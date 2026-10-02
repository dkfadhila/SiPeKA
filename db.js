// SiPeKA — Database layer (SQLite via node:sqlite, zero deps)
// Skema mengikuti SRS_SIPEKA_SPEC §3 / PRD_SIPEKA_V2 §6 + Client Operational Extension
const { DatabaseSync } = require("node:sqlite");
const { createHash, randomBytes, scryptSync, timingSafeEqual } = require("node:crypto");
const path = require("node:path");
const fs = require("node:fs");

const DB_PATH = path.join(__dirname, "sipeka.db");
const db = new DatabaseSync(DB_PATH);
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");

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

// Migrasi kolom tambahan bila belum ada di DB fisik
try { db.exec("ALTER TABLE ledger_transactions ADD COLUMN tx_intent TEXT DEFAULT 'SETOR_NOTA';"); } catch(e) {}
try { db.exec("ALTER TABLE cash_closings ADD COLUMN total_nota INTEGER DEFAULT 0;"); } catch(e) {}
try { db.exec("ALTER TABLE cash_closings ADD COLUMN kg_reguler REAL DEFAULT 0;"); } catch(e) {}
try { db.exec("ALTER TABLE cash_closings ADD COLUMN kg_express REAL DEFAULT 0;"); } catch(e) {}
try { db.exec("ALTER TABLE cash_closings ADD COLUMN kg_kilat REAL DEFAULT 0;"); } catch(e) {}
try { db.exec("ALTER TABLE cash_closings ADD COLUMN income_cash INTEGER DEFAULT 0;"); } catch(e) {}
try { db.exec("ALTER TABLE cash_closings ADD COLUMN income_qris INTEGER DEFAULT 0;"); } catch(e) {}
try { db.exec("ALTER TABLE cash_closings ADD COLUMN income_transfer INTEGER DEFAULT 0;"); } catch(e) {}
try { db.exec("ALTER TABLE cash_closings ADD COLUMN stock_detergent REAL DEFAULT 0;"); } catch(e) {}
try { db.exec("ALTER TABLE cash_closings ADD COLUMN stock_perfume REAL DEFAULT 0;"); } catch(e) {}
try { db.exec("ALTER TABLE cash_closings ADD COLUMN operational_notes TEXT;"); } catch(e) {}

db.exec(`
DROP TRIGGER IF EXISTS ledger_no_update;
CREATE TRIGGER IF NOT EXISTS ledger_no_update
BEFORE UPDATE ON ledger_transactions
WHEN (
  OLD.id != NEW.id OR
  OLD.idempotency_key != NEW.idempotency_key OR
  OLD.branch_id != NEW.branch_id OR
  OLD.user_id != NEW.user_id OR
  OLD.coa_id != NEW.coa_id OR
  OLD.tx_type != NEW.tx_type OR
  OLD.amount != NEW.amount OR
  OLD.payment_method != NEW.payment_method OR
  (OLD.memo IS NOT NULL AND NEW.memo IS NOT NULL AND OLD.memo != NEW.memo) OR
  OLD.created_at != NEW.created_at
)
BEGIN SELECT RAISE(ABORT, 'APPEND_ONLY: data finansial transaksi terkunci, hanya status approval yang boleh diubah'); END;

CREATE TRIGGER IF NOT EXISTS ledger_no_delete
BEFORE DELETE ON ledger_transactions
BEGIN SELECT RAISE(ABORT, 'APPEND_ONLY: transaksi tidak boleh dihapus'); END;

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES app_users(id),
  created_at TEXT DEFAULT (datetime('now'))
);
`);

// ============ PASSWORD ============
function hashPassword(pw, salt) {
  salt = salt || randomBytes(16).toString("hex");
  return salt + ":" + scryptSync(pw, salt, 64).toString("hex");
}
function verifyPassword(pw, stored) {
  const [salt, hash] = stored.split(":");
  const calc = scryptSync(pw, salt, 64);
  return timingSafeEqual(calc, Buffer.from(hash, "hex"));
}

// ============ SEED (idempoten) ============
const uid = () => randomBytes(12).toString("hex");
const DEMO_PASSWORD = "SiPeKA@2026"; // password sama utk semua akun demo

