'use strict';
const crypto=require('node:crypto');
const {createCipher,transaction,fault}=require('./payroll');
const {renderSlipPdf,payrollCaption}=require('./payroll-pdf');
function createNotificationAdapter({emailTransport,emailFrom,telegramToken,fetchImpl=globalThis.fetch,companyName='SiPeKA'}={}){
 function check(channel,to){
  if(!['email','telegram'].includes(channel))throw fault('PAYROLL_CHANNEL',503);
  if(channel==='email'){if(typeof to!=='string'||to.length>254||! /^[^\s@<>;,]+@[^\s@<>;,]+\.[^\s@<>;,]+$/.test(to))throw fault('PAYROLL_EMAIL_CONTACT',503);if(!emailTransport||typeof emailTransport.sendMail!=='function'||typeof emailFrom!=='string'||! /^[^\s@<>;,]+@[^\s@<>;,]+\.[^\s@<>;,]+$/.test(emailFrom))throw fault('PAYROLL_EMAIL_CONFIG',503);}
  else {if(!/^[1-9]\d{0,15}$/.test(String(to)))throw fault('PAYROLL_TELEGRAM_PRIVATE_CHAT',503);if(!telegramToken||!fetchImpl)throw fault('PAYROLL_TELEGRAM_CONFIG',503);}
 }
 return {check,
 async email({to,row,idempotencyKey,publishedAt,simulation=false}){check('email',to);const template=require('./payroll-email-template').payrollEmail(row,{publishedAt,simulation});const result=await emailTransport.sendMail({from:emailFrom,to,subject:template.subject,text:template.text,html:template.html,messageId:`<${idempotencyKey}@payroll.sipeka>`,attachments:[{filename:template.filename,content:renderSlipPdf(row,{companyName,publishedAt,simulation}),contentType:'application/pdf'}]});if(!result||!Array.isArray(result.accepted)||!result.accepted.includes(to))throw fault('PAYROLL_EMAIL_ACCEPTANCE_UNKNOWN',503);return {providerId:result.messageId||idempotencyKey};},
 async telegram({to,row,publishedAt}){check('telegram',to);const pdf=renderSlipPdf(row,{publishedAt});if(pdf.length>256*1024)throw fault('PAYROLL_PDF_LIMIT',503);const form=new FormData();form.set('chat_id',String(to));form.set('caption',payrollCaption(row,publishedAt));form.set('protect_content','true');form.set('document',new Blob([pdf],{type:'application/pdf'}),`SiPeKA-slip-${/^[0-9]{4}-[0-9]{2}$/.test(row.period)?row.period:'periode'}.pdf`);const response=await fetchImpl(`https://api.telegram.org/bot${telegramToken}/sendDocument`,{method:'POST',body:form,signal:AbortSignal.timeout(20000)});const body=await response.json();if(!response.ok||!body.ok||String(body.result?.chat?.id)!==String(to)||body.result?.chat?.type!=='private'||!Number.isSafeInteger(body.result?.message_id)||body.result.message_id<=0)throw fault('PAYROLL_TELEGRAM_ACCEPTANCE_UNKNOWN',503);return {providerId:String(body.result.message_id)};}
 };
}
function createPayrollDeliveryWorker({pool,encryptionKey=process.env.PAYROLL_ENCRYPTION_KEY,adapter,emailEnabled=false}={}){
 const cipher=createCipher(encryptionKey);if(!pool?.connect||!adapter?.check)throw fault('PAYROLL_WORKER_CONFIG',503);
 async function mark(id,status,error=null,provider=null){await pool.query('UPDATE payroll_delivery_outbox SET status=$2,error_code=$3,provider_id=$4,updated_at=clock_timestamp() WHERE id=$1',[id,status,error,provider]);}
 return {
 async runOnce(){
  const job=await transaction(pool,async c=>{
   const channelFilter=emailEnabled?"o.channel IN ('telegram','email')":"o.channel='telegram'";
   const r=(await c.query("SELECT o.* FROM payroll_delivery_outbox o JOIN payroll_entries e ON e.id=o.entry_id JOIN payroll_batches b ON b.id=e.batch_id WHERE o.status='pending' AND "+channelFilter+" AND b.status='PUBLISHED' ORDER BY o.updated_at,o.id FOR UPDATE OF o SKIP LOCKED LIMIT 1")).rows[0];if(!r)return null;
   await c.query("UPDATE payroll_delivery_outbox SET status='processing',attempts=attempts+1,updated_at=clock_timestamp() WHERE id=$1",[r.id]);
   const e=(await c.query('SELECT e.*,b.published_at,u.email,u.telegram_user_id,u.email_verified,u.telegram_verified,u.role FROM payroll_entries e JOIN app_users u ON u.id=e.user_id JOIN payroll_batches b ON b.id=e.batch_id WHERE e.id=$1',[r.entry_id])).rows[0];
   await c.query("INSERT INTO payroll_access_audit(id,action,batch_id) VALUES($1,'DELIVERY_READ',$2)",[crypto.randomUUID(),e.batch_id]);return {...r,entry:e};
  });if(!job)return null;
  let row,to;try{if(job.entry.role!=='STAFF')throw fault('PAYROLL_STAFF_CONTACT');if(!(job.channel==='email'?job.entry.email_verified:job.entry.telegram_verified))throw fault('PAYROLL_CONTACT_UNVERIFIED',503);to=job.channel==='email'?job.entry.email:job.entry.telegram_user_id;adapter.check(job.channel,to);const column=job.channel==='email'?'email':'telegram_user_id';const contacts=(await pool.query('SELECT id,role FROM app_users WHERE '+column+'=$1',[to])).rows;if(contacts.length!==1||contacts[0].id!==job.entry.user_id||contacts[0].role!=='STAFF')throw fault('PAYROLL_CONTACT_AMBIGUOUS',503);row=cipher.open(job.entry.payload_cipher,job.entry.id);}catch(e){const code=/^PAYROLL_[A-Z_]+$/.test(e.code||'')?e.code:'PAYROLL_CONFIGURATION_BLOCKED';await pool.query("UPDATE payroll_delivery_outbox SET status='blocked',error_code=$2,updated_at=clock_timestamp() WHERE id=$1 AND status='processing' AND attempts=$3",[job.id,code,job.attempts+1]);return {id:job.id,status:'blocked',error_code:code};}
  const claimed=await pool.query("UPDATE payroll_delivery_outbox SET status='sending',updated_at=clock_timestamp() WHERE id=$1 AND status='processing' AND attempts=$2 RETURNING id",[job.id,job.attempts+1]);
  if(!claimed.rows.length)return {id:job.id,status:'uncertain'};
  let result;try{result=await transaction(pool,async c=>{
   // Fence recipient contact/role changes until provider access completes.
   // FOR SHARE conflicts with UPDATE, including non-key contact verification,
   // without table-wide UPDATE grants. Unique contact index fences other users.
   const column=job.channel==='email'?'email':'telegram_user_id',verified=job.channel==='email'?'email_verified':'telegram_verified';
   const contacts=(await c.query('SELECT id,role,'+verified+' FROM app_users WHERE '+column+'=$1 FOR SHARE',[to])).rows;
   if(contacts.length!==1||contacts[0].id!==job.entry.user_id||contacts[0].role!=='STAFF'||contacts[0][verified]!==true)throw fault('PAYROLL_CONTACT_CHANGED');
   if(row.user_id!==job.entry.user_id||row.period!==job.entry.period)throw fault('PAYROLL_PAYLOAD_IDENTITY');
   const receipt=await adapter[job.channel]({to,row,publishedAt:job.entry.published_at,userId:job.entry.user_id,idempotencyKey:job.id});if(!receipt?.providerId)throw fault('PAYROLL_ACCEPTANCE_UNKNOWN');return receipt;
  });}
  catch{await mark(job.id,'uncertain','PAYROLL_PROVIDER_ACCEPTANCE_UNKNOWN');return {id:job.id,status:'uncertain'};}
  // Failure here deliberately leaves sending. Never automatically resubmit a potentially accepted message.
  await mark(job.id,'sent',null,String(result.providerId));return {id:job.id,status:'sent'};
 },
 async recoverStale(){const r=await pool.query("UPDATE payroll_delivery_outbox SET status=CASE WHEN status='sending' THEN 'uncertain' ELSE 'pending' END,error_code=CASE WHEN status='sending' THEN 'PAYROLL_INTERRUPTED_ACCEPTANCE_UNKNOWN' ELSE NULL END,updated_at=clock_timestamp() WHERE status IN ('processing','sending') AND updated_at<clock_timestamp()-interval '10 minutes' RETURNING id,status");return r.rows;}
 };
}
module.exports={renderSlipPdf,createNotificationAdapter,createPayrollDeliveryWorker};
