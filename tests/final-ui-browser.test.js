'use strict';
// Isolated read-only API fixtures. Serves the exact production HTML/inline scripts.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const {chromium}=require('playwright-core');
const html=path.join(__dirname,'../public/financial-dashboard.html');
const user={id:'owner',role:'OWNER',full_name:'Fixture Owner',session_purpose:'full'};
const units=[{id:'a',name:'Laundry A',code:'A'},{id:'b',name:'Laundry B',code:'B'},{id:'c',name:'Empty',code:'C'}];
const row=(id,extra={})=>({id,branch_id:'a',branch_name:'Laundry A',user_id:'staff',created_at:'2026-01-01T17:00:00Z',status:'APPROVED',payment_method:'CASH_DRAWER',tx_type:'INCOME',tx_intent:'SETOR_NOTA',amount:1250000,account_code:'4101',account_name:'Income',memo:id,...extra});
const rows=[row('boundary'),row('pending',{status:'PENDING_APPROVAL',payment_method:'QRIS'}),row('rejected',{status:'REJECTED',payment_method:'BANK_TRANSFER'}),row('old',{created_at:'2025-12-31T16:59:59Z'}),row('next',{created_at:'2026-01-02T17:00:00Z'}),row('other-branch',{branch_id:'b',branch_name:'Laundry B'}),row('other-user',{user_id:'other'}),row('invalid',{created_at:'invalid'})];
let server,browser,page,base;const errors=[],writes=[];
test.before(async()=>{
 server=http.createServer((req,res)=>{const p=req.url.split('?')[0];if(req.method!=='GET')writes.push(req.method+' '+p);res.setHeader('Content-Type',p.startsWith('/api/')?'application/json':'text/html');const data=p==='/api/me'?user:p==='/api/units'?units:p==='/api/transactions'?{rows}:p==='/api/closing/summary'?{system_balance:0,closings:[]}:[];res.end(p==='/'?fs.readFileSync(html):p.startsWith('/api/')?JSON.stringify(data):'');});await new Promise(r=>server.listen(0,'127.0.0.1',r));base='http://127.0.0.1:'+server.address().port;
 browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});page=await browser.newPage({viewport:{width:1440,height:1000},acceptDownloads:true});page.on('pageerror',e=>errors.push(e.message));await page.goto(base);await page.waitForSelector('#loginGate.is-hidden',{state:'attached'});
});
test.after(async()=>{if(browser)await browser.close();if(server)await new Promise(r=>server.close(r));});
const apply=async(view,branch='Laundry A')=>page.evaluate(({view,branch})=>__sipekaApplyState('owner',branch,{view}),{view,branch});
const ids=()=>page.locator('#content tr[data-transaction]').evaluateAll(es=>es.map(e=>e.querySelector('[data-label="Transaction"]').textContent));
async function filter(values){const f=page.locator('[data-ledger-filter]');for(const [name,value] of Object.entries(values)){const e=f.locator('[name="'+name+'"]');if(['status','payment'].includes(name))await e.selectOption(value);else await e.fill(value);}await f.locator('[type="submit"]').click();}
test('Transactions / Single Ledger use raw WIB date/status/payment filters and identical CSV',async()=>{
 for(const view of ['transactions','ledger']){
  await apply(view);if(!await page.locator('[data-ledger-filter]').isVisible())await page.locator('[data-ledger-filter-toggle]').click();assert.equal(await page.locator('[data-ledger-filter]').isVisible(),true);
  await filter({dateFrom:'2026-01-02',dateTo:'2026-01-02',status:'APPROVED',payment:'CASH_DRAWER'});assert.deepEqual(await ids(),['boundary','other-user']);
  const downloaded=page.waitForEvent('download');await page.locator('#content [data-download]').click();const d=await downloaded;const csv=fs.readFileSync(await d.path(),'utf8');assert.match(csv,/boundary/);assert.match(csv,/1250000/);assert.match(csv,/other-user/);for(const id of ['pending','rejected','old','next','other-branch','invalid'])assert.ok(!csv.includes(id),id+' excluded from CSV');
  await filter({status:'PENDING_APPROVAL',payment:'QRIS'});assert.deepEqual(await ids(),['pending']);await page.locator('#content [data-transaction]').click();assert.match(await page.locator('#drawerBody').innerText(),/pending/);await page.locator('#drawer [data-close]').click();
  await filter({status:'REJECTED',payment:'BANK_TRANSFER'});assert.deepEqual(await ids(),['rejected']);
  await filter({dateFrom:'2026-01-03',dateTo:'2026-01-01'});assert.match(await page.locator('[data-ledger-filter-status]').innerText(),/awal/);assert.deepEqual(await ids(),['rejected']);
  await page.locator('[data-ledger-filter-reset]').click();assert.equal((await ids()).length,6);
  await apply(view,'all');assert.equal((await ids()).length,7);await apply(view,'Laundry B');assert.deepEqual(await ids(),['other-branch']);
  await apply(view,'Empty');assert.deepEqual(await ids(),[]);await filter({dateFrom:'2030-01-01',dateTo:'',status:'all',payment:'all'});const emptyDownload=page.waitForEvent('download');await page.locator('#content [data-download]').click();assert.equal(fs.readFileSync(await (await emptyDownload).path(),'utf8').trim().split(/\r?\n/).length,1);await page.locator('[data-ledger-filter-reset]').click();
 }
 assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);
});
test('existing real-data browser fixture regression',async()=>{await page.addScriptTag({path:path.join(__dirname,'frontend-real-data-browser.js')});const result=await page.evaluate(()=>runFrontendRealDataBrowserFixture());assert.ok(result.results.every(r=>r.pass));console.log('Existing browser fixture:',result.results.length,'checks passed');});
test('accepted desktop/mobile geometry remains within viewport',async()=>{
 for(const width of [1440,360]){await page.setViewportSize({width,height:1000});for(const view of ['dashboard','calendar','budget','ledger']){await apply(view);const geometry=await page.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth}));assert.ok(geometry.scroll<=geometry.width,view+' '+JSON.stringify(geometry));}}await page.setViewportSize({width:1440,height:1000});
});
test('Deferred controls disabled with visible truthful reasons; calendar submit cannot create notes',async()=>{
 for(const [view,text,reason] of [['calendar','Tambah catatan','Belum tersedia'],['dashboard','Ingatkan','Telegram/email belum dikonfigurasi'],['budget','Revise budget','dataset belum tersedia']]){
  await apply(view);const button=page.getByRole('button',{name:text,exact:true});assert.equal(await button.isDisabled(),true);assert.match(await page.locator('#content').innerText(),new RegExp(reason));await button.evaluate(b=>b.click());
  if(view==='calendar'){assert.equal(await page.locator('#calendarNote').isDisabled(),true);await page.locator('#calendarNoteForm').evaluate(f=>f.dispatchEvent(new Event('submit',{bubbles:true,cancelable:true})));assert.equal(await page.locator('.note-item').count(),0);}
 }
 assert.deepEqual(errors,[]);assert.deepEqual(writes,[]);
});
