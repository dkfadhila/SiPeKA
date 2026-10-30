'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('playwright-core');
const read=name=>fs.readFileSync(path.join(__dirname,'../public',name),'utf8');

test('embedded frontend contracts match maintained source modules',()=>{
 const context={window:{}};require('node:vm').runInNewContext(read('backend-ui.js'),context);assert.match(context.window.SipekaUi.message(Error('PAYROLL_CSV_CELL_4')),/baris 4/);assert.match(context.window.SipekaUi.message(Error('PAYROLL_NET_INVALID')),/potongan/);
 const html=read('financial-dashboard.html').replace(/\r\n/g,'\n');
 for(const file of ['report-template-pdf.js','lucide-icons.js','backend-ui.js','coa-input-ui.js','device-staff-ui.js','employee-payroll-ui.js','report-identity-ui.js'])assert.ok(html.includes(read(file).replace(/\r\n/g,'\n').trim()),file+' embedded source drift');
});

test('payroll UI uses backend readiness, explicit publication, uncertain delivery and actionable import errors',async t=>{
 const entry={id:'employee-entry',batch_id:'employee-batch',period:'2026-10',preview_token:'preview-token',status:'DRAFT',email_status:null,row:{company_name:'Perusahaan QA',employee_id:'employee-1',full_name:'Ayu QA',job_title:'Admin QA',employment_status:'Tetap',operational_allowance:'30000',health_allowance:'20000',overtime:'40000',bonus:'10000',absence_deduction:'10000',late_deduction:'5000',violation_deduction:'5000',department:'Operasional',branch_name:'Unit X1',email:'ayu@example.test',basic_salary:'2500000',allowances:'100000',deductions:'20000',pph21:'10000',net_salary:'2570000'}};
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
 assert.match(await page.locator('#employeePayroll').innerText(),/Tunjangan operasional/);assert.match(await page.locator('#employeePayroll').innerText(),/Tunjangan kesehatan/);assert.match(await page.locator('#employeePayroll').innerText(),/Admin QA · Tetap/);await page.locator('[name=company_address]').fill('Alamat Kop QA');
 await page.locator('[name=csv]').setInputFiles({name:'qa.csv',mimeType:'text/csv',buffer:Buffer.from('fixture rejected by backend')});await importButton.click();await page.waitForFunction(()=>document.querySelector('[data-employee-status]').textContent.includes('Lengkapi departemen'));
 assert.equal(await page.locator('[data-employee-publish]').isDisabled(),true);await page.locator('[data-employee-publish-consent]').check();await page.locator('[data-employee-publish]').click();await page.waitForFunction(()=>!document.querySelector('[data-employee-publish]'));
 assert.equal(await send.isDisabled(),true);await page.locator('[data-employee-consent]').check();assert.equal(await send.isDisabled(),false);await send.click();await page.waitForFunction(()=>document.querySelector('[data-employee-delivery]').textContent.includes('Status kirim perlu diperiksa'));
 assert.equal(await send.isDisabled(),true);assert.equal(await page.locator('[data-employee-consent]').isDisabled(),true);await page.locator('[data-employee-refresh]').click();assert.equal(await send.isDisabled(),true);
 assert.equal(writes[0].body.company_address,'Alamat Kop QA');assert.deepEqual(writes.map(x=>x.route),['/api/employee-payroll/import','/api/employee-payroll/publish','/api/employee-payroll/entries/employee-entry/send']);assert.deepEqual(errors,[]);
});


