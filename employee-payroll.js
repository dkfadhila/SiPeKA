'use strict';
const crypto=require('node:crypto');
const {createCipher,parseCsv,validateCsv,fault}=require('./payroll');
const LEGACY_HEADER='period,employee_id,basic_salary,allowances,deductions,pph21';
const HEADER='period,employee_id,basic_salary,overtime,bonus,absence_deduction,late_deduction,violation_deduction,pph21';
const GENERAL_HEADER=HEADER+',payment_method';
const LAUNDRY_HEADER='period,employee_id,basic_salary,meal_allowance,transport_allowance,ironing_regular,ironing_express,overtime,bonus,deductions,pph21,employment_status,payment_method';
const FULL_GENERAL_HEADER='period,employee_id,basic_salary,operational_allowance,health_allowance,overtime,bonus,absence_deduction,late_deduction,violation_deduction,pph21,job_title,employment_status,payment_method';
const FULL_LAUNDRY_HEADER='period,employee_id,basic_salary,operational_allowance,health_allowance,meal_allowance,transport_allowance,ironing_regular,ironing_express,overtime,bonus,absence_deduction,late_deduction,violation_deduction,other_deductions,pph21,job_title,employment_status,payment_method';
const {renderSlipPdf}=require('./payroll-pdf');
const documentFormat=require('./document-format');
// Codes that prove the provider was never asked. Anything else stays ambiguous.
const RETRYABLE_FAIL_CODES=new Set(['PAYROLL_CONTACT_CHANGED','PAYROLL_TEMPLATE_INVALID','PAYROLL_PAYLOAD_IDENTITY','PAYROLL_PROVIDER_REJECTED','PAYROLL_DELIVERY_LOCAL_FAILURE']);
function preProviderCode(err){
 const raw=[err?.code,err?.message].find(v=>typeof v==='string'&&/^PAYROLL_[A-Z_]+$/.test(v))||'';
 return RETRYABLE_FAIL_CODES.has(raw)?raw:'PAYROLL_DELIVERY_LOCAL_FAILURE';
}
function validate(csv,staff){
 if(typeof csv!=='string')throw fault('PAYROLL_CSV_HEADER');
 const friendly=require('./payroll-csv'),inputTable=friendly.read(csv).rows,inputHeader=inputTable[0]||[];
 let sourceNames=null;
 if(inputHeader.includes('full_name')){
  if(inputHeader.filter(key=>key==='full_name').length!==1)throw fault('PAYROLL_CSV_HEADER');
  const index=inputHeader.indexOf('full_name');sourceNames=inputTable.slice(1).map(row=>row[index]);
  inputTable.forEach(row=>row.splice(index,1));
 }
 const employeeColumn=inputHeader.indexOf('employee_id');
 for(const row of inputTable.slice(1)){
  const value=row[employeeColumn];
  if(/^\d{1,2}$/.test(value||'')&&!staff.some(s=>s.id===value||s.employee_code===value)){
   const padded=value.padStart(3,'0');if(staff.filter(s=>s.employee_code===padded).length===1)row[employeeColumn]=padded;
  }
 }
 csv=friendly.encode(inputTable);
 let sourceEmails=null;
 if(inputHeader.at(-1)==='email'){
  sourceEmails=inputTable.slice(1).map(r=>r.at(-1));
  const quote=v=>'"'+String(v).replace(/"/g,'""')+'"';
  csv=inputTable.map(r=>r.slice(0,-1).map(quote).join(',')).join('\r\n');
 }
 const table=parseCsv(csv),header=table.shift()?.join(',');
 if(![HEADER,GENERAL_HEADER,LEGACY_HEADER,LAUNDRY_HEADER,FULL_GENERAL_HEADER,FULL_LAUNDRY_HEADER].includes(header))throw fault('PAYROLL_CSV_HEADER');
 const detail=[];
 if(header===FULL_GENERAL_HEADER||header===FULL_LAUNDRY_HEADER){
  const keys=header.split(','),laundry=header===FULL_LAUNDRY_HEADER;
  const normalized=table.map(r=>{
   if(r.length!==keys.length)throw fault('PAYROLL_CSV_ROWS');
   if(r.some(v=>/[\x00-\x1f\x7f]/.test(v)||/^[=+@-]/.test(v)))throw fault('PAYROLL_CSV_CELL');
   const input=Object.fromEntries(keys.map((key,i)=>[key,r[i]]));
   for(const key of keys.slice(2,-3)){const value=input[key];if(!/^(0|[1-9]\d{0,15})$/.test(value)||!Number.isSafeInteger(Number(value)))throw fault('PAYROLL_INTEGER_IDR');input[key]=Number(value);}
   if(input.job_title.length>64||input.employment_status.length>48||input.payment_method.length>64)throw fault('PAYROLL_CSV_CELL');
   const allowances=['operational_allowance','health_allowance','overtime','bonus',...(laundry?['meal_allowance','transport_allowance','ironing_regular','ironing_express']:[])].reduce((n,key)=>n+input[key],0);
   const deductions=['absence_deduction','late_deduction','violation_deduction',...(laundry?['other_deductions']:[])].reduce((n,key)=>n+input[key],0);
   if(!Number.isSafeInteger(allowances)||!Number.isSafeInteger(deductions))throw fault('PAYROLL_NET_INVALID');
   const {period,employee_id,basic_salary,pph21,...components}=input;
   detail.push({...components,payroll_type:laundry?'LAUNDRY':'GENERAL'});
   return [period,employee_id,basic_salary,allowances,deductions,pph21].join(',');
  });csv=LEGACY_HEADER+'\r\n'+normalized.join('\r\n')+'\r\n';
 }
 if(header===LAUNDRY_HEADER){
  const normalized=table.map(r=>{
   if(r.length!==13)throw fault('PAYROLL_CSV_ROWS');
   if(r.some(v=>/[\x00-\x1f\x7f]/.test(v)||/^[=+@-]/.test(v)))throw fault('PAYROLL_CSV_CELL');
   const [period,employee_id,...rest]=r,values=rest.slice(0,9).map(v=>{if(!/^(0|[1-9]\d{0,15})$/.test(v)||!Number.isSafeInteger(Number(v)))throw fault('PAYROLL_INTEGER_IDR');return Number(v);});
   const [basic_salary,meal_allowance,transport_allowance,ironing_regular,ironing_express,overtime,bonus,deductions,pph21]=values;
   const allowances=meal_allowance+transport_allowance+ironing_regular+ironing_express+overtime+bonus;
   if(!Number.isSafeInteger(allowances))throw fault('PAYROLL_NET_INVALID');
   const [employment_status,payment_method]=rest.slice(9);if(employment_status.length>48||payment_method.length>64)throw fault('PAYROLL_CSV_CELL');
   detail.push({payroll_type:'LAUNDRY',meal_allowance,transport_allowance,ironing_regular,ironing_express,overtime,bonus,employment_status,payment_method});
   return [period,employee_id,basic_salary,allowances,deductions,pph21].join(',');
  });csv=LEGACY_HEADER+'\r\n'+normalized.join('\r\n')+'\r\n';
 }
 if(header===HEADER||header===GENERAL_HEADER){
  const amount=v=>{if(!/^(0|[1-9]\d{0,15})$/.test(v)||!Number.isSafeInteger(Number(v)))throw fault('PAYROLL_INTEGER_IDR');return Number(v);};
  const normalized=table.map(r=>{
   if(r.length!==(header===GENERAL_HEADER?10:9))throw fault('PAYROLL_CSV_ROWS');
   if(header===GENERAL_HEADER&&(r[9].length>64||/[\x00-\x1f\x7f]/.test(r[9])||/^[=+@-]/.test(r[9])))throw fault('PAYROLL_CSV_CELL');
   const [period,employee_id,basic,overtime,bonus,absence,late,violation,pph21]=r;
   const d={overtime:amount(overtime),bonus:amount(bonus),absence_deduction:amount(absence),late_deduction:amount(late),violation_deduction:amount(violation)};
   detail.push({...d,...(header===GENERAL_HEADER?{payment_method:r[9]}:{})});
   return [period,employee_id,basic,String(d.overtime+d.bonus),String(d.absence_deduction+d.late_deduction+d.violation_deduction),pph21].join(',');
  });
  csv=LEGACY_HEADER+'\r\n'+normalized.join('\r\n')+'\r\n';
 }
 const users=staff.map(s=>({...s,username:s.employee_code||s.id,full_name:s.name,role:'STAFF',is_active:s.active}));
 return validateCsv(csv.replace(/^\uFEFF/,'').replace(LEGACY_HEADER,LEGACY_HEADER.replace('employee_id','user_id')),users).map((row,i)=>{
  const s=staff.find(s=>s.id===row.user_id);
  if(!s?.department)throw fault('PAYROLL_EMPLOYEE_DEPARTMENT_REQUIRED');
  if(sourceNames){const name=sourceNames[i];if(typeof name!=='string'||/[\x00-\x1f\x7f]/.test(name)||/^[=+@-]/.test(name))throw fault('PAYROLL_CSV_CELL');const clean=v=>String(v).normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase('id-ID');if(name.trim()&&clean(name)!==clean(s.name))throw fault('PAYROLL_CSV_IDENTITY_MISMATCH');}
  const canonical=require('./payroll-upload').canonicalEmail,email=canonical(s.email);
  if(sourceEmails){const source=canonical(sourceEmails[i]);if(sourceEmails[i]&&!source)throw fault('PAYROLL_EMAIL_INVALID');if(source&&source!==email)throw fault('PAYROLL_PDF_EMAIL_MISMATCH');}
  return {...row,...detail[i],employee_id:s.id,employee_code:s.employee_code,department:s.department,email,staff_revision:s.revision??null,branch_id:s.branch_id,branch_name:s.branch_name,...(sourceEmails?{source_email:canonical(sourceEmails[i])}:{})};
 });
}
function service({pool,env=process.env,transport,widyaReviews}={}){
 const cipher=()=>createCipher(env.PAYROLL_ENCRYPTION_KEY);
 const call=async(token,op,p={},client=pool)=>(await client.query('SELECT employee_payroll_access($1,$2,$3::jsonb) result',[token,op,JSON.stringify(p)])).rows[0].result;
 // Only failures that prove the provider was never asked may leave 'sending' as 'failed'.
 const settleFailed=async(token,claimId,code)=>{try{return (await pool.query('SELECT employee_payroll_fail_claim($1,$2,$3) result',[token,claimId,code])).rows[0].result;}
  catch(err){if(/PAYROLL_DELIVERY_STATUS/.test(err?.message||''))throw fault('PAYROLL_DELIVERY_STATUS',409);throw fault('PAYROLL_DELIVERY_LOCAL_FAILURE',503);}};
 // Best-effort Owner re-arm of a retryable row; CLAIM still decides whether a send happens.
 const rearm=async(token,entryId)=>{try{return (await pool.query('SELECT employee_payroll_rearm($1,$2) result',[token,entryId])).rows[0].result;}catch{return null;}};
 const company=async token=>(await pool.query('SELECT company_profile_access($1,NULL) result',[token])).rows[0].result;
 const directory=async(token,client=pool)=>(await client.query('SELECT operational_directory($1,NULL) result',[token])).rows[0].result;
 async function entries(token){return (await call(token,'LIST')).map(e=>{
  const row=cipher().open(e.payload_cipher,e.id);
  if(row.employee_id!==e.staff_id||row.period!==e.period)throw fault('PAYROLL_PAYLOAD_IDENTITY',503);
  const {payload_cipher,...metadata}=e;return {...metadata,row:{...row,document_code:documentFormat.slipCode(row)}};
 });}
 function publicPayrollRow(row,staff){const employee=staff.find(s=>s.id===row.employee_id),employee_code=row.employee_code||employee?.employee_code;if(!employee_code)return row;const code=row.document_code||documentFormat.slipCode(row),suffix=String(code||'').split('/').at(-1),opaque=/^(?:[a-f0-9]{32}|[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12})$/i.test(suffix);return {...row,employee_code,...(opaque?{document_code:documentFormat.slipCode({...row,employee_code,department_code:/^[A-Z]{2,4}$/.test(row.department_code||'')?row.department_code:documentFormat.departmentCode(row.department),document_code:null})}:{})};}
 async function entry(token,id){const e=(await entries(token)).find(e=>e.id===id);if(!e)throw fault('PAYROLL_NOT_FOUND',404);e.row=publicPayrollRow(e.row,await directory(token));return e;}
 const identity=row=>({company_name:row.company_name,company_address:row.company_address,branch_name:row.branch_name,department:row.department});
 const upload=require('./payroll-upload');
 function currentRecipient(row,staff){const s=staff.find(s=>s.id===row.employee_id);return !!s&&s.active&&upload.canonicalEmail(s.email)===row.email&&!!row.email&&s.name===row.full_name&&s.department===row.department&&s.branch_id===row.branch_id&&(row.staff_revision==null||row.staff_revision===s.revision)&&staff.filter(s=>upload.canonicalEmail(s.email)===row.email).length===1;}
 async function preparedUpload(token,body){
  if(!body||!['csv','xlsx','pdf'].includes(body.format))throw fault('PAYROLL_UPLOAD_FORMAT');
  const profile=await company(token);if(!profile.name)throw fault('PAYROLL_COMPANY_REQUIRED');
  const units=(await pool.query('SELECT id,name,code FROM business_units')).rows;
  const staff=(await directory(token)).map(s=>({...s,branch_name:units.find(u=>u.id===s.branch_id)?.name}));
  let rows,warnings=[],blockers=[];
  if(body.format==='csv'){rows=validate(body.csv,staff);if(rows.some(r=>!r.email))blockers.push('PAYROLL_EMAIL_MISSING');}
  else if(body.format==='xlsx'){const workbook=require('./payroll-xlsx').read(body.data_base64);rows=validate(workbook.csv,staff);if(rows.some(r=>!r.email))blockers.push('PAYROLL_EMAIL_MISSING');for(let i=0;i<rows.length;i++){const source=workbook.metadata[i]||{},row=rows[i];if(source.department&&upload.normalize(source.department)!==upload.normalize(row.department)||source.branch_name&&upload.normalize(source.branch_name)!==upload.normalize(row.branch_name))blockers.push('PAYROLL_DIRECTORY_MISMATCH');if(source.company_name&&upload.normalize(source.company_name)!==upload.normalize(profile.name))blockers.push('PAYROLL_COMPANY_MISMATCH');}}
  else{
   const bytes=upload.pdfBytes(body.data_base64),text=await upload.extractPdf(body.data_base64),match=upload.matchPdf(text,staff,body.period);
   warnings=match.warnings;blockers=match.blockers;const s=match.employee;
   rows=[{period:match.period,employee_id:s.id,employee_code:s.employee_code,full_name:s.name,department:s.department,branch_id:s.branch_id,branch_name:s.branch_name,email:match.email,staff_revision:s.revision??null,upload_kind:'PDF',source_email:match.source_email,source_pdf:{data_base64:bytes.toString('base64'),sha256:crypto.createHash('sha256').update(bytes).digest('hex')},net_salary:null}];
  }
  const existing=await entries(token);if(rows.some(row=>existing.some(e=>e.row.employee_id===row.employee_id&&e.period===row.period)))blockers.push('PAYROLL_DUPLICATE_PERIOD_STAFF');
  const digest=upload.fingerprint({format:body.format,rows,company:profile,company_address:body.company_address||''});
  return {profile,units,rows,warnings,blockers,digest};
 }
 async function saveRows(token,rows,profile,units,company_address){
  if(rows.some(row=>!row.email))throw fault('PAYROLL_EMAIL_MISSING');
  if(company_address!==undefined&&(typeof company_address!=='string'||company_address.length>180||/[\x00-\x1f\x7f]/.test(company_address)))throw fault('PAYROLL_COMPANY_ADDRESS_INVALID');
  const id=crypto.randomUUID(),preview_token=crypto.randomUUID();
  const prepared=rows.map(row=>{const entryId=crypto.randomUUID();const snapshot={...row,unit_code:documentFormat.unitCode(units.find(u=>u.id===row.branch_id)||row),department_code:documentFormat.departmentCode(row.department),company_name:profile.name,...(company_address!==undefined?{company_address:company_address.trim()}:{}),entry_id:entryId};snapshot.document_code=documentFormat.slipCode(snapshot);return {id:entryId,staff_id:row.employee_id,period:row.period,payload_cipher:cipher().seal(snapshot,entryId)};});
  return call(token,'IMPORT',{id,period:rows[0].period,preview_token,rows:prepared});
 }
 function pdfBytes(row,publishedAt){if(row.source_pdf){const bytes=upload.pdfBytes(row.source_pdf.data_base64);if(crypto.createHash('sha256').update(bytes).digest('hex')!==row.source_pdf.sha256)throw fault('PAYROLL_PDF_INVALID');return bytes;}return renderSlipPdf(row,{publishedAt,documentIdentity:identity(row)});}
 return {
 async list(token){const staff=await directory(token),rows=(await entries(token)).map(e=>{const {source_pdf,...row}=publicPayrollRow(e.row,staff);return {...e,row,recipient_valid:currentRecipient(e.row,staff)};});return {rows,readiness:{encryption:/^[a-fA-F0-9]{64}$/.test(env.PAYROLL_ENCRYPTION_KEY||''),email:require('./payroll-resend').resendReady(env)}};},
 async reviewUpload(token,body){const p=await preparedUpload(token,body);if(!widyaReviews)throw fault('PAYROLL_WIDYA_UNAVAILABLE',503);return widyaReviews.start(token,p,body);},
 async reviewStatus(token,id){if(!widyaReviews)throw fault('PAYROLL_WIDYA_UNAVAILABLE',503);const result=await widyaReviews.status(token,id);const {digest,...view}=result;if(result.status==='completed'&&result.ai?.decision==='LANJUT'&&!result.blockers.length)view.review_token=upload.reviewToken(env.PAYROLL_ENCRYPTION_KEY,token,digest);return view;},
 async importUpload(token,body){if(body.confirmed!==true)throw fault('PAYROLL_CONFIRM_REQUIRED');const p=await preparedUpload(token,body);if(p.blockers.length)throw fault(p.blockers[0]);upload.verifyToken(env.PAYROLL_ENCRYPTION_KEY,token,p.digest,body.review_token);if(!widyaReviews)throw fault('PAYROLL_WIDYA_UNAVAILABLE',503);const result=await widyaReviews.status(token,body.review_id);if(result.digest!==p.digest||result.status!=='completed'||result.ai?.decision!=='LANJUT'||result.blockers.length)throw fault('PAYROLL_UPLOAD_REVIEW_REQUIRED',409);return saveRows(token,p.rows,p.profile,p.units,body.company_address);},
 async importCsv(token,csv,{company_address}={}){
  if(company_address!==undefined&&(typeof company_address!=='string'||company_address.length>180||/[\x00-\x1f\x7f]/.test(company_address)))throw fault('PAYROLL_COMPANY_ADDRESS_INVALID');
  const profile=await company(token);if(!profile.name)throw fault('PAYROLL_COMPANY_REQUIRED');
  const staff=await directory(token),units=(await pool.query('SELECT id,name,code FROM business_units')).rows;
  const rows=validate(csv,staff.map(s=>({...s,branch_name:units.find(u=>u.id===s.branch_id)?.name})));
  return saveRows(token,rows,profile,units,company_address);
 },
 async publish(token,body){if(body.confirmed!==true)throw fault('PAYROLL_CONFIRM_REQUIRED');const rows=await entries(token),batch=rows.filter(e=>e.batch_id===body.id);if(!batch.length)throw fault('PAYROLL_NOT_FOUND',404);return call(token,'PUBLISH',body);},
 async filename(token,id){const e=await entry(token,id);return documentFormat.filename(documentFormat.slipCode(e.row)||'slip-gaji')+'.pdf';},
 async pdf(token,id){const e=await entry(token,id);return pdfBytes(e.row,e.published_at);},
 async send(token,id,body){
  if(body.confirmed!==true)throw fault('PAYROLL_CONFIRM_REQUIRED');
  const e=await entry(token,id);if(e.status!=='PUBLISHED')throw fault('PAYROLL_NOT_PUBLISHED',409);
  if(body.email!==e.row.email||!e.row.email)throw fault('PAYROLL_CONTACT_CHANGED',409);
  if(!currentRecipient(e.row,await directory(token)))throw fault('PAYROLL_CONTACT_CHANGED',409);
  // Local-only work before the claim: a rendering/config failure must never consume a claim
  // nor look like provider contact.
  let mailer,pdf,template;
  try{
   mailer=transport||require('./payroll-resend').createResendTransport({env});
   pdf=pdfBytes(e.row,e.published_at);
   template=require('./payroll-email-template').payrollEmail(e.row,{publishedAt:e.published_at,recipientEmail:e.row.email});
  }catch(err){const code=preProviderCode(err);throw fault(code,code==='PAYROLL_DELIVERY_LOCAL_FAILURE'?503:409);}
  // A retryable 'failed' row (stale claim or pre-provider failure) needs this explicit Owner send re-armed.
  if(e.email_status==='failed')await rearm(token,id);
  const claim=await call(token,'CLAIM',{id,email:e.row.email,confirmed:true,job_id:crypto.randomUUID()});
  if(!claim.acquired)return claim;
  const client=await pool.connect();
  let outcome={kind:'unknown'};
  try{
   await client.query('BEGIN');
   let fenced=false;
   try{
    await call(token,'FENCE',{id,email:e.row.email},client);
    if(!currentRecipient(e.row,await directory(token,client)))throw fault('PAYROLL_CONTACT_CHANGED',409);
    fenced=true;
   }catch(err){outcome={kind:'pre',code:preProviderCode(err)};}
   if(fenced&&outcome.kind!=='pre'){
    let result=null;
    // Provider access stays inside the FENCE/FOR SHARE transaction; a throw here is ambiguous.
    try{result=await mailer.sendMail({from:env.PAYROLL_EMAIL_FROM,to:e.row.email,subject:template.subject,text:template.text,html:template.html,messageId:`<${claim.id}@payroll.sipeka>`,attachments:[{filename:template.filename,content:pdf,contentType:'application/pdf'},...template.inlineAttachments]});}
    catch{outcome={kind:'unknown'};}
    if(result){
     if(!Array.isArray(result.accepted)||!result.accepted.includes(e.row.email))outcome={kind:'pre',code:'PAYROLL_PROVIDER_REJECTED'};
     else if(!result.messageId)outcome={kind:'unknown'};
     else outcome={kind:'sent',value:await call(token,'FINISH',{id:claim.id,status:'sent',provider_id:result.messageId},client)};
    }
   }
   if(outcome.kind==='sent')await client.query('COMMIT');else await client.query('ROLLBACK');
  }catch{
   try{await client.query('ROLLBACK');}catch{}
   outcome={kind:'unknown'};
  }finally{client.release();}
  if(outcome.kind==='sent')return outcome.value;
  // Provably never sent: 'failed' with a retryable code instead of terminal 'uncertain'.
  if(outcome.kind==='pre')return settleFailed(token,claim.id,outcome.code);
  // Provider acceptance unknown: terminal, never auto-resubmitted.
  try{return await call(token,'FINISH',{id:claim.id,status:'uncertain'});}catch{throw fault('PAYROLL_DELIVERY_UNCERTAIN',503);}
 }
 };
}
module.exports={FULL_GENERAL_HEADER,FULL_LAUNDRY_HEADER,GENERAL_HEADER,LAUNDRY_HEADER,HEADER,LEGACY_HEADER,validate,service};
