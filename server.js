// SiPeKA — API server (Node http, zero deps)
// Endpoint: login, change-password, transaksi (Setor Nota & Pengajuan Dana), closing (Daily Report), Widya AI (owner only)
// HARDENING v2: error boundary, body limit, rate-limit login, security headers, no CORS wildcard,
//   session expiry, revoke on pw change/reset, idempotency scoped, approval atomic,
//   balance approved-only, closing lock, MIME verify upload, authenticated receipt, safe stream.
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { q, uid, atomicApprove, createSession, getValidSession,
  revokeUserSessions, checkIdempotency, ready, withRequestTransaction, db } = require(process.env.DATABASE_URL ? "./db-postgres" : "./db");

const security = require("./auth-security");
const authConfig = security.config();
const authReady = Promise.resolve(ready).then(async () => {
  if (process.env.DATABASE_URL) {
    await db.prepare("SELECT password_change_required,totp_cipher,totp_pending_cipher,totp_pending_until,totp_last_counter,recovery_hashes FROM app_users LIMIT 0").all();
    await db.prepare("SELECT last_seen_at,purpose FROM sessions LIMIT 0").all();
  } else if (authConfig.requireOwner2FA || authConfig.production) throw new Error("Public auth requires PostgreSQL migration 002");
});
authReady.catch(() => {});
const loginLimiter = security.createLimiter();
const mfaLimiter = security.createLimiter();
const TOTP_KEY = process.env.AUTH_TOTP_KEY || '';
if (authConfig.requireOwner2FA) security.encryptionKey(TOTP_KEY);
const PORT = process.env.PORT || 4321;
const HOST = process.env.HOST || "127.0.0.1";
const KARA_BASE = process.env.KARA_BASE_URL || "http://localhost:20128/v1";
const KARA_KEY = process.env.KARA_API_KEY || "";
const KARA_MODEL = process.env.KARA_MODEL || "ag/gemini-3.8-flash-medium";

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
function widyaSystemPrompt(context) {
  return `Kamu adalah Widya (panggilan: Widya) — Head of Accounting AI di sistem SiPeKA.
Aturan:
- Jawab Bahasa Indonesia, ringkas, format Rupiah id-ID (Rp 123.456).
- Gunakan HANYA angka dari KONTEKS DATA. DILARANG mengarang angka.
- Role owner memiliki akses penuh semua cabang.
- Kamu tidak mengeksekusi aksi final: pengeluaran > Rp 500.000 tetap menunggu approval owner.

=== KONTEKS DATA ===
${context}`;
}

