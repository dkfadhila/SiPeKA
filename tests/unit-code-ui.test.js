'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {chromium}=require('playwright-core'),{createServer}=require('./fixtures/management-ui-preview.cjs');
function createBranchSource(){const html=fs.readFileSync(path.join(__dirname,'../public/financial-dashboard.html'),'utf8'),start=html.indexOf('window.SipekaCreateBranch = async function()');let source='';for(const line of html.slice(start).split(/\r?\n/)){source+=line+'\n';try{new vm.Script(source);return source;}catch(e){if(!(e instanceof SyntaxError))throw e;}}throw Error('Create branch source not found');}
test('Owner branch form suggests three letters, accepts edited 2–4 letter code, blocks invalid/reserved/duplicate codes and sends uppercase code',async t=>{
 const server=createServer();await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});t.after(()=>browser.close());
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForSelector('#newUserForm');await page.locator('[data-view=branchesSys]').click();
 await page.evaluate(source=>{window.api=async(p,o)=>{calls.push({p,o});if(window.rejectUnitCode)throw Error('Kode unit sudah digunakan, termasuk cabang arsip.');return {ok:true};};window.bootstrap=async()=>{};eval(source);},createBranchSource());
 const name=page.locator('#nbName'),code=page.locator('#nbCode'),message=page.locator('#nbMsg');
 assert.match(await page.locator('#nbCodeHelp').innerText(),/2–4 huruf/);assert.equal(await code.getAttribute('minlength'),'2');assert.equal(await code.getAttribute('maxlength'),'4');assert.equal(await code.getAttribute('pattern'),'[A-Za-z]{2,4}');assert.equal(await page.locator('.badge-code').innerText(),'QA');
 await name.fill('Laundry Kemang');assert.equal(await code.inputValue(),'LAU');await name.fill('Cafe Pusat');assert.equal(await code.inputValue(),'CAF');
 await code.fill('rd');assert.equal(await code.inputValue(),'RD');await name.fill('RedDoorz');assert.equal(await code.inputValue(),'RD');
 await code.fill('');await name.fill('Laundry Utama');assert.equal(await code.inputValue(),'LAU');await name.fill('AMC');assert.equal(await code.inputValue(),'');await name.fill('RedDoorz');
 for(const value of ['A','ABCDE','RD1','R-D','AMC','QA']){await page.evaluate(value=>{document.querySelector('#nbCode').value=value;return SipekaCreateBranch();},value);assert.match(await message.innerText(),value==='AMC'?/khusus perusahaan/:value==='QA'?/sudah dipakai/:/2–4 huruf/);}
 assert.equal(await page.evaluate(()=>calls.filter(c=>c.p==='/api/units'&&c.o?.method==='POST').length),0);
 // A code held by an archived branch is still rejected by the backend and leaves inputs intact.
 await code.fill('ARCH');await page.evaluate(()=>{window.rejectUnitCode=true;return SipekaCreateBranch();});assert.match(await message.innerText(),/termasuk cabang arsip/);assert.equal(await code.inputValue(),'ARCH');assert.equal(await page.locator('#nbSubmitBtn').isDisabled(),false);
 await code.fill('rd');await page.evaluate(()=>{window.rejectUnitCode=false;return SipekaCreateBranch();});const posted=await page.evaluate(()=>calls.filter(c=>c.p==='/api/units'&&c.o?.method==='POST').at(-1));assert.deepEqual(posted.o.body,{name:'RedDoorz',code:'RD',category:'LAUNDRY'});assert.equal(await name.inputValue(),'');assert.equal(await code.inputValue(),'');
 await name.fill('Kantor Operasional');assert.equal(await code.inputValue(),'KAN');await code.fill('ABCD');await page.evaluate(()=>SipekaCreateBranch());assert.equal((await page.evaluate(()=>calls.filter(c=>c.p==='/api/units'&&c.o?.method==='POST').at(-1))).o.body.code,'ABCD');assert.deepEqual(errors,[]);
});
