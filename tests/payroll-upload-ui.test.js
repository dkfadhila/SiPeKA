'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('playwright-core');
const root=path.resolve(__dirname,'..'),read=name=>fs.readFileSync(path.join(root,'public',name),'utf8');
test('CSV/PDF review requires explicit recipient check; Widya review cannot send; draft and delivery keep separate approvals',async t=>{
 const requests=[],pdf=require('../payroll-pdf').renderSlipPdf({employee_id:'QA-001',full_name:'Karyawan QA',period:'2026-10',department:'Operasional',branch_name:'QA',basic_salary:3000000,allowances:0,deductions:0,pph21:0,net_salary:3000000});
 let blocked=false,entry=null;
 const person={employee_id:'QA-001',full_name:'Karyawan QA',period:'2026-10',department:'Operasional',branch_name:'QA',email:'qa@example.invalid',upload_kind:'PDF',net_salary:null,company_name:'Perusahaan QA'};
 let reviewRows=[person];
 const html=read('financial-dashboard.html'),styles=[...html.matchAll(/<style\b[^>]*>[\s\S]*?<\/style>/g)].map(m=>m[0]).join('');
 const pageHtml='<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">'+styles+'</head><body><main id="content" style="max-width:1400px;margin:auto;padding:16px"></main><script>window.SipekaCompany={name:"Perusahaan QA"};window.SipekaCurrentUser={id:"owner-qa",role:"OWNER"};window.SipekaAuth={generation:()=>1,api:async(path,options={})=>{const response=await fetch(path,{method:options.method||"GET",headers:{"Content-Type":"application/json"},body:options.body?JSON.stringify(options.body):undefined});const result=await response.json();if(!response.ok)throw Error(result.error);return result;}};</script><script>'+read('backend-ui.js')+read('employee-payroll-ui.js')+'document.querySelector("#content").innerHTML="<div class=management-workspace>"+SipekaEmployeePayroll.render()+"</div>";SipekaEmployeePayroll.bind(document.querySelector("#content"));</script></body></html>';
 const server=http.createServer(async(req,res)=>{
  res.setHeader('Content-Type',req.url==='/'?'text/html; charset=utf-8':'application/json');if(req.url==='/')return res.end(pageHtml);
  let raw='';for await(const chunk of req)raw+=chunk;const body=raw?JSON.parse(raw):null;requests.push({path:req.url,body});let value={};
  if(req.url==='/api/employee-payroll')value={rows:entry?[entry]:[],readiness:{encryption:true,email:true}};
  else if(req.url.endsWith('/review'))value={rows:reviewRows,warnings:['PAYROLL_PDF_EMAIL_MISSING_REVIEW'],blockers:blocked?['PAYROLL_EMAIL_MISSING']:[],review_token:blocked?null:'signed-review-token'};
  else if(req.url==='/api/widya/sessions')value={session:{id:'session-qa'}};
  else if(req.url.endsWith('/files'))value={file:{id:body.name==='pembanding-penerima.json'?'comparison-qa':'file-qa'}};
  else if(req.url.endsWith('/import')){assert.equal(body.confirmed,true);assert.equal(body.review_token,'signed-review-token');assert.deepEqual(Buffer.from(body.data_base64,'base64'),pdf);entry={id:'entry-qa',batch_id:'batch-qa',preview_token:'publish-token',period:person.period,status:'DRAFT',recipient_valid:true,email_status:null,row:person};}
  else if(req.url.endsWith('/publish')){assert.equal(body.preview_token,'publish-token');assert.equal(body.confirmed,true);entry.status='PUBLISHED';}
  else if(req.url.endsWith('/send')){assert.equal(body.email,person.email);assert.equal(body.confirmed,true);entry.email_status='sent';value={status:'sent'};}
  res.end(JSON.stringify(value));
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});t.after(()=>browser.close());const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>!document.querySelector('[data-employee-import] button').disabled);
 assert.equal(await page.locator('[data-employee-template],[data-employee-workbook],[data-employee-blank]').count(),6);
 await page.locator('[name=csv]').setInputFiles({name:'slip-qa.pdf',mimeType:'application/pdf',buffer:pdf});await page.locator('[name=pdf_period]').fill('2026-10');
 await page.locator('[data-employee-import] button').click();await page.waitForSelector('[data-employee-review]:not([hidden])');assert.match(await page.locator('[data-employee-review]').innerText(),/Email tidak tercantum dalam PDF/);assert.equal(await page.locator('[data-employee-save]').isDisabled(),true);assert.equal(requests.filter(r=>r.path.endsWith('/import')||r.path.endsWith('/send')).length,0);
 await page.locator('[data-employee-ai]').click();await page.waitForFunction(()=>document.querySelector('[data-employee-status]').textContent.includes('Pemeriksaan Widya berjalan'));
 const ai=requests.find(r=>r.path.endsWith('/messages'));assert.deepEqual(ai.body.attachment_ids,['file-qa','comparison-qa']);assert.match(ai.body.message,/JANGAN mengirim email\/Telegram/);assert.match(ai.body.message,/pembanding-penerima.json/);assert.ok(ai.body.message.length<32000);const comparison=requests.find(r=>r.path.endsWith('/files')&&r.body.name==='pembanding-penerima.json');const comparisonData=JSON.parse(Buffer.from(comparison.body.data_base64,'base64'));assert.deepEqual(comparisonData.rows,[person]);assert.deepEqual(comparisonData.warnings,['PAYROLL_PDF_EMAIL_MISSING_REVIEW']);assert.equal(requests.filter(r=>r.path.endsWith('/send')).length,0);
 await page.locator('[data-employee-review-consent]').check();assert.equal(await page.locator('[data-employee-save]').isDisabled(),false);
 await page.locator('[name=pdf_period]').fill('2026-11');assert.equal(await page.locator('[data-employee-review]').isHidden(),true);assert.equal(requests.filter(r=>r.path.endsWith('/import')).length,0);
 await page.locator('[name=pdf_period]').fill('2026-10');blocked=true;await page.locator('[data-employee-import] button').click();await page.waitForSelector('[data-employee-review]:not([hidden])');assert.equal(await page.locator('[data-employee-review-consent]').isDisabled(),true);assert.equal(await page.locator('[data-employee-save]').isDisabled(),true);
 blocked=false;await page.locator('[data-employee-import] button').click();await page.waitForFunction(()=>document.querySelector('[data-employee-review-consent]')?.disabled===false);await page.locator('[data-employee-review-consent]').check();await page.locator('[data-employee-save]').click();await page.waitForSelector('[data-employee-publish]');
 assert.match(await page.locator('[data-employee-rows]').innerText(),/PDF unggahan/);assert.equal(await page.locator('[data-employee-send]').isDisabled(),true);assert.equal(await page.locator('[data-employee-publish]').isDisabled(),true);
 await page.locator('[data-employee-publish-consent]').check();await page.locator('[data-employee-publish]').click();await page.waitForFunction(()=>!document.querySelector('[data-employee-publish]'));assert.equal(await page.locator('[data-employee-send]').isDisabled(),true);
 entry.recipient_valid=false;await page.locator('[data-employee-refresh]').click();await page.waitForFunction(()=>document.querySelector('[data-employee-delivery]').textContent.includes('berbeda dari direktori'));assert.equal(await page.locator('[data-employee-consent]').isDisabled(),true);
 entry.recipient_valid=true;await page.locator('[data-employee-refresh]').click();await page.waitForFunction(()=>!document.querySelector('[data-employee-consent]').disabled);await page.locator('[data-employee-consent]').check();await page.locator('[data-employee-send]').click();await page.waitForFunction(()=>document.querySelector('[data-employee-delivery]').textContent.includes('Diterima layanan email'));assert.equal(await page.locator('[data-employee-send]').isDisabled(),true);assert.equal(requests.filter(r=>r.path.endsWith('/send')).length,1);
 // Full supported batches exceed the chat message limit; comparison data travels as a file.
 reviewRows=Array.from({length:1000},(_,i)=>({...person,employee_id:'QA-'+i,full_name:'Karyawan QA '+i,email:'qa'+i+'@example.invalid'}));
 assert.ok(JSON.stringify(reviewRows).length>32000);
 await page.locator('[name=csv]').setInputFiles({name:'gaji.csv',mimeType:'text/csv',buffer:Buffer.from('synthetic CSV fixture')});
 await page.locator('[data-employee-import] button').click();await page.waitForSelector('[data-employee-review]:not([hidden])');await page.locator('[data-employee-ai]').click();
 await page.waitForFunction(()=>document.querySelector('[data-employee-status]').textContent.includes('Pemeriksaan Widya berjalan'));
 const largeAi=requests.filter(r=>r.path.endsWith('/messages')).at(-1),largeComparison=requests.filter(r=>r.path.endsWith('/files')&&r.body.name==='pembanding-penerima.json').at(-1);
 assert.ok(largeAi.body.message.length<32000);assert.match(largeAi.body.message,/1000 karyawan/);assert.deepEqual(JSON.parse(Buffer.from(largeComparison.body.data_base64,'base64')).rows,reviewRows);
 assert.equal(requests.filter(r=>r.path.endsWith('/send')).length,1);
 for(const width of [1440,390,360]){await page.setViewportSize({width,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);if(process.env.PAYROLL_UI_SHOTS){fs.mkdirSync(process.env.PAYROLL_UI_SHOTS,{recursive:true});await page.screenshot({path:path.join(process.env.PAYROLL_UI_SHOTS,'slip-gaji-'+width+'.png'),fullPage:true});}}
 assert.deepEqual(errors,[]);
});
