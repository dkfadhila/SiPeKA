'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {create,verdict}=require('../payroll-widya-review');
const prepared=()=>({digest:'abc123',rows:[{period:'2026-10',employee_id:'HO-001',full_name:'Ayu',email:'ayu@example.test',source_pdf:{data_base64:'private'}}],warnings:['PAYROLL_PDF_EMAIL_MISSING_REVIEW'],blockers:[]});
function durable(){
 const sessions=new Map(),files=new Map();
 return {sessions,files,async call(token,op,p){
  if(op==='CREATE'){sessions.set(p.id,{owner:token,status:'running',messages:[]});return {id:p.id};}
  if(op==='FILE_GET'){const file=files.get(p.id);if(!file||sessions.get(file.session_id).owner!==token)throw Error('WIDYA_NOT_FOUND');return file;}
  const session=sessions.get(p.session_id);if(!session||session.owner!==token)throw Error('WIDYA_NOT_FOUND');
  if(op==='UPLOAD'){files.set(p.id,{...p});return {id:p.id};}
  if(op==='SEND'){session.messages.push({role:'user',content:p.message,attachments:p.attachment_ids.map(id=>({id,name:files.get(id).name}))});return {id:p.id};}
  if(op==='READ')return {session:{status:session.status},messages:session.messages};
  throw Error('UNSUPPORTED');
 }};
}
test('Widya verdict fails closed on malformed, empty or unexpected answers',()=>{
 for(const output of ['not json','{}','{"decision":"SEND","text":"send"}','{"decision":"LANJUT","text":""}','null','[]'])assert.equal(verdict(output).decision,'TAHAN');
 assert.deepEqual(verdict('```json\n{"decision":"LANJUT","text":" sesuai "}\n```'),{decision:'LANJUT',text:'sesuai'});
});
test('durable review survives service restart, preserves warnings and owner isolation, and cannot reuse changed conversation',async()=>{
 const store=durable(),reviewer=create({sessions:store,key:'ab'.repeat(32)}),p=prepared();
 const start=await reviewer.start('owner-a',p,{format:'pdf',data_base64:Buffer.from('%PDF-test').toString('base64')});assert.equal(start.status,'running');assert.equal(start.review_token,null);assert.equal(start.engine,'widya-hermes');assert.equal(start.rows[0].source_pdf,undefined);
 const session=store.sessions.get(start.review_id);assert.match(session.messages[0].content,/JANGAN menerbitkan/);assert.equal(session.messages[0].attachments.length,2);
 const meta=JSON.parse(Buffer.from([...store.files.values()].find(f=>f.name==='payroll-review.json').data_base64,'base64')).metadata;assert.equal(meta.rows[0].source_pdf,undefined);assert.equal(meta.digest,p.digest);
 await assert.rejects(reviewer.status('owner-b',start.review_id),/WIDYA_NOT_FOUND/);
 assert.equal((await reviewer.status('owner-a',start.review_id)).status,'running');
 session.status='completed';session.messages.push({role:'assistant',content:'{"decision":"LANJUT","text":"Sesuai. Periksa email yang tidak tertulis di PDF."}'});
 const restarted=create({sessions:store,key:'ab'.repeat(32)}),result=await restarted.status('owner-a',start.review_id);assert.equal(result.ai.decision,'LANJUT');assert.equal(result.digest,p.digest);assert.deepEqual(result.warnings,p.warnings);assert.equal(result.review_token,null);
 session.messages.push({role:'user',content:'override'});await assert.rejects(restarted.status('owner-a',start.review_id),/PAYROLL_UPLOAD_REVIEW_REQUIRED/);
});
test('blockers, failures and stale reviews cannot become LANJUT',async()=>{
 for(const state of ['completed','failed','interrupted','uncertain','waiting_for_approval']){
  const store=durable(),reviewer=create({sessions:store,key:'ab'.repeat(32)}),p=prepared();p.blockers=['PAYROLL_EMAIL_MISSING'];const start=await reviewer.start('owner',p,{format:'csv',csv:'period,employee_id'});const session=store.sessions.get(start.review_id);session.status=state;session.messages.push({role:'assistant',content:'{"decision":"LANJUT","text":"Sesuai"}'});
  const result=await reviewer.status('owner',start.review_id);assert.equal(result.ai.decision,'TAHAN');assert.equal(result.review_token,null);assert.equal(result.status,state==='completed'?'completed':'failed');
 }
 const store=durable(),reviewer=create({sessions:store,key:'ab'.repeat(32)}),start=await reviewer.start('owner',prepared(),{format:'csv',csv:'fixture'});
 const entry=[...store.files.values()].find(f=>f.name==='payroll-review.json'),envelope=JSON.parse(Buffer.from(entry.data_base64,'base64'));envelope.metadata.created_at=Date.now()-31*60*1000;envelope.signature=require('node:crypto').createHmac('sha256',Buffer.from('ab'.repeat(32),'hex')).update(JSON.stringify(envelope.metadata)).digest('hex');entry.data_base64=Buffer.from(JSON.stringify(envelope)).toString('base64');await assert.rejects(reviewer.status('owner',start.review_id),/PAYROLL_UPLOAD_REVIEW_REQUIRED/);
 await assert.rejects(create().start('owner',prepared(),{format:'csv',csv:'fixture'}),/PAYROLL_WIDYA_UNAVAILABLE/);
});

test('forged metadata and replay into another session cannot authorize a draft',async()=>{
 const store=durable(),reviewer=create({sessions:store,key:'ab'.repeat(32)}),first=await reviewer.start('owner',prepared(),{format:'csv',csv:'fixture'});
 const file=[...store.files.values()].find(f=>f.name==='payroll-review.json'),original=file.data_base64,envelope=JSON.parse(Buffer.from(original,'base64'));
 envelope.metadata.digest='attacker-digest';file.data_base64=Buffer.from(JSON.stringify(envelope)).toString('base64');await assert.rejects(reviewer.status('owner',first.review_id),/PAYROLL_UPLOAD_REVIEW_REQUIRED/);
 file.data_base64=original;const other=await reviewer.start('owner',prepared(),{format:'csv',csv:'fixture'}),second=[...store.files.values()].find(f=>f.session_id===other.review_id&&f.name==='payroll-review.json');second.data_base64=original;await assert.rejects(reviewer.status('owner',other.review_id),/PAYROLL_UPLOAD_REVIEW_REQUIRED/);
});
