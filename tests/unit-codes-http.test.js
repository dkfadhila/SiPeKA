'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),net=require('node:net'),path=require('node:path'),crypto=require('node:crypto'),{spawn}=require('node:child_process');
const runtime=process.env.PAYROLL_TEST_PGLITE||process.env.REPORTS_TEST_PGLITE;
test('actual HTTP registers an Owner unit code and uses the same code in reports, payroll PDF and workbook',{skip:!runtime,timeout:90000},async t=>{
 const port=await new Promise(resolve=>{const socket=net.createServer().listen(0,'127.0.0.1',()=>{const value=socket.address().port;socket.close(()=>resolve(value));});}),base='http://127.0.0.1:'+port;
 const child=spawn(process.execPath,[path.join(__dirname,'fixtures/payroll-upload-http-pglite.cjs')],{cwd:path.resolve(__dirname,'..'),stdio:['ignore','pipe','pipe','ipc'],env:{...process.env,TZ:'UTC',PAYROLL_TEST_PGLITE:runtime,DATABASE_URL:'postgresql://fixture-invalid/no-network',PORT:String(port),HOST:'127.0.0.1',PUBLIC_ORIGIN:base,NODE_ENV:'test',REQUIRE_OWNER_2FA:'0',ALLOW_PRIVATE_QA_BEARER:'0',PAYROLL_DELIVERY_ENABLED:'0',SIPEKA_WIDYA_ENABLED:'0',PAYROLL_ENCRYPTION_KEY:'ab'.repeat(32)}});
 let logs='';child.stdout.on('data',b=>logs+=b);child.stderr.on('data',b=>logs+=b);t.after(async()=>{if(child.exitCode===null){child.kill();await new Promise(resolve=>child.once('exit',resolve));}});
 let ready=false;for(let i=0;i<300;i++){if(child.exitCode!==null)throw Error(logs);try{if((await fetch(base+'/api/ready')).ok){ready=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,50));}assert.ok(ready,logs);
 const api=(route,{user='owner',body,origin=base}={})=>fetch(base+route,{method:body===undefined?'GET':'POST',headers:{...(user?{Cookie:'sipeka_session=fixture-'+user}:{}),Origin:origin,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const json=async(response,status)=>{assert.equal(response.status,status,await response.clone().text()+'\n'+logs);return response.json();};
 const request={name:'RedDoorz Custom',code:'rtd',category:'KOS'};
 assert.equal((await api('/api/units',{user:null,body:request})).status,401);await json(await api('/api/units',{user:'staff',body:request}),403);assert.equal((await api('/api/units',{origin:'https://evil.invalid',body:request})).status,403);
 for(const code of ['A','ABCDE','RD1','R-D'])assert.equal((await json(await api('/api/units',{body:{...request,code}}),400)).code,'UNIT_CODE_INVALID');
 assert.equal((await json(await api('/api/units',{body:{...request,code:'AMC'}}),400)).code,'UNIT_CODE_RESERVED');
 const unit=await json(await api('/api/units',{body:request}),201);assert.equal(unit.code,'RTD');assert.match(unit.id,/^UNIT_[a-f0-9]{24}$/);
 assert.equal((await json(await api('/api/units',{body:{...request,name:'Other',code:'RTD'}}),409)).code,'UNIT_CODE_DUPLICATE');
 const units=await json(await api('/api/units'),200);assert.equal(units.find(u=>u.id===unit.id).code,'RTD');
 const filters={branch_id:unit.id,date_from:'2026-10-01',date_to:'2026-10-31',view_mode:'branch',timezone:'Asia/Jakarta'};
 const issue=async report_id=>json(await api('/api/documents/issue',{body:{report_id,...Object.fromEntries(Object.entries(filters).filter(([k])=>k!=='timezone')),idempotency_key:crypto.randomUUID()}}),201);
 const document=await issue('fund-position');assert.equal(document.code,'NRC/RTD/X/2026/001');
 const bare=new URLSearchParams({...filters,format:'csv'});assert.equal((await json(await api('/api/reports/fund-position/export?'+bare),409)).error,'DOCUMENT_REQUIRED');
 for(const format of ['csv','xlsx']){
  const params=new URLSearchParams({...filters,format,document_id:document.id,...(format==='xlsx'?{company_name:'CV Artha Multi Ciptanusa'}:{})});
  const response=await api('/api/reports/fund-position/export?'+params);assert.equal(response.status,200,await response.clone().text());const bytes=Buffer.from(await response.arrayBuffer());
  if(format==='csv')assert.match(bytes.toString(),/NRC\/RTD\/X\/2026\/001/);
  else{const xml=require('../report-template-xlsx').unzip(bytes).filter(f=>f.name.startsWith('xl/worksheets/')).map(f=>f.data.toString()).join('');assert.match(xml,/NRC\/RTD\/X\/2026\/001/);}
 }
 const staff=await json(await api('/api/operational-staff',{body:{name:'Karyawan Unit Custom',department:'Operasional',branch_id:unit.id,active:true,email:'unit@example.test',email_confirmed:true}}),200);
 const csv=require('../employee-payroll').FULL_GENERAL_HEADER+'\r\n2026-10,'+staff.id+',3000000,0,0,0,0,0,0,0,0,Staff,Tetap,Transfer\r\n',body={format:'csv',csv};
 const start=await json(await api('/api/employee-payroll/review',{body}),200),review=await json(await api('/api/employee-payroll/reviews/'+start.review_id),200);assert.equal(review.ai.decision,'LANJUT');assert.ok(review.review_token);
 const draft=await json(await api('/api/employee-payroll/import',{body:{...body,review_id:review.review_id,review_token:review.review_token,confirmed:true}}),201);
 const entry=(await json(await api('/api/employee-payroll'),200)).rows.find(e=>e.batch_id===draft.id),code='SLIP/RTD-OPS/X/2026/'+staff.id;assert.equal(entry.row.document_code,code);
 const pdf=await api('/api/employee-payroll/entries/'+entry.id+'/slip.pdf');assert.equal(pdf.status,200);assert.match(Buffer.from(await pdf.arrayBuffer()).toString('latin1'),/SLIP\/RTD-OPS\/X\/2026\//);
 const xlsx=await api('/api/employee-payroll/workbook?type=general');assert.equal(xlsx.status,200);const xml=require('../report-template-xlsx').unzip(Buffer.from(await xlsx.arrayBuffer())).find(f=>f.name==='xl/worksheets/sheet2.xml').data.toString();assert.ok(xml.includes(code));
 // No publication or delivery calls are made by this test.
});
