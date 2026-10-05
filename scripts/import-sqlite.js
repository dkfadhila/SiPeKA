'use strict';
// Standalone import: never require db.js (which migrates/seeds SQLite on import).
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { DatabaseSync } = require('node:sqlite');
const { verifySchema, LOCK_KEY } = require('../migrations/runner');
const ORDER = ['business_units','app_users','chart_of_accounts','ledger_transactions','approval_logs','cash_closings','receipt_assets'];
const keys = {receipt_assets:'filename'};
const quote = value => '"'+value.replace(/"/g,'""')+'"';
function snapshotHashes(file) {
 return [file,file+'-wal'].map(name => fs.existsSync(name) ? createHash('sha256').update(fs.readFileSync(name)).digest('hex') : null);
}
function canonical(value) {
 if(value===null) return null;
 if(typeof value==='bigint') return value.toString();
 if(typeof value==='number' && !Number.isFinite(value)) throw new Error('Nonfinite source value');
 return String(value);
}
async function importSqlite(sourcePath,pool) {
 const file = path.resolve(sourcePath);
 if(!fs.statSync(file).isFile()) throw new Error('SQLite source must be an existing file');
 const before = snapshotHashes(file);
 const sqlite = new DatabaseSync(file,{readOnly:true});
 let client;
 let committed = false;
 try {
  sqlite.exec('PRAGMA query_only=ON; BEGIN;');
  if(sqlite.prepare('PRAGMA integrity_check').get().integrity_check!=='ok') throw new Error('SQLite integrity check failed');
  if(sqlite.prepare('PRAGMA foreign_key_check').all().length) throw new Error('SQLite foreign key check failed');
  await verifySchema(pool);
  client = await pool.connect();
  await client.query('BEGIN');
  await client.query('SELECT pg_advisory_xact_lock($1::bigint)',[LOCK_KEY]);
  await client.query("SET LOCAL TIME ZONE 'UTC'");
  // Lock target tables against external writers too. Never merge into existing financial data.
  await client.query(`LOCK TABLE ${[...ORDER,'sessions'].map(quote).join(',')} IN ACCESS EXCLUSIVE MODE`);
  for(const table of [...ORDER,'sessions']) {
   if((await client.query(`SELECT 1 FROM ${quote(table)} LIMIT 1`)).rowCount) throw new Error('PostgreSQL target must be empty');
  }
  const counts = {};
  for(const table of ORDER) {
   const exists = sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table);
   if(!exists && table==='receipt_assets') { counts[table]=0; continue; }
   if(!exists) throw new Error('Missing SQLite source table: '+table);
   const columns = sqlite.prepare(`PRAGMA table_info(${quote(table)})`).all().map(c=>c.name);
   const metadata = (await client.query(`SELECT column_name,data_type,is_nullable,column_default FROM information_schema.columns
    WHERE table_schema=current_schema() AND table_name=$1 ORDER BY ordinal_position`,[table])).rows;
   const target = new Map(metadata.map(c=>[c.column_name,c]));
   if(columns.some(c=>!target.has(c))) throw new Error('Unknown source column; refusing silent data loss in '+table);
   if(metadata.some(c=>!columns.includes(c.column_name) && c.is_nullable==='NO' && c.column_default===null)) throw new Error('Missing required source column in '+table);
   const statement = sqlite.prepare(`SELECT * FROM ${quote(table)} ORDER BY ${quote(keys[table] || 'id')}`);
   statement.setReadBigInts(true);
   const rows = statement.all();
   const sql = `INSERT INTO ${quote(table)}(${columns.map(quote).join(',')}) VALUES(${columns.map((_,i)=>'$'+(i+1)).join(',')})`;
   for(const row of rows) {
    for(const column of columns) {
     const type = target.get(column).data_type;
     const value = row[column];
     if(value===null) continue;
     if(type==='bigint' && (typeof value!=='bigint' || value>9007199254740991n || value< -9007199254740991n)) throw new Error('Unsafe/noninteger financial value in '+table);
     if(type==='timestamp without time zone' && (typeof value!=='string' || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value))) throw new Error('Noncanonical source timestamp in '+table);
    }
    const inserted = await client.query(sql,columns.map(c=>row[c]));
    if(inserted.rowCount!==1) throw new Error('Import affected row mismatch');
   }
   // Re-read every original field before commit; timestamps and exact integers remain lossless strings.
   const select = columns.map(c=> {
    const type=target.get(c).data_type;
    const expression = type==='timestamp without time zone' ? `to_char(${quote(c)},'YYYY-MM-DD HH24:MI:SS')` :
     type==='date' ? `to_char(${quote(c)},'YYYY-MM-DD')` : `${quote(c)}::text`;
    return expression+' AS '+quote(c);
   }).join(',');
   const imported = (await client.query(`SELECT ${select} FROM ${quote(table)} ORDER BY ${quote(keys[table] || 'id')} COLLATE "C"`)).rows;
   const originals = new Map(rows.map(r=>[canonical(r[keys[table] || 'id']),r]));
   if(imported.length!==rows.length) throw new Error('Import count mismatch in '+table);
   for(const row of imported) {
    const original=originals.get(canonical(row[keys[table] || 'id']));
    if(!original || columns.some(c=>canonical(original[c])!==canonical(row[c]))) throw new Error('Import field verification failed in '+table);
   }
   counts[table]=rows.length;
  }
  // WAL/source changing during migration is unsafe: stop writers and use an online-backup snapshot first.
  if(JSON.stringify(before)!==JSON.stringify(snapshotHashes(file))) throw new Error('SQLite source changed during import; use a stable snapshot');
  sqlite.exec('ROLLBACK');
  await client.query('COMMIT'); committed=true;
  return {counts,sessionsImported:0,verified:true};
 } catch(error) {
  if(client && !committed) try { await client.query('ROLLBACK'); } catch {}
  throw error;
 } finally { sqlite.close(); if(client) client.release(); }
}
async function main() {
 if(!process.env.DATABASE_URL) throw new Error('DATABASE_URL required');
 if(process.argv.length!==3) throw new Error('Usage: node scripts/import-sqlite.js /absolute/path/snapshot.sqlite');
 const { Pool } = require('pg');
 const pool=new Pool({connectionString:process.env.DATABASE_URL,connectionTimeoutMillis:10000});
 try { console.log(JSON.stringify(await importSqlite(process.argv[2],pool))); }
 finally { await pool.end(); }
}
if(require.main===module) main().catch(() => { console.error('SiPeKA SQLite import failed; no partial import committed (credentials and row values suppressed)'); process.exitCode=1; });
module.exports={importSqlite};
