'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('playwright-core');
const read=name=>fs.readFileSync(path.join(__dirname,'../public',name),'utf8');

test('embedded frontend contracts match maintained source modules',()=>{
 const context={window:{}};require('node:vm').runInNewContext(read('backend-ui.js'),context);assert.match(context.window.SipekaUi.message(Error('PAYROLL_CSV_CELL_4')),/baris 4/);assert.match(context.window.SipekaUi.message(Error('PAYROLL_NET_INVALID')),/potongan/);
 const html=read('financial-dashboard.html').replace(/\r\n/g,'\n');
 for(const file of ['backend-ui.js','coa-input-ui.js','device-staff-ui.js','employee-payroll-ui.js','report-identity-ui.js'])assert.ok(html.includes(read(file).replace(/\r\n/g,'\n').trim()),file+' embedded source drift');
});

test('payroll UI uses backend readiness, explicit publication, uncertain delivery and actionable import errors',async t=>{
 const entry={id:'employee-entry',batch_id:'employee-batch',period:'2026-10',preview_token:'preview-token',status:'DRAFT',email_status:null,row:{company_name:'Perusahaan QA',employee_id:'employee-1',full_name:'Ayu QA',department:'Operasional',branch_name:'Unit X1',email:'ayu@example.test',basic_salary:'2500000',allowances:'100000',deductions:'20000',pph21:'10000',net_salary:'2570000'}};
 const writes=[];
 const script="window.testGeneration=1;window.SipekaCompany={};window.SipekaCurrentUser={id:'owner',role:'OWNER'};window.SipekaAuth={generation:()=>testGeneration,api:async(path,options={})=>{const r=await fetch(path,{method:options.method||'GET',headers:{'Content-Type':'application/json'},body:options.body?JSON.stringify(options.body):undefined});const d=await r.json();if(!r.ok)throw Error(d.error);return d;}};";
 const server=http.createServer((req,res)=>{
  const route=req.url.split('?')[0];res.setHeader('Content-Type',route==='/'?'text/html; charset=utf-8':'application/json; charset=utf-8');
  if(route==='/'){res.end('<div id="content"></div><script>'+script+read('backend-ui.js')+read('employee-payroll-ui.js')+"document.querySelector('#content').innerHTML=SipekaEmployeePayroll.render();SipekaEmployeePayroll.bind(document.querySelector('#content'));</script>");return;}
  let body='';req.on('data',chunk=>body+=chunk);req.on('end',()=>{
   if(req.method==='POST'){const parsed=JSON.parse(body);writes.push({route,body:parsed});
    if(route.endsWith('/import')){res.statusCode=400;res.end(JSON.stringify({error:'PAYROLL_EMPLOYEE_DEPARTMENT_REQUIRED'}));return;}
    if(route.endsWith('/publish')){assert.equal(parsed.preview_token,'preview-token');assert.equal(parsed.confirmed,true);entry.status='PUBLISHED';}
    if(route.endsWith('/send')){assert.equal(parsed.email,entry.row.email);assert.equal(parsed.confirmed,true);entry.email_status='uncertain';res.end(JSON.stringify({status:'uncertain'}));return;}
    res.end('{}');return;
   }
   res.end(JSON.stringify({rows:[entry],readiness:{encryption:true,email:true}}));
  });
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});t.after(()=>browser.close());
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:'+server.address().port);
 await page.waitForSelector('[data-employee-pdf]');
 const importButton=page.locator('[data-employee-import] button'),send=page.locator('[data-employee-send]');
 assert.equal(await importButton.isDisabled(),true);assert.equal(await page.locator('[data-employee-consent]').isDisabled(),true);assert.match(await page.locator('#employeePayroll').innerText(),/Operasional · Unit X1/);
 await page.evaluate(()=>{SipekaCompany={name:'Perusahaan QA'};document.dispatchEvent(new Event('sipeka-company-saved'));});await page.waitForFunction(()=>!document.querySelector('[data-employee-import] button').disabled);
 await page.locator('[name=csv]').setInputFiles({name:'qa.csv',mimeType:'text/csv',buffer:Buffer.from('fixture rejected by backend')});await importButton.click();await page.waitForFunction(()=>document.querySelector('[data-employee-status]').textContent.includes('Lengkapi departemen'));
 assert.equal(await page.locator('[data-employee-publish]').isDisabled(),true);await page.locator('[data-employee-publish-consent]').check();await page.locator('[data-employee-publish]').click();await page.waitForFunction(()=>!document.querySelector('[data-employee-publish]'));
 assert.equal(await send.isDisabled(),true);await page.locator('[data-employee-consent]').check();assert.equal(await send.isDisabled(),false);await send.click();await page.waitForFunction(()=>document.querySelector('[data-employee-delivery]').textContent.includes('Status kirim perlu diperiksa'));
 assert.equal(await send.isDisabled(),true);assert.equal(await page.locator('[data-employee-consent]').isDisabled(),true);await page.locator('[data-employee-refresh]').click();assert.equal(await send.isDisabled(),true);
 assert.deepEqual(writes.map(x=>x.route),['/api/employee-payroll/import','/api/employee-payroll/publish','/api/employee-payroll/entries/employee-entry/send']);assert.deepEqual(errors,[]);
});
