// SiPeKA — Database layer (SQLite via node:sqlite, zero deps)
// Skema mengikuti SRS_SIPEKA_SPEC §3 / PRD_SIPEKA_V2 §6 + Client Operational Extension
// HARDENING v2: session expiry, token revoke on pw change/reset, idempotency scoped,
//   approval atomic, balance approved-only, closing lock, triggers extended,
//   safe integer, migration error visibility, env-controlled seed.
const { DatabaseSync } = require("node:sqlite");
const { randomBytes, scryptSync, timingSafeEqual } = require("node:crypto");
const path = require("node:path");

const DB_PATH = process.env.DB_PATH ||
  (process.env.VERCEL ? path.join("/tmp", "sipeka.db") : path.join(__dirname, "sipeka.db"));
const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");

// Session TTL: 12 jam (configurable via SESSION_TTL_HOURS)
const SESSION_TTL_HOURS = Number(process.env.SESSION_TTL_HOURS || 12);
if (!Number.isFinite(SESSION_TTL_HOURS) || SESSION_TTL_HOURS <= 0 || SESSION_TTL_HOURS > 168) throw new Error("SESSION_TTL_HOURS harus 0-168 jam");

// ============ SCHEMA ============
db.exec(`
CREATE TABLE IF NOT EXISTS business_units (
  id TEXT PRIMARY KEY,
  code TEXT UNIQUE NOT NULL,
  name TEXT UNIQUE NOT NULL,
  category TEXT NOT NULL,
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS app_users (
  id TEXT PRIMARY KEY,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  full_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('OWNER','STAFF')),
  assigned_branch_id TEXT REFERENCES business_units(id),
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS chart_of_accounts (
  id TEXT PRIMARY KEY,
  account_code TEXT UNIQUE NOT NULL,
  account_name TEXT NOT NULL,
  account_type TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS ledger_transactions (
  id TEXT PRIMARY KEY,
  idempotency_key TEXT UNIQUE NOT NULL,
  branch_id TEXT NOT NULL REFERENCES business_units(id),
  user_id TEXT NOT NULL REFERENCES app_users(id),
  coa_id TEXT NOT NULL REFERENCES chart_of_accounts(id),
  tx_type TEXT NOT NULL CHECK (tx_type IN ('INCOME','EXPENSE')),
  amount INTEGER NOT NULL CHECK (amount > 0),
  payment_method TEXT NOT NULL CHECK (payment_method IN ('CASH_DRAWER','QRIS','BANK_TRANSFER')),
  memo TEXT,
  receipt_key TEXT,
  status TEXT NOT NULL DEFAULT 'APPROVED'
    CHECK (status IN ('APPROVED','PENDING_APPROVAL','REJECTED')),
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS approval_logs (
  id TEXT PRIMARY KEY,
  transaction_id TEXT NOT NULL REFERENCES ledger_transactions(id),
  action TEXT NOT NULL CHECK (action IN ('APPROVED','REJECTED')),
  reviewer_id TEXT NOT NULL REFERENCES app_users(id),
  notes TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS cash_closings (
  id TEXT PRIMARY KEY,
  branch_id TEXT NOT NULL REFERENCES business_units(id),
  user_id TEXT NOT NULL REFERENCES app_users(id),
  closing_date TEXT NOT NULL DEFAULT (date('now')),
  system_balance INTEGER NOT NULL,
  physical_cash INTEGER NOT NULL,
  difference INTEGER NOT NULL,
  reason TEXT,
  total_nota INTEGER DEFAULT 0,
  kg_reguler REAL DEFAULT 0,
  kg_express REAL DEFAULT 0,
  kg_kilat REAL DEFAULT 0,
  income_cash INTEGER DEFAULT 0,
  income_qris INTEGER DEFAULT 0,
  income_transfer INTEGER DEFAULT 0,
  stock_detergent REAL DEFAULT 0,
  stock_perfume REAL DEFAULT 0,
  operational_notes TEXT,
  status TEXT NOT NULL DEFAULT 'CLOSED',
  created_at TEXT DEFAULT (datetime('now'))
);
`);