test('Income/Expenses follow backend transaction types, including other income, operating expenses, tax and legacy codes',()=>{
 const html=read('financial-dashboard.html'),vm=require('node:vm');
 const raw=[['i','7-1100','INCOME'],['e6','6-1100','EXPENSE'],['e7','7-2100','EXPENSE'],['e8','8-1000','EXPENSE'],['legacy','5101','EXPENSE'],['other','4-1300','INCOME']].map(([id,account_code,tx_type])=>({id,account_code,tx_type}));
 const display=raw.map(r=>['',r.id,r.id==='other'?'Unit B':'Unit A',r.account_code,'','','','',null,r.id]);
 const context={Set,transactions:display,visibleTransactions:rows=>rows.filter(r=>r[2]==='Unit A'),realDataRows:()=>raw};
 for(const name of ['categoryRawRows','categoryDisplayRows'])vm.runInNewContext(html.match(new RegExp('function '+name+'\\([^\\n]+'))[0],context);
 assert.deepEqual(Array.from(context.categoryDisplayRows('income'),r=>r[9]),['i']);
 assert.deepEqual(Array.from(context.categoryDisplayRows('expenses'),r=>r[9]),['e6','e7','e8','legacy']);
 // A Staff display list can be narrower than the API snapshot (today/device).
 context.transactions=display.filter(r=>r[9]==='e8');assert.deepEqual(Array.from(context.categoryRawRows('expenses'),r=>r.id),['e8']);
});

test('Staff directory ignores older success/failure responses across reloads, identity changes, logout and auth generations',async()=>{
 const vm=require('node:vm'),pending=[];let generation=1;
 const window={SipekaAuth:{generation:()=>generation,api:()=>new Promise((resolve,reject)=>pending.push({resolve,reject}))},SipekaCurrentUser:{role:'STAFF'}};
 vm.runInNewContext(read('device-staff-ui.js'),{window,document:{addEventListener(){}},console});const ui=window.SipekaDeviceStaff;
 const load=(id='device-a')=>ui.load({id,branch_id:id}),row=name=>[{id:name,name,active:true,revision:1}];
 let old=load(),latest=load();pending[1].resolve(row('Latest'));await latest;pending[0].resolve(row('Stale'));await old;
 assert.match(ui.selector(),/Latest/);assert.doesNotMatch(ui.selector(),/Stale/);
 old=load();latest=load('device-b');assert.doesNotMatch(ui.selector(),/Latest/);pending[3].resolve(row('Unit B'));await latest;pending[2].reject(Error('old request failed'));await old;
 assert.match(ui.selector(),/Unit B/);assert.doesNotMatch(ui.selector(),/tidak tersedia/);
 old=load('device-b');ui.reset();pending[4].resolve(row('After logout'));await old;assert.doesNotMatch(ui.selector(),/After logout/);
 old=load('device-b');generation++;pending[5].resolve(row('Old generation'));await old;assert.doesNotMatch(ui.selector(),/Old generation/);
});


test('category register exports exact visible IDs across years while financial report ranges remain bounded',()=>{
 const vm=require('node:vm'),window={},context=vm.createContext({window,console,Intl,Date}),html=read('financial-dashboard.html');
 for(const marker of ['SIPEKA_METRICS_MODULE','SIPEKA_REPORT_MODULE'])vm.runInContext(html.split('<!-- '+marker+' -->')[1].split('</script>')[0].replace(/^\s*<script>/,''),context);
 const rows=[{id:'old',branch_id:'a',created_at:'2024-02-29T05:00:00Z',tx_type:'EXPENSE',status:'APPROVED',amount:100},{id:'new',branch_id:'a',created_at:'2026-10-22T00:00:00Z',tx_type:'EXPENSE',status:'APPROVED',amount:200},{id:'exclude',branch_id:'b',created_at:'2026-10-22T00:00:00Z',tx_type:'INCOME',status:'APPROVED',amount:300}];
 const api=window.SipekaReports;api.setSnapshot({rows,units:[{id:'a',name:'A'},{id:'b',name:'B'}],advanceAvailable:false});const range={branch:'a',dateFrom:'2024-02-29',dateTo:'2026-10-22'};
 assert.throws(()=>api.buildReport('general-ledger',range),/366/);
 const r=api.buildRegister(range,['old','new','exclude']);assert.deepEqual(Array.from(r.rows,x=>x.id),['old','new']);assert.equal(r.sourceCount,2);assert.equal(r.totals.expense,300);assert.equal(r.totals.income,0);assert.equal(r.complete,true);assert.match(api.toCsv(r),/2024-02-29/);assert.equal(api.csvManifest(r).export_row_count,2);
 const empty=api.buildRegister(range,[]);assert.equal(empty.rows.length,0);assert.equal(empty.sourceCount,0);assert.throws(()=>api.buildRegister({...range,dateTo:'2024-02-28'},['old']),/awal/);
});
