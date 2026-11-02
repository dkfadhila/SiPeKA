"use strict";
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('playwright-core');
const root=path.resolve(__dirname,'..'),read=name=>fs.readFileSync(path.join(root,'public',name),'utf8');
test('Periksa File automatically polls real-review contract; only completed LANJUT plus human confirmation enables draft', {timeout:60000},async t=>{
 const requests=[],pdf=require('../payroll-pdf').renderSlipPdf({employee_id:'QA-001',full_name:'Karyawan QA',period:'2026-10',department:'Operasional',branch_name:'QA',basic_salary:3000000,allowances:0,deductions:0,pph21:0,net_salary:3000000});
 const person={employee_id:'QA-001',full_name:'Karyawan QA',period:'2026-10',department:'Operasional',branch_name:'QA',email:'qa@example.invalid',upload_kind:'PDF',net_salary:null,company_name:'Perusahaan QA'};
 let entry=null,mode='hold-running',sequence=0,pollFailures=0;const jobs=new Map();
 const html=read('financial-dashboard.html'),styles=[...html.matchAll(/<style\b[^>]*>[\s\S]*?<\/style>/g)].map(m=>m[0]).join('');
 const pageHtml='<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">'+styles+'</head><body><main id="content" style="max-width:1400px;margin:auto;padding:16px"></main><script>window.testGeneration=1;window.SipekaCompany={name:"Perusahaan QA"};window.SipekaCurrentUser={id:"owner-qa",role:"OWNER"};window.SipekaAuth={generation:()=>testGeneration,api:async(path,options={})=>{const response=await fetch(path,{method:options.method||"GET",headers:{"Content-Type":"application/json"},body:options.body?JSON.stringify(options.body):undefined});const result=await response.json();if(!response.ok)throw Error(result.error);return result;}};</script><script>'+read('backend-ui.js')+read('employee-payroll-ui.js')+'document.querySelector("#content").innerHTML="<div class=management-workspace>"+SipekaEmployeePayroll.render()+"</div>";SipekaEmployeePayroll.bind(document.querySelector("#content"));</script></body></html>';
 const server=http.createServer(async(req,res)=>{
  res.setHeader('Content-Type',req.url==='/'?'text/html; charset=utf-8':'application/json');if(req.url==='/')return res.end(pageHtml);
  let raw='';for await(const chunk of req)raw+=chunk;const body=raw?JSON.parse(raw):null;requests.push({path:req.url,body});let value={};
  if(req.url==='/api/employee-payroll')value={rows:entry?[entry]:[],readiness:{encryption:true,email:true}};
  else if(req.url==='/api/employee-payroll/review'){
   const id='review-'+(++sequence);jobs.set(id,{mode,polls:0});value={review_id:id,status:'running',rows:[person],warnings:['PAYROLL_PDF_EMAIL_MISSING_REVIEW'],blockers:[],review_token:null};
  }else if(req.url.startsWith('/api/employee-payroll/reviews/')){
   const id=req.url.split('/').at(-1),job=jobs.get(id);job.polls++;
   if(pollFailures){pollFailures--;res.statusCode=503;return res.end('{"error":"PAYROLL_WIDYA_REVIEW_FAILED"}');}
   value={review_id:id,status:'running',rows:[person],warnings:['PAYROLL_PDF_EMAIL_MISSING_REVIEW'],blockers:[],review_token:null};
   if(job.mode==='LANJUT')Object.assign(value,{status:'completed',ai:{decision:'LANJUT',text:'LANJUT\nID, nama, periode dan komponen sesuai. Email tidak tercetak dalam PDF; periksa kembali alamat dari direktori.'},review_token:'signed-'+id});
   if(job.mode==='TAHAN')Object.assign(value,{status:'completed',ai:{decision:'TAHAN',text:'TAHAN\nPotongan pada dokumen belum konsisten. Perbaiki sebelum melanjutkan.'}});
   if(job.mode==='BLOCKED')Object.assign(value,{status:'completed',ai:{decision:'LANJUT',text:'AI mengizinkan, tetapi email master belum tersedia.'},blockers:['PAYROLL_EMAIL_MISSING'],review_token:null});
   if(job.mode==='FAILED')Object.assign(value,{status:'failed',error:'PAYROLL_WIDYA_REVIEW_FAILED',ai:{decision:'TAHAN',text:'Widya belum berhasil membaca seluruh lampiran. Coba pemeriksaan ulang.'}});
  }else if(req.url.endsWith('/import')){
   assert.equal(body.confirmed,true);assert.equal(body.review_token,'signed-'+body.review_id);assert.equal(jobs.get(body.review_id).mode,'LANJUT');assert.deepEqual(Buffer.from(body.data_base64,'base64'),pdf);entry={id:'entry-qa',batch_id:'batch-qa',preview_token:'publish-token',period:person.period,status:'DRAFT',recipient_valid:true,email_status:null,row:person};
  }else if(req.url.endsWith('/publish')){assert.equal(body.preview_token,'publish-token');assert.equal(body.confirmed,true);entry.status='PUBLISHED';}
  else if(req.url.endsWith('/send')){assert.equal(body.email,person.email);assert.equal(body.confirmed,true);entry.email_status='sent';value={status:'sent'};}
  else if(req.url.includes('/template')||req.url.includes('/workbook')||req.url.endsWith('/slip.pdf')){
   const isPdf=req.url.endsWith('.pdf'),extension=isPdf?'pdf':req.url.includes('workbook')||req.url.includes('format=xlsx')?'xlsx':'csv';res.setHeader('Content-Type',isPdf?'application/pdf':extension==='xlsx'?'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':'text/csv');res.setHeader('Content-Disposition','attachment; filename="'+(isPdf?'SLIP-QA-X-2026-001':'template-gaji-general')+'.'+extension+'"');return res.end(isPdf?pdf:extension==='xlsx'?Buffer.from('PK-fixture'):Buffer.from('period,employee_id\r\n'));
  }else{res.statusCode=404;value={error:'unexpected-request'};}
  res.end(JSON.stringify(value));
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});t.after(()=>browser.close());const page=await browser.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>!document.querySelector('[data-employee-import] button').disabled);
 assert.equal(await page.locator('[data-employee-ai]').count(),0);
 for(const [selector,extension]of [['[data-employee-template=general]','csv'],['[data-employee-template=laundry]','csv'],['[data-employee-workbook=general]','xlsx'],['[data-employee-workbook=laundry]','xlsx'],['[data-employee-blank=general]','xlsx'],['[data-employee-blank=laundry]','xlsx']]){
  const pending=page.waitForEvent('download');await page.locator(selector).click();assert.match((await pending).suggestedFilename(),new RegExp('\\.'+extension+'$'));
 }
 const choose=async()=>{await page.locator('[name=csv]').setInputFiles({name:'slip-qa.pdf',mimeType:'application/pdf',buffer:pdf});await page.locator('[name=pdf_period]').fill('2026-10');};
 await choose();await page.locator('[data-employee-import] button').click();await page.waitForSelector('[data-employee-review]:not([hidden])');
 assert.match(await page.locator('[data-employee-ai-decision]').innerText(),/Sedang diperiksa Widya/);assert.equal(await page.locator('[data-employee-save]').isDisabled(),true);assert.equal(await page.locator('[data-employee-review-consent]').isDisabled(),true);assert.equal(await page.locator('[data-employee-import] button').isDisabled(),true);
 await page.waitForFunction(()=>!!document.querySelector('[data-employee-ai-result]'));
 const first='review-1';jobs.get(first).mode='LANJUT';await page.waitForFunction(()=>document.querySelector('[data-employee-ai-decision]')?.textContent.includes('LANJUT —'));
 assert.match(await page.locator('[data-employee-ai-result]').innerText(),/komponen sesuai/);assert.match(await page.locator('[data-employee-review]').innerText(),/Email tidak tercantum dalam PDF/);assert.equal(await page.locator('[data-employee-save]').isDisabled(),true);assert.equal(requests.filter(r=>r.path.endsWith('/import')).length,0);
 await page.locator('[data-employee-review-consent]').check();assert.equal(await page.locator('[data-employee-save]').isDisabled(),false);
 // Editing an input invalidates the completed verdict and token.
 await page.locator('[name=pdf_period]').fill('2026-11');assert.equal(await page.locator('[data-employee-review]').isHidden(),true);await page.locator('[name=pdf_period]').fill('2026-10');
 for(const [nextMode,expected]of [['TAHAN','TAHAN —'],['FAILED','belum berhasil'],['BLOCKED','Belum dapat dilanjutkan']]){
  mode=nextMode;await page.locator('[data-employee-import] button').click();await page.waitForFunction(text=>document.querySelector('[data-employee-ai-decision]')?.textContent.includes(text),expected);assert.equal(await page.locator('[data-employee-save]').isDisabled(),true);assert.equal(await page.locator('[data-employee-review-consent]').isDisabled(),true);
 }
 assert.equal(requests.filter(r=>r.path.startsWith('/api/widya/')).length,0);
 assert.equal(requests.filter(r=>r.path.endsWith('/import')||r.path.endsWith('/send')).length,0);
 // A transient status read retries the same durable review ID, never creates another AI run.
 mode='LANJUT';pollFailures=1;const beforeReview=sequence;await page.locator('[data-employee-import] button').click();await page.waitForSelector('[data-employee-check-review]');assert.equal(sequence,beforeReview+1);await page.locator('[data-employee-check-review]').click();await page.waitForFunction(()=>document.querySelector('[data-employee-ai-decision]')?.textContent.includes('LANJUT —'));assert.equal(sequence,beforeReview+1);
 await page.locator('[data-employee-review-consent]').check();await page.locator('[data-employee-save]').click();await page.waitForSelector('[data-employee-publish]');assert.equal(requests.filter(r=>r.path.endsWith('/import')).length,1);
 assert.equal(await page.locator('[data-employee-send]').isDisabled(),true);assert.equal(await page.locator('[data-employee-publish]').isDisabled(),true);assert.match(await page.locator('[data-employee-rows]').innerText(),/PDF unggahan/);
 const attachment=page.waitForEvent('download');await page.locator('[data-employee-pdf]').click();const slipDownload=await attachment;assert.match(slipDownload.suggestedFilename(),/\.pdf$/);assert.ok(requests.some(request=>request.path==='/api/employee-payroll/entries/entry-qa/slip.pdf'));await slipDownload.cancel();
 await page.locator('[data-employee-publish-consent]').check();await page.locator('[data-employee-publish]').click();await page.waitForFunction(()=>!document.querySelector('[data-employee-publish]'));assert.equal(await page.locator('[data-employee-send]').isDisabled(),true);
 entry.recipient_valid=false;await page.locator('[data-employee-refresh]').click();await page.waitForFunction(()=>document.querySelector('[data-employee-delivery]').textContent.includes('berbeda dari direktori'));assert.equal(await page.locator('[data-employee-consent]').isDisabled(),true);
 entry.recipient_valid=true;await page.locator('[data-employee-refresh]').click();await page.waitForFunction(()=>!document.querySelector('[data-employee-consent]').disabled);await page.locator('[data-employee-consent]').check();await page.locator('[data-employee-send]').click();await page.waitForFunction(()=>document.querySelector('[data-employee-delivery]').textContent.includes('Diterima layanan email'));assert.equal(requests.filter(r=>r.path.endsWith('/send')).length,1);assert.equal(await page.locator('[data-employee-send]').isDisabled(),true);
 for(const width of [1440,390,360]){await page.setViewportSize({width,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);if(process.env.PAYROLL_UI_SHOTS){fs.mkdirSync(process.env.PAYROLL_UI_SHOTS,{recursive:true});await page.screenshot({path:path.join(process.env.PAYROLL_UI_SHOTS,'automatic-review-'+width+'.png'),fullPage:true});}}
 assert.deepEqual(errors,[]);
});