// Migrasi kolom tambahan bila belum ada di DB fisik — error dilogkan bukan ditelan diam
function tryMigrate(sql, label) {
  try {
    db.exec(sql);
  } catch (e) {
    // "duplicate column" adalah expected pada DB yang sudah ada; sisanya log sebagai WARNING
    if (!e.message.includes("duplicate column")) {
      throw new Error(`Migrasi gagal [${label}]: ${e.message}`);
    }
  }
}

tryMigrate("ALTER TABLE ledger_transactions ADD COLUMN tx_intent TEXT DEFAULT 'SETOR_NOTA';", "tx_intent");
tryMigrate("ALTER TABLE cash_closings ADD COLUMN total_nota INTEGER DEFAULT 0;", "total_nota");
tryMigrate("ALTER TABLE cash_closings ADD COLUMN kg_reguler REAL DEFAULT 0;", "kg_reguler");
tryMigrate("ALTER TABLE cash_closings ADD COLUMN kg_express REAL DEFAULT 0;", "kg_express");
tryMigrate("ALTER TABLE cash_closings ADD COLUMN kg_kilat REAL DEFAULT 0;", "kg_kilat");
tryMigrate("ALTER TABLE cash_closings ADD COLUMN income_cash INTEGER DEFAULT 0;", "income_cash");
tryMigrate("ALTER TABLE cash_closings ADD COLUMN income_qris INTEGER DEFAULT 0;", "income_qris");
tryMigrate("ALTER TABLE cash_closings ADD COLUMN income_transfer INTEGER DEFAULT 0;", "income_transfer");
tryMigrate("ALTER TABLE cash_closings ADD COLUMN stock_detergent REAL DEFAULT 0;", "stock_detergent");
tryMigrate("ALTER TABLE cash_closings ADD COLUMN stock_perfume REAL DEFAULT 0;", "stock_perfume");
tryMigrate("ALTER TABLE cash_closings ADD COLUMN operational_notes TEXT;", "operational_notes");
// Tambah kolom session expiry
db.exec("CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES app_users(id),created_at TEXT DEFAULT (datetime('now')));");
tryMigrate("ALTER TABLE sessions ADD COLUMN expired_at TEXT;", "sessions.expired_at");
db.prepare("DELETE FROM sessions WHERE expired_at IS NULL").run();
// Tambah kolom idempotency scope + fingerprint ke ledger_transactions
tryMigrate("ALTER TABLE ledger_transactions ADD COLUMN idempotency_user_id TEXT;", "tx.idempotency_user_id");
tryMigrate("ALTER TABLE ledger_transactions ADD COLUMN idempotency_branch_id TEXT;", "tx.idempotency_branch_id");
tryMigrate("ALTER TABLE ledger_transactions ADD COLUMN idempotency_fingerprint TEXT;", "tx.idempotency_fingerprint");

// Schema sessions (jika belum ada — termasuk expired_at dari awal)
db.exec(`
CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES app_users(id),
  expired_at TEXT NOT NULL DEFAULT (datetime('now', '+12 hours')),
  created_at TEXT DEFAULT (datetime('now'))
);
`);

tryMigrate("ALTER TABLE cash_closings ADD COLUMN idempotency_key TEXT;", "closing.idempotency_key");
tryMigrate("ALTER TABLE cash_closings ADD COLUMN fingerprint TEXT;", "closing.fingerprint");
db.exec(`CREATE TABLE IF NOT EXISTS receipt_assets (
 filename TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES app_users(id),
 branch_id TEXT REFERENCES business_units(id),mime TEXT NOT NULL,created_at TEXT DEFAULT (datetime('now'))
);`);

