'use strict';
// C1/C2 payroll delivery recovery: migration 024 + service catch-splitting + scheduler.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs');
const payroll=require('../employee-payroll');
const pglitePath=process.env.PAYROLL_TEST_PGLITE||process.env.REPORTS_TEST_PGLITE||'D:/FamilyAgent/Flora/generated/sipeka-operations/payroll-test-runtime/node_modules/@electric-sql/pglite';
const employee={id:'HO-26002',name:'Ayu Contoh',department:'Operasional',branch_id:'ho',branch_name:'Head Office',active:true,revision:1,email:'ayu@example.test'};
const csv=period=>payroll.FULL_GENERAL_HEADER+'\r\n'+[period,employee.id,'3000000','250000','100000','200000','150000','50000','25000','0','0','Admin','Tetap','Transfer'].join(',')+'\r\n';
function harness(db){
 const run=async(sql,params)=>{const result=!params&&sql.includes(';')?(await db.exec(sql)).at(-1):await db.query(sql,params);return {...result,rowCount:result.rows.length||result.affectedRows||0};};
 let mutex=Promise.resolve();const acquire=async()=>{const prior=mutex;let release;mutex=new Promise(r=>release=r);await prior;return release;};
 return {async query(sql,params){const release=await acquire();try{return await run(sql,params);}finally{release();}},async connect(){const release=await acquire();return {query:run,release};}};
}
const seed=`INSERT INTO business_units(id,code,name,category) VALUES('ho','AMC','Head Office','LAUNDRY');
INSERT INTO app_users(id,username,password_hash,full_name,role,assigned_branch_id) VALUES('owner','qa_owner','unused','Owner QA','OWNER',NULL),('device','qa_device','unused','Device QA','STAFF','ho');
INSERT INTO sessions(token,user_id,expired_at,purpose) VALUES('owner-session','owner',(clock_timestamp() AT TIME ZONE 'UTC')+interval '1 hour','full'),('staff-session','device',(clock_timestamp() AT TIME ZONE 'UTC')+interval '1 hour','full');
INSERT INTO operational_staff(id,name,branch_id,department,email) VALUES('HO-26002','Ayu Contoh','ho','Operasional','ayu@example.test');
INSERT INTO company_profile(singleton,name,updated_by) VALUES(true,'CV Artha Multi Ciptanusa','owner');`;

