'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const crypto=require('node:crypto');
// PGlite is PostgreSQL compiled to WASM; optional test-only install outside repo.
const runtime=process.env.PAYROLL_TEST_PGLITE;
test('PostgreSQL payroll migration, encrypted preview, idempotent publish, private delivery, blocked retry, uncertain no replay',{skip:!runtime},async()=>{
 const {PGlite}=require(runtime);const db=new PGlite();
 let queue=Promise.resolve();const pool={query:(sql,args)=>db.query(sql,args),async connect(){let unlock;const prior=queue;queue=new Promise(r=>unlock=r);await prior;return {query:(sql,args)=>db.query(sql,args),release:unlock};}};
 try{
  await db.exec(fs.readFileSync(require.resolve('../migrations/001_initial.sql'),'utf8'));
  await db.exec(fs.readFileSync(require.resolve('../migrations/004_payroll.sql'),'utf8'));
  await db.query("INSERT INTO app_users(id,username,password_hash,full_name,role,email,telegram_user_id) VALUES('owner','owner','fixture','Owner','OWNER',NULL,NULL),('s','staff','fixture','Staff','STAFF','staff@example.com','123')");
  const key=crypto.randomBytes(32).toString('hex');const {createPayrollService,templateCsv}=require('../payroll');const {createNotificationAdapter,createPayrollDeliveryWorker}=require('../payroll-delivery');const svc=createPayrollService({pool,encryptionKey:key}),actor={id:'owner',role:'OWNER'};
  assert.equal(await svc.template(actor),templateCsv());
  const preview=await svc.importCsv(actor,templateCsv()+'2026-09,staff,2500000,100000,20000,10000');assert.equal(preview.rows[0].net_salary,2570000);
  const stored=(await pool.query('SELECT * FROM payroll_entries')).rows[0];assert.ok(!JSON.stringify(stored).includes('2570000'));assert.ok(!JSON.stringify(stored).includes('2500000'));
  await assert.rejects(svc.importCsv(actor,templateCsv()+'2026-09,staff,1,0,0,0'),/DUPLICATE/);assert.equal((await pool.query('SELECT * FROM payroll_batches')).rows.length,1);
  await assert.rejects(createPayrollService({pool,encryptionKey:''}).publish(actor,preview.id,preview.preview_token),/KEY_REQUIRED/);
  await assert.rejects(createPayrollService({pool,encryptionKey:crypto.randomBytes(32).toString('hex')}).publish(actor,preview.id,preview.preview_token),/DECRYPT_FAILED/);
  await assert.rejects(svc.publish(actor,preview.id,'wrong'),/PREVIEW_TOKEN/);assert.equal((await pool.query('SELECT * FROM payroll_delivery_outbox')).rows.length,0);
  assert.equal((await svc.preview(actor,preview.id)).rows[0].net_salary,2570000);
  const missing=createPayrollDeliveryWorker({pool,encryptionKey:key,adapter:createNotificationAdapter({})});assert.equal(await missing.runOnce(),null);
  await Promise.all([svc.publish(actor,preview.id,preview.preview_token),svc.publish(actor,preview.id,preview.preview_token)]);assert.equal((await pool.query('SELECT * FROM payroll_delivery_outbox')).rows.length,1);
  assert.equal((await missing.runOnce()).status,'blocked');assert.equal(await missing.runOnce(),null);
  const statuses=await svc.deliveryStatus(actor,preview.id);assert.equal(statuses.length,1);assert.ok(statuses.every(r=>r.status==='blocked'));
  await Promise.all(statuses.map(r=>svc.retryDelivery(actor,r.id)));
  await pool.query("UPDATE app_users SET email_verified=true,telegram_verified=true WHERE id='s'");
  const sends=[];const adapter=createNotificationAdapter({emailFrom:'payroll@example.com',emailTransport:{async sendMail(message){sends.push({channel:'email',message});return {accepted:[message.to],messageId:'email-receipt'};}},telegramToken:'fixture',fetchImpl:async(url,opt)=>{const payload=JSON.parse(opt.body);sends.push({channel:'telegram',payload});return {ok:true,json:async()=>({ok:true,result:{message_id:1234,chat:{id:123,type:'private'}}})};}});
  const worker=createPayrollDeliveryWorker({pool,encryptionKey:key,adapter});assert.equal((await worker.runOnce()).status,'sent');assert.equal(await worker.runOnce(),null);assert.equal(sends.length,1);
  assert.equal(sends.filter(s=>s.channel==='email').length,0);
  const tg=sends.find(s=>s.channel==='telegram').payload;assert.equal(tg.chat_id,'123');assert.ok(!tg.text.includes('2500000'));assert.ok(!tg.text.includes('Potongan'));
  await svc.publish(actor,preview.id,preview.preview_token);assert.equal(await worker.runOnce(),null);
  for(const r of await svc.deliveryStatus(actor,preview.id))await assert.rejects(svc.retryDelivery(actor,r.id),/RETRY_UNSAFE/);
  await assert.rejects(pool.query("UPDATE payroll_entries SET payload_cipher='v1.changed'"),/APPEND_ONLY/);await assert.rejects(pool.query('DELETE FROM payroll_access_audit'),/APPEND_ONLY/);await assert.rejects(pool.query("UPDATE payroll_batches SET status='DRAFT'"),/IMMUTABLE/);
  const second=await svc.importCsv(actor,templateCsv()+'2026-10,staff,1000000,0,0,0');await svc.publish(actor,second.id,second.preview_token);
  const broken=createPayrollDeliveryWorker({pool,encryptionKey:key,adapter:{check(){},email:async()=>{throw Error('SECRET PROVIDER BODY');},telegram:async()=>{throw Error('SECRET PROVIDER BODY');}}});
  const ambiguous=await broken.runOnce();assert.equal(ambiguous.status,'uncertain');await assert.rejects(svc.retryDelivery(actor,ambiguous.id),/RETRY_UNSAFE/);assert.ok(!(await pool.query('SELECT error_code FROM payroll_delivery_outbox WHERE id=$1',[ambiguous.id])).rows[0].error_code.includes('SECRET'));
  await pool.query("UPDATE payroll_delivery_outbox SET status='sending',updated_at=clock_timestamp()-interval '20 minutes' WHERE status='pending'");assert.ok((await broken.recoverStale()).every(r=>r.status==='uncertain'));assert.equal(await broken.runOnce(),null);
  const third=await svc.importCsv(actor,templateCsv()+'2026-11,staff,5,0,0,0');await svc.publish(actor,third.id,third.preview_token);
  await pool.query("INSERT INTO app_users(id,username,password_hash,full_name,role,email,telegram_user_id,email_verified,telegram_verified) VALUES('other','other','fixture','Other','STAFF','staff@example.com','123',true,true)");
  const before=sends.length;assert.equal((await worker.runOnce()).status,'blocked');assert.equal(await worker.runOnce(),null);assert.equal(sends.length,before);
  const actions=(await pool.query('SELECT action FROM payroll_access_audit')).rows.map(r=>r.action);for(const action of ['TEMPLATE','IMPORT_PREVIEW','PREVIEW','PUBLISH','DELIVERY_STATUS','RETRY','DELIVERY_READ'])assert.ok(actions.includes(action));
 }finally{await db.close();}
});