tryMigrate('ALTER TABLE business_units ADD COLUMN archived_at TEXT;', 'branch.archived_at');
tryMigrate('ALTER TABLE business_units ADD COLUMN archived_by TEXT REFERENCES app_users(id);', 'branch.archived_by');
tryMigrate('ALTER TABLE business_units ADD COLUMN archive_reason TEXT;', 'branch.archive_reason');
db.exec(`CREATE TABLE IF NOT EXISTS branch_audit_logs (
 id TEXT PRIMARY KEY, branch_id TEXT NOT NULL REFERENCES business_units(id),
 actor_id TEXT NOT NULL REFERENCES app_users(id), action TEXT NOT NULL CHECK(action='ARCHIVED'),
 reason TEXT NOT NULL, reassigned_to TEXT REFERENCES business_units(id), reassigned_users INTEGER NOT NULL,
 created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TRIGGER IF NOT EXISTS branch_audit_no_update BEFORE UPDATE ON branch_audit_logs BEGIN SELECT RAISE(ABORT,'APPEND_ONLY_BRANCH_AUDIT'); END;
CREATE TRIGGER IF NOT EXISTS branch_audit_no_delete BEFORE DELETE ON branch_audit_logs BEGIN SELECT RAISE(ABORT,'APPEND_ONLY_BRANCH_AUDIT'); END;
`);
for (const table of ['ledger_transactions','cash_closings','receipt_assets','app_users']) {
  const column = table === 'app_users' ? 'assigned_branch_id' : 'branch_id';
  db.exec(`CREATE TRIGGER IF NOT EXISTS ${table}_active_branch_insert BEFORE INSERT ON ${table}
    WHEN NEW.${column} IS NOT NULL AND NOT EXISTS(SELECT 1 FROM business_units WHERE id=NEW.${column} AND is_active=1)
    BEGIN SELECT RAISE(ABORT,'BRANCH_INACTIVE'); END;`);
}
db.exec(`CREATE TRIGGER IF NOT EXISTS app_users_active_branch_update BEFORE UPDATE OF assigned_branch_id ON app_users
 WHEN NEW.assigned_branch_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM business_units WHERE id=NEW.assigned_branch_id AND is_active=1)
 BEGIN SELECT RAISE(ABORT,'BRANCH_INACTIVE'); END;`);

