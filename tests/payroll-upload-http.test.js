'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),net=require('node:net'),path=require('node:path'),{spawn}=require('node:child_process');
const {FULL_GENERAL_HEADER}=require('../employee-payroll');
const pglitePath=process.env.PAYROLL_TEST_PGLITE||process.env.REPORTS_TEST_PGLITE;
test('current HTTP upload routes enforce authentication/Origin, signed recipient review, publication and original PDF attachment',{skip:!pglitePath,timeout:90000},async t=>{
 const port=await new Promise(resolve=>{const socket=net.createServer().listen(0,'127.0.0.1',()=>{const result=socket.address().port;socket.close(()=>resolve(result));});}),base='http://127.0.0.1:'+port;
 const child=spawn(process.execPath,[path.join(__dirname,'fixtures/payroll-upload-http-pglite.cjs')],{cwd:path.resolve(__dirname,'..'),stdio:['ignore','pipe','pipe','ipc'],env:{...process.env,PAYROLL_TEST_PGLITE:pglitePath,TZ:'UTC',DATABASE_URL:'postgresql://fixture-invalid/no-network',PORT:String(port),HOST:'127.0.0.1',PUBLIC_ORIGIN:base,NODE_ENV:'test',REQUIRE_OWNER_2FA:'0',ALLOW_PRIVATE_QA_BEARER:'0',PAYROLL_DELIVERY_ENABLED:'0',SIPEKA_WIDYA_ENABLED:'0',PAYROLL_ENCRYPTION_KEY:'ab'.repeat(32),PAYROLL_EMAIL_FROM:'raditya@widyafa.xyz'}});
 let logs='';child.stdout.on('data',value=>logs+=value);child.stderr.on('data',value=>logs+=value);
 t.after(async()=>{if(child.exitCode===null){child.kill();await new Promise(resolve=>child.once('exit',resolve));}});
 let ready=false;for(let i=0;i<300;i++){if(child.exitCode!==null)throw Error(logs);try{if((await fetch(base+'/api/ready')).ok){ready=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,50));}assert.ok(ready,logs);
 const api=(route,{user='owner',body,origin=base}={})=>fetch(base+route,{method:body===undefined?'GET':'POST',headers:{...(user?{Cookie:'sipeka_session=fixture-'+user}:{}),Origin:origin,'Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const json=async(response,status)=>{assert.equal(response.status,status,await response.clone().text()+'\n'+logs);assert.equal(response.headers.get('cache-control'),'no-store');return response.json();};
 const ipc=()=>new Promise((resolve,reject)=>{const request=String(Math.random()),timer=setTimeout(()=>reject(Error('Fixture state timeout')),5000);const receive=value=>{if(value.request!==request)return;clearTimeout(timer);child.off('message',receive);value.error?reject(Error(value.error)):resolve(value.value);};child.on('message',receive);child.send({action:'state',request});});
 const csv=FULL_GENERAL_HEADER+'\r\n2026-11,HO-26002,3000000,250000,100000,200000,150000,50000,25000,0,0,Admin,Tetap,Transfer\r\n',csvBody={format:'csv',csv,company_address:'Alamat Contoh'};
 assert.equal((await api('/api/employee-payroll/review',{user:null,body:csvBody})).status,401);
 assert.equal((await api('/api/employee-payroll/review',{user:'staff',body:csvBody})).status,403);
 assert.equal((await api('/api/employee-payroll/review',{body:csvBody,origin:'https://evil.invalid'})).status,403);
 for(const format of ['csv','xlsx']){
  const template=await api('/api/employee-payroll/template?type=general&format='+format);assert.equal(template.status,200);assert.equal(template.headers.get('cache-control'),'no-store');assert.match(template.headers.get('content-disposition'),new RegExp('template-gaji-general\\.'+format));
  const content=Buffer.from(await template.arrayBuffer());if(format==='csv')assert.match(content.toString('utf8'),/period,employee_id,basic_salary,operational_allowance/);else{assert.equal(content.subarray(0,2).toString(),'PK');assert.match(template.headers.get('content-type'),/spreadsheetml/);}
 }
 const csvReview=await json(await api('/api/employee-payroll/review',{body:csvBody}),200);assert.ok(csvReview.review_token);assert.equal(csvReview.rows[0].net_salary,3625000);assert.equal(csvReview.rows[0].email,'ayu@example.test');assert.equal((await ipc()).entries.length,0);
 await json(await api('/api/employee-payroll/import',{body:{...csvBody,confirmed:false,review_token:csvReview.review_token}}),400);
 const unsigned=await json(await api('/api/employee-payroll/import',{body:{...csvBody,confirmed:true}}),409);assert.equal(unsigned.error,'PAYROLL_UPLOAD_REVIEW_REQUIRED');
 const changed=await json(await api('/api/employee-payroll/import',{body:{...csvBody,csv:csv.replace('3000000','4000000'),confirmed:true,review_token:csvReview.review_token}}),409);assert.equal(changed.error,'PAYROLL_UPLOAD_REVIEW_REQUIRED');
 assert.equal((await ipc()).entries.length,0);
 const csvImported=await json(await api('/api/employee-payroll/import',{body:{...csvBody,confirmed:true,review_token:csvReview.review_token}}),201);assert.equal(csvImported.status,'DRAFT');
 const csvEntry=(await json(await api('/api/employee-payroll'),200)).rows.find(row=>row.batch_id===csvImported.id);assert.equal(csvEntry.row.net_salary,3625000);assert.equal(csvEntry.row.department,'Operasional');assert.equal(csvEntry.row.branch_name,'Head Office');assert.equal(csvEntry.row.email,'ayu@example.test');
 const pdf=require('../payroll-pdf').renderSlipPdf({employee_id:'HO-26002',full_name:'Ayu Contoh',department:'Operasional',branch_name:'Head Office',period:'2026-10',basic_salary:3000000,allowances:100000,deductions:50000,pph21:0,net_salary:3050000},{documentIdentity:{company_name:'CV Artha Multi Ciptanusa',company_address:'Alamat Contoh',branch_name:'Head Office'}});
 const pdfBody={format:'pdf',period:'2026-10',data_base64:pdf.toString('base64'),company_address:'Alamat Contoh'};
 const review=await json(await api('/api/employee-payroll/review',{body:pdfBody}),200);assert.ok(review.review_token);assert.deepEqual(review.warnings,['PAYROLL_PDF_EMAIL_MISSING_REVIEW']);assert.equal(review.rows[0].source_pdf,undefined);
 assert.equal((await api('/api/employee-payroll/import',{user:'staff',body:{...pdfBody,review_token:review.review_token,confirmed:true}})).status,403);
 const imported=await json(await api('/api/employee-payroll/import',{body:{...pdfBody,review_token:review.review_token,confirmed:true}}),201);assert.equal(imported.status,'DRAFT');
 const listing=await json(await api('/api/employee-payroll'),200),entry=listing.rows.find(row=>row.batch_id===imported.id);assert.ok(entry);assert.equal(entry.recipient_valid,true);assert.equal(entry.row.source_pdf,undefined);assert.equal(entry.row.upload_kind,'PDF');
 const attachment=await api('/api/employee-payroll/entries/'+entry.id+'/slip.pdf');assert.equal(attachment.status,200);assert.equal(attachment.headers.get('content-type'),'application/pdf');assert.equal(attachment.headers.get('cache-control'),'no-store');assert.deepEqual(Buffer.from(await attachment.arrayBuffer()),pdf);
 assert.equal((await api('/api/employee-payroll/entries/'+entry.id+'/slip.pdf',{user:'staff'})).status,403);
 await json(await api('/api/employee-payroll/entries/'+entry.id+'/send',{body:{email:'ayu@example.test',confirmed:true}}),409);
 await json(await api('/api/employee-payroll/publish',{body:{id:imported.id,preview_token:entry.preview_token,confirmed:true}}),200);
 const delivered=await json(await api('/api/employee-payroll/entries/'+entry.id+'/send',{body:{email:'ayu@example.test',confirmed:true}}),200);assert.equal(delivered.status,'sent');
 const repeat=await json(await api('/api/employee-payroll/entries/'+entry.id+'/send',{body:{email:'ayu@example.test',confirmed:true}}),200);assert.equal(repeat.status,'sent');
 const state=await ipc();assert.equal(state.sent.length,1);assert.equal(state.sent[0].to,'ayu@example.test');assert.equal(state.sent[0].attachments,1);assert.deepEqual(Buffer.from(state.sent[0].pdf,'base64'),pdf);
});