test('migration chain 001->024 adds bounded recovery; stranded sending rows become failed and are never auto-resent',{skip:!fs.existsSync(pglitePath),timeout:120000},async t=>{
 const {PGlite}=require(pglitePath),db=new PGlite();t.after(()=>db.close());
 const pool=harness(db);
 await require('../migrations/runner').migrate(pool);
 assert.equal((await pool.query("SELECT count(*)::int n FROM schema_migrations WHERE name='024_payroll_stale_recovery.sql'")).rows[0].n,1);
 await pool.query(seed);
 await pool.query(`INSERT INTO payroll_batches(id,period,status,created_by,preview_token,published_by,published_at) VALUES
  ('b1','2026-10','PUBLISHED','owner','pv1','owner',clock_timestamp()),('b2','2026-11','PUBLISHED','owner','pv2','owner',clock_timestamp()),
  ('b3','2026-12','PUBLISHED','owner','pv3','owner',clock_timestamp()),('b4','2027-01','PUBLISHED','owner','pv4','owner',clock_timestamp());
 INSERT INTO payroll_entries(id,batch_id,period,staff_id,payload_cipher) VALUES
  ('e1','b1','2026-10','HO-26002','v1.fixture'),('e2','b2','2026-11','HO-26002','v1.fixture2'),('e3','b3','2026-12','HO-26002','v1.fixture3'),('e4','b4','2027-01','HO-26002','v1.fixture4');
 INSERT INTO payroll_delivery_outbox(id,entry_id,channel,status,attempts,error_code,updated_at) VALUES
  ('job-stale','e1','email','sending',1,NULL,clock_timestamp()-interval '20 minutes'),
  ('job-fresh','e2','email','sending',1,NULL,clock_timestamp()),
  ('job-uncertain','e3','email','uncertain',1,'PAYROLL_PROVIDER_ACCEPTANCE_UNKNOWN',clock_timestamp()-interval '90 minutes'),
  ('job-sent','e4','email','sent',1,NULL,clock_timestamp()-interval '90 minutes');`);
 const before=(await pool.query("SELECT id,status,error_code,attempts FROM payroll_delivery_outbox ORDER BY id")).rows;
 const sweep=(await pool.query('SELECT payroll_recover_stale_claims(15) result')).rows[0].result;
 assert.deepEqual(sweep,{recovered:1,lease_minutes:15});
 const after=(await pool.query('SELECT id,status,error_code,attempts FROM payroll_delivery_outbox ORDER BY id')).rows;
 assert.equal(after.find(r=>r.id==='job-stale').status,'failed');
 assert.equal(after.find(r=>r.id==='job-stale').error_code,'PAYROLL_STALE_CLAIM_RECOVERED');
 assert.equal(after.find(r=>r.id==='job-fresh').status,'sending');
 assert.equal(after.find(r=>r.id==='job-uncertain').status,'uncertain');
 assert.equal(after.find(r=>r.id==='job-sent').status,'sent');
 assert.equal(after.find(r=>r.id==='job-stale').attempts,1,'recovery never resends');
 // second sweep is a no-op (idempotent)
 assert.deepEqual((await pool.query('SELECT payroll_recover_stale_claims(15) result')).rows[0].result,{recovered:0,lease_minutes:15});
 // lease is clamped 1..1440
 assert.equal((await pool.query('SELECT payroll_recover_stale_claims(0) result')).rows[0].result.lease_minutes,1);
 assert.equal((await pool.query('SELECT payroll_recover_stale_claims(99999) result')).rows[0].result.lease_minutes,1440);
 assert.equal((await pool.query('SELECT payroll_recover_stale_claims(NULL) result')).rows[0].result.lease_minutes,15);
 // audit is append-only, metadata-only: no amounts, emails, payloads or provider ids
 const audit=(await pool.query("SELECT action,batch_id,actor_id FROM payroll_access_audit WHERE action='STALE_RECLAIM'")).rows;
 assert.equal(audit.length,1);assert.equal(audit[0].batch_id,'b1');assert.equal(audit[0].actor_id,null);
 const dump=JSON.stringify((await pool.query('SELECT * FROM payroll_access_audit')).rows);
 for(const secret of ['ayu@example.test','3000000','v1.','provider-'])assert.ok(!dump.includes(secret),'audit leaks '+secret);
 // re-arm: Owner only, and only retryable codes
 await assert.rejects(pool.query("SELECT employee_payroll_rearm('staff-session','e1')"),/PAYROLL_OWNER_ONLY/);
 assert.deepEqual((await pool.query("SELECT employee_payroll_rearm('owner-session','e1') result")).rows[0].result,{rearmed:true,status:'pending'});
 assert.equal((await pool.query("SELECT status,error_code FROM payroll_delivery_outbox WHERE id='job-stale'")).rows[0].status,'pending');
 assert.equal((await pool.query("SELECT employee_payroll_rearm('owner-session','e1') result")).rows[0].result.rearmed,false,'pending is not re-armed twice');
 assert.equal((await pool.query("SELECT employee_payroll_rearm('owner-session','e3') result")).rows[0].result.rearmed,false,'uncertain is never re-armed');
 assert.equal((await pool.query("SELECT employee_payroll_rearm('owner-session','e4') result")).rows[0].result.rearmed,false,'sent is never re-armed');
 // fail-claim: Owner only, whitelist only, and only a claimed row
 await assert.rejects(pool.query("SELECT employee_payroll_fail_claim('staff-session','job-fresh','PAYROLL_PROVIDER_REJECTED')"),/PAYROLL_OWNER_ONLY/);
 await assert.rejects(pool.query("SELECT employee_payroll_fail_claim('owner-session','job-fresh','PAYROLL_PROVIDER_ACCEPTANCE_UNKNOWN')"),/PAYROLL_DELIVERY_STATUS/);
 const failed=(await pool.query("SELECT employee_payroll_fail_claim('owner-session','job-fresh','PAYROLL_PROVIDER_REJECTED') result")).rows[0].result;
 assert.deepEqual({status:failed.status,error_code:failed.error_code},{status:'failed',error_code:'PAYROLL_PROVIDER_REJECTED'});
 await assert.rejects(pool.query("SELECT employee_payroll_fail_claim('owner-session','job-fresh','PAYROLL_PROVIDER_REJECTED')"),/PAYROLL_DELIVERY_STATUS/,'already settled');
 assert.equal(before.length,4);
});