// ============ TRIGGERS ============
db.exec(`
DROP TRIGGER IF EXISTS ledger_no_update;
CREATE TRIGGER IF NOT EXISTS ledger_no_update
BEFORE UPDATE ON ledger_transactions
WHEN (
  OLD.id IS NOT NEW.id OR
  OLD.idempotency_key IS NOT NEW.idempotency_key OR
  OLD.branch_id IS NOT NEW.branch_id OR
  OLD.user_id IS NOT NEW.user_id OR
  OLD.coa_id IS NOT NEW.coa_id OR
  OLD.tx_type IS NOT NEW.tx_type OR
  OLD.amount IS NOT NEW.amount OR
  OLD.payment_method IS NOT NEW.payment_method OR
  OLD.memo IS NOT NEW.memo OR
  OLD.receipt_key IS NOT NEW.receipt_key OR
  OLD.tx_intent IS NOT NEW.tx_intent OR
  OLD.created_at IS NOT NEW.created_at OR
  OLD.idempotency_user_id IS NOT NEW.idempotency_user_id OR
  OLD.idempotency_branch_id IS NOT NEW.idempotency_branch_id OR
  OLD.idempotency_fingerprint IS NOT NEW.idempotency_fingerprint
)
BEGIN SELECT RAISE(ABORT, 'APPEND_ONLY: data finansial transaksi terkunci, hanya status approval yang boleh diubah'); END;

DROP TRIGGER IF EXISTS ledger_no_delete;
CREATE TRIGGER IF NOT EXISTS ledger_no_delete
BEFORE DELETE ON ledger_transactions
BEGIN SELECT RAISE(ABORT, 'APPEND_ONLY_TRANSAKSI_TERKUNCI'); END;

DROP TRIGGER IF EXISTS closing_no_update;
CREATE TRIGGER IF NOT EXISTS closing_no_update
BEFORE UPDATE ON cash_closings
WHEN (
  OLD.id IS NOT NEW.id OR
  OLD.system_balance IS NOT NEW.system_balance OR
  OLD.physical_cash IS NOT NEW.physical_cash OR
  OLD.difference IS NOT NEW.difference OR
  OLD.branch_id IS NOT NEW.branch_id OR
  OLD.user_id IS NOT NEW.user_id OR
  OLD.closing_date IS NOT NEW.closing_date OR
  OLD.reason IS NOT NEW.reason OR OLD.total_nota IS NOT NEW.total_nota OR
  OLD.kg_reguler IS NOT NEW.kg_reguler OR OLD.kg_express IS NOT NEW.kg_express OR OLD.kg_kilat IS NOT NEW.kg_kilat OR
  OLD.income_cash IS NOT NEW.income_cash OR OLD.income_qris IS NOT NEW.income_qris OR OLD.income_transfer IS NOT NEW.income_transfer OR
  OLD.stock_detergent IS NOT NEW.stock_detergent OR OLD.stock_perfume IS NOT NEW.stock_perfume OR
  OLD.operational_notes IS NOT NEW.operational_notes OR OLD.status IS NOT NEW.status OR OLD.created_at IS NOT NEW.created_at OR
  OLD.idempotency_key IS NOT NEW.idempotency_key OR OLD.fingerprint IS NOT NEW.fingerprint
)
BEGIN SELECT RAISE(ABORT, 'APPEND_ONLY_CLOSING: data closing terkunci'); END;

DROP TRIGGER IF EXISTS closing_no_delete;
CREATE TRIGGER IF NOT EXISTS closing_no_delete
BEFORE DELETE ON cash_closings
BEGIN SELECT RAISE(ABORT, 'APPEND_ONLY_CLOSING_TERKUNCI'); END;
`);

// ============ PASSWORD ============
function hashPassword(pw, salt) {
  salt = salt || randomBytes(16).toString("hex");
  return salt + ":" + scryptSync(pw, salt, 64).toString("hex");
}
function verifyPassword(pw, stored) {
  try {
    const [salt, hash] = stored.split(":");
    if (!salt || !hash) return false;
    const calc = scryptSync(pw, salt, 64);
    return timingSafeEqual(calc, Buffer.from(hash, "hex"));
  } catch { return false; }
}

// ============ SEED (env-controlled, hanya fresh DB tanpa user) ============
const uid = () => randomBytes(12).toString("hex");

