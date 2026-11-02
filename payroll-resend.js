'use strict';
const {fault}=require('./payroll');
const RESEND_FROM='Raditya Martanegara <raditya@widyafa.xyz>';
// Record actual credential provenance; never attest rotation that did not occur.
function resendReady(env){return env.PAYROLL_EMAIL_ENABLED==='1'&&['rotated-private','user-authorized-chat'].includes(env.PAYROLL_RESEND_CREDENTIAL_PROVENANCE)&&/^re_[A-Za-z0-9_-]{20,}$/.test(env.PAYROLL_RESEND_API_KEY||'')&&env.PAYROLL_EMAIL_FROM==='raditya@widyafa.xyz'&&/^[a-f0-9-]{36}$/.test(env.PAYROLL_RESEND_DOMAIN_ID||'');}
async function boundedJson(response){const reader=response.body?.getReader();if(!reader)throw fault('PAYROLL_EMAIL_RESPONSE',503);let size=0,chunks=[];try{for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>65536)throw fault('PAYROLL_EMAIL_RESPONSE',503);chunks.push(Buffer.from(value));}return JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw fault('PAYROLL_EMAIL_RESPONSE',503);}finally{await reader.cancel().catch(()=>{});}}
function createResendTransport({env=process.env,fetchImpl=globalThis.fetch}={}){
 if(!resendReady(env)||typeof fetchImpl!=='function')throw fault('PAYROLL_EMAIL_CONFIG',503);
 const headers={Authorization:'Bearer '+env.PAYROLL_RESEND_API_KEY,'Content-Type':'application/json'};
 return {async sendProof({id,email,token,expires_at}){
  if(!/^[a-f0-9-]{36}$/.test(id||'')||! /^[A-Za-z0-9_-]{43}$/.test(token||'')||require('./payroll-email-onboarding').canonicalEmail(email)!==email)throw fault('PAYROLL_EMAIL_CONTACT',503);
  const signal=AbortSignal.timeout(20000),d=await fetchImpl('https://api.resend.com/domains/'+env.PAYROLL_RESEND_DOMAIN_ID,{headers,signal}),domain=await boundedJson(d);
  if(!d.ok||domain.id!==env.PAYROLL_RESEND_DOMAIN_ID||domain.name!=='widyafa.xyz'||domain.status!=='verified')throw fault('PAYROLL_EMAIL_DOMAIN_UNVERIFIED',503);
  const r=await fetchImpl('https://api.resend.com/emails',{method:'POST',headers:{...headers,'Idempotency-Key':id},signal,body:JSON.stringify({from:RESEND_FROM,to:[email],subject:'SiPeKA — verifikasi email pribadi',text:'Masuk ke akun Staff SiPeKA Anda, buka Slip Gaji > Kontak pribadi, lalu masukkan kode sekali pakai ini:\n\n'+token+'\n\nBerlaku sampai '+expires_at+'. Jangan bagikan kode. Bukti email belum mengaktifkan pengiriman; Owner harus memeriksa identitas terlebih dahulu. Abaikan bila Anda tidak meminta verifikasi.'})});const value=await boundedJson(r);if(!r.ok||typeof value.id!=='string'||!/^[a-f0-9-]{36}$/.test(value.id))throw fault('PAYROLL_EMAIL_ACCEPTANCE_UNKNOWN',503);return {accepted:true};
 },async sendMail(mail){
  if(mail.from!=='raditya@widyafa.xyz'||typeof mail.to!=='string'||! /^[^\s@<>;,]+@[^\s@<>;,]+\.[^\s@<>;,]+$/.test(mail.to)||![1,2].includes(mail.attachments?.length))throw fault('PAYROLL_EMAIL_CONTACT',503);
  const attachment=mail.attachments[0];if(!Buffer.isBuffer(attachment.content)||attachment.content.length>262144||attachment.content.subarray(0,5).toString()!=='%PDF-')throw fault('PAYROLL_PDF_LIMIT',503);
  const visual=require('./payroll-email-visual'),inline=mail.attachments[1],hasReference=typeof mail.html==='string'&&mail.html.includes('cid:'+visual.CID);
  if(inline&&(!visual.validHeaderAttachment(inline)||!hasReference)||hasReference&&!inline)throw fault('PAYROLL_EMAIL_VISUAL_INVALID',503);
  const attachments=[{filename:attachment.filename,content:attachment.content.toString('base64'),content_type:'application/pdf'},...(inline?[{filename:inline.filename,content:inline.content.toString('base64'),content_type:'image/png',content_id:visual.CID}]:[])];
  const signal=AbortSignal.timeout(20000);
  // Recheck provider domain status on every send; no DNS mutation or cached attestation.
  const domainResponse=await fetchImpl('https://api.resend.com/domains/'+env.PAYROLL_RESEND_DOMAIN_ID,{headers,signal});const domain=await boundedJson(domainResponse);
  if(!domainResponse.ok||domain.name!=='widyafa.xyz'||domain.status!=='verified'||domain.id!==env.PAYROLL_RESEND_DOMAIN_ID)throw fault('PAYROLL_EMAIL_DOMAIN_UNVERIFIED',503);
  const key=mail.messageId?.match(/^<([a-f0-9-]{36})@payroll\.sipeka>$/)?.[1];if(!key)throw fault('PAYROLL_EMAIL_IDEMPOTENCY',503);
  const response=await fetchImpl('https://api.resend.com/emails',{method:'POST',headers:{...headers,'Idempotency-Key':key},signal,body:JSON.stringify({from:RESEND_FROM,to:[mail.to],subject:mail.subject,text:mail.text,html:mail.html,attachments})});const result=await boundedJson(response);
  if(!response.ok||typeof result.id!=='string'||!/^[a-f0-9-]{36}$/.test(result.id))throw fault('PAYROLL_EMAIL_ACCEPTANCE_UNKNOWN',503);
  return {accepted:[mail.to],messageId:result.id};
 }};
}
module.exports={resendReady,createResendTransport};
