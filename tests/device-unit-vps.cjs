'use strict';
// Run only in an isolated VPS QA checkout. Schemas are retained; never production writes.
const fs=require('fs'),cp=require('child_process'),crypto=require('crypto'),assert=require('assert/strict'),net=require('net'),http=require('http');
const schema='device_unit_'+crypto.randomBytes(8).toString('hex'),root=process.cwd();
const sql=s=>cp.execFileSync('sudo',['-n','-u','postgres','psql','-X','-At','-v','ON_ERROR_STOP=1','-d','sipeka'],{input:s,encoding:'utf8'});
(async()=>{
 let setup=`CREATE SCHEMA ${schema};SET search_path=${schema};CREATE TABLE schema_migrations(name text PRIMARY KEY,sha256 text NOT NULL,applied_at timestamptz DEFAULT clock_timestamp());`;
 for(const f of fs.readdirSync('migrations').filter(x=>/^\d+_.*\.sql$/.test(x)).sort()){const s=fs.readFileSync('migrations/'+f,'utf8');setup+=s+`\nINSERT INTO schema_migrations(name,sha256) VALUES('${f}','${crypto.createHash('sha256').update(s).digest('hex')}');`;}
 setup+=`GRANT USAGE ON SCHEMA ${schema} TO sipeka_runtime;GRANT SELECT ON schema_migrations TO sipeka_runtime;`;sql(setup);
 sql(sql(`SELECT format('GRANT %s ON ${schema}.%I TO sipeka_runtime;',privilege_type,table_name) FROM information_schema.table_privileges WHERE table_schema='public' AND grantee='sipeka_runtime' UNION SELECT format('GRANT %s(%I) ON ${schema}.%I TO sipeka_runtime;',privilege_type,column_name,table_name) FROM information_schema.column_privileges WHERE table_schema='public' AND grantee='sipeka_runtime';`));
 const hash=await require('@node-rs/argon2').hash('SampleA');
 sql(`SET search_path=${schema};INSERT INTO business_units(id,code,name,category) VALUES('a','A','Unit A','LAUNDRY'),('b','B','Unit B','LAUNDRY');INSERT INTO app_users(id,username,password_hash,full_name,role,assigned_branch_id) VALUES('owner','qa_owner','${hash}','Owner','OWNER',NULL),('d1','qa_device1','${hash}','Device 1','STAFF','a'),('d2','qa_device2','${hash}','Device 2','STAFF','a'),('d3','qa_device3','${hash}','Device 3','STAFF','b');INSERT INTO chart_of_accounts VALUES('expense','5101','Expense','EXPENSE');INSERT INTO sessions(token,user_id,expired_at,purpose) SELECT 'qa-'||id,id,(clock_timestamp() AT TIME ZONE 'UTC')+interval '2 hours','full' FROM app_users;INSERT INTO ledger_transactions(id,idempotency_key,branch_id,user_id,coa_id,tx_type,amount,payment_method) VALUES('legacy','legacy','a','d1','expense','EXPENSE',1,'BANK_TRANSFER');`);
 const raw=cp.execFileSync('sudo',['-n','cat','/etc/sipeka/runtime.env'],{encoding:'utf8'}),url=new URL(raw.split('\n').find(x=>x.startsWith('DATABASE_URL=')).slice(13).trim().replace(/^['"]|['"]$/g,''));url.searchParams.set('options','-c search_path='+schema);
 const {Pool}=require('pg'),pool=new Pool({connectionString:url.toString()});
 const port=await new Promise(r=>{const s=net.createServer().listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>r(p));});}),base='http://127.0.0.1:'+port;
 const child=cp.spawn(process.execPath,['server.js'],{env:{PATH:process.env.PATH,HOME:root,DATABASE_URL:url.toString(),PORT:String(port),PUBLIC_ORIGIN:base,NODE_ENV:'test',HOST:'127.0.0.1',STORAGE_BACKEND:'filesystem',UPLOADS_DIR:root+'/qa-receipts',SIPEKA_SEED:'0',SIPEKA_WIDYA_ENABLED:'0',PAYROLL_DELIVERY_ENABLED:'0',PAYROLL_ENCRYPTION_KEY:'a'.repeat(64)},stdio:['ignore','ignore','pipe']});let logs='';child.stderr.on('data',x=>logs+=x);
 let browser;const checks=[];
 const check=(label,fn)=>{fn();checks.push(label);};
 async function api(path,{actor='owner',method='GET',body,staff,status=200,origin=base}={}){
  const result=await new Promise((resolve,reject)=>{const req=http.request(base+path,{method,headers:{Host:new URL(base).host,Origin:origin,Cookie:'sipeka_session=qa-'+actor,'Content-Type':'application/json',...(staff?{'X-Operational-Staff':staff.id,'X-Operational-Revision':String(staff.revision)}:{})}},res=>{let data='';res.on('data',x=>data+=x);res.on('end',()=>resolve({status:res.statusCode,text:data,headers:res.headers}));});req.on('error',reject);req.end(body?JSON.stringify(body):undefined);});
  assert.equal(result.status,status,path+': '+result.text);checks.push(method+' '+path+' '+status);return result.text?JSON.parse(result.text):null;
 }
 try{
  for(let i=0;i<100;i++){try{if((await fetch(base+'/api/ready')).ok)break;}catch{}if(child.exitCode!==null)throw Error('STARTUP '+logs);await new Promise(r=>setTimeout(r,100));}
  await api('/api/login',{method:'POST',body:{username:'qa_device1',password:'SampleA'}});
  await api('/api/operational-staff',{method:'POST',actor:'d1',body:{name:'No',branch_id:'a',active:true},status:403});
  const create=(name,branch_id)=>api('/api/operational-staff',{method:'POST',body:{name,branch_id,active:true}});
  await api('/api/operational-staff',{method:'POST',body:{name:'Bad branch',branch_id:'missing',active:true},status:409});
  let alice=await create('Alice','a'),bob=await create('Bob','a'),other=await create('Other','b');
  const list=await api('/api/operational-staff',{actor:'d1'});check('directory branch scope',()=>assert.deepEqual(list.map(x=>x.id).sort(),[alice.id,bob.id].sort()));
  const tx=(key,extra={})=>({idempotency_key:key,amount:100,coa_id:'expense',payment_method:'BANK_TRANSFER',...extra});
  await api('/api/transactions',{actor:'d1',method:'POST',body:tx('missing'),status:403});
  await api('/api/transactions',{actor:'d1',method:'POST',staff:other,body:tx('cross'),status:403});
  await api('/api/transactions',{actor:'d1',method:'POST',staff:alice,body:tx('origin'),origin:'https://evil.example',status:403});
  const a=await api('/api/transactions',{actor:'d1',method:'POST',staff:alice,body:tx('alice1'),status:201});
  await api('/api/transactions',{actor:'d1',method:'POST',staff:alice,body:tx('alice1')});
  await api('/api/transactions',{actor:'d1',method:'POST',staff:bob,body:tx('alice1'),status:409});
  const b=await api('/api/transactions',{actor:'d1',method:'POST',staff:bob,body:tx('bob1'),status:201});
  const d2=await api('/api/transactions',{actor:'d2',method:'POST',staff:alice,body:tx('alice2'),status:201});
  const before=await api('/api/transactions');check('immutable per-operation identity',()=>{assert.equal(before.rows.find(x=>x.id===a.id).staff_name,'Alice');assert.equal(before.rows.find(x=>x.id===b.id).staff_name,'Bob');assert.equal(before.rows.find(x=>x.id===d2.id).device_id,'d2');assert.equal(before.rows.find(x=>x.id==='legacy').attribution,'LEGACY');});
  const oldAlice=alice;alice=await api('/api/operational-staff',{method:'POST',body:{id:alice.id,revision:alice.revision,name:'Alice edited',branch_id:'a',active:false}});
  await api('/api/transactions',{actor:'d1',method:'POST',staff:oldAlice,body:tx('archived'),status:403});
  await api('/api/operational-staff',{method:'POST',body:{id:alice.id,revision:oldAlice.revision,name:'Stale',branch_id:'a',active:true},status:409});
  alice=await api('/api/operational-staff',{method:'POST',body:{id:alice.id,revision:alice.revision,name:'Alice edited',branch_id:'a',active:true}});
  await api('/api/transactions',{actor:'d1',method:'POST',staff:oldAlice,body:tx('stale'),status:403});
  await api('/api/transactions',{actor:'d1',method:'POST',staff:alice,body:tx('current'),status:201});
  const historical=await api('/api/transactions');check('directory edits do not rename history',()=>assert.equal(historical.rows.find(x=>x.id===a.id).staff_name,'Alice'));
  await api('/api/devices/configure',{method:'POST',body:{device_id:'d1',name:'Laundry Device A',branch_id:'a'}});
  await api('/api/devices/configure',{actor:'d1',method:'POST',body:{device_id:'d2',name:'Forbidden',branch_id:'a'},status:403});
  await api('/api/devices/configure',{method:'POST',body:{device_id:'owner',name:'Not a device',branch_id:'a'},status:409});
  await api('/api/units/rename',{method:'POST',body:{branch_id:'b',name:'Unit B renamed'}});
  await api('/api/units/archive',{actor:'d1',method:'POST',body:{branch_id:'b'},status:403});
  check('account ID/password retained',()=>assert.equal(sql(`SELECT password_hash FROM ${schema}.app_users WHERE id='d1'`).trim(),hash));
  const advance=await api('/api/transactions',{actor:'d1',method:'POST',staff:bob,body:tx('advance',{payment_method:'CASH_DRAWER',tx_intent:'PENGAJUAN_DANA',amount:1000}),status:201});
  await api('/api/approvals',{method:'POST',body:{id:advance.id,action:'APPROVED'}});
  await api('/api/advances/'+advance.id+'/disburse',{method:'POST',body:{idempotencyKey:'disburse',evidence:'Cash handed over in QA',confirmed:true}});
  const image=await require('sharp')({create:{width:20,height:20,channels:3,background:'#eeeeee'}}).jpeg().toBuffer();
  const receipt=await api('/api/receipts/upload',{actor:'d1',method:'POST',staff:bob,body:{image:'data:image/jpeg;base64,'+image.toString('base64'),branch_id:'a'},status:201});
  fs.writeFileSync('receipt-response.json',JSON.stringify(receipt));
  const receiptKey=receipt.receipt_key||receipt.key;
  const settled=await api('/api/advances/'+advance.id+'/settlements',{actor:'d1',method:'POST',staff:bob,body:{idempotencyKey:'settle',evidence:'Complete synthetic settlement',lines:[{receiptKey,coaId:'expense',amount:'600'}]}});
  const events=await api('/api/advances');const sub=events.rows.find(x=>x.advanceId===advance.id).events.find(e=>e.action==='SUBMIT');assert.ok(sub);
  await api('/api/advances/'+advance.id+'/settlements/'+sub.id+'/approve',{method:'POST',body:{idempotencyKey:'approve',evidence:'Synthetic receipt approved'}});
  await api('/api/advances/'+advance.id+'/return',{method:'POST',body:{idempotencyKey:'return',evidence:'Physical cash returned QA',amount:'400',confirmed:true}});
  const summary=await api('/api/closing/summary',{actor:'d1'});
  await api('/api/closing',{actor:'d1',method:'POST',staff:bob,body:{idempotency_key:'close',physical_cash:0,reason:'QA physical observation'},status:201});
  const audit=(await pool.query('SELECT entity_type,staff_name FROM operational_attributions')).rows;
  check('all operation kinds attributed',()=>{for(const type of ['ledger_transactions','cash_closings','receipt_assets','approval_logs','advance_events'])assert.ok(audit.some(x=>x.entity_type===type),type);});
  await assert.rejects(pool.query("UPDATE operational_attributions SET staff_name='tamper'"));checks.push('runtime attribution UPDATE denied');
  await assert.rejects(pool.query("INSERT INTO operational_staff(id,branch_id,name) VALUES('bad','a','Bad')"));checks.push('runtime directory direct DML denied');
  for(const path of ['/api/payroll/own-slips','/api/payroll/template','/api/payroll/contacts','/api/payroll/email/bind','/api/payroll/telegram/webhook','/api/payroll/import','/api/payroll/entries/00000000-0000-0000-0000-000000000000/send'])for(const actor of ['owner','d1'])for(const method of ['GET','POST'])await api(path,{actor,method,body:method==='POST'?{}:undefined,status:410});
  check('payroll worker source absent',()=>assert.doesNotMatch(fs.readFileSync('server.js','utf8'),/setInterval\(schedulePayroll|createPayrollDeliveryWorker|queueDelivery\(/));
  const {chromium}=require('playwright-core');browser=await chromium.launch({executablePath:'/home/ubuntu/sipeka-advance-integration/browser-cache/chromium-1243/chrome-linux64/chrome',headless:true,args:['--no-sandbox'],env:{...process.env,LD_LIBRARY_PATH:'/home/ubuntu/sipeka-payroll-manual-qa/runtime/libs/root/usr/lib/x86_64-linux-gnu'}});
  const errors=[];const ctx=await browser.newContext();await ctx.addCookies([{name:'sipeka_session',value:'qa-d2',url:base}]);const page=await ctx.newPage();page.on('pageerror',e=>errors.push(e.message));await page.goto(base);await page.waitForSelector('#loginGate.is-hidden',{state:'attached'});await page.waitForSelector('#onDutyStaff');await page.selectOption('#onDutyStaff',bob.id);assert.equal(await page.locator('#onDutyStaff').inputValue(),bob.id);checks.push('actual browser on-duty dropdown');
  for(const width of [390,768,1440]){await page.setViewportSize({width,height:900});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);checks.push('responsive '+width);}
  assert.equal(await page.locator('[data-view="payslip"]').count(),0);
  const second=await ctx.newPage();await second.goto(base);await second.waitForSelector('#onDutyStaff');assert.equal(await second.locator('#onDutyStaff').inputValue(),'');await second.selectOption('#onDutyStaff',alice.id);assert.equal(await page.locator('#onDutyStaff').inputValue(),bob.id);checks.push('concurrent tabs keep explicit independent Staff');
  const loginContext=await browser.newContext();const login=await loginContext.newPage();await login.goto(base);await login.locator('#loginUsername').fill('qa_device3');await login.locator('#loginPassword').fill('SampleA');await login.locator('#loginForm button[type=submit]').click();await login.waitForSelector('#loginGate.is-hidden',{state:'attached'});await login.waitForSelector('#onDutyStaff');assert.equal(await login.locator('#onDutyStaff').inputValue(),'');assert.equal(await login.locator('#onDutyStaff option').count(),2);checks.push('actual browser password login then scoped Staff selection');
  const oc=await browser.newContext();await oc.addCookies([{name:'sipeka_session',value:'qa-owner',url:base}]);const op=await oc.newPage();op.on('pageerror',e=>errors.push(e.message));await op.goto(base);await op.waitForSelector('#loginGate.is-hidden',{state:'attached'});await op.evaluate(()=>window.__sipekaApplyState('owner','all',{view:'users'}));await op.waitForSelector('[data-staff-edit]');checks.push('Owner directory UI');await op.screenshot({path:'owner-device-directory.png',fullPage:true});
  const form=op.locator('[data-staff-edit=""]');await form.locator('[name="name"]').fill('Browser Staff');await form.locator('button').click();await op.waitForFunction(()=>[...document.querySelectorAll('[data-staff-edit] input')].some(e=>e.value==='Browser Staff'));checks.push('Owner browser create persisted');
  await op.evaluate(()=>window.__sipekaApplyState('owner','all',{view:'settings'}));assert.equal(await op.locator('[data-payroll-self]').count(),0);assert.equal(await op.locator('#settingsPwdForm').count(),1);assert.deepEqual(errors,[]);
  const today=new Date(Date.now()+7*3600000).toISOString().slice(0,10),params='branch_id=a&date_from='+today+'&date_to='+today+'&timezone=Asia%2FJakarta';
  for(const id of ['fund-position','recorded-income-expense','audit-evidence','daily-closings','fund-requests']){
   const report=await api('/api/reports/'+id+'?'+params);
   await api('/api/reports/'+id+'?'+params,{actor:'d2',status:403});
   if(id==='recorded-income-expense'){assert.equal(report.totals.income,null);assert.equal(report.totals.expense,'1001');assert.equal(report.snapshot.outstanding,'0');}
   if(id==='fund-position'){assert.equal(report.endBalance,null);assert.equal(report.rows.find(r=>r.item==='Kas akhir').amount,null);}
   if(id==='audit-evidence')assert.equal(report.rows.find(r=>r.tx_intent==='ADVANCE_APPROVE').staff_name,'Bob');
  }
  const pdfIds=['profit-loss','cash-flow','fund-position','recorded-income-expense','fund-requests','daily-closings','audit-evidence','general-ledger','management-report'];fs.mkdirSync('report-artifacts',{recursive:true});
  for(const id of pdfIds){
   const c=await browser.newContext({acceptDownloads:true});await c.addCookies([{name:'sipeka_session',value:'qa-owner',url:base}]);const p=await c.newPage();await p.goto(base);await p.waitForSelector('#loginGate.is-hidden',{state:'attached'});
   await p.evaluate(({id,today})=>{window.SipekaReports.downloadPdf(id,{branch:'a',dateFrom:today,dateTo:today}).catch(e=>window.exportError=e.message);},{id,today});
   await p.locator('#documentCompany').fill('DEVICE QA COMPANY');await p.locator('#documentBranch').selectOption('a');const download=p.waitForEvent('download');await p.locator('dialog button[type=submit]').click();await (await download).saveAs(root+'/report-artifacts/'+id+'.pdf');checks.push('browser PDF '+id);await c.close();
  }
  for(const id of ['fund-position','recorded-income-expense']){
   const c=await browser.newContext({acceptDownloads:true});await c.addCookies([{name:'sipeka_session',value:'qa-owner',url:base}]);const p=await c.newPage();const downloads=[];p.on('download',d=>downloads.push(d));await p.goto(base);await p.waitForSelector('#loginGate.is-hidden',{state:'attached'});
   await p.evaluate(({id,today})=>{window.SipekaReports.downloadCsv(id,{branch:'a',dateFrom:today,dateTo:today}).catch(e=>window.exportError=e.message);},{id,today});await p.locator('#documentCompany').fill('DEVICE QA COMPANY');await p.locator('dialog button[type=submit]').click();
   for(let i=0;i<50&&downloads.length<2;i++)await new Promise(r=>setTimeout(r,100));assert.equal(downloads.length,2);
   for(const d of downloads)await d.saveAs(root+'/report-artifacts/'+id+(d.suggestedFilename().endsWith('.json')?'.manifest.json':'.csv'));
   const manifest=JSON.parse(fs.readFileSync('report-artifacts/'+id+'.manifest.json'));assert.ok(manifest.coverage);assert.equal(manifest.snapshot.basis,'CURRENT_SNAPSHOT_NOT_PERIOD_END');assert.ok(fs.readFileSync('report-artifacts/'+id+'.csv','utf8').startsWith('\uFEFFitem,amount,status,basis\r\n'));checks.push('CSV + identity/coverage manifest '+id);await c.close();
  }

  const coa=await api('/api/coa',{actor:'d2'});assert.equal(coa.length,23);assert.ok(coa.some(r=>r.id==='7-1100'&&r.account_type==='REVENUE'));assert.ok(!coa.some(r=>r.id==='6-3000'));
  await api('/api/transactions',{method:'POST',actor:'d2',staff:bob,body:{idempotency_key:'missing-coa',amount:10,payment_method:'BANK_TRANSFER'},status:400});
  await api('/api/transactions',{method:'POST',actor:'d2',staff:bob,body:{idempotency_key:'bad-type',amount:10,coa_id:'7-1100',tx_type:'EXPENSE',payment_method:'BANK_TRANSFER'},status:400});
  await api('/api/transactions',{method:'POST',actor:'d2',staff:bob,body:{idempotency_key:'interest',amount:50,coa_id:'7-1100',tx_type:'INCOME',payment_method:'BANK_TRANSFER'},status:201});
  const consolidated=await api('/api/reports/company-profit-loss?'+params.replace('branch_id=a','branch_id=all'));
  const compared=await api('/api/reports/compare-profit-loss?'+params.replace('branch_id=a','branch_id=all'));
  assert.equal(consolidated.rows.at(-1).amount,compared.rows.at(-1).amount);assert.equal(compared.rows.find(r=>r.account_code==='7-1100').amount,'50');
  assert.equal(compared.rows.at(-1).amount,compared.totals.net);checks.push('COA mandatory, type-safe including 7-1100; exact consolidated comparison');
  await api('/api/company',{actor:'d2',method:'POST',body:{name:'Forbidden',revision:0},status:403});
  await api('/api/company',{method:'POST',body:{name:'QA Perusahaan Tunggal',revision:0}});
  await api('/api/company',{method:'POST',body:{name:'Stale',revision:0},status:409});
  await api('/api/employee-payroll',{actor:'d2',status:403});
  bob=await api('/api/operational-staff',{method:'POST',body:{id:bob.id,revision:bob.revision,name:'Bob',branch_id:'a',active:true,department:'Operasional',email:'bob@example.test',email_confirmed:true}});
  assert.equal(bob.department,'Operasional');assert.ok(!(await api('/api/operational-staff',{actor:'d2'})).find(r=>r.id===bob.id).email);
  await api('/api/operational-staff',{method:'POST',body:{name:'Duplicate email',branch_id:'a',active:true,email:'bob@example.test',email_confirmed:true},status:409});
  const header=require('../employee-payroll').HEADER,csv=header+'\r\n2026-10,'+bob.id+',2500000,50000,50000,10000,5000,5000,10000\r\n';
  const imported=await api('/api/employee-payroll/import',{method:'POST',body:{csv},status:201});
  const importedRows=(await api('/api/employee-payroll')).rows,entry=importedRows.find(e=>e.batch_id===imported.id);assert.equal(entry.row.net_salary,2570000);assert.equal(entry.row.company_name,'QA Perusahaan Tunggal');assert.equal(entry.row.employee_id,bob.id);assert.equal(entry.row.department,'Operasional');
  await api('/api/employee-payroll/publish',{method:'POST',body:{id:imported.id,preview_token:entry.preview_token,confirmed:false},status:400});
  await api('/api/employee-payroll/publish',{method:'POST',body:{id:imported.id,preview_token:entry.preview_token,confirmed:true}});
  const attachment=await fetch(base+'/api/employee-payroll/entries/'+entry.id+'/slip.pdf',{headers:{Cookie:'sipeka_session=qa-owner'}});assert.equal(attachment.status,200);const pdf=Buffer.from(await attachment.arrayBuffer());assert.match(pdf.toString('latin1'),/QA Perusahaan Tunggal/);assert.match(pdf.toString('latin1'),/Operasional/);fs.writeFileSync('report-artifacts/employee-slip.pdf',pdf);
  const emp=require('../employee-payroll').service({pool,env:{PAYROLL_ENCRYPTION_KEY:'a'.repeat(64),PAYROLL_EMAIL_FROM:'raditya@widyafa.xyz'},transport:{async sendMail(mail){assert.equal(mail.to,'bob@example.test');assert.equal(mail.attachments.length,1);assert.match(mail.attachments[0].content.toString('latin1'),/QA Perusahaan Tunggal/);emailCalls++;return {accepted:[mail.to],messageId:'fixture-resend-id'};}}});let emailCalls=0;
  const deliveries=await Promise.all(Array.from({length:4},()=>emp.send('qa-owner',entry.id,{email:'bob@example.test',confirmed:true})));assert.equal(emailCalls,1);assert.ok(deliveries.some(r=>r.status==='sent'));
  assert.equal((await emp.send('qa-owner',entry.id,{email:'bob@example.test',confirmed:true})).status,'sent');assert.equal(emailCalls,1);
  const stored=sql(`SELECT payload_cipher FROM ${schema}.payroll_entries WHERE id='${entry.id}'`);assert.ok(!stored.includes('2500000'));checks.push('employee payroll separate from device; encrypted identity snapshot; publish; PDF; exactly one mocked email under concurrent requests');
  const next=await api('/api/employee-payroll/import',{method:'POST',body:{csv:csv.replace('2026-10','2026-11')},status:201});const nextEntry=(await api('/api/employee-payroll')).rows.find(e=>e.batch_id===next.id);await api('/api/employee-payroll/publish',{method:'POST',body:{id:next.id,preview_token:nextEntry.preview_token,confirmed:true}});
  let unknownCalls=0;const uncertain=require('../employee-payroll').service({pool,env:{PAYROLL_ENCRYPTION_KEY:'a'.repeat(64),PAYROLL_EMAIL_FROM:'raditya@widyafa.xyz'},transport:{async sendMail(){unknownCalls++;throw Error('fixture ambiguous provider acceptance');}}});assert.equal((await uncertain.send('qa-owner',nextEntry.id,{email:'bob@example.test',confirmed:true})).status,'uncertain');assert.equal((await uncertain.send('qa-owner',nextEntry.id,{email:'bob@example.test',confirmed:true})).status,'uncertain');assert.equal(unknownCalls,1);
  bob=await api('/api/operational-staff',{method:'POST',body:{id:bob.id,revision:bob.revision,name:'Bob',branch_id:'a',active:true,department:'Administrasi',email:'bob-new@example.test',email_confirmed:true}});await assert.rejects(emp.send('qa-owner',entry.id,{email:'bob@example.test',confirmed:true}),/PAYROLL_CONTACT_CHANGED/);assert.equal(emailCalls,1);const frozen=(await api('/api/employee-payroll')).rows.find(e=>e.id===entry.id);assert.equal(frozen.row.department,'Operasional');assert.equal(frozen.row.email,'bob@example.test');checks.push('uncertain provider never retried; changed contact blocked; historical slip placement immutable');
  await op.evaluate(()=>SipekaAuth.bootstrap(SipekaCurrentUser));await op.evaluate(()=>window.__sipekaApplyState('owner','all',{view:'users'}));await op.waitForSelector('[data-employee-pdf]');assert.match(await op.locator('#employeePayroll').innerText(),/Bob/);assert.match(await op.locator('#employeePayroll').innerText(),/Operasional/);
  await op.screenshot({path:'report-artifacts/company-employees.png',fullPage:true});for(const width of [390,768,1440]){await op.setViewportSize({width,height:950});await op.screenshot({path:'report-artifacts/owner-check-'+width+'.png',fullPage:true});const over=await op.evaluate(()=>[...document.querySelectorAll('body *')].filter(e=>e.getBoundingClientRect().right>innerWidth+1).slice(0,14).map(e=>({tag:e.tagName,id:e.id,cls:typeof e.className==='string'?e.className:'',w:e.getBoundingClientRect().width,right:e.getBoundingClientRect().right})));if(await op.evaluate(()=>document.documentElement.scrollWidth>innerWidth))console.log('OWNER_OVERFLOW',width,JSON.stringify(over));assert.equal(await op.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);await op.screenshot({path:'report-artifacts/company-employees-'+width+'.png',fullPage:true});}checks.push('Owner payroll and employee directory responsive at 390/768/1440');
  await page.evaluate(()=>window.__sipekaApplyState('staff','Unit A',{view:'manual'}));assert.equal(await page.locator('#mnCoa').inputValue(),'');await page.locator('#mnCoa').selectOption('7-1100');assert.match(await page.locator('#mnCoa option:checked').innerText(),/7-1100/);await page.locator('#mnIntent').selectOption('PENGAJUAN_DANA');assert.equal(await page.locator('#mnCoa').inputValue(),'');assert.equal(await page.locator('#mnCoa option[value="7-1100"]').isDisabled(),true);
  for(const id of ['company-profit-loss','compare-profit-loss']){
   const p=await oc.newPage();await p.goto(base);await p.waitForSelector('#loginGate.is-hidden',{state:'attached'});await p.evaluate(({id,today})=>{SipekaReports.downloadPdf(id,{branch:'all',dateFrom:today,dateTo:today}).catch(e=>window.exportError=e.message);},{id,today});await p.waitForSelector('#documentCompany');assert.equal(await p.locator('#documentCompany').inputValue(),'QA Perusahaan Tunggal');assert.equal(await p.locator('#documentBranch').inputValue(),'all');const downloaded=p.waitForEvent('download');await p.locator('dialog button[type=submit]').click();await (await downloaded).saveAs(root+'/report-artifacts/'+id+'.pdf');await p.close();
  }
  const navy=await op.evaluate(()=>{document.documentElement.dataset.theme='light';return getComputedStyle(document.documentElement).getPropertyValue('--green').trim();});assert.equal(navy.toLowerCase(),'#1f3864');checks.push('exact Owner-supplied navy accent');
  for(const id of ['company-profit-loss','compare-profit-loss','fund-position','cash-flow']){
   const doc=await api('/api/reports/'+id+'?'+params);assert.ok(doc.templateLayout);assert.ok(doc.templateLayout.grid[5].includes('Kode'));
   const url=base+'/api/reports/'+id+'/export?'+params+'&format=xlsx&company_name=QA%20Perusahaan%20Tunggal';const response=await fetch(url,{headers:{Cookie:'sipeka_session=qa-owner'}});assert.equal(response.status,200,await response.clone().text());const buffer=Buffer.from(await response.arrayBuffer());assert.equal(buffer.subarray(0,2).toString(),'PK');const files=require('../report-template-xlsx').unzip(buffer);assert.ok(files.find(f=>f.name==='xl/worksheets/sheet1.xml').data.toString().includes('QA Perusahaan Tunggal'));fs.writeFileSync('report-artifacts/'+id+'.xlsx',buffer);assert.equal((await fetch(url,{headers:{Cookie:'sipeka_session=qa-d2'}})).status,403);checks.push('actual source template XLSX + RBAC '+id);
  }
  await op.evaluate(()=>window.__sipekaApplyState('owner','all',{view:'reports'}));await op.waitForSelector('[data-sr-action="xlsx"]');await op.screenshot({path:'report-artifacts/navy-reports.png',fullPage:true});
  assert.deepEqual(errors,[]);checks.push('actual browser master company/department/payroll preview, Staff COA, all-company PDFs');
  fs.writeFileSync('device-proof.json',JSON.stringify({schema,retained:true,checks,passed:checks.length,failed:0,pageErrors:errors,productionWrites:false,providersCalled:false},null,2));console.log(JSON.stringify({schema,passed:checks.length,failed:0}));
 }finally{if(browser)await browser.close();child.kill();await pool.end();fs.writeFileSync('qa-server.log',logs);}
})().catch(e=>{console.error(e);process.exitCode=1;});
