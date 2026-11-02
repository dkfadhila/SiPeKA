'use strict';
// Dedicated operator command. Never mounted in the app; never reads device contacts.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const fail=c=>{throw Error(c);};
function validate(a,s){
 if(a?.confirmed!==true||!a.owner_app_id||!a.owner_confirmation_reference||!a.source_reference)fail('EXPLICIT_OWNER_APPROVAL_REQUIRED');
 if(!s?.active||a.staff_id!==s.id||a.staff_name!==s.name||a.branch_id!==s.branch_id||a.staff_revision!==s.revision||!s.branch_name)fail('STAFF_IDENTITY_OR_BRANCH_STALE');
 if(typeof a.email!=='string'||a.email.length>254||! /^[^\s@<>;,]+@[^\s@<>;,]+\.[^\s@<>;,]+$/.test(a.email))fail('EXPLICIT_STAFF_EMAIL_REQUIRED');
 if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(a.period)||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(a.published_at)||!Number.isFinite(Date.parse(a.published_at)))fail('PAYROLL_PERIOD_OR_PUBLICATION_REQUIRED');
 const amounts=['basic_salary','allowances','deductions','pph21','approved_net_salary'].map(k=>{if(typeof a[k]!=='string'||!/^(0|[1-9]\d{0,15})$/.test(a[k]))fail('EXACT_INTEGER_IDR_REQUIRED');return BigInt(a[k]);});
 if(amounts[0]+amounts[1]-amounts[2]-amounts[3]!==amounts[4])fail('APPROVED_AMOUNT_MISMATCH');
 return {period:a.period,user_id:s.id,employee_id:s.id,username:s.id,full_name:s.name,branch_name:s.branch_name,...(s.department?{department:s.department}:{}),...(s.unit_code?{unit_code:s.unit_code}:{}),basic_salary:a.basic_salary,allowances:a.allowances,deductions:a.deductions,pph21:a.pph21,net_salary:a.approved_net_salary};
}
function build(a,s,modules){const row=validate(a,s),pdf=modules.renderSlipPdf(row,{publishedAt:a.published_at}),mail=modules.payrollEmail(row,{publishedAt:a.published_at,recipientEmail:a.email});return {from:'raditya@widyafa.xyz',to:a.email,subject:mail.subject,text:mail.text,html:mail.html,attachments:[{filename:mail.filename,content:pdf},...(mail.inlineAttachments||[])]};}
async function deliver({approval,staff,modules,transport,stateDir}){
 const mail=build(approval,staff,modules);
 // One durable staff-period reservation, including recipient changes. Never auto-retry.
 const key=crypto.createHash('sha256').update(approval.staff_id+'\0'+approval.period).digest('hex'),target=path.join(stateDir,key+'.json');
 const id=crypto.randomUUID();const fd=fs.openSync(target,'wx',0o600);try{fs.writeFileSync(fd,JSON.stringify({status:'uncertain',id,approval_sha256:crypto.createHash('sha256').update(JSON.stringify(approval)).digest('hex')}));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
 const dirfd=fs.openSync(stateDir,'r');try{fs.fsyncSync(dirfd);}finally{fs.closeSync(dirfd);}
 mail.messageId='<'+id+'@payroll.sipeka>';
 try{const result=await transport.sendMail(mail);if(!result?.accepted?.includes(approval.email)||!result.messageId)fail('PROVIDER_ACCEPTANCE_UNKNOWN');const out={status:'accepted',id,provider_id:result.messageId};const fd=fs.openSync(target,'r+');try{fs.ftruncateSync(fd,0);fs.writeFileSync(fd,JSON.stringify(out));fs.fsyncSync(fd);}finally{fs.closeSync(fd);}return out;}catch{fail('UNCERTAIN_QUARANTINED_NO_RETRY');}
}
async function main(){
 if(process.getuid?.()!==0)fail('ROOT_OPERATOR_REQUIRED');
 const [mode,id]=process.argv.slice(2);if(!['--check','--send'].includes(mode)||!/^[a-f0-9-]{36}$/.test(id||''))fail('USAGE_CHECK_OR_SEND_APPROVAL_UUID');
 const base='/var/lib/widya-payroll-email',file=path.join(base,'approvals',id+'.json'),st=fs.lstatSync(file);
 if(!st.isFile()||st.isSymbolicLink()||st.uid!==0||(st.mode&0o077)||st.size>16384)fail('PROTECTED_APPROVAL_FILE_REQUIRED');
 const approval=JSON.parse(fs.readFileSync(file,'utf8'));
 const app='/opt/sipeka/current',modules={...require(app+'/payroll-pdf'),...require(app+'/payroll-email-template')};
 const parse=p=>Object.fromEntries(fs.readFileSync(p,'utf8').split(/\r?\n/).filter(l=>/^[A-Z_]+=/.test(l)).map(l=>{const i=l.indexOf('=');return [l.slice(0,i),l.slice(i+1).replace(/^(["'])(.*)\1$/,'$2')];}));
 // Maintenance connection root-only; runtime role intentionally cannot SELECT staff directory directly.
 const env={...parse('/etc/sipeka/production.env'),...parse('/etc/sipeka/payroll.env')};
 const {Client}=require(app+'/node_modules/pg'),db=new Client({connectionString:env.DATABASE_URL,statement_timeout:5000});await db.connect();
 try{await db.query('BEGIN');await db.query("SET LOCAL idle_in_transaction_session_timeout='60s'");
 const owner=(await db.query("SELECT id FROM app_users WHERE id=$1 AND role='OWNER'",[approval.owner_app_id])).rows[0];if(!owner)fail('OWNER_APP_ID_REQUIRED');
 const staff=(await db.query('SELECT s.id,s.name,s.branch_id,s.department,s.revision,s.active,b.name branch_name,b.code unit_code FROM operational_staff s JOIN business_units b ON b.id=s.branch_id AND b.is_active=1 WHERE s.id=$1 FOR SHARE OF s,b',[approval.staff_id])).rows[0];
 validate(approval,staff);if(mode==='--check'){console.log(JSON.stringify({status:'validated_not_sent',channel:'email',requires:'explicit --send with this protected approval UUID'}));return;}
 const transport=require(app+'/payroll-resend').createResendTransport({env});
 console.log(JSON.stringify(await deliver({approval,staff,modules,transport,stateDir:path.join(base,'state')})));
 }finally{await db.query('ROLLBACK').catch(()=>{});await db.end();}
}
module.exports={validate,build,deliver};
if(require.main===module)main().catch(e=>{console.error(JSON.stringify({status:'blocked',code:/^[A-Z_]+$/.test(e.message)?e.message:'SAFE_FAILURE'}));process.exitCode=1;});
