// SiPeKA — API server (Node http, zero deps)
// Endpoint: login, change-password, transaksi (Setor Nota & Pengajuan Dana), closing (Daily Report), Widya AI (owner only)
// HARDENING v2: error boundary, body limit, rate-limit login, security headers, no CORS wildcard,
//   session expiry, revoke on pw change/reset, idempotency scoped, approval atomic,
//   balance approved-only, closing lock, MIME verify upload, authenticated receipt, safe stream.
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { normalizeReceipt, friendlyFilename, safeDisplayFilename } = require('./receipt-upload');
const { receiptDisplayName } = require('./storage');
const { q, uid, atomicApprove, createSession, getValidSession,
  revokeUserSessions, checkIdempotency, ready, withRequestTransaction, db } = require(process.env.DATABASE_URL ? "./db-postgres" : "./db");

const deviceStaff = require('./device-staff');
const accounting = require('./accounting');
const accountingReviewKey = crypto.randomBytes(32); // Restart invalidates outstanding reviews; no persisted drafts.
function accountingFailure(code,status=400){return Object.assign(new Error(code),{accountingCode:code,status});}
async function accountingGuard(pool) {
  const tables=['accounting_accounts','accounting_journals','accounting_lines','accounting_period_locks','accounting_category_maps','accounting_funds'];
  const role=(await pool.query('SELECT current_user role,current_schema() schema')).rows[0];
  if(role.role!=='sipeka_runtime')throw Error('ACCOUNTING_RUNTIME_ROLE_REQUIRED');
  if((await pool.query("SELECT has_schema_privilege(current_user,current_schema(),'CREATE') allowed")).rows[0].allowed)throw Error('ACCOUNTING_SCHEMA_CREATE_DENIED');
  for(const table of tables){
    const row=(await pool.query("SELECT has_table_privilege(current_user,$1,'INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER') unsafe",[table])).rows[0];
    if(row.unsafe)throw Error('ACCOUNTING_DML_DENIED');
    const col=(await pool.query("SELECT 1 FROM information_schema.column_privileges WHERE table_schema=current_schema() AND table_name=$1 AND grantee IN(current_user,'PUBLIC') AND privilege_type IN('INSERT','UPDATE') LIMIT 1",[table])).rows;
    if(col.length)throw Error('ACCOUNTING_COLUMN_DML_DENIED');
  }
  const required={accounting_journals:['accounting_header_balanced','accounting_header_immutable'],accounting_lines:['accounting_lines_balanced','accounting_lines_immutable'],accounting_accounts:['accounting_accounts_immutable'],accounting_category_maps:['accounting_maps_immutable'],accounting_funds:['accounting_funds_immutable']};
  for(const [table,names] of Object.entries(required)){
    const rows=(await pool.query('SELECT tgname,tgenabled,tgdeferrable,tginitdeferred,p.proname FROM pg_trigger t JOIN pg_proc p ON p.oid=t.tgfoid WHERE t.tgrelid=$1::regclass AND NOT t.tgisinternal',[table])).rows;
    for(const name of names){const r=rows.find(r=>r.tgname===name);if(!r||!['O','A'].includes(r.tgenabled)||r.proname!==(name.endsWith('balanced')?'accounting_balance_guard':'sipeka_immutable_guard')||(name.endsWith('balanced')&&(!r.tgdeferrable||!r.tginitdeferred)))throw Error('ACCOUNTING_GUARD_REQUIRED');}
  }
  const types=(await pool.query("SELECT column_name,data_type FROM information_schema.columns WHERE table_schema=current_schema() AND table_name='accounting_lines' AND column_name IN('debit','credit')")).rows;
  if(types.length!==2||types.some(r=>r.data_type!=='bigint'))throw Error('ACCOUNTING_EXACT_IDR_REQUIRED');
  for(const signature of ['accounting_owner(text)','accounting_post(text,jsonb)','accounting_preview(text,jsonb)']){
    const r=(await pool.query("SELECT p.prosecdef,p.proconfig,pg_get_userbyid(p.proowner) owner,has_function_privilege(current_user,p.oid,'EXECUTE') allowed,EXISTS(SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE') public FROM pg_proc p WHERE p.oid=$1::regprocedure",[signature])).rows[0];
    if(!r||!r.prosecdef||r.owner===role.role||!r.allowed||r.public||!r.proconfig?.includes('search_path='+role.schema+', pg_temp'))throw Error('ACCOUNTING_FUNCTION_ACL_REQUIRED');
  }
}
function accountingDraft(b){
  const fields=['sourceType','sourceId','fundId','accountingDate','idempotencyKey','evidence'];
  if(Object.keys(b).some(k=>!fields.includes(k))||!['CASH_TRANSACTION','REVERSAL'].includes(b.sourceType)||typeof b.sourceId!=='string'||!b.sourceId||b.sourceId.length>128||typeof b.idempotencyKey!=='string'||!b.idempotencyKey||b.idempotencyKey.length>128||typeof b.evidence!=='string'||b.evidence.trim().length<10||b.evidence.length>2000||typeof b.accountingDate!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(b.accountingDate)||!Number.isFinite(Date.parse(b.accountingDate+'T00:00:00Z'))||new Date(b.accountingDate+'T00:00:00Z').toISOString().slice(0,10)!==b.accountingDate)throw accountingFailure('ACCOUNTING_DRAFT_INVALID');
  if(b.sourceType==='CASH_TRANSACTION'&&(typeof b.fundId!=='string'||!b.fundId||b.fundId.length>128))throw accountingFailure('NAMED_FUND_REQUIRED');
  if(b.sourceType==='REVERSAL'&&Object.hasOwn(b,'fundId'))throw accountingFailure('ACCOUNTING_DRAFT_INVALID');
  return {...b};
}
async function accountingSource(pool,draft,sessionToken){
  return (await pool.query('SELECT accounting_preview($1,$2::jsonb) source',[sessionToken,JSON.stringify(draft)])).rows[0].source;
}
function accountingSign(value){return crypto.createHmac('sha256',accountingReviewKey).update(value).digest('base64url');}
const security = require("./auth-security");
const authConfig = security.config();
const authReady = Promise.resolve(ready).then(async () => {
  if (process.env.DATABASE_URL) {
    await db.prepare("SELECT password_change_required,totp_cipher,totp_pending_cipher,totp_pending_until,totp_last_counter,recovery_hashes FROM app_users LIMIT 0").all();
    await db.prepare("SELECT last_seen_at,purpose FROM sessions LIMIT 0").all();
    await db.prepare("SELECT token_hash,status,reviewed_by FROM payroll_telegram_bindings LIMIT 0").all();
    await accountingGuard(require('./db-postgres').getPool());
    await require('./advance-service').guard(require('./db-postgres').getPool());
    await deviceStaff.guard(require('./db-postgres').getPool());
    await require('./widya-sessions').guard(require('./db-postgres').getPool());
    await require('./document-numbering').guard(require('./db-postgres').getPool());
  } else if (authConfig.requireOwner2FA || authConfig.production) throw new Error("Public auth requires PostgreSQL migration 002");
});
authReady.catch(() => {});
const loginLimiter = security.createLimiter();
const mfaLimiter = security.createLimiter();
const TOTP_KEY = process.env.AUTH_TOTP_KEY || '';
if (authConfig.requireOwner2FA) security.encryptionKey(TOTP_KEY);
const PORT = process.env.PORT || 4321;
const HOST = process.env.HOST || "127.0.0.1";
// Receipt analysis uses Widya's isolated supported vision-tool worker, never direct inference.

const PUBLIC_DIR = path.join(__dirname, "public");
const HTML_PATH = path.join(PUBLIC_DIR, "financial-dashboard.html");
const { saveReceipt, readReceipt, deleteReceipt } = require("./storage");

// ---------- CORS whitelist ----------
const ALLOWED_ORIGINS = (process.env.CORS_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean);



// ---------- security headers ----------
const SECURITY_HEADERS = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Content-Security-Policy":
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
};