// DEMO_PASSWORD dihapus — tidak ada konstanta hardcoded.
// Seed hanya berjalan jika SIPEKA_SEED=1 DAN DB belum punya user.
// Password owner wajib dari env SIPEKA_OWNER_PASSWORD.
function seed() {
  const existingUserCount = db.prepare("SELECT COUNT(*) AS n FROM app_users").get().n;
  if (existingUserCount > 0) {
    // DB sudah ada user — skip seed tanpa log credential
    return;
  }
  if (process.env.SIPEKA_SEED !== "1") return;

  const ownerPassword = process.env.SIPEKA_OWNER_PASSWORD;
  if (!ownerPassword || ownerPassword.length < 8) {
    console.error("[db] SIPEKA_SEED=1 tapi SIPEKA_OWNER_PASSWORD tidak di-set atau < 8 karakter. Seed dibatalkan.");
    return;
  }

  // Operational default supersedes the six-unit demonstration seed. Existing DBs are unchanged.
  const units = [["UNIT_LP", "LP", "Laundry", "LAUNDRY"]];
  const insUnit = db.prepare("INSERT OR IGNORE INTO business_units (id, code, name, category) VALUES (?,?,?,?)");
  for (const [id, code, name, cat] of units) {
    insUnit.run(id, code, name, cat);
  }

  const coa = [
    ["4101", "Pendapatan Operasional", "REVENUE"],
    ["5101", "Beban Chemical / Supplies", "EXPENSE"],
    ["5102", "Beban Utilitas", "EXPENSE"],
    ["5103", "Beban Gaji", "EXPENSE"],
    ["5104", "Beban Sewa", "EXPENSE"],
    ["5120", "Beban Amenities", "EXPENSE"],
    ["5310", "Beban Maintenance & Perbaikan", "EXPENSE"],
    ["5400", "Pengeluaran Lapangan / Operasional Lain", "EXPENSE"],
  ];
  const insCoa = db.prepare("INSERT OR IGNORE INTO chart_of_accounts (id, account_code, account_name, account_type) VALUES (?,?,?,?)");
  for (const [c, n, t] of coa) insCoa.run(c, c, n, t);

  const insUser = db.prepare(
    "INSERT OR IGNORE INTO app_users (id, username, password_hash, full_name, role, assigned_branch_id) VALUES (?,?,?,?,?,?)"
  );
  const ownerUsername = process.env.SIPEKA_OWNER_USERNAME || "mafucan";
  const ownerPw = hashPassword(ownerPassword);
  insUser.run("U_OWNER_RADIT", ownerUsername, ownerPw, "Radit Martanegara", "OWNER", null);

  const txCount = db.prepare("SELECT COUNT(*) AS n FROM ledger_transactions").get().n;
  // Log tanpa credential
  console.log(`[db] seed OK — units=${units.length}, users=1 (Owner: Radit Martanegara), transactions=${txCount}`);
}

seed();

// ============ HELPER: approval atomik ============
// DatabaseSync (node:sqlite) tidak punya .transaction() — gunakan BEGIN/COMMIT/ROLLBACK manual
function atomicApprove(txId, action, reviewerId, notes) {
  try {
    db.exec("BEGIN IMMEDIATE");
    const tx = db.prepare("SELECT status FROM ledger_transactions WHERE id = ?").get(txId);
    if (!tx) {
      db.exec("ROLLBACK");
      return { ok: false, error: "Transaksi tidak ditemukan", statusCode: 404 };
    }
    if (tx.status !== "PENDING_APPROVAL") {
      db.exec("ROLLBACK");
      return {
        ok: false,
        error: `Transaksi sudah dalam status ${tx.status}; hanya PENDING_APPROVAL yang dapat diubah`,
        statusCode: 409,
        currentStatus: tx.status,
      };
    }
    db.prepare("UPDATE ledger_transactions SET status = ? WHERE id = ? AND status = 'PENDING_APPROVAL'").run(action, txId);
    db.prepare(
      "INSERT INTO approval_logs (id, transaction_id, action, reviewer_id, notes) VALUES (?,?,?,?,?)"
    ).run(uid(), txId, action, reviewerId, notes || "");
    db.exec("COMMIT");
    return { ok: true, status: action };
  } catch (e) {
    try { db.exec("ROLLBACK"); } catch {}
    console.error("[db] approval gagal", e.message);
    return { ok: false, error: "Gagal memproses approval", statusCode: 500 };
  }
}

// ============ HELPER: session dengan expiry ============
function createSession(token, userId) {
  const expiredAt = new Date(Date.now() + SESSION_TTL_HOURS * 3600_000).toISOString().replace("T", " ").slice(0, 19);
  db.prepare("INSERT INTO sessions (token, user_id, expired_at) VALUES (?,?,?)").run(token, userId, expiredAt);
}

function getValidSession(token) {
  const row = db.prepare(
    "SELECT s.token, s.user_id, s.expired_at, u.* FROM sessions s JOIN app_users u ON u.id = s.user_id WHERE s.token = ?"
  ).get(token);
  if (!row) return null;
  const expires = row.expired_at && Date.parse(row.expired_at.replace(" ","T") + "Z");
  if (!Number.isFinite(expires) || expires <= Date.now()) {
    db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
    return null;
  }
  return row;
}

