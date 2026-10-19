'use strict';
const crypto=require('node:crypto');
const {createCipher,parseCsv,validateCsv,fault}=require('./payroll');
const LEGACY_HEADER='period,employee_id,basic_salary,allowances,deductions,pph21';
const HEADER='period,employee_id,basic_salary,overtime,bonus,absence_deduction,late_deduction,violation_deduction,pph21';
const {renderSlipPdf}=require('./payroll-pdf');
function validate(csv,staff){
 if(typeof csv!=='string')throw fault('PAYROLL_CSV_HEADER');
 const table=parseCsv(csv),header=table.shift()?.join(',');
 if(![HEADER,LEGACY_HEADER].includes(header))throw fault('PAYROLL_CSV_HEADER');
 const detail=[];
 if(header===HEADER){
  const amount=v=>{if(!/^(0|[1-9]\d{0,15})$/.test(v)||!Number.isSafeInteger(Number(v)))throw fault('PAYROLL_INTEGER_IDR');return Number(v);};
  const normalized=table.map(r=>{
   if(r.length!==9)throw fault('PAYROLL_CSV_ROWS');
   const [period,employee_id,basic,overtime,bonus,absence,late,violation,pph21]=r;
   const d={overtime:amount(overtime),bonus:amount(bonus),absence_deduction:amount(absence),late_deduction:amount(late),violation_deduction:amount(violation)};
   detail.push(d);
   return [period,employee_id,basic,String(d.overtime+d.bonus),String(d.absence_deduction+d.late_deduction+d.violation_deduction),pph21].join(',');
  });
  csv=LEGACY_HEADER+'\r\n'+normalized.join('\r\n')+'\r\n';
 }
 const users=staff.map(s=>({...s,username:s.id,full_name:s.name,role:'STAFF',is_active:s.active}));
 return validateCsv(csv.replace(/^\uFEFF/,'').replace(LEGACY_HEADER,LEGACY_HEADER.replace('employee_id','user_id')),users).map((row,i)=>{
  const s=staff.find(s=>s.id===row.user_id);
  if(!s?.department)throw fault('PAYROLL_EMPLOYEE_DEPARTMENT_REQUIRED');
  return {...row,...detail[i],employee_id:s.id,department:s.department,email:s.email||null,branch_id:s.branch_id,branch_name:s.branch_name};
 });
}
function service({pool,env=process.env,transport}={}){
 const cipher=()=>createCipher(env.PAYROLL_ENCRYPTION_KEY);
 const call=async(token,op,p={},client=pool)=>(await client.query('SELECT employee_payroll_access($1,$2,$3::jsonb) result',[token,op,JSON.stringify(p)])).rows[0].result;
 const company=async token=>(await pool.query('SELECT company_profile_access($1,NULL) result',[token])).rows[0].result;
 const directory=async token=>(await pool.query('SELECT operational_directory($1,NULL) result',[token])).rows[0].result;
 async function entries(token){return (await call(token,'LIST')).map(e=>{
  const row=cipher().open(e.payload_cipher,e.id);
  if(row.employee_id!==e.staff_id||row.period!==e.period)throw fault('PAYROLL_PAYLOAD_IDENTITY',503);
  const {payload_cipher,...metadata}=e;return {...metadata,row};
 });}
 async function entry(token,id){const e=(await entries(token)).find(e=>e.id===id);if(!e)throw fault('PAYROLL_NOT_FOUND',404);return e;}
 const identity=row=>({company_name:row.company_name,branch_name:row.branch_name,department:row.department});
 return {
 async list(token){const rows=await entries(token);return {rows,readiness:{encryption:/^[a-fA-F0-9]{64}$/.test(env.PAYROLL_ENCRYPTION_KEY||''),email:require('./payroll-resend').resendReady(env)}};},
 async importCsv(token,csv){
  const profile=await company(token);if(!profile.name)throw fault('PAYROLL_COMPANY_REQUIRED');
  const staff=await directory(token),units=(await pool.query('SELECT id,name FROM business_units')).rows;
  const rows=validate(csv,staff.map(s=>({...s,branch_name:units.find(u=>u.id===s.branch_id)?.name})));
  const id=crypto.randomUUID(),preview_token=crypto.randomUUID();
  const prepared=rows.map(row=>{const entryId=crypto.randomUUID();return {id:entryId,staff_id:row.employee_id,period:row.period,payload_cipher:cipher().seal({...row,company_name:profile.name,entry_id:entryId},entryId)};});
  return call(token,'IMPORT',{id,period:rows[0].period,preview_token,rows:prepared});
 },
 async publish(token,body){if(body.confirmed!==true)throw fault('PAYROLL_CONFIRM_REQUIRED');const rows=await entries(token),batch=rows.filter(e=>e.batch_id===body.id);if(!batch.length)throw fault('PAYROLL_NOT_FOUND',404);return call(token,'PUBLISH',body);},
 async pdf(token,id){const e=await entry(token,id);return renderSlipPdf(e.row,{publishedAt:e.published_at,documentIdentity:identity(e.row)});},
 async send(token,id,body){
  if(body.confirmed!==true)throw fault('PAYROLL_CONFIRM_REQUIRED');
  const e=await entry(token,id);if(e.status!=='PUBLISHED')throw fault('PAYROLL_NOT_PUBLISHED',409);
  if(body.email!==e.row.email||!e.row.email)throw fault('PAYROLL_CONTACT_CHANGED',409);
  const mailer=transport||require('./payroll-resend').createResendTransport({env});
  const pdf=renderSlipPdf(e.row,{publishedAt:e.published_at,documentIdentity:identity(e.row)});
  const claim=await call(token,'CLAIM',{id,email:e.row.email,confirmed:true,job_id:crypto.randomUUID()});
  if(!claim.acquired)return claim;
  const client=await pool.connect();
  try{
   await client.query('BEGIN');
   await call(token,'FENCE',{id,email:e.row.email},client);
   const template=require('./payroll-email-template').payrollEmail(e.row,{publishedAt:e.published_at});
   const result=await mailer.sendMail({from:env.PAYROLL_EMAIL_FROM,to:e.row.email,subject:template.subject,text:template.text,html:template.html,messageId:`<${claim.id}@payroll.sipeka>`,attachments:[{filename:template.filename,content:pdf,contentType:'application/pdf'}]});
   if(!result?.accepted?.includes(e.row.email)||!result.messageId)throw fault('PAYROLL_EMAIL_ACCEPTANCE_UNKNOWN',503);
   const finished=await call(token,'FINISH',{id:claim.id,status:'sent',provider_id:result.messageId},client);
   await client.query('COMMIT');return finished;
  }catch{
   try{await client.query('ROLLBACK');}catch{}
   try{return await call(token,'FINISH',{id:claim.id,status:'uncertain'});}catch{throw fault('PAYROLL_DELIVERY_UNCERTAIN',503);}
  }finally{client.release();}
 }
 };
}
module.exports={HEADER,LEGACY_HEADER,validate,service};
