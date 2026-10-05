'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {createHash,randomBytes}=require('node:crypto');
const {Pool}=require('pg');
const {migrate}=require('../migrations/runner');
const {importSqlite}=require('../scripts/import-sqlite');
const snapshot=process.env.PG_SQLITE_SNAPSHOT;
test('approved online-backup snapshot imports legacy optional columns without changing source',{skip:!snapshot},async()=>{
 assert.ok(process.env.DATABASE_URL,'Disposable PostgreSQL required');
 const hash=()=>createHash('sha256').update(fs.readFileSync(snapshot)).digest('hex');
 const before=hash();
 const schema='pgsnapshot_'+randomBytes(8).toString('hex');
 const admin=new Pool({connectionString:process.env.DATABASE_URL});let target;
 try {
  await admin.query(`CREATE SCHEMA ${schema}`);
  target=new Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema}`});
  await migrate(target);
  const imported=await importSqlite(snapshot,target);
  const {DatabaseSync}=require('node:sqlite');const db=new DatabaseSync(snapshot,{readOnly:true});
  try {
   for(const table of ['business_units','app_users','chart_of_accounts','ledger_transactions','approval_logs','cash_closings'])
    assert.equal(imported.counts[table],db.prepare(`SELECT count(*) AS n FROM ${table}`).get().n);
  } finally {db.close();}
  assert.equal(hash(),before);assert.equal(imported.sessionsImported,0);
  console.log('Online-backup import verified counts: '+JSON.stringify(imported.counts));
 } finally {if(target)await target.end();await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin.end();}
});
