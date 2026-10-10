'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),net=require('node:net'),path=require('node:path'),{spawn}=require('node:child_process');
const runtime=process.env.REPORTS_TEST_PGLITE;
test('current server PostgreSQL/WASM cookie reports, read-only snapshot, exact money, all CSV, RBAC and failures',{skip:!runtime,timeout:120000},async t=>{
 const port=await new Promise(r=>{const s=net.createServer().listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>r(p));});}),base='http://127.0.0.1:'+port;
 const child=spawn(process.execPath,[path.join(__dirname,'fixtures/operational-reports-pglite.cjs')],{cwd:path.resolve(__dirname,'..'),env:{...process.env,TZ:'UTC',DATABASE_URL:'postgresql://fixture-only-invalid/no-network',PORT:String(port),PUBLIC_ORIGIN:base,NODE_ENV:'test',REQUIRE_OWNER_2FA:'0',ALLOW_PRIVATE_QA_BEARER:'0',PAYROLL_DELIVERY_ENABLED:'0',SIPEKA_WIDYA_ENABLED:'0',REPORTS_TEST_PGLITE:runtime}});
 let logs='';child.stdout.on('data',x=>logs+=x);child.stderr.on('data',x=>logs+=x);
 t.after(async()=>{if(child.exitCode===null){child.kill();await new Promise(r=>child.once('exit',r));}await assert.rejects(fetch(base+'/api/health'));});
 let ready=false;for(let i=0;i<400;i++){if(child.exitCode!==null)throw Error(logs);try{if((await fetch(base+'/api/health')).ok){ready=true;break;}}catch{}await new Promise(r=>setTimeout(r,50));}assert.ok(ready,logs);
 const query='?branch_id=a&date_from=2026-10-01&date_to=2026-10-01&timezone=Asia%2FJakarta';
 const api=(route,user='owner')=>fetch(base+route,{headers:{Cookie:'sipeka_session=fixture-'+user,Origin:base}});
 const ids=['profit-loss','cash-flow','fund-requests','daily-closings','audit-evidence'];
 const envelopes={};
 for(const id of ids){
  const route='/api/reports/'+id;
  assert.equal((await fetch(base+route+query)).status,401);
  const denied=await api(route+query,'staff');assert.equal(denied.status,403,await denied.text()+'\n'+logs);
  assert.equal((await api(route+'/export'+query+'&format=csv','staff')).status,403);
  const response=await api(route+query);assert.equal(response.status,200,await response.clone().text());assert.match(response.headers.get('cache-control'),/no-store/);
  const r=envelopes[id]=await response.json();assert.equal(r.complete,true);assert.equal(r.neracaComplete,false);assert.equal(r.reconciliationComplete,false);assert.equal(r.endBalance,null);assert.equal(r.filters.branch,'a');
  const exported=await api(route+'/export'+query+'&format=csv');assert.equal(exported.status,200);assert.match(exported.headers.get('content-disposition'),/attachment/);const bytes=Buffer.from(await exported.arrayBuffer());assert.deepEqual([...bytes.subarray(0,3)],[239,187,191]);assert.ok(bytes.toString().endsWith('\r\n'));
 }
 assert.equal(envelopes['profit-loss'].totals.expense,String(9007199254730000n+700n));assert.equal(envelopes['profit-loss'].totals.income,'500');assert.equal(envelopes['profit-loss'].rows.find(x=>x.account_code==='5-101').expense,String(9007199254730000n+700n));
 assert.equal(envelopes['cash-flow'].totals.expense,String(9007199254730000n+1000n));assert.equal(envelopes['cash-flow'].totals.income,'800');
 assert.deepEqual(envelopes['fund-requests'].rows,[]);assert.equal(envelopes['fund-requests'].totals,null); // Request day differs from event day.
 const requests=await (await api('/api/reports/fund-requests'+query.replace('date_from=2026-10-01','date_from=2026-09-29'))).json();assert.equal(requests.rows[0].id,'advance');assert.equal(requests.rows[0].amount,'1000');assert.equal(requests.totals,null);
 assert.equal(envelopes['daily-closings'].rows[0].system_balance,'-100');assert.equal(envelopes['daily-closings'].totals,null);
 assert.equal(envelopes['audit-evidence'].rows.find(x=>x.id==='approve:settlement.jpeg').receipt_registered,true);assert.equal(envelopes['audit-evidence'].rows.find(x=>x.id==='ordinary').receipt_registered,true);assert.ok(envelopes['audit-evidence'].rows.every(x=>x.file_verified===null));
 const audit=await (await api('/api/reports/audit-evidence/export'+query+'&format=csv')).text();assert.match(audit,/'=formula/);
 const empty=await (await api('/api/reports/profit-loss'+query.replace('branch_id=a','branch_id=old'))).json();assert.equal(empty.readiness,'empty');assert.equal(empty.totals.expense,'0');
 assert.equal((await api('/api/reports/profit-loss'+query.replace('branch_id=a','branch_id=missing'))).status,404);
 assert.equal((await api('/api/reports/profit-loss'+query+'&user_id=staff')).status,400);
 assert.equal((await api('/api/reports/profit-loss/export'+query+'&format=pdf')).status,400);
 // Actual SECURITY DEFINER snapshot and its own Owner gate, not injected lifecycle JSON.
 assert.equal((await api('/api/advances','staff')).status,403);
 const snapshot=await (await api('/api/advances')).json();assert.equal(snapshot.rows[0].events.find(x=>x.action==='APPROVE').lines[0].receiptKey,'settlement.jpeg');
 if(process.env.REPORTS_TEST_PLAYWRIGHT){
  const fs=require('node:fs'),{chromium}=require(process.env.REPORTS_TEST_PLAYWRIGHT);const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  try{const context=await browser.newContext({acceptDownloads:true});await context.addCookies([{name:'sipeka_session',value:'fixture-owner',url:base}]);await context.route('**/*',r=>new URL(r.request().url()).origin===base?r.continue():r.abort());const page=await context.newPage();const errors=[],responses=[];page.on('response',r=>{if(r.url().includes('/api/'))responses.push([r.status(),r.url()]);});page.on('pageerror',e=>errors.push(e.message));await page.goto(base);await page.waitForSelector('#loginGate.is-hidden',{state:'attached',timeout:10000}).catch(async e=>{throw Error(e.message+'\n'+JSON.stringify({errors,responses})+'\n'+await page.locator('body').innerText()+'\n'+logs);});await page.locator('[data-view="reports"]').first().click();
   await page.locator('[data-sr-filter] select[name="branch"]').selectOption('a');await page.locator('[data-sr-filter] input[name="dateFrom"]').fill('2026-10-01');await page.locator('[data-sr-filter] input[name="dateTo"]').fill('2026-10-01');await page.locator('[data-sr-filter] button[type="submit"]').click();
   for(const id of ids){await page.evaluate(async id=>{await SipekaReports.loadOperational(id);document.getElementById('content').innerHTML=SipekaReports.render(id==='audit-evidence'?'export':'reports');SipekaReports.bind(document.getElementById('content'));},id);await page.locator('[data-sr-id="'+id+'"][data-sr-action="preview"]').click();for(const format of ['csv','pdf']){const pending=page.waitForEvent('download');await page.locator('[data-sr-id="'+id+'"][data-sr-action="'+format+'"]').click();const download=await pending;const file=path.join(process.env.REPORTS_TEST_ARTIFACTS,id+'.'+format);await download.saveAs(file);assert.ok(fs.statSync(file).size>0);if(format==='pdf')assert.equal(fs.readFileSync(file).subarray(0,4).toString(),'%PDF');}}
   assert.deepEqual(errors,[]);
  }finally{await browser.close();}
 }
 console.log('PROOF: exact current server + db-postgres + migrations + advance_read; PostgreSQL/WASM fixture runtime role; five Owner cookie sources/CSV; Staff denied; no network DB/providers.');
});