test('service splits pre-provider failure from ambiguous provider access, and only re-arms retryable rows',{skip:!fs.existsSync(pglitePath),timeout:120000},async t=>{
 const {PGlite}=require(pglitePath),db=new PGlite();t.after(()=>db.close());
 const pool=harness(db);
 await require('../migrations/runner').migrate(pool);
 await pool.query(seed);
 const env={PAYROLL_ENCRYPTION_KEY:'ab'.repeat(32),PAYROLL_EMAIL_FROM:'raditya@widyafa.xyz'};
 const rejecting=payroll.service({pool,env,transport:{async sendMail(mail){return {accepted:[],messageId:'rejected-'+mail.to};}}});
 const import1=await rejecting.importCsv('owner-session',csv('2026-10'));
 const entry1=(await rejecting.list('owner-session')).rows[0];
 await rejecting.publish('owner-session',{id:import1.id,preview_token:entry1.preview_token,confirmed:true});
 const rejected=await rejecting.send('owner-session',entry1.id,{email:employee.email,confirmed:true});
 assert.equal(rejected.status,'failed');assert.equal(rejected.error_code,'PAYROLL_PROVIDER_REJECTED');
 // explicit Owner retry re-arms the retryable row and sends
 const sent=[];
 const good=payroll.service({pool,env,transport:{async sendMail(mail){sent.push(mail);return {accepted:[mail.to],messageId:'ok-'+sent.length};}}});
 const retried=await good.send('owner-session',entry1.id,{email:employee.email,confirmed:true});
 assert.equal(retried.status,'sent');assert.equal(sent.length,1);
 // a genuine provider throw stays terminal 'uncertain' and is never resent automatically
 const import2=await good.importCsv('owner-session',csv('2026-11'));
 const entry2=(await good.list('owner-session')).rows.find(e=>e.batch_id===import2.id);
 await good.publish('owner-session',{id:import2.id,preview_token:entry2.preview_token,confirmed:true});
 let calls=0;
 const ambiguous=payroll.service({pool,env,transport:{async sendMail(){calls++;throw Error('offline-provider-timeout');}}});
 assert.equal((await ambiguous.send('owner-session',entry2.id,{email:employee.email,confirmed:true})).status,'uncertain');
 assert.equal((await ambiguous.send('owner-session',entry2.id,{email:employee.email,confirmed:true})).status,'uncertain');
 assert.equal(calls,1,'uncertain is not resubmitted');
 const row=(await pool.query("SELECT status,error_code FROM payroll_delivery_outbox WHERE entry_id=$1 AND channel='email'",[entry2.id])).rows[0];
 assert.deepEqual({status:row.status,error_code:row.error_code},{status:'uncertain',error_code:'PAYROLL_PROVIDER_ACCEPTANCE_UNKNOWN'});
 // FENCE failure is provably pre-provider: contact change after claim is impossible to reach here,
 // so assert the mapped code directly through the exported helper path (deactivated staff blocks earlier).
 await pool.query("UPDATE operational_staff SET active=false WHERE id=$1",[employee.id]);
 await assert.rejects(good.send('owner-session',entry2.id,{email:employee.email,confirmed:true}),/PAYROLL_CONTACT_CHANGED/);
});

test('scheduler is single-flight, idle-safe and clamps its lease',async()=>{
 const {createStaleClaimRecovery,clampLease,DEFAULT_LEASE_MINUTES}=require('../payroll-stale-recovery');
 assert.equal(clampLease(0),DEFAULT_LEASE_MINUTES);assert.equal(clampLease(2000),DEFAULT_LEASE_MINUTES);assert.equal(clampLease(30),30);
 let inflight=null,calls=0;
 const pool={query(){calls++;return new Promise(resolve=>{inflight=()=>resolve({rows:[{result:{recovered:0,lease_minutes:15}}]});});}};
 const recovery=createStaleClaimRecovery({pool,leaseMinutes:15});
 const first=recovery.runOnce();
 const second=await recovery.runOnce();
 assert.equal(second,null,'concurrent run is skipped');
 inflight();assert.deepEqual(await first,{recovered:0,lease_minutes:15});
 assert.equal(calls,1);
 const timer=recovery.start();assert.equal(recovery.start(),timer,'start is idempotent');
 assert.ok(timer.hasRef&&!timer.hasRef(),'timer is unref-ed');
 recovery.stop();assert.equal(recovery.status().timer,false);
 assert.throws(()=>createStaleClaimRecovery({}),/PAYROLL_STALE_RECOVERY_CONFIG/);
});
