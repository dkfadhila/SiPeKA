'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const LOCK_KEY = '1397313611';
const tables = ['business_units','app_users','chart_of_accounts','ledger_transactions','approval_logs','cash_closings','sessions','receipt_assets'];
function files() {
 return fs.readdirSync(__dirname).filter(x => /^\d+_[a-z0-9_]+\.sql$/.test(x)).sort().map(name => {
  const sql = fs.readFileSync(path.join(__dirname,name),'utf8');
  const normalized=sql.replace(/\r\n/g,'\n');
  return { name,sql,sha256:createHash('sha256').update(normalized).digest('hex'),legacySha256:createHash('sha256').update(normalized.replace(/\n/g,'\r\n')).digest('hex') };
 });
}
async function migrate(pool) {
 const client = await pool.connect();
 try {
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock($1::bigint)',[LOCK_KEY]);
  await client.query("SET LOCAL TIME ZONE 'UTC'");
  await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations(name text PRIMARY KEY,sha256 text NOT NULL,
   applied_at timestamptz NOT NULL DEFAULT clock_timestamp())`);
  const applied = new Map((await client.query('SELECT name,sha256 FROM schema_migrations')).rows.map(r => [r.name,r.sha256]));
  const known = files();
  for (const name of applied.keys()) if (!known.some(f => f.name===name)) throw new Error('Unknown migration in database');
  for (const file of known) {
   if (applied.has(file.name)) {
    if (applied.get(file.name)!==file.sha256 && applied.get(file.name)!==file.legacySha256) throw new Error('Applied migration checksum mismatch: '+file.name);
    continue;
   }
   await client.query(file.sql);
   await client.query('INSERT INTO schema_migrations(name,sha256) VALUES($1,$2)',[file.name,file.sha256]);
  }
  await client.query('COMMIT');
 } catch (error) { try { await client.query('ROLLBACK'); } catch {} throw error; }
 finally { client.release(); }
}
async function verifySchema(pool) {
 // Read-only startup verification: never migrates, seeds, expires sessions, or changes schema.
 await pool.query('SELECT 1');
 const applied = new Map((await pool.query('SELECT name,sha256 FROM schema_migrations')).rows.map(r => [r.name,r.sha256]));
 const known = files();
 if (applied.size!==known.length || known.some(f => applied.get(f.name)!==f.sha256 && applied.get(f.name)!==f.legacySha256)) throw new Error('PostgreSQL migration schema mismatch; run explicit migrations');
 const columns = {
  business_units:'id code name category is_active created_at',
  app_users:'id username password_hash full_name role assigned_branch_id created_at',
  chart_of_accounts:'id account_code account_name account_type',
  ledger_transactions:'id idempotency_key branch_id user_id coa_id tx_type amount payment_method memo receipt_key status tx_intent idempotency_user_id idempotency_branch_id idempotency_fingerprint created_at',
  approval_logs:'id transaction_id action reviewer_id notes created_at',
  cash_closings:'id branch_id user_id closing_date system_balance physical_cash difference reason total_nota kg_reguler kg_express kg_kilat income_cash income_qris income_transfer stock_detergent stock_perfume operational_notes status idempotency_key fingerprint created_at',
  sessions:'token user_id expired_at created_at',
  receipt_assets:'filename user_id branch_id mime created_at',
 };
 for (const table of tables) {
  await pool.query(`SELECT ${columns[table].split(' ').join(',')} FROM ${table} LIMIT 0`);
  const metadata = (await pool.query(`SELECT column_name,data_type FROM information_schema.columns
   WHERE table_schema=current_schema() AND table_name=$1`,[table])).rows;
  for (const column of metadata) {
   if (['amount','system_balance','physical_cash','difference','total_nota','income_cash','income_qris','income_transfer'].includes(column.column_name) && column.data_type!=='bigint') throw new Error('PostgreSQL exact-money schema mismatch');
   if (['created_at','expired_at'].includes(column.column_name) && column.data_type!=='timestamp without time zone') throw new Error('PostgreSQL timestamp schema mismatch');
  }
 }
 const guards = await pool.query(`SELECT tgname,tgenabled FROM pg_trigger WHERE NOT tgisinternal
  AND tgrelid IN ('ledger_transactions'::regclass,'cash_closings'::regclass,'approval_logs'::regclass)`);
 const required = ['sipeka_ledger_update','sipeka_ledger_delete','sipeka_closing_update','sipeka_closing_delete','sipeka_approval_immutable'];
 if (required.some(name => !guards.rows.some(r => r.tgname===name && ['O','A'].includes(r.tgenabled)))) throw new Error('PostgreSQL immutable guards missing/disabled');
 const unique = await pool.query(`SELECT 1 FROM pg_constraint WHERE conrelid='cash_closings'::regclass
  AND conname='closing_user_branch_date_unique' AND contype='u' AND convalidated`);
 if (unique.rowCount!==1) throw new Error('PostgreSQL closing uniqueness missing');
}
async function main() {
 if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
 if (process.argv.length>3 || (process.argv[2] && process.argv[2]!=='--verify')) throw new Error('Usage: node migrations/runner.js [--verify]');
 const { Pool } = require('pg');
 const pool = new Pool({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:10000});
 try { if (process.argv[2]!=='--verify') await migrate(pool); await verifySchema(pool); console.log('SiPeKA PostgreSQL schema verified'); }
 finally { await pool.end(); }
}
if (require.main===module) main().catch(() => { console.error('SiPeKA PostgreSQL migration/verification failed (credentials and SQL values suppressed)'); process.exitCode=1; });
module.exports = { migrate,verifySchema,tables,LOCK_KEY,files };
