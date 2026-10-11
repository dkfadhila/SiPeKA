'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const runtime=process.env.PAYROLL_TEST_PGLITE;
test('publication never queues; explicit Owner queue validates master contacts and is idempotent',{skip:!runtime},async()=>{
 const {PGlite}=require(runtime),db=new PGlite();let tail=Promise.resolve();const pool={query:(s,p)=>db.query(s,p),async connect(){let release;const before=tail;tail=new Promise(r=>release=r);await before;return {query:(s,p)=>db.query(s,p),release};}};
 try{await db.exec(fs.readFileSync(require.resolve('../migrations/001_initial.sql'),'utf8'));await db.exec(fs.readFileSync(require.resolve('../migrations/004_payroll.sql'),'utf8'));await db.exec(fs.readFileSync(require.resolve('../migrations/009_payroll_telegram_onboarding.sql'),'utf8'));await db.exec(fs.readFileSync(require.resolve('../migrations/010_payroll_contact_proof.sql'),'utf8'));
 await db.exec("INSERT INTO app_users(id,username,password_hash,full_name,role,email,email_verified,telegram_user_id,telegram_verified) VALUES('o','owner','unused','Owner','OWNER',NULL,false,NULL,false),('s','staff','unused','Verified Staff','STAFF','staff@example.test',true,'101',true),('s2','staff2','unused','Other Staff','STAFF','other@example.test',false,'202',false)");
 const actor={id:'o',role:'OWNER'},svc=require('../payroll').createPayrollService({pool,encryptionKey:'a'.repeat(64),emailEnabled:true}),header=require('../payroll').templateCsv();
 const draft=await svc.importCsv(actor,header+'2026-10,staff,1000,100,50,10\n2026-10,staff2,2000,200,100,20');
 await svc.publish(actor,draft.id,draft.preview_token);
 assert.equal((await pool.query('SELECT * FROM payroll_delivery_outbox')).rows.length,0,'publishing is not sending');
 const entry=draft.rows.find(r=>r.user_id==='s').entry_id,other=draft.rows.find(r=>r.user_id==='s2').entry_id;
 await assert.rejects(svc.queueDelivery({id:'s',role:'STAFF'},entry,['telegram']),/OWNER_ONLY/);
 await assert.rejects(svc.queueDelivery(actor,other,['email','telegram']),/CONTACT_UNVERIFIED/);
 await assert.rejects(require('../payroll').createPayrollService({pool,encryptionKey:'a'.repeat(64),deliveryReady:{email:false,telegram:true}}).queueDelivery(actor,entry,['email']),/PROVIDER_NOT_READY/);
 const legacy='legacy-job';await pool.query("INSERT INTO payroll_delivery_outbox(id,entry_id,channel,status) VALUES($1,$2,'telegram','pending')",[legacy,other]);const idle=require('../payroll-delivery').createPayrollDeliveryWorker({pool,encryptionKey:'a'.repeat(64),adapter:{check(){},telegram(){throw Error('legacy sent');}}});assert.equal(await idle.runOnce(),null);
 const jobs=await svc.queueDelivery(actor,entry,['email','telegram']);assert.equal(jobs.length,2);
 assert.deepEqual((await svc.queueDelivery(actor,entry,['telegram'])).map(j=>j.id),[jobs.find(j=>j.channel==='telegram').id]);
 assert.equal((await pool.query('SELECT * FROM payroll_delivery_outbox')).rows.length,3);
 await pool.query("UPDATE payroll_delivery_outbox SET status='uncertain' WHERE channel='telegram'");
 assert.equal((await svc.queueDelivery(actor,entry,['telegram']))[0].status,'uncertain');
 const next=await svc.importCsv(actor,header+'2026-11,staff,1,0,0,0');await assert.rejects(svc.queueDelivery(actor,next.rows[0].entry_id,['email']),/NOT_PUBLISHED/);
 const details=await svc.preview(actor,draft.id);assert.equal(details.rows.find(r=>r.user_id==='s').delivery.email.verified,true);
 }finally{await db.close();}
});