// ---------- MIME magic bytes ----------
function detectImageMime(buf) {
  // Verify full signatures and bounded container lengths, not a prefix alone.
  if (buf.length >= 45 && buf.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) {
    let pos = 8, hasHeader = false, hasData = false;
    while (pos + 12 <= buf.length) {
      const len = buf.readUInt32BE(pos), type = buf.toString("ascii", pos + 4, pos + 8);
      if (len > buf.length - pos - 12) return null;
      if (!hasHeader) {
        if (type !== "IHDR" || len !== 13 || !buf.readUInt32BE(pos + 8) || !buf.readUInt32BE(pos + 12)) return null;
        hasHeader = true;
      } else if (type === "IHDR") return null;
      if (type === "IDAT" && len > 0) hasData = true;
      pos += len + 12;
      if (type === "IEND") return len === 0 && hasData && pos === buf.length ? "image/png" : null;
    }
    return null;
  }
  if (buf.length >= 16 && buf[0] === 255 && buf[1] === 216 && buf[2] === 255) {
    let pos = 2, hasFrame = false;
    while (pos + 4 <= buf.length) {
      if (buf[pos++] !== 255) return null;
      while (buf[pos] === 255) pos++;
      const marker = buf[pos++];
      if (!marker || marker === 216 || marker === 217 || (marker >= 208 && marker <= 215)) return null;
      if (pos + 2 > buf.length) return null;
      const len = buf.readUInt16BE(pos);
      if (len < 2 || pos + len > buf.length) return null;
      if ([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(marker)) {
        if (len < 8 || !buf.readUInt16BE(pos + 3) || !buf.readUInt16BE(pos + 5)) return null;
        hasFrame = true;
      }
      if (marker === 218) return hasFrame && len >= 6 && pos + len < buf.length - 2 &&
        buf[buf.length - 2] === 255 && buf[buf.length - 1] === 217 ? "image/jpeg" : null;
      pos += len;
    }
    return null;
  }
  if (buf.length >= 20 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WEBP") {
    if (buf.readUInt32LE(4) + 8 !== buf.length) return null;
    let pos = 12, hasImage = false;
    while (pos + 8 <= buf.length) {
      const type = buf.toString("ascii", pos, pos + 4), len = buf.readUInt32LE(pos + 4), data = pos + 8;
      if (len > buf.length - data) return null;
      if (type === "VP8 ") {
        if (len < 10 || !buf.subarray(data + 3, data + 6).equals(Buffer.from([157,1,42])) ||
            !(buf.readUInt16LE(data + 6) & 16383) || !(buf.readUInt16LE(data + 8) & 16383)) return null;
        hasImage = true;
      } else if (type === "VP8L") {
        if (len < 5 || buf[data] !== 47) return null;
        hasImage = true;
      } else if (type === "VP8X" && len !== 10) return null;
      else if (type === "ANMF") {
        if (len < 24) return null;
        hasImage = true;
      }
      pos = data + len + (len & 1);
    }
    return hasImage && pos === buf.length ? "image/webp" : null;
  }
  if (buf.length >= 14 && ["GIF87a", "GIF89a"].includes(buf.toString("ascii", 0, 6))) {
    if (!buf.readUInt16LE(6) || !buf.readUInt16LE(8)) return null;
    let pos = 13 + ((buf[10] & 128) ? 3 * (1 << ((buf[10] & 7) + 1)) : 0), hasImage = false;
    function skipBlocks() {
      while (pos < buf.length) {
        const len = buf[pos++];
        if (!len) return true;
        if (pos + len > buf.length) return false;
        pos += len;
      }
      return false;
    }
    while (pos < buf.length) {
      const marker = buf[pos++];
      if (marker === 59) return hasImage && pos === buf.length ? "image/gif" : null;
      if (marker === 33) {
        if (pos >= buf.length) return null;
        pos++;
        if (!skipBlocks()) return null;
      } else if (marker === 44) {
        if (pos + 9 > buf.length || !buf.readUInt16LE(pos + 4) || !buf.readUInt16LE(pos + 6)) return null;
        const packed = buf[pos + 8];
        pos += 9 + ((packed & 128) ? 3 * (1 << ((packed & 7) + 1)) : 0);
        if (pos >= buf.length || buf[pos] < 2 || buf[pos++] > 8 || !skipBlocks()) return null;
        hasImage = true;
      } else return null;
    }
  }
  return null;
}

const RECEIPT_FILENAME = /^evidence-[0-9]+-[a-f0-9]{6}\.(?:jpg|png|webp|gif)$/;
function receiptFilename(key) {
  if (typeof key !== "string" || !key.startsWith("/api/receipts/")) return null;
  const name = key.slice("/api/receipts/".length);
  return RECEIPT_FILENAME.test(name) ? name : null;
}
function canAccessReceipt(me, asset) {
  return me.role === "OWNER" || (me.role === "STAFF" && asset.user_id === me.id && asset.branch_id === me.assigned_branch_id);
}
function idempotencyKey(value) {
  if (value === undefined || value === null || value === "") return uid();
  if (typeof value !== "string" || value.length > 200 || !value.trim())
    throw Object.assign(new Error("idempotency_key tidak valid"), { code: 400 });
  return value;
}
function fingerprintOf(payload) {
  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}
function dateWIB(value) {
  const utc = /(?:Z|[+-]\d\d:\d\d)$/.test(value) ? value : value.replace(" ", "T") + "Z";
  const date = new Date(utc);
  if (!Number.isFinite(date.getTime())) throw new Error("Invalid transaction timestamp");
  return new Date(date.getTime() + 7 * 3600_000).toISOString().slice(0, 10);
}

// ---------- utils ----------
function corsHeaders(origin) {
  if (!origin) return {};
  if (ALLOWED_ORIGINS.length > 0 && ALLOWED_ORIGINS.includes(origin)) {
    return { "Access-Control-Allow-Origin": origin, "Vary": "Origin" };
  }
  return {};
}

function json(res, code, obj) {
  if (res._deferJSON) { res._pendingJSON = [code, obj]; return; }
  const body = JSON.stringify(obj);
  const origin = res._sipeka_origin || "";
  res.writeHead(code, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    ...corsHeaders(origin),
    ...SECURITY_HEADERS,
  });
  res.end(body);
}

const BODY_LIMIT_JSON = 1_048_576;
const BODY_LIMIT_IMAGE = 8_388_608;

function readBody(req) {
  return new Promise((resolve, reject) => {
    const limit = req._bodyLimit || BODY_LIMIT_JSON;
    let size = 0;
    let tooLarge = false;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) {
        tooLarge = true;
        // Drain sisa data tanpa menyimpan, agar koneksi tetap hidup untuk response
        return;
      }
      if (!tooLarge) chunks.push(c);
    });
    req.on("end", () => {
      if (tooLarge) {
        return reject(Object.assign(new Error("Request body terlalu besar"), { code: 413 }));
      }
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try {
        const parsed = JSON.parse(raw);
        if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
          return reject(Object.assign(new Error("Body harus berupa JSON object"), { code: 400 }));
        }
        resolve(parsed);
      } catch {
        reject(Object.assign(new Error("JSON tidak valid"), { code: 400 }));
      }
    });
    req.on("error", (e) => reject(e));
  });
}

async function auth(req) {
  const token = security.sessionToken(req, authConfig);
  if (!token) return null;
  const me = await getValidSession(token);
  if (!me) return null;
  if (process.env.DATABASE_URL) {
    const session = await db.prepare("SELECT last_seen_at,purpose FROM sessions WHERE token=$1").get(token);
    const seen = session && Date.parse(session.last_seen_at.replace(' ', 'T') + 'Z');
    if (!Number.isFinite(seen) || seen + authConfig.idleMS <= Date.now()) { await q.dropSession.run(token); return null; }
    me.session_purpose = session.purpose;
    await db.prepare("UPDATE sessions SET last_seen_at=(clock_timestamp() AT TIME ZONE 'UTC') WHERE token=$1", { write: true }).run(token);
  }
  return me;
}
function publicUser(user, purpose = 'full') {
  return { id: user.id, username: user.username, full_name: user.full_name, role: user.role, branch_id: user.assigned_branch_id,
    password_change_required: !!user.password_change_required, totp_enabled: !!user.totp_cipher, session_purpose: purpose };
}
async function issueSession(res, user, purpose) {
  const token = crypto.randomBytes(32).toString('hex');
  await createSession(token, user.id);
  if (process.env.DATABASE_URL) await db.prepare("UPDATE sessions SET purpose=$1 WHERE token=$2", { write: true }).run(purpose, token);
  res.setHeader('Set-Cookie', security.cookie(token, authConfig));
  return { ...(authConfig.bearer ? { token } : {}), user: publicUser(user, purpose) };
}

// ---------- Widya AI ----------
const widyaBridge = require('./widya-bridge').createWidyaBridge();
const widyaSessions = process.env.DATABASE_URL ? require('./widya-sessions').createWidyaSessions({pool:require('./db-postgres').getPool(),bridge:widyaBridge,context:widyaLedgerContext}) : null;
authReady.then(()=>widyaSessions?.start()).catch(()=>{});
const widyaReceiptRouter = require('./widya-receipt-analysis').createWidyaReceiptRouter({
  authenticate:async(req,options)=>process.env.DATABASE_URL
    ? require('./widya-receipt-db').createWidyaReceiptDB(require('./db-postgres').getPool(),{idleMS:authConfig.idleMS}).authenticate(security.sessionToken(req,authConfig),options)
    : auth(req).then(actor=>actor?.session_purpose==='full'&&!actor.password_change_required?actor:null),
  checkRequest:async req=>!!security.cookieToken(req)&&security.validOrigin(req,authConfig),
  lookupReceipt:(filename,options)=>process.env.DATABASE_URL
    ? require('./widya-receipt-db').createWidyaReceiptDB(require('./db-postgres').getPool(),{idleMS:authConfig.idleMS}).lookupReceipt(filename,options)
    : q.receiptByFilename.get(filename),
  readReceipt:require('./receipt-storage-bounded').createBoundedReceiptReader(),
  bridge:widyaBridge,sendJSON:json,
});
async function widyaLedgerContext() {
 const txs = (await deviceStaff.annotate({query:require('./db-postgres').query},'ledger_transactions',await q.txAll.all())).slice(0,40);
 return require('./widya-account-context').build(txs,await q.allCoa.all());
}

