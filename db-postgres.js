'use strict';
// SiPeKA PostgreSQL adapter. No seeds, startup migrations, or SQLite fallback.
const { AsyncLocalStorage } = require('node:async_hooks');
const { randomBytes, scryptSync, timingSafeEqual } = require('node:crypto');
const transactions = new AsyncLocalStorage();
const uid = () => randomBytes(12).toString('hex');
const LOCK_KEY = '1397313611'; // Shared by request transactions, migrations, and import.
const ttl = Number(process.env.SESSION_TTL_HOURS || 12);
const safeNumber = value => {
  const n = Number(value);
  if (!Number.isFinite(n) || (Number.isInteger(n) && !Number.isSafeInteger(n)))
    throw new RangeError('PostgreSQL value exceeds safe API numeric range');
  return n;
};
let pool;
function getPool() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required; PostgreSQL never falls back to SQLite');
  if (!Number.isFinite(ttl) || ttl <= 0 || ttl > 168) throw new Error('SESSION_TTL_HOURS harus 0-168 jam');
  if (!pool) {
    const { Pool, types } = require('pg');
    // Per-pool parsers: never change pg's process-global parsers.
    const parsers = new Map([[20, safeNumber], [1700, safeNumber], [1114, x => x], [1082, x => x]]);
    pool = new Pool({ connectionString: process.env.DATABASE_URL, max: 12,
      connectionTimeoutMillis: 10000, idleTimeoutMillis: 10000,
      types: { getTypeParser: (oid, format) => format !== 'binary' && parsers.has(oid) ? parsers.get(oid) : types.getTypeParser(oid, format) } });
    pool.on('error', () => { /* No credentials or query values in logs. Next operation fails normally. */ });
  }
  return pool;
}
const ready = (async () => {
  const { verifySchema } = require('./migrations/runner');
  await verifySchema(getPool());
})();
// Preserve a rejecting promise for callers without an unhandled-rejection crash before listen.
ready.catch(() => {});

function enqueue(scope, callback) {
  const result = scope.tail.then(callback);
  scope.tail = result.catch(() => {});
  return result;
}
function clientQuery(context, sql, values) {
  return enqueue(context.queries, () => context.client.query(sql, values));
}
async function savepoint(scope, callback) {
  // Serialize siblings, not descendants: parallel nested savepoints must never overlap.
  return enqueue(scope, async () => {
    const context = scope.context;
    const name = 'sipeka_' + (++context.counter);
    await clientQuery(context, `SAVEPOINT ${name}`);
    const child = { context, tail: Promise.resolve() };
    try {
      const result = await transactions.run(child, callback);
      await child.tail;
      await clientQuery(context, `RELEASE SAVEPOINT ${name}`);
      return result;
    } catch (error) {
      await child.tail;
      await context.queries.tail;
      try {
        await clientQuery(context, `ROLLBACK TO SAVEPOINT ${name}`);
        await clientQuery(context, `RELEASE SAVEPOINT ${name}`);
      } catch { context.broken = true; }
      throw error;
    }
  });
}
async function withRequestTransaction(callback) {
  if (typeof callback !== 'function') throw new TypeError('Transaction callback is required');
  await ready;
  const active = transactions.getStore();
  if (active) {
    if (active.context.closed) throw new Error('Transaction context already closed');
    return savepoint(active, callback);
  }
  const client = await getPool().connect();
  const context = { client, counter: 0, closed: false, broken: false, queries: { tail: Promise.resolve() } };
  const scope = { context, tail: Promise.resolve() };
  try {
    await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [LOCK_KEY]);
    await client.query("SET LOCAL TIME ZONE 'UTC'");
    const result = await transactions.run(scope, callback);
    await scope.tail;
    await context.queries.tail;
    if (context.broken) throw new Error('Transaction could not be recovered');
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await scope.tail;
    await context.queries.tail;
    try { await client.query('ROLLBACK'); } catch { context.broken = true; }
    throw error;
  } finally { context.closed = true; client.release(context.broken); }
}
async function read(sql, values) {
  await ready;
  const active = transactions.getStore();
  if (active?.context.closed) throw new Error('Transaction context already closed');
  return active ? enqueue(active, () => clientQuery(active.context, sql, values)) : getPool().query(sql, values);
}
async function write(sql, values, expected = 1) {
  return withRequestTransaction(async () => {
    const result = await read(sql, values);
    if (expected !== null && result.rowCount !== expected)
      throw Object.assign(new Error('Expected exactly one affected row'), { code: 'ROW_COUNT_MISMATCH', rowCount: result.rowCount });
    return { changes: result.rowCount, lastInsertRowid: null };
  });
}
function statement(sql, options = {}) {
  const execute = values => options.write ? write(sql, values, options.anyCount ? null : 1) : read(sql, values);
  return {
    async get(...values) { if (options.write) throw new TypeError('Use run for mutating statements'); return (await execute(values)).rows[0]; },
    async all(...values) { if (options.write) throw new TypeError('Use run for mutating statements'); return (await execute(values)).rows; },
    async run(...values) { if (!options.write) throw new TypeError('Use get/all for read statements'); return execute(values); },
  };
}
const TODAY = "((clock_timestamp() AT TIME ZONE 'Asia/Jakarta')::date)";
const TX_DAY = "((t.created_at + interval '7 hours')::date)";
const txJoin = `SELECT t.*, u.full_name AS user_name, u.username, b.name AS branch_name, c.account_code, c.account_name
 FROM ledger_transactions t JOIN app_users u ON u.id=t.user_id JOIN business_units b ON b.id=t.branch_id
 JOIN chart_of_accounts c ON c.id=t.coa_id`;