async function callWidya(messages) {
  const txs = (await q.txAll.all()).slice(0, 40);
  const perf = (await q.staffPerf.all());
  const lines = txs.map((t) =>
    `${t.created_at} | ${t.branch_name} | ${t.user_name} | ${t.tx_type} | ${t.account_name} | ${t.memo || "-"} | Rp ${Number(t.amount).toLocaleString("id-ID")} | ${t.payment_method} | ${t.status} | [${t.tx_intent || "SETOR_NOTA"}]`
  );
  const perfLines = perf.map((p) =>
    `${p.full_name} (@${p.username}) @ ${p.branch_name}: ${p.tx_count} transaksi, income Rp ${Number(p.income).toLocaleString("id-ID")}, expense Rp ${Number(p.expense).toLocaleString("id-ID")}, hari ini ${p.today_count}`
  );
  const context = [
    `Ledger saat ini (terbaru):`,
    lines.length ? lines.join("\n") : "(ledger kosong — belum ada transaksi)",
    ``,
    `Kinerja staf:`,
    perfLines.length ? perfLines.join("\n") : "(belum ada staf bertransaksi)",
  ].join("\n");

  const res = await fetch(`${KARA_BASE}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${KARA_KEY}` },
    body: JSON.stringify({
      model: KARA_MODEL,
      stream: true,
      temperature: 0.3,
      max_tokens: 1200,
      messages: [
        { role: "system", content: widyaSystemPrompt(context) },
        ...messages.slice(-12),
      ],
    }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok || !res.body) throw new Error(`upstream ${res.status}`);
  const decoder = new TextDecoder();
  let buf = "";
  let reply = "";
  const reader = res.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines2 = buf.split("\n");
    buf = lines2.pop() ?? "";
    for (const line of lines2) {
      const s = line.trim();
      if (!s.startsWith("data:")) continue;
      const payload = s.slice(5).trim();
      if (payload === "[DONE]") continue;
      try {
        const j = JSON.parse(payload);
        reply += j?.choices?.[0]?.delta?.content ?? j?.choices?.[0]?.message?.content ?? "";
      } catch {}
    }
  }
  return reply;
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
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
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
      await ready;
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
    if (p.startsWith('/api/') && !['GET','HEAD','OPTIONS'].includes(req.method) && !security.validOrigin(req, authConfig))
      return json(res, 403, { error: "Origin tidak diizinkan" });
    const mutation = req.method === "POST" && (["/api/login", "/api/logout", "/api/change-password", "/api/users", "/api/users/reset-password", "/api/units", "/api/transactions", "/api/approvals", "/api/closing"].includes(p) || p.startsWith('/api/auth/'));
    if (process.env.DATABASE_URL && mutation) {
      // Do not report success until PostgreSQL has committed the entire request.
      res._deferJSON = true;
      await withRequestTransaction(() => handleRequest(req, res, url, p));
      res._deferJSON = false;
      if (res._pendingJSON) json(res, ...res._pendingJSON);
    } else await handleRequest(req, res, url, p);
  } catch (err) {
    if (res.headersSent) return;
    res.removeHeader('Set-Cookie'); // Never send a session cookie from a rolled-back request.
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

  // TOTP_REMOVED: enrollment and verification endpoints removed.
  if (p.startsWith('/api/auth/totp/')) return json(res, 404, { error: 'not found' });

  // CONTRACT: returns { ok, message, logout_required: true } — frontend WAJIB logout setelah ini
  if (p === "/api/change-password" && req.method === "POST") {
    const { old_password, new_password } = await readBody(req);
    if (!old_password || !new_password) return json(res, 400, { error: "Password lama dan baru wajib diisi" });
    if (String(new_password).length < 12) return json(res, 400, { error: "Password baru minimal 12 karakter" });
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
    if (String(password).length < 12) return json(res, 400, { error: "Password minimal 12 karakter" });
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
    if (String(new_password).length < 12) return json(res, 400, { error: "Password baru minimal 12 karakter" });
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
    const branchId = "UNIT_" + cleanCode.replace(/[^A-Z0-9]/g, "");
    try {
      (await q.insertBranch.run(branchId, cleanCode, cleanName, category || "LAUNDRY"));
      return json(res, 201, { ok: true, id: branchId, name: cleanName, code: cleanCode });
    } catch (e) {
      console.error("[units] write failed");
      return json(res, 400, { error: "Gagal menambah cabang (kode/nama mungkin sudah ada)" });
    }
  }

  if (p === "/api/units" && req.method === "GET") {
    if (me.role === "STAFF") {
      const u = me.assigned_branch_id ? (await q.unitById.get(me.assigned_branch_id)) : null;
      return json(res, 200, u ? [u] : []);
    }
    return json(res, 200, (await q.allUnits.all()));
  }

  if (p === "/api/transactions" && req.method === "GET") {
    if (me.role === "STAFF") {
      return json(res, 200, { scope: "today-own", rows: (await q.txStaffToday.all(me.id, me.assigned_branch_id)) });
    }
    return json(res, 200, { scope: "all", rows: (await q.txAll.all()) });
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

    let branchId = b.branch_id;
    if (me.role === "STAFF") {
      branchId = me.assigned_branch_id;
      if (!branchId) return json(res, 403, { error: "Anda tidak terikat unit bisnis manapun" });
    }
    const unit = (await q.unitByIdActive.get(branchId));
    if (!unit) return json(res, 400, { error: "Unit bisnis tidak ditemukan" });

    const coaId = b.coa_id || "5101";
    const coaEntry = (await q.coaById.get(String(coaId)));
    if (!coaEntry) return json(res, 400, { error: "COA tidak ditemukan" });
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
    }
    const idem = idempotencyKey(b.idempotency_key);
    const fingerprint = fingerprintOf({ amount, method, txType, txIntent, coaId: String(coaId), memo, receiptKey });
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

  if (p === "/api/closing/summary" && req.method === "GET") {
    const branchId = me.role === "STAFF"
      ? me.assigned_branch_id
      : (url.searchParams.get("branch_id") || "UNIT_LP");
    const sysBal = (await q.cashDrawerBalanceToday.get(branchId))?.balance || 0;
    const closings = me.role === "STAFF"
      ? (await q.closingsByBranchToday.all(me.assigned_branch_id))
      : (await q.allClosingsToday.all());
    return json(res, 200, { branch_id: branchId, system_balance: sysBal, closings });
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
    const fingerprint = fingerprintOf(payload);
    const existing = (await q.closingTodayByUser.get(me.id, branchId));
    if (existing) {
      if (existing.idempotency_key !== idem || existing.fingerprint !== fingerprint)
        return json(res, 409, { error: "Shift Anda sudah ditutup hari ini; idempotency_key atau payload berbeda" });
      return json(res, 200, { ok: true, id: existing.id, idempotent: true,
        system_balance: existing.system_balance, physical_cash: existing.physical_cash, difference: existing.difference });
    }

    const sysBal = (await q.cashDrawerBalanceToday.get(branchId))?.balance ?? 0;
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

  if (p === "/api/closings" && req.method === "GET") {
    const closings = me.role === "STAFF"
      ? (await q.closingsByBranchToday.all(me.assigned_branch_id))
      : (await q.allClosingsToday.all());
    return json(res, 200, closings);
  }

  if (p === "/api/staff-performance" && req.method === "GET") {
    if (me.role !== "OWNER") return json(res, 403, { error: "Hanya Owner yang boleh melihat kinerja staf" });
    return json(res, 200, (await q.staffPerf.all()));
  }

  if ((p === "/api/widya" || p === "/api/dewi") && req.method === "POST") {
    if (me.role !== "OWNER") return json(res, 403, { error: "Akses Widya hanya untuk Owner" });
    const b = await readBody(req);
    const messages = Array.isArray(b.messages) ? b.messages : [];
    if (!messages.length) return json(res, 400, { error: "messages required" });
    try {
      return json(res, 200, { reply: await callWidya(messages) });
    } catch (e) {
      console.error("[widya] upstream failed");
      return json(res, 502, { error: "Widya tidak terjangkau" });
    }
  }

  if (["/api/widya/extract", "/api/dewi/extract", "/api/receipts/upload"].includes(p) && req.method === "POST") {
    req._bodyLimit = BODY_LIMIT_IMAGE;
    const b = await readBody(req);
    const branchId = me.role === "STAFF" ? me.assigned_branch_id : (b.branch_id || null);
    if (me.role === "STAFF" && !branchId) return json(res, 403, { error: "Anda tidak terikat unit bisnis manapun" });
    if (branchId !== null && (typeof branchId !== "string" || !(await q.unitByIdActive.get(branchId))))
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

    const extMap = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif" };
    const ext = extMap[detectedMime] || ".jpg";

    const filename = `evidence-${Date.now()}-${uid().slice(0, 6)}${ext}`;
    const receiptUrl = `/api/receipts/${filename}`;
    let stored;
    try {
      stored = await saveReceipt({ filename, buffer: imgBuf, mime: detectedMime, userId: me.id, branchId });
      try { await q.insertReceipt.run(filename, me.id, branchId, detectedMime); }
      catch (err) {
        try { await deleteReceipt(stored); }
        catch { console.error("[save-receipt] orphan cleanup failed"); }
        throw err;
      }
    } catch {
      console.error("[save-receipt] storage or metadata write failed");
      return json(res, 500, { error: "Gagal menyimpan bukti transaksi" });
    }
    if (p === "/api/receipts/upload") return json(res, 201, { ok: true, receipt_key: receiptUrl, mime: detectedMime });
    if (!process.env.KARA_BASE_URL || !KARA_KEY)
      return json(res, 503, { error: "OCR belum dikonfigurasi; bukti tersimpan, isi transaksi secara manual", receipt_key: receiptUrl });

    const prompt = `Ekstrak data nota/kuitansi berikut menjadi JSON SAJA (tanpa teks lain).
Format tepat:
{"merchant":"nama toko","date":"YYYY-MM-DD","amount":angka_rupiah_tanpa_titik,"items":[{"name":"nama barang","qty":jumlah,"price":harga_satuan}],"payment_method":"CASH_DRAWER|QRIS|BANK_TRANSFER","account_id":"5101|5102|5310|5120|5400|4101"}
Aturan:
- amount = TOTAL belanja (integer rupiah).
- payment_method: tebak dari bukti (BCA/transfer=BANK_TRANSFER, QRIS=QRIS, tunai/kas=CASH_DRAWER), default BANK_TRANSFER.
- account_id: chemical/supplies/bahan=5101, listrik/air/utilitas=5102, servis/kerusakan/maintenance=5310, amenities/hotel=5120, operasional/lapangan=5400, pendapatan/setoran=4101.
- Jika tidak terbaca, isi dengan nilai kosong/0 yang wajar. JANGAN mengarang total yang tidak ada di gambar.`;

    try {
      const upstream = await fetch(`${KARA_BASE}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${KARA_KEY}` },
        body: JSON.stringify({ model: KARA_MODEL, stream: false, temperature: 0, max_tokens: 800,
          messages: [{ role: "user", content: [
            { type: "text", text: prompt },
            { type: "image_url", image_url: { url: `data:${detectedMime};base64,${img}` } }
          ] }]
        }),
        signal: AbortSignal.timeout(90_000),
      });
      if (!upstream.ok) {
        await upstream.body?.cancel();
        console.error("[extract] upstream failed", upstream.status);
        return json(res, 502, { error: "OCR tidak terjangkau", receipt_key: receiptUrl });
      }
      const data = await upstream.json();
      let content = data?.choices?.[0]?.message?.content || "";
      const m = content.match(/\{[\s\S]*\}/);
      if (!m) return json(res, 502, { error: "OCR tidak mengembalikan JSON", receipt_key: receiptUrl });
      let parsed;
      try { parsed = JSON.parse(m[0]); }
      catch { return json(res, 502, { error: "JSON OCR tidak valid", receipt_key: receiptUrl }); }
      const amount = Number(parsed.amount);
      parsed.amount = Number.isSafeInteger(amount) && amount > 0 ? amount : 0;
      if (!Array.isArray(parsed.items)) parsed.items = [];
      if (!["CASH_DRAWER","QRIS","BANK_TRANSFER"].includes(parsed.payment_method)) parsed.payment_method = "BANK_TRANSFER";
      if (!["5101","5102","5310","5120","5400","4101"].includes(String(parsed.account_id))) parsed.account_id = "5101";
      parsed.receipt_key = receiptUrl;
      return json(res, 200, parsed);
    } catch (e) {
      console.error("[extract] upstream failed");
      return json(res, 502, { error: "OCR tidak terjangkau", receipt_key: receiptUrl });
    }
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
    res.writeHead(200, { "Content-Type": asset.mime, "Content-Length": buffer.length,
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
  server.listen(PORT, HOST, () => {
    console.log(`[sipeka] API + frontend di http://${HOST}:${PORT}`);
    console.log(`[sipeka] Widya model: ${KARA_MODEL}`);
  });
}).catch(() => {
  console.error("[sipeka] Database readiness failed; server not listening");
  process.exit(1);
});
