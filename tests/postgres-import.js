'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { randomBytes,createHash } = require('node:crypto');
const { Pool } = require('pg');
const { DatabaseSync } = require('node:sqlite');
const { migrate } = require('../migrations/runner');

test('read-only SQLite import preserves every record/hash/ID, omits sessions, verifies values and rolls back conflicts', async () => {
 assert.ok(fs.existsSync(path.resolve(__dirname,'../scripts/import-sqlite.js')), 'Read-only SQLite importer must exist');
 assert.ok(process.env.DATABASE_URL, 'Disposable PostgreSQL required');
 const admin = new Pool({connectionString:process.env.DATABASE_URL});
 const schema = 'pgimport_'+randomBytes(8).toString('hex');
 const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(),'sipeka-pgimport-'));
 const file = path.join(dir,'fixture.sqlite');
 let target;
 try {
  await admin.query(`CREATE SCHEMA ${schema}`);
  target = new Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema}`});
  await migrate(target);
  const sql = new DatabaseSync(file);
  sql.exec(`CREATE TABLE business_units(id TEXT PRIMARY KEY,code TEXT,name TEXT,category TEXT,is_active INTEGER,created_at TEXT);
    CREATE TABLE app_users(id TEXT PRIMARY KEY,username TEXT,password_hash TEXT,full_name TEXT,role TEXT,assigned_branch_id TEXT,created_at TEXT);
    CREATE TABLE chart_of_accounts(id TEXT PRIMARY KEY,account_code TEXT,account_name TEXT,account_type TEXT);
    CREATE TABLE ledger_transactions(id TEXT PRIMARY KEY,idempotency_key TEXT,branch_id TEXT,user_id TEXT,coa_id TEXT,tx_type TEXT,amount INTEGER,payment_method TEXT,memo TEXT,receipt_key TEXT,status TEXT,tx_intent TEXT,created_at TEXT,idempotency_user_id TEXT,idempotency_branch_id TEXT,idempotency_fingerprint TEXT);
    CREATE TABLE approval_logs(id TEXT PRIMARY KEY,transaction_id TEXT,action TEXT,reviewer_id TEXT,notes TEXT,created_at TEXT);
    CREATE TABLE cash_closings(id TEXT PRIMARY KEY,branch_id TEXT,user_id TEXT,closing_date TEXT,system_balance INTEGER,physical_cash INTEGER,difference INTEGER,reason TEXT,total_nota INTEGER,kg_reguler REAL,kg_express REAL,kg_kilat REAL,income_cash INTEGER,income_qris INTEGER,income_transfer INTEGER,stock_detergent REAL,stock_perfume REAL,operational_notes TEXT,status TEXT,created_at TEXT,idempotency_key TEXT,fingerprint TEXT);
    CREATE TABLE receipt_assets(filename TEXT PRIMARY KEY,user_id TEXT,branch_id TEXT,mime TEXT,created_at TEXT);
    CREATE TABLE sessions(token TEXT,user_id TEXT);
    INSERT INTO business_units VALUES('B','B','Original unit','LAUNDRY',1,'2026-01-01 00:00:00');
    INSERT INTO app_users VALUES('U','original','unaltered-hash','Original user','STAFF','B','2026-01-01 00:00:00');
    INSERT INTO chart_of_accounts VALUES('C','C','Income','REVENUE');
    INSERT INTO ledger_transactions VALUES('T','idem','B','U','C','INCOME',9007199254740991,'QRIS','memo',NULL,'APPROVED','SETOR_NOTA','2026-01-01 17:00:00','U','B','fingerprint');
    INSERT INTO approval_logs VALUES('A','T','APPROVED','U','original note','2026-01-01 17:00:01');
    INSERT INTO cash_closings VALUES('K','B','U','2026-01-02',0,0,0,'',1,1.25,0.5,0,0,0,0,1.125,2.5,'notes','CLOSED','2026-01-01 18:00:00','close-key','close-fingerprint');
    INSERT INTO receipt_assets VALUES('original.jpg','U','B','image/jpeg','2026-01-01 17:00:00');
    INSERT INTO sessions VALUES('never-import','U');`);
  sql.close();
  const digest = () => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const before = digest();
  const { importSqlite } = require('../scripts/import-sqlite');
  const result = await importSqlite(file,target);
  assert.equal(result.counts.ledger_transactions,1);
  assert.equal(result.sessionsImported,0);
  assert.equal((await target.query('SELECT password_hash FROM app_users')).rows[0].password_hash,'unaltered-hash');
  assert.equal((await target.query('SELECT amount::text FROM ledger_transactions')).rows[0].amount,'9007199254740991');
  assert.equal((await target.query('SELECT count(*)::int AS n FROM sessions')).rows[0].n,0);
  assert.equal((await target.query('SELECT kg_reguler FROM cash_closings')).rows[0].kg_reguler,1.25);
  assert.equal(digest(),before);
  await assert.rejects(importSqlite(file,target), /empty/);
  assert.equal((await target.query('SELECT count(*)::int AS n FROM ledger_transactions')).rows[0].n,1);
  const badSchema=schema+'_bad';
  await admin.query(`CREATE SCHEMA ${badSchema}`);
  const bad=new Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${badSchema}`});
  try {
   await migrate(bad);
   const invalid=new DatabaseSync(file);invalid.exec("UPDATE ledger_transactions SET amount=-1");invalid.close();
   await assert.rejects(importSqlite(file,bad));
   assert.equal((await bad.query('SELECT count(*)::int AS n FROM business_units')).rows[0].n,0,'No partial masters commit');
   const restore=new DatabaseSync(file);restore.exec('UPDATE ledger_transactions SET amount=9007199254740991');restore.close();
  } finally {await bad.end();await admin.query(`DROP SCHEMA ${badSchema} CASCADE`);}
  const legacySchema=schema+'_legacy';
  await admin.query(`CREATE SCHEMA ${legacySchema}`);
  const legacy=new Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${legacySchema}`});
  try {
   await migrate(legacy);
   const old=new DatabaseSync(file); old.exec('DROP TABLE receipt_assets'); old.close();
   const imported=await importSqlite(file,legacy);
   assert.equal(imported.counts.receipt_assets,0);
   assert.equal(imported.counts.app_users,1);
  } finally { await legacy.end(); await admin.query(`DROP SCHEMA ${legacySchema} CASCADE`); }
 } finally {
  if(target) await target.end();
  await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await admin.end();
  fs.rmSync(dir,{recursive:true,force:true});
 }
});