const closingJoin = `SELECT c.*,u.full_name AS user_name,b.name AS branch_name FROM cash_closings c
 JOIN app_users u ON u.id=c.user_id JOIN business_units b ON b.id=c.branch_id`;
const q = {
  userByUsername: statement('SELECT * FROM app_users WHERE username=$1'),
  userById: statement('SELECT * FROM app_users WHERE id=$1'),
  updateUserPassword: statement('UPDATE app_users SET password_hash=$1 WHERE id=$2', { write: true }),
  unitById: statement('SELECT * FROM business_units WHERE id=$1'),
  unitByIdActive: statement('SELECT * FROM business_units WHERE id=$1 AND is_active=1'),
  allUnits: statement('SELECT * FROM business_units WHERE is_active=1 ORDER BY name'),
  allCoa: statement('SELECT * FROM chart_of_accounts ORDER BY account_code'),
  coaById: statement('SELECT * FROM chart_of_accounts WHERE id=$1'),
  txAll: statement(txJoin + ' ORDER BY t.created_at DESC'),
  txStaffToday: statement(txJoin + ` WHERE t.user_id=$1 AND t.branch_id=$2 AND ${TX_DAY}=${TODAY} ORDER BY t.created_at DESC`),
  staffPerf: statement(`SELECT u.id,u.username,u.full_name,b.name AS branch_name, COUNT(t.id) AS tx_count,
    COALESCE(SUM(CASE WHEN t.tx_type='INCOME' AND t.status='APPROVED' AND t.tx_intent='SETOR_NOTA' THEN t.amount END),0) AS income,
    COALESCE(SUM(CASE WHEN t.tx_type='EXPENSE' AND t.status='APPROVED' AND t.tx_intent='SETOR_NOTA' THEN t.amount END),0) AS expense,
    SUM(CASE WHEN ${TX_DAY}=${TODAY} THEN 1 ELSE 0 END) AS today_count
    FROM app_users u LEFT JOIN business_units b ON b.id=u.assigned_branch_id LEFT JOIN ledger_transactions t ON t.user_id=u.id
    WHERE u.role='STAFF' GROUP BY u.id,b.name ORDER BY u.full_name`),
  insertTx: statement(`INSERT INTO ledger_transactions
    (id,idempotency_key,branch_id,user_id,coa_id,tx_type,amount,payment_method,memo,receipt_key,status,tx_intent,
     idempotency_user_id,idempotency_branch_id,idempotency_fingerprint)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`, { write: true }),
  txByIdempotency: statement('SELECT * FROM ledger_transactions WHERE idempotency_key=$1'),
  txById: statement('SELECT * FROM ledger_transactions WHERE id=$1'),
  updateTxStatus: statement("UPDATE ledger_transactions SET status=$1 WHERE id=$2 AND status='PENDING_APPROVAL'", { write: true }),
  insertApprovalLog: statement('INSERT INTO approval_logs(id,transaction_id,action,reviewer_id,notes) VALUES($1,$2,$3,$4,$5)', { write: true }),
  approvalLogsByTx: statement(`SELECT a.*,u.full_name AS reviewer_name FROM approval_logs a JOIN app_users u ON u.id=a.reviewer_id
    WHERE a.transaction_id=$1 ORDER BY a.created_at DESC`),
  cashDrawerBalanceToday: statement(`SELECT COALESCE(SUM(CASE WHEN tx_type='INCOME' AND status='APPROVED' THEN amount ELSE 0 END),0)
    - COALESCE(SUM(CASE WHEN tx_type='EXPENSE' AND status='APPROVED' THEN amount ELSE 0 END),0) AS balance
    FROM ledger_transactions WHERE branch_id=$1 AND payment_method='CASH_DRAWER' AND tx_intent='SETOR_NOTA'
    AND (created_at + interval '7 hours')::date=${TODAY}`),
  closingTodayByBranch: statement(`SELECT COUNT(*) AS n FROM cash_closings WHERE branch_id=$1 AND closing_date=${TODAY}`),
  insertClosing: statement(`INSERT INTO cash_closings
    (id,branch_id,user_id,closing_date,system_balance,physical_cash,difference,reason,total_nota,kg_reguler,kg_express,kg_kilat,
     income_cash,income_qris,income_transfer,stock_detergent,stock_perfume,operational_notes,idempotency_key,fingerprint,status)
    VALUES($1,$2,$3,${TODAY},$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,'CLOSED')`, { write: true }),
  closingsByBranchToday: statement(closingJoin + ` WHERE c.branch_id=$1 AND c.closing_date=${TODAY} ORDER BY c.created_at DESC`),
  allClosingsToday: statement(closingJoin + ` WHERE c.closing_date=${TODAY} ORDER BY c.created_at DESC`),
  closingTodayByUser: statement(`SELECT * FROM cash_closings WHERE user_id=$1 AND branch_id=$2 AND closing_date=${TODAY} ORDER BY created_at DESC LIMIT 1`),
  closingByUserDate: statement('SELECT * FROM cash_closings WHERE user_id=$1 AND branch_id=$2 AND closing_date=$3::date LIMIT 1'),
  insertReceipt: statement('INSERT INTO receipt_assets(filename,user_id,branch_id,mime) VALUES($1,$2,$3,$4)', { write: true }),
  receiptByFilename: statement('SELECT * FROM receipt_assets WHERE filename=$1'),
  dropSession: statement('DELETE FROM sessions WHERE token=$1', { write: true, anyCount: true }),
  dropUserSessions: statement('DELETE FROM sessions WHERE user_id=$1', { write: true, anyCount: true }),
  allUsers: statement(`SELECT u.id,u.username,u.full_name,u.role,u.assigned_branch_id,u.created_at,b.name AS branch_name,b.code AS branch_code
    FROM app_users u LEFT JOIN business_units b ON b.id=u.assigned_branch_id ORDER BY u.role DESC,u.full_name ASC`),
  insertUser: statement('INSERT INTO app_users(id,username,password_hash,full_name,role,assigned_branch_id) VALUES($1,$2,$3,$4,$5,$6)', { write: true }),
  resetUserPassword: statement('UPDATE app_users SET password_hash=$1 WHERE id=$2', { write: true }),
  insertBranch: statement('INSERT INTO business_units(id,code,name,category,is_active) VALUES($1,$2,$3,$4,1)', { write: true }),
};
// Branch retirement always archives. A referenced unit is never physically deleted.
q.allUnitsIncludingArchived = statement('SELECT * FROM business_units ORDER BY name');
q.branchAuditLogs = statement('SELECT * FROM branch_audit_logs WHERE branch_id=$1 ORDER BY created_at,id');
q.archiveBranch = { run: archiveBranch };
q.deleteBranch = q.archiveBranch;
async function archiveBranch(branchId, actorId, reassignTo = null, reason = '') {
  const fail = (statusCode, error) => ({ ok: false, statusCode, error });
  return withRequestTransaction(async () => {
    const actor = await q.userById.get(actorId);
    if (actor?.role !== 'OWNER') return fail(403, 'Khusus Owner');
    const unit = (await read('SELECT * FROM business_units WHERE id=$1 FOR UPDATE', [branchId])).rows[0];
    if (!unit) return fail(404, 'Unit bisnis tidak ditemukan');
    if (unit.is_active !== 1) return { ok: true, action: 'already_archived', id: branchId, reassigned_users: 0 };
    if ((await q.allUnits.all()).length <= 1) return fail(409, 'Unit aktif terakhir tidak dapat diarsipkan');
    if (reassignTo !== null && (reassignTo === branchId || !(await q.unitByIdActive.get(reassignTo))))
      return fail(400, 'Unit pengganti harus aktif dan berbeda');
    const users = (await read('SELECT id FROM app_users WHERE assigned_branch_id=$1 ORDER BY id FOR UPDATE', [branchId])).rows;
    if (users.length && !reassignTo) return fail(409, 'Pindahkan staf ke unit aktif sebelum mengarsipkan');
    if (typeof reason !== 'string' || reason.length > 1000) return fail(400, 'Alasan maksimal 1000 karakter');
    for (const user of users) {
      await write('UPDATE app_users SET assigned_branch_id=$1 WHERE id=$2', [reassignTo, user.id]);
      await q.dropUserSessions.run(user.id);
    }
    await write("UPDATE business_units SET is_active=0,archived_at=date_trunc('second',clock_timestamp() AT TIME ZONE 'UTC'),archived_by=$1,archive_reason=$2 WHERE id=$3", [actorId, reason.trim(), branchId]);
    await write("INSERT INTO branch_audit_logs(id,branch_id,actor_id,action,reason,reassigned_to,reassigned_users) VALUES($1,$2,$3,'ARCHIVED',$4,$5,$6)", [uid(), branchId, actorId, reason.trim(), reassignTo, users.length]);
    return { ok: true, action: 'archived', id: branchId, reassigned_users: users.length };
  });
}
function hashPassword(pw, salt = randomBytes(16).toString('hex')) {
  return salt + ':' + scryptSync(pw, salt, 64).toString('hex');
}
function verifyPassword(pw, stored) {
  try {
    const [salt, hash] = stored.split(':');
    if (!salt || !hash) return false;
    return timingSafeEqual(scryptSync(pw, salt, 64), Buffer.from(hash, 'hex'));
  } catch { return false; }
}
async function atomicApprove(txId, action, reviewerId, notes) {
  if (!['APPROVED', 'REJECTED'].includes(action)) return { ok: false, error: 'Action tidak valid', statusCode: 400 };
  try {
    return await withRequestTransaction(async () => {
      const tx = (await read('SELECT * FROM ledger_transactions WHERE id=$1 FOR UPDATE', [txId])).rows[0];
      if (!tx) return { ok: false, error: 'Transaksi tidak ditemukan', statusCode: 404 };
      if (tx.status !== 'PENDING_APPROVAL') return { ok: false,
        error: `Transaksi sudah dalam status ${tx.status}; hanya PENDING_APPROVAL yang dapat diubah`,
        statusCode: 409, currentStatus: tx.status };
      if (action === 'APPROVED' && tx.payment_method === 'CASH_DRAWER' && (tx.tx_intent || 'SETOR_NOTA') === 'SETOR_NOTA') {
        const closed = await read(`SELECT id FROM cash_closings WHERE user_id=$1 AND branch_id=$2
          AND closing_date=($3::timestamp + interval '7 hours')::date`, [tx.user_id, tx.branch_id, tx.created_at]);
        if (closed.rowCount) return { ok: false, error: 'Shift pembuat transaksi sudah ditutup untuk tanggal transaksi ini', statusCode: 409 };
      }
      await q.updateTxStatus.run(action, txId);
      await q.insertApprovalLog.run(uid(), txId, action, reviewerId, notes || '');
      return { ok: true, status: action };
    });
  } catch { return { ok: false, error: 'Gagal memproses approval', statusCode: 500 }; }
}
async function createSession(token, userId) {
  const expires = new Date(Date.now() + ttl * 3600000).toISOString().replace('T', ' ').slice(0, 19);
  await write('INSERT INTO sessions(token,user_id,expired_at) VALUES($1,$2,$3::timestamp)', [token, userId, expires]);
}
async function getValidSession(token) {
  const row = (await read(`SELECT s.token,s.user_id,s.expired_at,u.* FROM sessions s JOIN app_users u ON u.id=s.user_id WHERE s.token=$1`, [token])).rows[0];
  if (!row) return null;
  const expires = row.expired_at && Date.parse(row.expired_at.replace(' ', 'T') + 'Z');
  if (!Number.isFinite(expires) || expires <= Date.now()) { await q.dropSession.run(token); return null; }
  return row;
}
async function revokeUserSessions(userId) { return q.dropUserSessions.run(userId); }
async function checkIdempotency(key, userId, branchId, fingerprint) {
  const row = await q.txByIdempotency.get(key);
  if (!row) return { exists: false };
  if (row.idempotency_user_id !== userId || row.idempotency_branch_id !== branchId)
    return { exists: true, conflict: true, reason: 'Idempotency key digunakan oleh pengguna/cabang lain' };
  if (row.idempotency_fingerprint && row.idempotency_fingerprint !== fingerprint)
    return { exists: true, conflict: true, reason: 'Idempotency key dengan payload berbeda' };
  return { exists: true, conflict: false, id: row.id };
}
// Compatibility db.prepare accepts PostgreSQL $n parameters, not SQLite dialect.
// Mutations are explicitly marked; unrestricted raw SQL is intentionally not exposed.
const db = {
  prepare(sql, options = {}) {
    const raw = statement(sql, options);
    if (options.write) return raw;
    const allowed = /^\s*SELECT\b/i.test(sql) && !/;|\b(?:INTO|FOR\s+UPDATE|FOR\s+SHARE)\b/i.test(sql);
    return {
      async get(...values) {
        if (!allowed) throw new TypeError('Raw mutating SQL requires explicit {write:true} and run');
        return withRequestTransaction(() => raw.get(...values));
      },
      async all(...values) {
        if (!allowed) throw new TypeError('Raw mutating SQL requires explicit {write:true} and run');
        return withRequestTransaction(() => raw.all(...values));
      },
      async run() { throw new TypeError('Raw writes require explicit {write:true}'); },
    };
  },
  async close() { if (pool) { const current = pool; pool = null; await current.end(); } },
};
module.exports = { db, q, verifyPassword, hashPassword, uid, atomicApprove, createSession,
  getValidSession, revokeUserSessions, checkIdempotency, ready, withRequestTransaction, getPool };