// ---------- router ----------
const server = http.createServer(async (req, res) => {
  res._sipeka_origin = req.headers.origin || "";

  let url, p;
  try {
    url = new URL(req.url, "http://localhost");
    p = url.pathname;
  } catch {
    res.writeHead(400, { "Content-Type": "application/json", ...SECURITY_HEADERS });
    res.end(JSON.stringify({ error: "URL tidak valid" }));
    return;
  }

  if (req.method === "OPTIONS") {
    const origin = req.headers.origin || "";
    const h = {
      ...SECURITY_HEADERS,
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
    };
    if (ALLOWED_ORIGINS.length > 0 && ALLOWED_ORIGINS.includes(origin)) {
      h["Access-Control-Allow-Origin"] = origin;
      h["Vary"] = "Origin";
    }
    res.writeHead(204, h);
    res.end();
    return;
  }

  if ((p === "/api/ready" || p === "/api/readiness") && req.method === "GET") {
    try {
      await authReady;
      await db.prepare("SELECT 1 AS ok").get();
      return json(res, 200, { ok: true, database: process.env.DATABASE_URL ? "postgresql" : "sqlite" });
    } catch {
      return json(res, 503, { ok: false, error: "Database belum siap" });
    }
  }

  if (p === "/api/health" && req.method === "GET") {
    res.writeHead(200, { "Content-Type": "application/json", ...SECURITY_HEADERS });
    res.end(JSON.stringify({ ok: true, ts: new Date().toISOString() }));
    return;
  }

  try {
    await authReady;
    if(p.startsWith('/api/payroll'))return json(res,410,{error:'PAYROLL_DISABLED_DEVICE_MODEL'});
    if (p.startsWith('/api/') && !['GET','HEAD','OPTIONS'].includes(req.method) && !security.validOrigin(req, authConfig))
      return json(res, 403, { error: "Origin tidak diizinkan" });
    const mutation = req.method === "POST" && (["/api/login", "/api/logout", "/api/change-password", "/api/users", "/api/users/reset-password", "/api/units", "/api/units/archive", "/api/transactions", "/api/approvals", "/api/closing"].includes(p) || p.startsWith('/api/auth/') || p==='/api/operational-staff' || p==='/api/devices/configure' || deviceStaff.financialPath(p));
    if (process.env.DATABASE_URL && mutation) {
      // Do not report success until PostgreSQL has committed the entire request.
      res._deferJSON = true;
      await withRequestTransaction(() => handleRequest(req, res, url, p));
      res._deferJSON = false;
      if (res._pendingJSON) json(res, ...res._pendingJSON);
    } else await handleRequest(req, res, url, p);
  } catch (err) {
    if (res.headersSent) return;
    if(err.code==='23505'&&p==='/api/operational-staff'){res._deferJSON=false;return json(res,409,{error:'Email sudah digunakan karyawan lain'});}
    res.removeHeader('Set-Cookie'); // Never send a session cookie from a rolled-back request.
    if (err.message === 'RECEIPT_RESERVED_FOR_ADVANCE') {
      res._deferJSON = false;
      return json(res, 409, { error: 'Nota sudah dicadangkan untuk settlement advance. Gunakan nota lain.' });
    }
    if(/^OPERATIONAL_[A-Z_]+$/.test(err.message||'')){res._deferJSON=false;return json(res,err.code==='42501'?403:409,{error:err.message});}
    const status = err.statusCode ?? err.code;
    const code = Number.isInteger(status) && status >= 400 && status < 600 ? status : 500;
    const msg = code === 500 ? "Terjadi kesalahan server" : err.message;
    if (code === 500) console.error("[sipeka] request failed");
    res.writeHead(code, { "Content-Type": "application/json", ...SECURITY_HEADERS });
    res.end(JSON.stringify({ error: msg }));
  }
});