function revokeUserSessions(userId) {
  db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
}

// ============ HELPER: idempotency scoped ============
function checkIdempotency(idemKey, userId, branchId, fingerprint) {
  const existing = db.prepare(
    "SELECT * FROM ledger_transactions WHERE idempotency_key = ?"
  ).get(idemKey);
  if (!existing) return { exists: false };
  if (existing.idempotency_user_id !== userId || existing.idempotency_branch_id !== branchId) {
    return { exists: true, conflict: true, reason: "Idempotency key digunakan oleh pengguna/cabang lain" };
  }
  if (existing.idempotency_fingerprint && existing.idempotency_fingerprint !== fingerprint) {
    return { exists: true, conflict: true, reason: "Idempotency key dengan payload berbeda" };
  }
  return { exists: true, conflict: false, id: existing.id };
}

// ============ QUERIES ============
const q = {
  userByUsername: db.prepare("SELECT * FROM app_users WHERE username = ?"),
  userById: db.prepare("SELECT * FROM app_users WHERE id = ?"),
  updateUserPassword: db.prepare("UPDATE app_users SET password_hash = ? WHERE id = ?"),
  unitById: db.prepare("SELECT * FROM business_units WHERE id = ?"),
  unitByIdActive: db.prepare("SELECT * FROM business_units WHERE id = ? AND is_active = 1"),
  allUnits: db.prepare("SELECT * FROM business_units WHERE is_active = 1 ORDER BY name"),
  allCoa: db.prepare("SELECT * FROM chart_of_accounts ORDER BY account_code"),
  coaById: db.prepare("SELECT * FROM chart_of_accounts WHERE id = ?"),

  // OWNER: seluruh transaksi semua cabang + semua staf
  txAll: db.prepare(`
    SELECT t.*, u.full_name AS user_name, u.username, b.name AS branch_name, c.account_code, c.account_name
    FROM ledger_transactions t
    JOIN app_users u ON u.id = t.user_id
    JOIN business_units b ON b.id = t.branch_id
    JOIN chart_of_accounts c ON c.id = t.coa_id
    ORDER BY t.created_at DESC
  `),

  // STAFF: HANYA transaksi miliknya sendiri, HANYA hari ini (WIB +7)
  txStaffToday: db.prepare(`
    SELECT t.*, u.full_name AS user_name, u.username, b.name AS branch_name, c.account_code, c.account_name
    FROM ledger_transactions t
    JOIN app_users u ON u.id = t.user_id
    JOIN business_units b ON b.id = t.branch_id
    JOIN chart_of_accounts c ON c.id = t.coa_id
    WHERE t.user_id = ? AND t.branch_id = ?
      AND date(t.created_at, '+7 hours') = date('now', '+7 hours')
    ORDER BY t.created_at DESC
  `),

  // Kinerja staf utk Owner — APPROVED only
  staffPerf: db.prepare(`
    SELECT u.id, u.username, u.full_name, b.name AS branch_name,
           COUNT(t.id) AS tx_count,
           COALESCE(SUM(CASE WHEN t.tx_type='INCOME' AND t.status='APPROVED' AND t.tx_intent='SETOR_NOTA' THEN t.amount END),0) AS income,
           COALESCE(SUM(CASE WHEN t.tx_type='EXPENSE' AND t.status='APPROVED' AND t.tx_intent='SETOR_NOTA' THEN t.amount END),0) AS expense,
           SUM(CASE WHEN date(t.created_at, '+7 hours')=date('now', '+7 hours') THEN 1 ELSE 0 END) AS today_count
    FROM app_users u
    LEFT JOIN business_units b ON b.id = u.assigned_branch_id
    LEFT JOIN ledger_transactions t ON t.user_id = u.id
    WHERE u.role = 'STAFF'
    GROUP BY u.id
    ORDER BY u.full_name
  `),

  insertTx: db.prepare(`
    INSERT INTO ledger_transactions
      (id, idempotency_key, branch_id, user_id, coa_id, tx_type, amount, payment_method, memo, receipt_key, status, tx_intent,
       idempotency_user_id, idempotency_branch_id, idempotency_fingerprint)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `),
  txByIdempotency: db.prepare("SELECT * FROM ledger_transactions WHERE idempotency_key = ?"),
  txById: db.prepare("SELECT * FROM ledger_transactions WHERE id = ?"),
  updateTxStatus: db.prepare("UPDATE ledger_transactions SET status = ? WHERE id = ?"),

  // Approvals
  insertApprovalLog: db.prepare(`
    INSERT INTO approval_logs (id, transaction_id, action, reviewer_id, notes)
    VALUES (?,?,?,?,?)
  `),
  approvalLogsByTx: db.prepare(`
    SELECT a.*, u.full_name as reviewer_name
    FROM approval_logs a
    JOIN app_users u ON u.id = a.reviewer_id
    WHERE a.transaction_id = ?
    ORDER BY a.created_at DESC
  `),

  // Cash Closing — APPROVED only; PENGAJUAN_DANA excluded until settlement
  cashDrawerBalanceToday: db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN tx_type='INCOME' AND status='APPROVED' THEN amount ELSE 0 END), 0) -
      COALESCE(SUM(CASE WHEN tx_type='EXPENSE' AND status='APPROVED' THEN amount ELSE 0 END), 0) AS balance
    FROM ledger_transactions
    WHERE branch_id = ? AND payment_method = 'CASH_DRAWER'
      AND date(created_at, '+7 hours') = date('now', '+7 hours')
      AND tx_intent='SETOR_NOTA'
  `),

  // Cek apakah sudah ada closing hari ini (WIB) untuk branch ini
  closingTodayByBranch: db.prepare(`
    SELECT COUNT(*) AS n FROM cash_closings
    WHERE branch_id = ? AND closing_date = date('now', '+7 hours')
  `),

  insertClosing: db.prepare(`
    INSERT INTO cash_closings (
      id, branch_id, user_id, closing_date, system_balance, physical_cash, difference, reason,
      total_nota, kg_reguler, kg_express, kg_kilat, income_cash, income_qris, income_transfer,
      stock_detergent, stock_perfume, operational_notes, idempotency_key, fingerprint, status
    )
    VALUES (?,?,?,date('now', '+7 hours'),?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'CLOSED')
  `),
  closingsByBranchToday: db.prepare(`
    SELECT c.*, u.full_name as user_name, b.name as branch_name
    FROM cash_closings c
    JOIN app_users u ON u.id = c.user_id
    JOIN business_units b ON b.id = c.branch_id
    WHERE c.branch_id = ? AND c.closing_date = date('now', '+7 hours')
    ORDER BY c.created_at DESC
  `),
  allClosingsToday: db.prepare(`
    SELECT c.*, u.full_name as user_name, b.name as branch_name
    FROM cash_closings c
    JOIN app_users u ON u.id = c.user_id
    JOIN business_units b ON b.id = c.branch_id
    WHERE c.closing_date = date('now', '+7 hours')
    ORDER BY c.created_at DESC
  `),

  closingTodayByUser: db.prepare("SELECT * FROM cash_closings WHERE user_id=? AND branch_id=? AND closing_date=date('now','+7 hours') ORDER BY created_at DESC LIMIT 1"),
  closingByUserDate: db.prepare("SELECT * FROM cash_closings WHERE user_id=? AND branch_id=? AND closing_date=? LIMIT 1"),
  insertReceipt: db.prepare("INSERT INTO receipt_assets(filename,user_id,branch_id,mime) VALUES(?,?,?,?)"),
  receiptByFilename: db.prepare("SELECT * FROM receipt_assets WHERE filename=?"),

  // Sessions — pakai helper createSession/getValidSession, bukan prepare langsung
  dropSession: db.prepare("DELETE FROM sessions WHERE token = ?"),
  dropUserSessions: db.prepare("DELETE FROM sessions WHERE user_id = ?"),

  // Users & Staff management
  allUsers: db.prepare(`
    SELECT u.id, u.username, u.full_name, u.role, u.assigned_branch_id, u.created_at, b.name as branch_name, b.code as branch_code
    FROM app_users u
    LEFT JOIN business_units b ON b.id = u.assigned_branch_id
    ORDER BY u.role DESC, u.full_name ASC
  `),
  insertUser: db.prepare(`
    INSERT INTO app_users (id, username, password_hash, full_name, role, assigned_branch_id)
    VALUES (?,?,?,?,?,?)
  `),
  resetUserPassword: db.prepare("UPDATE app_users SET password_hash = ? WHERE id = ?"),

  // Branch management
  insertBranch: db.prepare(`
    INSERT INTO business_units (id, code, name, category, is_active)
    VALUES (?,?,?,?,1)
  `),
};

q.allUnitsIncludingArchived = db.prepare('SELECT * FROM business_units ORDER BY name');
q.branchAuditLogs = db.prepare('SELECT * FROM branch_audit_logs WHERE branch_id=? ORDER BY created_at,id');
q.archiveBranch = { run: archiveBranch };
q.deleteBranch = q.archiveBranch;
function archiveBranch(branchId, actorId, reassignTo = null, reason = '') {
  const fail = (statusCode, error) => ({ ok: false, statusCode, error });
  const savepoint = 'branch_' + uid();
  db.exec(`SAVEPOINT ${savepoint}`);
  try {
    const result = (() => {
      if (q.userById.get(actorId)?.role !== 'OWNER') return fail(403, 'Khusus Owner');
      const unit = q.unitById.get(branchId);
      if (!unit) return fail(404, 'Unit bisnis tidak ditemukan');
      if (unit.is_active !== 1) return { ok: true, action: 'already_archived', id: branchId, reassigned_users: 0 };
      if (q.allUnits.all().length <= 1) return fail(409, 'Unit aktif terakhir tidak dapat diarsipkan');
      if (reassignTo !== null && (reassignTo === branchId || !q.unitByIdActive.get(reassignTo))) return fail(400, 'Unit pengganti harus aktif dan berbeda');
      const users = db.prepare('SELECT id FROM app_users WHERE assigned_branch_id=? ORDER BY id').all(branchId);
      if (users.length && !reassignTo) return fail(409, 'Pindahkan staf ke unit aktif sebelum mengarsipkan');
      if (typeof reason !== 'string' || reason.length > 1000) return fail(400, 'Alasan maksimal 1000 karakter');
      for (const user of users) {
        db.prepare('UPDATE app_users SET assigned_branch_id=? WHERE id=?').run(reassignTo, user.id);
        q.dropUserSessions.run(user.id);
      }
      db.prepare("UPDATE business_units SET is_active=0,archived_at=datetime('now'),archived_by=?,archive_reason=? WHERE id=?").run(actorId, reason.trim(), branchId);
      db.prepare("INSERT INTO branch_audit_logs(id,branch_id,actor_id,action,reason,reassigned_to,reassigned_users) VALUES(?,?,?,'ARCHIVED',?,?,?)").run(uid(), branchId, actorId, reason.trim(), reassignTo, users.length);
      return { ok: true, action: 'archived', id: branchId, reassigned_users: users.length };
    })();
    db.exec(`RELEASE SAVEPOINT ${savepoint}`);
    return result;
  } catch (error) {
    db.exec(`ROLLBACK TO SAVEPOINT ${savepoint}; RELEASE SAVEPOINT ${savepoint}`);
    throw error;
  }
}

module.exports = {
  db,
  q,
  verifyPassword,
  hashPassword,
  uid,
  atomicApprove,
  createSession,
  getValidSession,
  revokeUserSessions,
  checkIdempotency,
  // DEMO_PASSWORD tidak diekspor
};