function seed() {
  const units = [
    ["UNIT_LP", "Laundry Pusat", "LAUNDRY"],
    ["UNIT_LC", "Laundry Cabang", "LAUNDRY"],
    ["UNIT_KOS", "Kos RedDoorz", "KOS"],
    ["UNIT_CFE", "Cafe Dummy", "FNB"],
    ["UNIT_VIL", "Villa", "VILLA"],
    ["UNIT_CWS", "Car Wash Dummy", "JASA"],
  ];
  const insUnit = db.prepare("INSERT OR IGNORE INTO business_units (id, code, name, category) VALUES (?,?,?,?)");
  for (const [code, name, cat] of units) {
    insUnit.run(code, code, name, cat);
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
  const pw = hashPassword(DEMO_PASSWORD);
  // Owner
  insUser.run("U_OWNER", "owner", pw, "Decka Prasetya", "OWNER", null);
  // 3 Staff — masing-masing terikat 1 cabang (isolasi)
  insUser.run("U_STAFF1", "dimas", pw, "Dimas Arya", "STAFF", "UNIT_LC");
  insUser.run("U_STAFF2", "sari", pw, "Sari Wulandari", "STAFF", "UNIT_KOS");
  insUser.run("U_STAFF3", "bagas", pw, "Bagas Nugroho", "STAFF", "UNIT_CFE");

  const txCount = db.prepare("SELECT COUNT(*) AS n FROM ledger_transactions").get().n;
  console.log(`[db] seed OK — units=${units.length}, users=4 (1 owner + 3 staff), transactions=${txCount}`);
}

seed();

// ============ QUERIES ============
const q = {
  userByUsername: db.prepare("SELECT * FROM app_users WHERE username = ?"),
  userById: db.prepare("SELECT * FROM app_users WHERE id = ?"),
  updateUserPassword: db.prepare("UPDATE app_users SET password_hash = ? WHERE id = ?"),
  unitById: db.prepare("SELECT * FROM business_units WHERE id = ?"),
  allUnits: db.prepare("SELECT * FROM business_units WHERE is_active = 1 ORDER BY name"),
  allCoa: db.prepare("SELECT * FROM chart_of_accounts ORDER BY account_code"),

  // OWNER: seluruh transaksi semua cabang + semua staf
  txAll: db.prepare(`
    SELECT t.*, u.full_name AS user_name, u.username, b.name AS branch_name, c.account_code, c.account_name
    FROM ledger_transactions t
    JOIN app_users u ON u.id = t.user_id
    JOIN business_units b ON b.id = t.branch_id
    JOIN chart_of_accounts c ON c.id = t.coa_id
    ORDER BY t.created_at DESC
  `),

  // STAFF: HANYA transaksi miliknya sendiri, HANYA hari ini (reset tiap hari)
  txStaffToday: db.prepare(`
    SELECT t.*, u.full_name AS user_name, u.username, b.name AS branch_name, c.account_code, c.account_name
    FROM ledger_transactions t
    JOIN app_users u ON u.id = t.user_id
    JOIN business_units b ON b.id = t.branch_id
    JOIN chart_of_accounts c ON c.id = t.coa_id
    WHERE t.user_id = ? AND t.branch_id = ?
      AND date(t.created_at) = date('now')
    ORDER BY t.created_at DESC
  `),

  // Kinerja staf utk Owner
  staffPerf: db.prepare(`
    SELECT u.id, u.username, u.full_name, b.name AS branch_name,
           COUNT(t.id) AS tx_count,
           COALESCE(SUM(CASE WHEN t.tx_type='INCOME' THEN t.amount END),0) AS income,
           COALESCE(SUM(CASE WHEN t.tx_type='EXPENSE' THEN t.amount END),0) AS expense,
           SUM(CASE WHEN date(t.created_at)=date('now') THEN 1 ELSE 0 END) AS today_count
    FROM app_users u
    LEFT JOIN business_units b ON b.id = u.assigned_branch_id
    LEFT JOIN ledger_transactions t ON t.user_id = u.id
    WHERE u.role = 'STAFF'
    GROUP BY u.id
    ORDER BY u.full_name
  `),

  insertTx: db.prepare(`
    INSERT INTO ledger_transactions
      (id, idempotency_key, branch_id, user_id, coa_id, tx_type, amount, payment_method, memo, receipt_key, status, tx_intent)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
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

  // Cash Closing
  cashDrawerBalanceToday: db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN tx_type='INCOME' THEN amount ELSE 0 END), 0) -
      COALESCE(SUM(CASE WHEN tx_type='EXPENSE' THEN amount ELSE 0 END), 0) AS balance
    FROM ledger_transactions
    WHERE branch_id = ? AND payment_method = 'CASH_DRAWER'
      AND date(created_at) = date('now') AND status != 'REJECTED'
  `),
  insertClosing: db.prepare(`
    INSERT INTO cash_closings (
      id, branch_id, user_id, closing_date, system_balance, physical_cash, difference, reason,
      total_nota, kg_reguler, kg_express, kg_kilat, income_cash, income_qris, income_transfer,
      stock_detergent, stock_perfume, operational_notes, status
    )
    VALUES (?,?,?,date('now'),?,?,?,?,?,?,?,?,?,?,?,?,?,?,'CLOSED')
  `),
  closingsByBranchToday: db.prepare(`
    SELECT c.*, u.full_name as user_name, b.name as branch_name
    FROM cash_closings c
    JOIN app_users u ON u.id = c.user_id
    JOIN business_units b ON b.id = c.branch_id
    WHERE c.branch_id = ? AND c.closing_date = date('now')
    ORDER BY c.created_at DESC
  `),
  allClosingsToday: db.prepare(`
    SELECT c.*, u.full_name as user_name, b.name as branch_name
    FROM cash_closings c
    JOIN app_users u ON u.id = c.user_id
    JOIN business_units b ON b.id = c.branch_id
    WHERE c.closing_date = date('now')
    ORDER BY c.created_at DESC
  `),

  createSession: db.prepare("INSERT INTO sessions (token, user_id) VALUES (?,?)"),
  getSession: db.prepare("SELECT s.token, s.user_id, u.* FROM sessions s JOIN app_users u ON u.id = s.user_id WHERE s.token = ?"),
  dropSession: db.prepare("DELETE FROM sessions WHERE token = ?"),
};

module.exports = { db, q, verifyPassword, hashPassword, uid, DEMO_PASSWORD };
