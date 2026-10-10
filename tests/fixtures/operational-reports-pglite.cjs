'use strict';
// Isolated in-memory PostgreSQL/WASM. No network database, storage or providers.
const fs=require('node:fs'),path=require('node:path');
const {PGlite}=require(process.env.REPORTS_TEST_PGLITE);
const root=path.resolve(__dirname,'../..');
(async()=>{
 const engine=new PGlite();let tail=Promise.resolve();
 const run=(sql,args)=>{const task=tail.then(async()=>{
  const result=!args&&sql.includes(';')?(await engine.exec(sql)).at(-1):await engine.query(sql,args);
  // pg adapter parses timestamp-without-time-zone/date as strings, not JS Date.
  for(const field of result.fields||[])if([1114,1082].includes(field.dataTypeID))for(const row of result.rows)if(row[field.name] instanceof Date)row[field.name]=row[field.name].toISOString().slice(0,field.dataTypeID===1082?10:23).replace('T',' ');
  return {...result,rowCount:result.rows.length||result.affectedRows||0};
 });tail=task.catch(()=>{});return task.catch(e=>{console.error('FIXTURE_SQL_ERROR',e.message,sql);throw e;});};
 const admin={query:run,connect:async()=>({query:run,release(){}})};
 await require(path.join(root,'migrations/runner')).migrate(admin);
 await run(`INSERT INTO business_units(id,code,name,category,is_active) VALUES('a','A','Laundry','LAUNDRY',1),('old','OLD','Archived','LAUNDRY',0),('b','B','Other','LAUNDRY',1);
 INSERT INTO app_users(id,username,password_hash,full_name,role,assigned_branch_id) VALUES('owner','fixture-owner','unused','Fixture Owner','OWNER',NULL),('staff','fixture-staff','unused','Fixture Staff','STAFF','a');
 INSERT INTO chart_of_accounts VALUES('coa-exp','5-101','Supplies','EXPENSE'),('coa-in','4-101','Income','INCOME');
 INSERT INTO sessions(token,user_id,expired_at,purpose) VALUES('fixture-owner','owner',(clock_timestamp() AT TIME ZONE 'UTC')+interval '1 hour','full'),('fixture-staff','staff',(clock_timestamp() AT TIME ZONE 'UTC')+interval '1 hour','full');
 INSERT INTO receipt_assets(filename,user_id,branch_id,mime) VALUES('settlement.jpeg','staff','a','image/jpeg'),('ordinary.jpeg','staff','a','image/jpeg');
 INSERT INTO ledger_transactions(id,idempotency_key,branch_id,user_id,coa_id,tx_type,amount,payment_method,memo,receipt_key,status,tx_intent,created_at) VALUES
 ('ordinary','ordinary','a','staff','coa-exp','EXPENSE',9007199254730000,'CASH_DRAWER','=formula','/api/receipts/ordinary.jpeg','APPROVED','SETOR_NOTA','2026-09-30 17:00:00'),
 ('income','income','a','staff','coa-in','INCOME',500,'BANK_TRANSFER','',NULL,'APPROVED','SETOR_NOTA','2026-10-01 16:59:59'),
 ('pending','pending','a','staff','coa-exp','EXPENSE',300,'CASH_DRAWER','',NULL,'PENDING_APPROVAL','SETOR_NOTA','2026-10-01 01:00:00'),
 ('advance','advance','a','staff','coa-exp','EXPENSE',1000,'CASH_DRAWER','',NULL,'APPROVED','PENGAJUAN_DANA','2026-09-29 01:00:00'),
 ('other','other','b','staff','coa-exp','EXPENSE',50,'QRIS','',NULL,'APPROVED','SETOR_NOTA','2026-10-01 01:00:00'),
 ('outside','outside','a','staff','coa-exp','EXPENSE',900,'CASH_DRAWER','',NULL,'APPROVED','SETOR_NOTA','2026-10-01 17:00:00');
 INSERT INTO cash_closings(id,branch_id,user_id,closing_date,system_balance,physical_cash,difference,reason) VALUES('close','a','staff','2026-10-01',-100,400,500,'Carryforward unverified');
 INSERT INTO advance_events(id,advance_id,branch_id,actor_id,action,settlement_id,idempotency_key,request,result,amount,created_at) VALUES
 ('disburse','advance','a','owner','DISBURSE',NULL,'disburse','{}','{}',1000,'2026-10-01T02:00:00Z'),
 ('submit','advance','a','staff','SUBMIT',NULL,'submit','{}','{}',700,'2026-10-01T03:00:00Z'),
 ('approve','advance','a','owner','APPROVE','submit','approve','{}','{}',700,'2026-10-01T04:00:00Z'),
 ('return','advance','a','owner','RETURN','submit','return','{}','{}',300,'2026-10-01T05:00:00Z');
 INSERT INTO advance_settlement_lines VALUES('submit',1,'settlement.jpeg','coa-exp',700);
 INSERT INTO advance_receipt_claims VALUES('settlement.jpeg','advance');`);
 // Fixture-only runtime role and reviewed minimum grants. Not a deployed ACL copy.
 await run(`CREATE ROLE sipeka_runtime; REVOKE CREATE ON SCHEMA public FROM PUBLIC;
 GRANT USAGE ON SCHEMA public TO sipeka_runtime;
 GRANT SELECT ON business_units,app_users,chart_of_accounts,ledger_transactions,cash_closings,receipt_assets,sessions,schema_migrations,approval_logs,payroll_telegram_bindings,accounting_accounts,accounting_journals,accounting_lines,accounting_period_locks TO sipeka_runtime;
 GRANT UPDATE(last_seen_at) ON sessions TO sipeka_runtime;
 GRANT EXECUTE ON FUNCTION advance_read(text,text,jsonb),advance_command(text,text,jsonb),accounting_owner(text),accounting_post(text,jsonb),accounting_preview(text,jsonb) TO sipeka_runtime;
 SET ROLE sipeka_runtime;`);
 // Exercise exact current db-postgres.js, server.js, advance-service.js and startup guards.
 // Only wire transport changed: pg.Pool executes SQL inside PGlite instead of TCP.
 let connections=Promise.resolve();
 async function acquire(){let unlock;const prior=connections;connections=new Promise(r=>unlock=r);await prior;return unlock;}
 class Pool{async query(sql,args){const release=await acquire();try{return await run(sql,args);}finally{release();}}async connect(){const release=await acquire();return {query:run,release};}on(){}async end(){}}
 const pgPath=require.resolve('pg',{paths:[root]});const pg=require(pgPath);pg.Pool=Pool;
 await require(path.join(root,'migrations/runner')).verifySchema(admin);
 await require(path.join(root,'advance-service')).guard(admin);
 await run('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
 const settings=(await run("SELECT current_user role,current_setting('transaction_read_only') ro,current_setting('transaction_isolation') isolation")).rows[0];
 require('node:assert/strict').deepEqual(settings,{role:'sipeka_runtime',ro:'on',isolation:'repeatable read'});
 const snapshot=await require(path.join(root,'advance-service')).snapshot(admin,'fixture-owner');
 require('node:assert/strict').equal(snapshot.rows[0].events.find(e=>e.action==='APPROVE').lines[0].receiptKey,'settlement.jpeg');
 await run('ROLLBACK');
 require(path.join(root,'server'));
})().catch(e=>{console.error(e);process.exit(1);});
