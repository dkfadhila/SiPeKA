'use strict';
const crypto=require('node:crypto'),{fork}=require('node:child_process'),path=require('node:path');
const {fault}=require('./payroll');
const MAX_PDF=256*1024;
function pdfBytes(encoded){
 if(typeof encoded!=='string'||encoded.length>Math.ceil(MAX_PDF/3)*4||encoded.length%4!==0||!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))throw fault('PAYROLL_PDF_INVALID');
 const bytes=Buffer.from(encoded,'base64');if(bytes.toString('base64')!==encoded||!bytes.length||bytes.length>MAX_PDF||!bytes.subarray(0,8).toString().startsWith('%PDF-')||!bytes.subarray(-1024).includes(Buffer.from('%%EOF')))throw fault('PAYROLL_PDF_INVALID');return bytes;
}
let active=0;
function extractPdf(encoded){
 pdfBytes(encoded);if(active>=2)throw fault('PAYROLL_PDF_BUSY',429);active++;
 return new Promise((resolve,reject)=>{
  const child=fork(path.join(__dirname,'payroll-pdf-worker.cjs'),[],{execArgv:['--max-old-space-size=192'],stdio:['ignore','ignore','ignore','ipc'],env:{PATH:process.env.PATH,...(process.env.NODE_PATH?{NODE_PATH:process.env.NODE_PATH}:{}),...(process.env.SystemRoot?{SystemRoot:process.env.SystemRoot}:{})}});
  let done=false;const timer=setTimeout(()=>finish(fault('PAYROLL_PDF_TIMEOUT',504)),12000);
  const finish=(error,value)=>{if(done)return;done=true;clearTimeout(timer);active--;child.kill();error?reject(error):resolve(value);};
  child.once('error',()=>finish(fault('PAYROLL_PDF_UNAVAILABLE',503)));child.once('exit',()=>finish(fault('PAYROLL_PDF_INVALID')));
  child.once('message',result=>{if(typeof result?.text==='string'&&result.text.length<=30000)finish(null,result.text);else finish(fault(/^PAYROLL_PDF_[A-Z_]+$/.test(result?.error)?result.error:'PAYROLL_PDF_INVALID'));});child.send(encoded);
 });
}
const normalize=v=>String(v??'').normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase('id-ID');
const canonicalEmail=v=>{const e=String(v??'').trim().toLowerCase();return e.length<=254&&/^[^\s@<>;,]+@[^\s@<>;,]+\.[^\s@<>;,]+$/.test(e)?e:null;};
function matchPdf(text,staff,period){
 if(typeof period!=='string'||!/^20\d{2}-(0[1-9]|1[0-2])$/.test(period))throw fault('PAYROLL_PERIOD');
 // Matching uses visible labelled fields, not filenames, AI guesses or a free text email.
 const lines=text.replace(/\r/g,'').split('\n').map(l=>l.trim()).filter(Boolean);
 const labels='Nomor Dokumen|Periode|Nama\\s*(?:Karyawan|Pegawai)|Employee\\s*Name|ID(?:\\s*(?:Karyawan|Pegawai))?|Employee\\s*ID|Departemen|Unit Kerja|Jabatan|Status|E-?mail(?:\\s*Karyawan)?';
 const values=label=>lines.flatMap(l=>[...l.matchAll(new RegExp('(?:^|\\s)(?:'+label+')\\s*:\\s*(.+?)(?=\\s+(?:'+labels+')\\s*:|$)','gi'))].map(m=>m[1].trim()));
 const ids=values('ID(?:\\s*(?:Karyawan|Pegawai))?|Employee\\s*ID').map(v=>v.split(/\s+(?:Jabatan|Status|Periode)\s*:/i)[0].trim());
 const names=values('Nama\\s*(?:Karyawan|Pegawai)|Employee\\s*Name').map(v=>v.split(/\s+(?:ID|Departemen|Unit Kerja)\s*:/i)[0].trim());
 if(ids.length!==1||names.length!==1)throw fault('PAYROLL_PDF_IDENTITY_REQUIRED');
 const employees=staff.filter(s=>s.active&&s.id===ids[0]);if(employees.length!==1)throw fault('PAYROLL_STAFF_NOT_FOUND');const employee=employees[0];
 if(normalize(names[0])!==normalize(employee.name))throw fault('PAYROLL_PDF_IDENTITY_MISMATCH');
 if(!employee.department)throw fault('PAYROLL_EMPLOYEE_DEPARTMENT_REQUIRED');
 // Extra labelled identities are rejected above. Searching arbitrary text for IDs
 // would confuse a salary like Rp 1.001 with another employee whose ID is 001.
 const periods=values('Periode').map(value=>{
  if(/^20\d{2}-(0[1-9]|1[0-2])$/.test(value))return value;
  const months=['januari','februari','maret','april','mei','juni','juli','agustus','september','oktober','november','desember'],m=/^([a-z]+)\s+(20\d{2})$/i.exec(value),index=m?months.findIndex(month=>month===m[1].toLowerCase()||month.slice(0,3)===m[1].toLowerCase()):-1;
  return index>=0?m[2]+'-'+String(index+1).padStart(2,'0'):value;
 });if(periods.length!==1||periods[0]!==period)throw fault('PAYROLL_PDF_PERIOD_MISMATCH');
 const emails=[...new Set([...text.matchAll(/[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g)].map(m=>canonicalEmail(m[0])).filter(Boolean))];
 const email=canonicalEmail(employee.email);const warnings=[],blockers=[];
 if(!email)blockers.push('PAYROLL_EMAIL_MISSING');
 if(email&&staff.filter(s=>canonicalEmail(s.email)===email).length!==1)blockers.push('PAYROLL_EMAIL_AMBIGUOUS');
 if(emails.length>1||emails.length===1&&emails[0]!==email)blockers.push('PAYROLL_PDF_EMAIL_MISMATCH');
 if(emails.length===0)warnings.push('PAYROLL_PDF_EMAIL_MISSING_REVIEW');
 return {employee,period,email,source_email:emails[0]||null,warnings,blockers};
}
function fingerprint(value){return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');}
function reviewToken(key,session,digest,expires=Date.now()+10*60*1000){if(!/^[a-f0-9]{64}$/i.test(key||''))throw fault('PAYROLL_ENCRYPTION_KEY_REQUIRED',503);const content=Buffer.from(JSON.stringify({digest,expires})).toString('base64url');const signature=crypto.createHmac('sha256',Buffer.from(key,'hex')).update(session+'\n'+content).digest('base64url');return content+'.'+signature;}
function verifyToken(key,session,digest,token){
 try{if(typeof token!=='string'||token.length>400)throw Error();const [data,signature,...rest]=token.split('.');const decoded=JSON.parse(Buffer.from(data,'base64url'));if(rest.length||decoded.digest!==digest||!Number.isFinite(decoded.expires)||decoded.expires<Date.now())throw Error();const expected=reviewToken(key,session,digest,decoded.expires).split('.')[1];if(signature?.length!==expected.length||!crypto.timingSafeEqual(Buffer.from(signature),Buffer.from(expected)))throw Error();}catch{throw fault('PAYROLL_UPLOAD_REVIEW_REQUIRED',409);}
}
module.exports={pdfBytes,extractPdf,matchPdf,canonicalEmail,normalize,fingerprint,reviewToken,verifyToken,MAX_PDF};