async function handleRequest(req, res, url, p) {
  // Never fall through to the public image handler for legacy receipt locations.
  let decodedPath;
  try { decodedPath = decodeURIComponent(p); }
  catch { return json(res, 400, { error: "URL tidak valid" }); }
  if (/^\/+uploads(?:\/|$)/i.test(decodedPath.replace(/\\/g, "/")))
    return json(res, 404, { error: "not found" });
  if (p === "/api/login" && req.method === "POST") {
    const b = await readBody(req);
    const username = String(b.username || "").trim().toLowerCase().slice(0, 200);
    if (loginLimiter.blocked(username, security.clientIP(req, authConfig)))
      return json(res, 429, { error: "Terlalu banyak percobaan login. Coba lagi nanti." });
    const user = await q.userByUsername.get(username);
    const checked = await security.checkPassword(String(b.password || ""), user?.password_hash);
    if (!user || !checked.valid) return json(res, 401, { error: "Username atau password salah" });
    loginLimiter.reset(username, security.clientIP(req, authConfig));
    if (checked.rehash) await q.updateUserPassword.run(await security.hashVerifiedPassword(String(b.password)), user.id);
    const purpose = user.password_change_required ? 'setup' : 'full';
    return json(res, 200, await issueSession(res, user, purpose));
  }

  if (p === "/api/logout" && req.method === "POST") {
    const token = security.sessionToken(req, authConfig);
    if (token) await q.dropSession.run(token);
    res.setHeader('Set-Cookie', security.cookie('', authConfig));
    return json(res, 200, { ok: true });
  }

  const me = await auth(req);
  if (p.startsWith("/api/") && !me) return json(res, 401, { error: "unauthorized" });

  if (p === "/api/me" && req.method === "GET") {
    return json(res, 200, publicUser(me, me.session_purpose));
  }

  if (p.startsWith('/api/') && me && (me.session_purpose !== 'full' || me.password_change_required) && p !== '/api/change-password')
    return json(res, 403, { error: 'Ganti password untuk mengamankan akun', setup_required: true });

  if(p==='/api/documents/issue'||p.startsWith('/api/documents/')){
    if(me.role!=='OWNER')return json(res,403,{error:'DOCUMENT_OWNER_REQUIRED'});
    if(!process.env.DATABASE_URL)return json(res,503,{error:'DOCUMENT_POSTGRES_REQUIRED'});
    const numbering=require('./document-numbering'),pool=require('./db-postgres').getPool(),token=security.cookieToken(req);
    try{
      if(p==='/api/documents/issue'&&req.method==='POST')return json(res,201,await numbering.issue(pool,token,await readBody(req)));
      const match=p.match(/^\/api\/documents\/([a-f0-9-]{36})$/i);
      if(match&&req.method==='GET')return json(res,200,await numbering.get(pool,token,match[1]));
      return json(res,404,{error:'DOCUMENT_NOT_FOUND'});
    }catch(e){return json(res,e.status||503,{error:/^DOCUMENT_[A-Z_]+$/.test(e.code||'')?e.code:'DOCUMENT_UNAVAILABLE'});}
  }
  if(p.startsWith('/api/employee-payroll')){
    if(me.role!=='OWNER')return json(res,403,{error:'PAYROLL_OWNER_ONLY'});
    if(!process.env.DATABASE_URL)return json(res,503,{error:'PAYROLL_POSTGRES_REQUIRED'});
    const token=security.cookieToken(req);if(!token)return json(res,401,{error:'PAYROLL_COOKIE_REQUIRED'});
    const svc=require('./employee-payroll').service({pool:require('./db-postgres').getPool()});
    try{
      if(p==='/api/employee-payroll'&&req.method==='GET')return json(res,200,await svc.list(token));
      if(p==='/api/employee-payroll/template'&&req.method==='GET'){
        res.writeHead(200,{'Content-Type':'text/csv;charset=utf-8','Content-Disposition':'attachment; filename="template-gaji-karyawan.csv"','Cache-Control':'no-store',...SECURITY_HEADERS});return res.end('\uFEFF'+require('./employee-payroll').HEADER+'\r\n');
      }
      if(p==='/api/employee-payroll/import'&&req.method==='POST')return json(res,201,await svc.importCsv(token,(await readBody(req)).csv));
      if(p==='/api/employee-payroll/publish'&&req.method==='POST')return json(res,200,await svc.publish(token,await readBody(req)));
      const match=p.match(/^\/api\/employee-payroll\/entries\/([a-f0-9-]{36})\/(slip.pdf|send)$/);
      if(match&&match[2]==='slip.pdf'&&req.method==='GET'){
        const pdf=await svc.pdf(token,match[1]),filename=await svc.filename(token,match[1]);res.writeHead(200,{'Content-Type':'application/pdf','Content-Disposition':'attachment; filename="'+filename+'"','Cache-Control':'no-store',...SECURITY_HEADERS});return res.end(pdf);
      }
      if(match&&match[2]==='send'&&req.method==='POST')return json(res,200,await svc.send(token,match[1],await readBody(req)));
      return json(res,404,{error:'PAYROLL_NOT_FOUND'});
    }catch(e){const code=e.code==='23505'?'PAYROLL_DUPLICATE_PERIOD_STAFF':/^PAYROLL_[A-Z_0-9]+$/.test(e.message||'')?e.message:'PAYROLL_UNAVAILABLE';return json(res,e.code==='42501'?403:e.code==='23505'?409:e.status||(['PAYROLL_UNAVAILABLE','PAYROLL_DECRYPT_FAILED'].includes(code)?503:400),{error:code});}
  }
  if(p==='/api/company'&&['GET','POST'].includes(req.method)){
    if(!process.env.DATABASE_URL)return json(res,503,{error:'OPERATIONAL_POSTGRES_REQUIRED'});
    if(req.method==='POST'&&me.role!=='OWNER')return json(res,403,{error:'OPERATIONAL_OWNER_REQUIRED'});
    const body=req.method==='POST'?await readBody(req):null;
    if(body)try{require('./report-identity').companyName(body.name);}catch{return json(res,400,{error:'Nama perusahaan wajib diisi, maksimal 80 karakter'});}
    const result=await require('./db-postgres').query('SELECT company_profile_access($1,$2::jsonb) result',[security.cookieToken(req),body===null?null:JSON.stringify(body)]);
    return json(res,200,result.rows[0].result);
  }
  if (p==='/api/operational-staff' || p==='/api/devices/configure') {
    if(!process.env.DATABASE_URL)return json(res,503,{error:'OPERATIONAL_POSTGRES_REQUIRED'});
    if(req.method==='GET'&&p==='/api/operational-staff')return json(res,200,await deviceStaff.directory(security.cookieToken(req)));
    if(req.method==='POST'){
      if(me.role!=='OWNER')return json(res,403,{error:'OPERATIONAL_OWNER_REQUIRED'});
      const b=await readBody(req);
      if(!b||Array.isArray(b)||typeof b!=='object'||(p==='/api/devices/configure')!==Object.hasOwn(b,'device_id'))return json(res,400,{error:'OPERATIONAL_INPUT_INVALID'});
      return json(res,200,await deviceStaff.directory(security.cookieToken(req),b));
    }
    return json(res,405,{error:'METHOD_NOT_ALLOWED'});
  }
  if(req.method==='POST'&&deviceStaff.financialPath(p)) {
    if(!process.env.DATABASE_URL)return json(res,503,{error:'OPERATIONAL_POSTGRES_REQUIRED'});
    req.operationalStaff=await deviceStaff.bind(req,security.cookieToken(req));
  }

  if (p.startsWith('/api/accounting')) {
    if(me.role!=='OWNER')return json(res,403,{error:'ACCOUNTING_OWNER_ONLY'});
    if(!process.env.DATABASE_URL)return json(res,503,{error:'ACCOUNTING_POSTGRES_REQUIRED'});
    // Accounting never accepts the private QA bearer transport or AI tool identity.
    const sessionToken=security.cookieToken(req);
    if(!sessionToken)return json(res,401,{error:'ACCOUNTING_COOKIE_REQUIRED'});
    try {
      const pool=require('./db-postgres').getPool();
      if(p==='/api/accounting/trial-balance'&&req.method==='GET'){
        if([...url.searchParams.keys()].some(k=>!['start','end','branchId'].includes(k)||url.searchParams.getAll(k).length!==1))return json(res,400,{error:'INVALID_DATE_RANGE'});
        const branchId=url.searchParams.get('branchId');
        if(branchId!==null&&!(await pool.query('SELECT id FROM business_units WHERE id=$1',[branchId])).rows.length)return json(res,404,{error:'ACCOUNTING_BRANCH_NOT_FOUND'});
        return json(res,200,await accounting.trialBalance(pool,sessionToken,{start:url.searchParams.get('start'),end:url.searchParams.get('end'),branchId}));
      }
      if(p==='/api/accounting/review'&&req.method==='POST'){
        const draft=accountingDraft(await readBody(req)),source=await accountingSource(pool,draft,sessionToken);
        const value=Buffer.from(JSON.stringify({draft,source,actor:me.id,session:crypto.createHash('sha256').update(sessionToken).digest('hex'),expires:Date.now()+600000})).toString('base64url');
        return json(res,200,{draft,source,reviewToken:value+'.'+accountingSign(value),expiresInSeconds:600,notice:'Review belum memposting. Pemetaan dana dan kategori telah divalidasi; persetujuan memvalidasi ulang. Draft sementara, kedaluwarsa 10 menit, hilang saat restart; bukan antrean tersimpan. Laporan ini menampilkan mutasi tercatat, bukan neraca lengkap.'});
      }
      if(p==='/api/accounting/approve'&&req.method==='POST'){
        const b=await readBody(req);
        if(Object.keys(b).some(k=>!['reviewToken','approved'].includes(k))||b.approved!==true||typeof b.reviewToken!=='string'||b.reviewToken.length>16000)throw accountingFailure('ACCOUNTING_EXPLICIT_APPROVAL_REQUIRED');
        const [value,signature,...rest]=b.reviewToken.split('.');
        const expected=accountingSign(value||'');
        if(rest.length||!signature||signature.length!==expected.length||!crypto.timingSafeEqual(Buffer.from(signature),Buffer.from(expected)))throw accountingFailure('ACCOUNTING_REVIEW_INVALID');
        const r=JSON.parse(Buffer.from(value,'base64url').toString('utf8'));
        if(r.actor!==me.id||r.session!==crypto.createHash('sha256').update(sessionToken).digest('hex')||r.expires<Date.now())throw accountingFailure('ACCOUNTING_REVIEW_EXPIRED');
        const draft=accountingDraft(r.draft),source=await accountingSource(pool,draft,sessionToken);
        if(JSON.stringify(source)!==JSON.stringify(r.source))throw accountingFailure('ACCOUNTING_SOURCE_CHANGED',409);
        const posted=await accounting.post(pool,sessionToken,draft);
        // Read exact immutable target after committed function call before success.
        const journal=(await pool.query('SELECT id,source_type,source_id,actor_id,accounting_date::text accounting_date FROM accounting_journals WHERE id=$1',[posted.id])).rows[0];
        if(!journal||journal.actor_id!==me.id)throw accountingFailure('ACCOUNTING_READBACK_FAILED',503);
        return json(res,200,{...posted,journal});
      }
      return json(res,404,{error:'not found'});
    }catch(e){
      const code=e.accountingCode||(/^[A-Z][A-Z_]+$/.test(e.message||'')?e.message:null);
      const clientCodes=['ISO_DATE_REQUIRED','INVALID_DATE_RANGE','INVALID_BRANCH','APPROVAL_EVIDENCE_REQUIRED','ACCOUNTING_DATE_REQUIRED','APPROVED_REALIZED_SOURCE_REQUIRED','NAMED_FUND_REQUIRED','QRIS_OUTFLOW_UNSUPPORTED','QRIS_CLEARING_REQUIRED','REVIEWED_CATEGORY_REQUIRED','REVERSAL_ORIGINAL_REQUIRED','REVERSAL_DATE_BEFORE_ORIGINAL','SOURCE_TYPE_UNSUPPORTED'];
      const status=e.accountingCode?e.status:code==='OWNER_REQUIRED'?403:['IDEMPOTENCY_CONFLICT','ACCOUNTING_PERIOD_LOCKED'].includes(code)||e.code==='23505'?409:clientCodes.includes(code)?400:503;
      return json(res,status,{error:code|| (e.code==='23505'?'ACCOUNTING_SOURCE_ALREADY_POSTED':'ACCOUNTING_UNAVAILABLE')});
    }
  }

  if(p==='/api/coa'&&req.method==='GET')return json(res,200,require('./coa-catalog').inputAccounts(await q.allCoa.all()));
  if(p==='/api/advance-categories'&&req.method==='GET')return json(res,200,require('./coa-catalog').inputAccounts(await q.allCoa.all()).filter(c=>c.account_type==='EXPENSE'));
  if (p.startsWith('/api/advances') || p==='/api/reports/advance-movements') {
    const match=p.match(/^\/api\/advances\/([^/]+)\/(disburse|return|settlements)(?:\/([^/]+)\/(approve|reject))?$/);
    const staffRoute=p==='/api/advances/own-unresolved'||match&&match[2]==='settlements'&&!match[4];
    if(me.role!==(staffRoute?'STAFF':'OWNER'))return json(res,403,{error:staffRoute?'STAFF_REQUIRED':'OWNER_REQUIRED'});
    if(!process.env.DATABASE_URL)return json(res,503,{error:'ADVANCE_POSTGRES_REQUIRED'});
    const svc=require('./advance-service'),pool={query:require('./db-postgres').query},sessionToken=security.cookieToken(req);
    if(!sessionToken)return json(res,401,{error:'ADVANCE_COOKIE_REQUIRED'});
    try{
      if(req.method==='GET'&&p==='/api/advances/own-unresolved')return json(res,200,await deviceStaff.advances(pool,await svc.listOwn(pool,sessionToken)));
      if(req.method==='GET'&&p==='/api/advances')return json(res,200,await deviceStaff.advances(pool,await svc.snapshot(pool,sessionToken)));
      if(req.method==='GET'&&p==='/api/reports/advance-movements')return json(res,200,await svc.report(pool,sessionToken,{start:url.searchParams.get('start'),end:url.searchParams.get('end'),branchId:url.searchParams.get('branchId')}));
      if(req.method==='POST'&&match){
        const b=await readBody(req),advanceId=decodeURIComponent(match[1]),settlementId=match[3]?decodeURIComponent(match[3]):undefined;
        const fields=['idempotencyKey','evidence',...(match[2]==='return'?['amount']:match[2]==='settlements'&&!match[4]?['lines']:[]),...(['disburse','return'].includes(match[2])?['confirmed']:[])];
        if(Object.keys(b).some(k=>!fields.includes(k)))return json(res,400,{error:'ADVANCE_PAYLOAD_INVALID'});
        if(['disburse','return'].includes(match[2])&&b.confirmed!==true)return json(res,400,{error:'EXPLICIT_CASH_CONFIRMATION_REQUIRED'});
        const request={...b,operationalStaff:req.operationalStaff,advanceId,...(settlementId?{settlementId}:{})};delete request.confirmed;
        const method=match[4]==='approve'?'approveSettlement':match[4]==='reject'?'rejectSettlement':match[2]==='disburse'?'disburse':match[2]==='return'?'confirmReturn':'submitSettlement';
        return json(res,200,await svc[method](pool,sessionToken,request));
      }
      return json(res,404,{error:'not found'});
    }catch(e){
      const code=/^[A-Z][A-Z_]+$/.test(e.message||'')?e.message:null;
      const invalid=['EVIDENCE_AND_KEY_REQUIRED','EXACT_IDR_REQUIRED','FULL_SETTLEMENT_LINES_REQUIRED','EXPENSE_CATEGORY_REQUIRED','DATE_RANGE_REQUIRED'];
      return json(res,e.code==='42501'?403:code?.endsWith('_NOT_FOUND')?404:invalid.includes(code)?400:code||e.code==='23505'?409:503,{error:code||'ADVANCE_UNAVAILABLE'});
    }
  }

  if (p.startsWith('/api/reports/')) {
    if(me.role!=='OWNER')return json(res,403,{error:'REPORT_OWNER_ONLY'});
    if(!process.env.DATABASE_URL)return json(res,503,{error:'REPORT_POSTGRES_REQUIRED'});
    const token=security.cookieToken(req);
    if(!token)return json(res,401,{error:'REPORT_COOKIE_REQUIRED'});
    const match=p.match(/^\/api\/reports\/([a-z-]+)(\/export)?$/);
    if(!match||req.method!=='GET'||match[1]==='quarterly-data'||(match[1]==='quarterly-owner'&&match[2]))return json(res,404,{error:'REPORT_NOT_FOUND'});
    const reports=require('./operational-reports'),params=new URLSearchParams(url.searchParams);
    const exportFormat=params.get('format');let exportCompany,exportDocument;
    const documentId=params.get('document_id');
    if(documentId!==null){
      if(params.getAll('document_id').length!==1)return json(res,400,{error:'DOCUMENT_INVALID_REQUEST'});
      params.delete('document_id');
      try{exportDocument=await require('./document-numbering').get(require('./db-postgres').getPool(),token,documentId);require('./document-numbering').assertMatches(exportDocument,{report_id:match[1],branch_id:params.get('branch_id')||'all',date_from:params.get('date_from'),date_to:params.get('date_to'),view_mode:params.get('view_mode')||undefined});}
      catch(e){return json(res,e.status||503,{error:e.code||'DOCUMENT_UNAVAILABLE'});}
    }
    if(match[2]){
      if(params.getAll('format').length!==1||!['csv','xlsx'].includes(exportFormat))return json(res,400,{error:'REPORT_CSV_FORMAT_REQUIRED'});
      params.delete('format');
      if(exportFormat==='xlsx'){
        if(!require('./report-template').kinds[match[1]])return json(res,400,{error:'REPORT_XLSX_TEMPLATE_UNAVAILABLE'});
        if(params.getAll('company_name').length!==1)return json(res,400,{error:'REPORT_COMPANY_REQUIRED'});
        try{exportCompany=require('./report-identity').companyName(params.get('company_name'));}catch{return json(res,400,{error:'REPORT_COMPANY_REQUIRED'});}
        params.delete('company_name');
      }
    }
    const client=await require('./db-postgres').getPool().connect();
    let report;
    try{
      await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
      await client.query("SET LOCAL statement_timeout='10s'");
      report=await reports.read(client,me,token,match[1],params);
      if(['fund-requests','daily-closings','audit-evidence'].includes(match[1])) {
        report.rows=await deviceStaff.annotate(client,match[1]==='daily-closings'?'cash_closings':'ledger_transactions',report.rows);
        for(const key of ['device_id','staff_id','staff_name','attribution'])if(!report.columns.some(c=>c.key===key))report.columns.push({key,label:key});
      }
      await client.query('COMMIT');
    }catch(e){
      try{await client.query('ROLLBACK');}catch{}
      const code=e.statusCode?e.statusCode:503;
      return json(res,code,{error:/^REPORT_[A-Z_]+$/.test(e.message||'')?e.message:'REPORT_SOURCE_UNAVAILABLE'});
    }finally{client.release();}
    if(exportDocument)report=require('./report-document').attach(report,exportDocument);
    if(match[2]){
      if(exportFormat==='xlsx'){
        const bytes=require('./report-template-xlsx').exportXlsx(report.templateLayout,exportCompany);
        res.writeHead(200,{'Content-Type':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','Content-Disposition':'attachment; filename="'+(exportDocument?require('./document-format').filename(exportDocument.code):'SiPeKA-'+match[1])+'.xlsx"',...SECURITY_HEADERS,'Cache-Control':'no-store'});return res.end(bytes);
      }
      const csv=reports.toCsv(report);
      res.writeHead(200,{'Content-Type':'text/csv; charset=utf-8','Content-Disposition':'attachment; filename="'+(exportDocument?require('./document-format').filename(exportDocument.code):'SiPeKA-'+match[1])+'.csv"',...SECURITY_HEADERS,'Cache-Control':'no-store'});
      return res.end(csv);
    }
    return json(res,200,report);
  }

  if ((p==='/api/units/archive' && req.method==='POST') || (/^\/api\/units\/[^/]+$/.test(p) && req.method==='DELETE')) {
    if(me.role!=='OWNER')return json(res,403,{error:'Khusus Owner'});
    const b=await readBody(req),id=req.method==='DELETE'?decodeURIComponent(p.slice('/api/units/'.length)):b.branch_id;
    if(typeof id!=='string'||!id.trim()||id.length>200||(b.reassign_to!=null&&(typeof b.reassign_to!=='string'||!b.reassign_to.trim()))||(b.reason!==undefined&&(typeof b.reason!=='string'||b.reason.length>1000)))return json(res,400,{error:'Data arsip cabang tidak valid'});
    const result=await q.archiveBranch.run(id,me.id,b.reassign_to??null,b.reason??'');return json(res,result.ok?200:result.statusCode,result);
  }
  if(p==='/api/units/rename' && req.method==='POST'){
    if(me.role!=='OWNER')return json(res,403,{error:'Khusus Owner'});
    const b=await readBody(req);if(typeof b.branch_id!=='string'||!b.branch_id.trim()||b.branch_id.length>200)return json(res,400,{error:'ID cabang tidak valid'});
    const result=await q.renameBranch.run(b.branch_id,me.id,b.name);return json(res,result.ok?200:result.statusCode,result);
  }
  // TOTP_REMOVED: enrollment and verification endpoints removed.
  if (p.startsWith('/api/auth/totp/')) return json(res, 404, { error: 'not found' });

  // CONTRACT: returns { ok, message, logout_required: true } — frontend WAJIB logout setelah ini
  if (p === "/api/change-password" && req.method === "POST") {
    const { old_password, new_password } = await readBody(req);
    if (!old_password || !new_password) return json(res, 400, { error: "Password lama dan baru wajib diisi" });
    security.validateNewPassword(new_password);
    const user = (await q.userById.get(me.id));
    if (!user || !(await security.checkPassword(String(old_password), user.password_hash)).valid)
      return json(res, 400, { error: "Password lama tidak sesuai" });
    (await q.updateUserPassword.run(await security.hashNewPassword(String(new_password)), me.id));
    if (process.env.DATABASE_URL) await db.prepare("UPDATE app_users SET password_change_required=false WHERE id=$1", { write: true }).run(me.id);
    await revokeUserSessions(me.id);
    res.setHeader('Set-Cookie', security.cookie('', authConfig));
    return json(res, 200, { ok: true, message: "Password berhasil diperbarui", logout_required: true });
  }

  if (p === "/api/users" && req.method === "GET") {
    if (me.role !== "OWNER") return json(res, 403, { error: "Khusus Owner" });
    return json(res, 200, (await q.allUsers.all()));
  }

  if (p === "/api/users" && req.method === "POST") {
    if (me.role !== "OWNER") return json(res, 403, { error: "Khusus Owner" });
    const { username, full_name, role, branch_id, password } = await readBody(req);
    if (!username || !full_name || !password) return json(res, 400, { error: "Username, nama lengkap, dan password wajib diisi" });
    const cleanUser = String(username).trim().toLowerCase();
    if (!cleanUser || cleanUser.length < 3) return json(res, 400, { error: "Username minimal 3 karakter tanpa spasi" });
    if ((await q.userByUsername.get(cleanUser))) return json(res, 400, { error: `Username @${cleanUser} sudah digunakan` });
    security.validateNewPassword(password);
    const userRole = role === "OWNER" ? "OWNER" : "STAFF";
    if (userRole === "STAFF" && !branch_id) return json(res, 400, { error: "Staff wajib terikat unit bisnis aktif" });
    const newId = "U_" + uid();
    try {
      if (branch_id) {
        if (typeof branch_id !== "string" || !(await q.unitByIdActive.get(branch_id))) return json(res, 400, { error: "Unit bisnis tidak ditemukan" });
      }
      (await q.insertUser.run(newId, cleanUser, await security.hashNewPassword(String(password)), String(full_name).trim(), userRole, branch_id || null));
      return json(res, 201, { ok: true, id: newId, username: cleanUser });
    } catch (e) {
      console.error("[users] write failed");
      return json(res, 400, { error: "Gagal membuat pengguna" });
    }
  }

  if (p === "/api/users/reset-password" && req.method === "POST") {
    if (me.role !== "OWNER") return json(res, 403, { error: "Khusus Owner" });
    const { user_id, new_password } = await readBody(req);
    if (!user_id || !new_password) return json(res, 400, { error: "user_id dan new_password wajib diisi" });
    security.validateNewPassword(new_password);
    const targetUser = (await q.userById.get(user_id));
    if (!targetUser) return json(res, 404, { error: "Pengguna tidak ditemukan" });
    (await q.resetUserPassword.run(await security.hashNewPassword(String(new_password)), user_id));
    await revokeUserSessions(user_id);
    return json(res, 200, { ok: true, message: `Password @${targetUser.username} berhasil direset`, sessions_revoked: true });
  }

  if (p === "/api/units" && req.method === "POST") {
    if (me.role !== "OWNER") return json(res, 403, { error: "Khusus Owner" });
    const { name, code, category } = await readBody(req);
    if (!name || !code) return json(res, 400, { error: "Nama cabang dan kode cabang wajib diisi" });
    const cleanCode = String(code).trim().toUpperCase();
    const cleanName = String(name).trim();
    if (typeof name !== 'string' || typeof code !== 'string' || !cleanName || cleanName.length>120 || !/^[A-Z0-9_-]{1,32}$/.test(cleanCode) || (category!==undefined && (typeof category!=='string' || !category.trim() || category.length>64))) return json(res,400,{error:'Data cabang tidak valid'});
    const branchId = "UNIT_" + uid();
    try {
      (await q.insertBranch.run(branchId, cleanCode, cleanName, category || "LAUNDRY"));
      return json(res, 201, { ok: true, id: branchId, name: cleanName, code: cleanCode });
    } catch (e) {
      console.error("[units] write failed");
      return json(res, 400, { error: "Gagal menambah cabang (kode/nama mungkin sudah ada)" });
    }
  }

  if (p === "/api/units" && req.method === "GET") {
    if(url.searchParams.get('include_archived')==='1' && me.role!=='OWNER')return json(res,403,{error:'Khusus Owner'});
    if (me.role === "STAFF") {
      const u = me.assigned_branch_id ? (await q.unitByIdActive.get(me.assigned_branch_id)) : null;
      return json(res, 200, u ? [u] : []);
    }
    if(url.searchParams.get('include_archived')==='1'){if(me.role!=='OWNER')return json(res,403,{error:'Khusus Owner'});return json(res,200,await q.allUnitsIncludingArchived.all());}
    return json(res, 200, (await q.allUnits.all()));
  }

  if (p === "/api/transactions" && req.method === "GET") {
    if (me.role === "STAFF") {
      return json(res, 200, { scope: "today-own", rows: (await deviceStaff.annotate({query:require('./db-postgres').query},'ledger_transactions',await q.txStaffToday.all(me.id, me.assigned_branch_id))) });
    }
    return json(res, 200, { scope: "all", rows: (await deviceStaff.annotate({query:require('./db-postgres').query},'ledger_transactions',await q.txAll.all())) });
  }

  if (p === "/api/transactions" && req.method === "POST") {
    const b = await readBody(req);
    const amount = Number(b.amount);
    if ((typeof b.amount !== "number" && typeof b.amount !== "string") ||
        (typeof b.amount === "string" && !/^[0-9]+$/.test(b.amount)) ||
        !Number.isSafeInteger(amount) || amount <= 0)
      return json(res, 400, { error: "Nominal uang harus berupa angka positif rupiah" });

    const method = b.payment_method || "CASH_DRAWER";
    if (!["CASH_DRAWER", "QRIS", "BANK_TRANSFER"].includes(method))
      return json(res, 400, { error: "Metode pembayaran tidak valid" });

    const txType = b.tx_type || "EXPENSE";
    if (!["INCOME", "EXPENSE"].includes(txType))
      return json(res, 400, { error: "tx_type tidak valid" });

    const rawIntent = b.tx_intent ? String(b.tx_intent).toUpperCase() : "SETOR_NOTA";
    if (!["SETOR_NOTA", "PENGAJUAN_DANA"].includes(rawIntent))
      return json(res, 400, { error: "tx_intent tidak valid, pilihan: SETOR_NOTA, PENGAJUAN_DANA" });
    const txIntent = rawIntent;
    if (txIntent === "PENGAJUAN_DANA" && (method !== "CASH_DRAWER" || txType !== "EXPENSE"))
      return json(res, 400, { error: "Pengajuan dana hanya untuk pengeluaran kas tunai; gunakan Setor Nota untuk realisasi non-tunai atau pendapatan" });

    let branchId = b.branch_id;
    if (me.role === "STAFF") {
      branchId = me.assigned_branch_id;
      if (!branchId) return json(res, 403, { error: "Anda tidak terikat unit bisnis manapun" });
    }
    const unit = (await q.unitByIdActive.get(branchId));
    if (!unit) return json(res, 400, { error: "Unit bisnis tidak ditemukan" });

    const coaId = b.coa_id;
    if(typeof coaId!=='string'||!coaId.trim())return json(res,400,{error:'Pilih kode akun COA sesuai transaksi'});
    const coaEntry = (await q.coaById.get(String(coaId)));
    if (!coaEntry) return json(res, 400, { error: "COA tidak ditemukan" });
    if(coaEntry.account_code==='6-3000')return json(res,400,{error:'Penyusutan dicatat lewat jurnal non-kas, bukan input nota'});
    if (txType === "INCOME" && coaEntry.account_type !== "REVENUE")
      return json(res, 400, { error: "COA untuk transaksi INCOME harus bertipe REVENUE" });
    if (txType === "EXPENSE" && coaEntry.account_type !== "EXPENSE")
      return json(res, 400, { error: "COA untuk transaksi EXPENSE harus bertipe EXPENSE" });

    const memo = String(b.memo || "");
    const receiptKey = b.receipt_key ?? null;
    if (receiptKey !== null) {
      const filename = receiptFilename(receiptKey);
      if (!filename) return json(res, 400, { error: "receipt_key tidak valid" });
      const asset = (await q.receiptByFilename.get(filename));
      if (!asset) return json(res, 400, { error: "Bukti transaksi tidak ditemukan" });
      if (!canAccessReceipt(me, asset)) return json(res, 403, { error: "Akses bukti transaksi ditolak" });
      if (asset.branch_id !== branchId) return json(res, 400, { error: "Bukti transaksi harus berasal dari cabang yang sama" });
    }
    const idem = idempotencyKey(b.idempotency_key);
    const fingerprint = fingerprintOf({ amount, method, txType, txIntent, coaId: String(coaId), memo, receiptKey, operationalStaff:req.operationalStaff });
    const idemCheck = await checkIdempotency(idem, me.id, branchId, fingerprint);
    if (idemCheck.exists) {
      if (idemCheck.conflict) return json(res, 409, { error: idemCheck.reason });
      return json(res, 200, { ok: true, id: idemCheck.id, idempotent: true });
    }

    // Replay is checked first: a lost response remains safely retryable after close.
    if ((await q.closingTodayByUser.get(me.id, branchId)))
      return json(res, 409, { error: "Shift Anda sudah ditutup hari ini; transaksi baru tidak diizinkan" });

    let status = "APPROVED";
    if (txIntent === "PENGAJUAN_DANA" || amount > 500000) status = "PENDING_APPROVAL";

    const id = (txIntent === "PENGAJUAN_DANA" ? "ADV-" : "TX-") + uid().slice(0, 10).toUpperCase();
    await q.insertTx.run(id, idem, branchId, me.id, coaId, txType, amount, method,
      memo, receiptKey, status, txIntent,
      me.id, branchId, fingerprint);
    return json(res, 201, { ok: true, id, status, tx_intent: txIntent });
  }

  if (p === "/api/approvals" && req.method === "POST") {
    if (me.role !== "OWNER") return json(res, 403, { error: "Hanya Owner yang berhak melakukan approval transaksi" });
    const b = await readBody(req);
    const id = String(b.id || "").trim();
    const action = String(b.action || "").toUpperCase();
    if (!id || !["APPROVED", "REJECTED"].includes(action))
      return json(res, 400, { error: "id dan action (APPROVED/REJECTED) wajib diisi" });
    const tx = (await q.txById.get(id));
    if (!tx) return json(res, 404, { error: "Transaksi tidak ditemukan" });
    if (tx.status !== "PENDING_APPROVAL")
      return json(res, 409, { error: "Status transaksi sudah final", currentStatus: tx.status });
    if (action === "APPROVED" && tx.payment_method === "CASH_DRAWER" &&
        (tx.tx_intent || "SETOR_NOTA") === "SETOR_NOTA" &&
        (await q.closingByUserDate.get(tx.user_id, tx.branch_id, dateWIB(tx.created_at))))
      return json(res, 409, { error: "Shift pembuat transaksi sudah ditutup untuk tanggal transaksi ini" });
    const result = await atomicApprove(id, action, me.id, String(b.notes || ""));
    if (!result.ok) return json(res, result.statusCode || 400, {
      error: result.statusCode >= 500 ? "Gagal memproses approval" : "Approval tidak dapat diproses",
      currentStatus: result.currentStatus });
    return json(res, 200, { ok: true, id, status: result.status });
  }

  async function drawerBalance(branchId) {
    // Preserve deployed recorded-day ordinary cash semantics; never infer an opening balance.
    const ordinaryBalance=Number((await q.cashDrawerBalanceToday.get(branchId))?.balance||0);
    const v=process.env.DATABASE_URL?await require('./advance-service').cash({query:require('./db-postgres').query},security.cookieToken(req),{branchId}):{cashDelta:'0'};
    const advanceCashDelta=Number(v.cashDelta),balance=ordinaryBalance+advanceCashDelta;
    if(![ordinaryBalance,advanceCashDelta,balance].every(Number.isSafeInteger))throw Object.assign(Error('Saldo di luar batas aman'),{code:400});
    return {...v,balance,ordinaryBalance,advanceCashDelta,basis:'RECORDED_DAY_MOVEMENT',reconciliationComplete:false,endBalance:null};
  }
  if (p === "/api/closing/summary" && req.method === "GET") {
    const branchId = me.role === "STAFF"
      ? me.assigned_branch_id
      : (url.searchParams.get("branch_id") || "UNIT_LP");
    const cash=await drawerBalance(branchId),sysBal=cash.balance;
    const closings = me.role === "STAFF"
      ? (await q.closingsByUserBranchToday.all(me.id, me.assigned_branch_id))
      : (await q.allClosingsToday.all());
    return json(res, 200, { branch_id: branchId, system_balance: sysBal, closings:await deviceStaff.annotate({query:require('./db-postgres').query},'cash_closings',closings), basis:cash.basis, ordinaryDailyMovement:cash.ordinaryBalance, advanceCashDelta:cash.advanceCashDelta, openingBalances:'MISSING',carryforward:'UNVERIFIED',reconciliationComplete:false,endBalance:null,neracaComplete:false,notice:'Mutasi kas tercatat hari ini WIB, bukan saldo akhir. Closing lama tetap; bukan reset kas atau bukti setoran.' });
  }

  if (p === "/api/closing" && req.method === "POST") {
    if (me.role !== "STAFF") return json(res, 403, { error: "Tutup shift hanya untuk Staff" });
    const b = await readBody(req);
    const branchId = me.assigned_branch_id;
    if (!branchId) return json(res, 403, { error: "Anda tidak terikat unit bisnis manapun" });
    if (!(await q.unitByIdActive.get(branchId))) return json(res, 400, { error: "Unit bisnis tidak ditemukan" });

    function safeInt(value, label) {
      const n = Number(value);
      if ((typeof value !== "number" && typeof value !== "string") ||
          (typeof value === "string" && !/^[0-9]+$/.test(value)) || !Number.isSafeInteger(n) || n < 0)
        throw Object.assign(new Error(`${label} harus bilangan bulat non-negatif yang aman`), { code: 400 });
      return n;
    }
    const payload = { physical_cash: safeInt(b.physical_cash, "physical_cash"), reason: String(b.reason || "") };
    const counts = ["total_nota", "kg_reguler", "kg_express", "kg_kilat", "income_cash", "income_qris", "income_transfer", "stock_detergent", "stock_perfume"];
    const measured = new Set(["kg_reguler", "kg_express", "kg_kilat", "stock_detergent", "stock_perfume"]);
    function safeMeasure(value, label) {
      const lexical = typeof value === "number" ? String(value) : value;
      const n = Number(value);
      if ((typeof value !== "number" && typeof value !== "string") ||
          !/^[0-9]+(?:\.[0-9]{1,3})?$/.test(lexical) || !Number.isFinite(n) || n < 0 ||
          n > Number.MAX_SAFE_INTEGER / 1000)
        throw Object.assign(new Error(`${label} harus angka non-negatif dengan maksimal 3 desimal`), { code: 400 });
      return n;
    }
    for (const field of counts) payload[field] = (measured.has(field) ? safeMeasure : safeInt)(b[field] === undefined ? 0 : b[field], field);
    payload.operational_notes = String(b.operational_notes || "");
    const idem = idempotencyKey(b.idempotency_key);
    const fingerprint = fingerprintOf({...payload,operationalStaff:req.operationalStaff});
    const existing = (await q.closingTodayByUser.get(me.id, branchId));
    if (existing) {
      if (existing.idempotency_key !== idem || existing.fingerprint !== fingerprint)
        return json(res, 409, { error: "Shift Anda sudah ditutup hari ini; idempotency_key atau payload berbeda" });
      return json(res, 200, { ok: true, id: existing.id, idempotent: true,
        system_balance: existing.system_balance, physical_cash: existing.physical_cash, difference: existing.difference });
    }

    const sysBal = (await drawerBalance(branchId)).balance;
    const phys = payload.physical_cash, diff = phys - sysBal;
    if (!Number.isSafeInteger(sysBal) || !Number.isSafeInteger(diff))
      return json(res, 400, { error: "Saldo atau selisih di luar batas rupiah yang aman" });
    if (diff !== 0 && !payload.reason.trim())
      return json(res, 400, { error: "Alasan selisih wajib diisi jika uang fisik laci tidak sama dengan sistem" });
    const id = "CLS-" + uid().slice(0, 8).toUpperCase();
    await q.insertClosing.run(id, branchId, me.id, sysBal, phys, diff, payload.reason,
      ...counts.map(field => payload[field]), payload.operational_notes, idem, fingerprint);
    return json(res, 201, { ok: true, id, system_balance: sysBal, physical_cash: phys, difference: diff });
  }

  if (p === '/api/closings/history' && req.method === 'GET') {
    if (!security.cookieToken(req)) return json(res,401,{error:'Cookie sesi diperlukan'});
    if (!process.env.DATABASE_URL) return json(res,503,{error:'Riwayat memerlukan PostgreSQL'});
    const history=await require('./closing-history').read(require('./db-postgres').getPool(),me,url.searchParams);history.rows=await deviceStaff.annotate({query:require('./db-postgres').query},'cash_closings',history.rows);return json(res,200,history);
  }
  if (p === '/api/calendar/notes') {
    if (me.role !== 'OWNER') return json(res,403,{error:'CALENDAR_OWNER_REQUIRED'});
    const token=security.cookieToken(req);
    if (!token) return json(res,401,{error:'Cookie sesi diperlukan'});
    if (!process.env.DATABASE_URL) return json(res,503,{error:'CALENDAR_POSTGRES_REQUIRED'});
    const pool=require('./db-postgres').getPool(),validation=require('./closing-history');
    try {
      if (req.method==='GET') {
        const {from,to}=validation.range(url.searchParams),{limit,offset}=validation.page(url.searchParams);
        const branch=url.searchParams.get('branch_id');
        if(branch&&branch!=='all'&&!(await q.unitById.get(branch)))return json(res,400,{error:'CALENDAR_BRANCH_INVALID'});
        const rows=(await pool.query('SELECT calendar_note_read($1,$2,$3::date,$4::date,$5,$6) rows',[token,branch==='all'?null:branch,from,to,limit+1,offset])).rows[0].rows;
        return json(res,200,{rows:rows.slice(0,limit),has_more:rows.length>limit,limit,offset,timezone:'Asia/Jakarta'});
      }
      if(req.method==='POST') {
        req._bodyLimit=4096;const b=await readBody(req);validation.date(b.date);
        if(Object.keys(b).some(k=>!['date','branch_id','text','idempotency_key'].includes(k))||typeof b.text!=='string'||!b.text.trim()||b.text.length>600||/[\u0000-\u001f\u007f]/.test(b.text)||typeof b.idempotency_key!=='string'||!b.idempotency_key.trim()||b.idempotency_key.length>128)return json(res,400,{error:'CALENDAR_INPUT_INVALID'});
        const note=(await pool.query('SELECT calendar_note_create($1,$2::jsonb) note',[token,JSON.stringify(b)])).rows[0].note;
        const readback=(await pool.query('SELECT calendar_note_read($1,$2,$3::date,$3::date,101,0) rows',[token,note.branch_id,note.note_date])).rows[0].rows.find(x=>x.id===note.id);
        if(!readback)return json(res,503,{error:'CALENDAR_READBACK_FAILED'});
        return json(res,note.idempotent?200:201,{...readback,idempotent:note.idempotent});
      }
      return json(res,405,{error:'METHOD_NOT_ALLOWED'});
    } catch(e) {
      if(e.code===400)throw e;
      const code=/^CALENDAR_[A-Z_]+$/.test(e.message||'')?e.message:'CALENDAR_UNAVAILABLE';
      return json(res,e.code==='42501'?403:code==='CALENDAR_IDEMPOTENCY_CONFLICT'?409:code==='CALENDAR_INPUT_INVALID'||code==='CALENDAR_BRANCH_INVALID'||['22007','22008'].includes(e.code)?400:503,{error:code});
    }
  }
  if (p === "/api/closings" && req.method === "GET") {
    const closings = me.role === "STAFF"
      ? (await q.closingsByUserBranchToday.all(me.id, me.assigned_branch_id))
      : (await q.allClosingsToday.all());
    return json(res, 200, await deviceStaff.annotate({query:require('./db-postgres').query},'cash_closings',closings));
  }

  if (p === "/api/staff-performance" && req.method === "GET") {
    if (me.role !== "OWNER") return json(res, 403, { error: "Hanya Owner yang boleh melihat kinerja staf" });
    const rows=await q.staffPerf.all();
    if(process.env.DATABASE_URL){const advances=await require('./advance-service').snapshot(require('./db-postgres').getPool(),security.cookieToken(req));for(const row of rows){const extra=advances.rows.filter(a=>a.userId===row.id).flatMap(a=>a.events).filter(e=>e.action==='APPROVE').reduce((n,e)=>n+BigInt(e.amount),0n);const total=BigInt(row.expense)+extra;if(total>BigInt(Number.MAX_SAFE_INTEGER))return json(res,503,{error:'PERFORMANCE_SAFE_RANGE_EXCEEDED'});row.expense=Number(total);}}
    return json(res,200,rows);
  }

  if(p==='/api/widya/sessions'||p.startsWith('/api/widya/sessions/')||p.startsWith('/api/widya/files/')) {
    if(me.role!=='OWNER')return json(res,403,{error:'WIDYA_OWNER_REQUIRED'});
    if(!widyaSessions)return json(res,503,{error:'WIDYA_POSTGRES_REQUIRED'});
    return widyaSessions.handle(req,res,url,{token:security.sessionToken(req,authConfig),readBody,json});
  }
  if (p === '/api/widya/status' && req.method === 'GET') {
    if (me.role !== 'OWNER') return json(res,403,{error:'Akses Widya hanya untuk Owner'});
    return json(res,200,await widyaBridge.status());
  }
  if ((p === "/api/widya" || p === "/api/dewi") && req.method === "POST") {
    if (me.role !== "OWNER") return json(res, 403, { error: "Akses Widya hanya untuk Owner" });
    const b = await readBody(req);
    const controller = new AbortController();
        const disconnect = () => { if (!res.writableEnded) controller.abort(); };
        res.once('close', disconnect);
        try {
          widyaBridge.validate(b);
          const answer = await widyaBridge.chat({sessionToken:security.sessionToken(req,authConfig),userId:me.id,body:b,context:await widyaLedgerContext(),signal:controller.signal});
          // Do not return financial context after a session was revoked while the agent worked.
          const current = await auth(req);
          if (!current || current.id !== me.id || current.role !== 'OWNER') return json(res,401,{error:'Sesi berakhir'});
          return json(res, 200, answer);
        } catch (e) {
          if (res.destroyed) return;
          const safe = /^WIDYA_[A-Z_]+$/.test(e.code||'');
          return json(res, safe ? e.status : 502, {error:safe ? e.code : 'WIDYA_BRIDGE_UNAVAILABLE'});
        } finally { res.removeListener('close',disconnect); }
  }

  if(p==='/api/receipts/analyze' && await widyaReceiptRouter(req,res))return;
  if(['/api/widya/extract','/api/dewi/extract'].includes(p))return json(res,410,{error:'WIDYA_RECEIPT_LEGACY_RETIRED',upload:'/api/receipts/upload',analyze:'/api/receipts/analyze'});
  if (p === '/api/receipts/upload' && req.method === "POST") {
    req._bodyLimit = BODY_LIMIT_IMAGE;
    const b = await readBody(req);
    const branchId = me.role === "STAFF" ? me.assigned_branch_id : (b.branch_id || null);
    if (me.role === "STAFF" && !branchId) return json(res, 403, { error: "Anda tidak terikat unit bisnis manapun" });
    const branch = typeof branchId === 'string' ? await q.unitByIdActive.get(branchId) : null;
    if (branchId !== null && !branch)
      return json(res, 400, { error: "Unit bisnis tidak ditemukan" });
    let img = typeof b.image === "string" ? b.image : "";
    if (!img) return json(res, 400, { error: "image (base64) required" });
    if (img.startsWith("data:")) {
      const match = img.match(/^data:image\/(?:jpeg|png|webp|gif);base64,([A-Za-z0-9+/=]+)$/);
      if (!match) return json(res, 400, { error: "Data gambar tidak valid" });
      img = match[1];
    }
    if (img.length > 8_000_000) return json(res, 400, { error: "gambar terlalu besar (maks ~6MB)" });
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(img) || img.length % 4 === 1)
      return json(res, 400, { error: "Data gambar tidak valid (base64 corrupt)" });

    let imgBuf;
    try { imgBuf = Buffer.from(img, "base64"); }
    catch { return json(res, 400, { error: "Data gambar tidak valid (base64 corrupt)" }); }
    if (imgBuf.toString("base64").replace(/=+$/, "") !== img.replace(/=+$/, ""))
      return json(res, 400, { error: "Data gambar tidak valid (base64 corrupt)" });
    const detectedMime = detectImageMime(imgBuf);
    if (!detectedMime) return json(res, 400, { error: "File bukan gambar yang didukung (JPEG, PNG, WebP, GIF)" });

    try { imgBuf = await normalizeReceipt(imgBuf); }
    catch (error) { return json(res, error.status || 400, { error: error.message }); }
    const original_filename = friendlyFilename(me.username, branch?.name);
    const filename = `evidence-${Date.now()}-${uid().slice(0, 6)}.jpg`;
    const receiptUrl = `/api/receipts/${filename}`;
    let stored;
    try {
      stored = await saveReceipt({ filename, buffer: imgBuf, mime: 'image/jpeg', original_filename, userId: me.id, branchId });
      try { await q.insertReceipt.run(filename, me.id, branchId, 'image/jpeg'); }
      catch (err) {
        try { await deleteReceipt(stored); }
        catch { console.error("[save-receipt] orphan cleanup failed"); }
        throw err;
      }
    } catch {
      console.error("[save-receipt] storage or metadata write failed");
      return json(res, 500, { error: "Gagal menyimpan bukti transaksi" });
    }
    return json(res, 201, { ok: true, receipt_key: receiptUrl, mime: 'image/jpeg', original_filename, display_name: original_filename });
  }

  // ---- authenticated receipt access ----
  if (p.startsWith("/api/receipts/")) {
    if (!me) return json(res, 401, { error: "unauthorized" });
    if (req.method !== "GET") return json(res, 405, { error: "Metode tidak diizinkan" });
    const filename = receiptFilename(p);
    if (!filename) return json(res, 404, { error: "File tidak ditemukan" });
    const asset = (await q.receiptByFilename.get(filename));
    if (!asset) return json(res, 404, { error: "File tidak ditemukan" });
    if (!canAccessReceipt(me, asset)) return json(res, 403, { error: "Akses bukti transaksi ditolak" });
    let buffer;
    try { buffer = await readReceipt(asset); }
    catch (err) {
      if (err.code === "ENOENT" || err.name === "NoSuchKey" || err.$metadata?.httpStatusCode === 404)
        return json(res, 404, { error: "File tidak ditemukan" });
      if (err.code === "EACCES") return json(res, 403, { error: "Akses ditolak" });
      throw err;
    }
    const displayName = safeDisplayFilename(await receiptDisplayName(asset), filename);
    res.writeHead(200, { "Content-Type": asset.mime, "Content-Length": buffer.length,
      "Content-Disposition": `inline; filename="${displayName}"; filename*=UTF-8''${encodeURIComponent(displayName)}`,
      "Cache-Control": "private, no-store", ...corsHeaders(res._sipeka_origin), ...SECURITY_HEADERS });
    return res.end(buffer);
  }

  // ---- static files (non-upload assets) ----
  if (p.endsWith(".webp") || p.endsWith(".png") || p.endsWith(".jpg") || p.endsWith(".jpeg") || p.endsWith(".svg") || p.endsWith(".ico")) {
    const safePath = path.join(PUBLIC_DIR, path.normalize(p));
    if (fs.existsSync(safePath) && safePath.startsWith(path.resolve(PUBLIC_DIR))) {
      const stats = fs.statSync(safePath);
      if (!stats.isFile()) return json(res, 404, { error: "file not found" });
      const ext = path.extname(safePath).toLowerCase();
      const ct = ext === ".webp" ? "image/webp" : ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : ext === ".png" ? "image/png" : ext === ".svg" ? "image/svg+xml" : ext === ".ico" ? "image/x-icon" : "application/octet-stream";
      res.writeHead(200, { "Content-Type": ct, "Cache-Control": "public, max-age=86400", ...SECURITY_HEADERS });
      const stream = fs.createReadStream(safePath);
      stream.on("error", (e) => { if (!res.headersSent) res.writeHead(500); console.error("[static stream]", e.message); res.end(); });
      return stream.pipe(res);
    }
    return json(res, 404, { error: "file not found" });
  }

  if (p === "/" || p === "/index.html") {
    if (!fs.existsSync(HTML_PATH)) return json(res, 404, { error: "frontend belum di-copy" });
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", ...SECURITY_HEADERS });
    const stream = fs.createReadStream(HTML_PATH);
    stream.on("error", (e) => { if (!res.headersSent) res.writeHead(500); console.error("[html stream]", e.message); res.end(); });
    return stream.pipe(res);
  }

  json(res, 404, { error: "not found" });
}

Promise.resolve(authReady).then(() => {
  // Device/unit model: no payroll scheduler, provider initialization or delivery worker.
  server.listen(PORT, HOST, () => {
    console.log(`[sipeka] API + frontend di http://${HOST}:${PORT}`);
    console.log('[sipeka] Widya: authenticated Hermes profile bridge (OCR configured separately)');
  });
}).catch(() => {
  console.error("[sipeka] Database readiness failed; server not listening");
  process.exit(1);
});
