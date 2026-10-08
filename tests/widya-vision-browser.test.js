'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{chromium}=require('playwright-core');
test('real Chrome actual scan handler: review required; failed vision preserves inputs; stale identity denies apply',async t=>{
 const html=fs.readFileSync(require.resolve('../public/financial-dashboard.html'),'utf8');const a=html.indexOf('async function processReceipt(file)'),b=html.indexOf("    document.addEventListener('click',e=>{",a),handler=html.slice(a,b);
 const browser=await chromium.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});t.after(()=>browser.close());const page=await browser.newPage();
 await page.setContent('<div id="scanPreviewWrap"><img id="scanPreview"></div><div id="scanLoading"></div><div id="scanStatus2"></div><div id="scanConf"></div><input id="scAmount" value="123"><input id="scDate" value="2026-01-01"><input id="scMemo" value="Existing"><input id="scMethod" value="QRIS"><input id="scCoa" value="5400">');
 await page.evaluate(handler=>{
  window.identity=1;window.mode='ok';window.requests=[];let upload=0;const receipts={begin:()=>({number:++upload,identity:window.identity}),current:(_,u)=>u.number===upload&&u.identity===window.identity,preview:()=>{},safeReceipt:v=>/^\/api\/receipts\/evidence-[0-9]+-[a-f0-9]{6}\.png$/.test(v||'')?v:null};
  const toDataUrl=async()=> 'data:image/png;base64,aGVsbG8=',formBranch=()=> 'b',toast=()=>{},integer=v=>/^[1-9]\d*$/.test(String(v))?Number(v):null;
  window.SipekaAuth={api:async(path,request)=>{window.requests.push({path,body:request.body});if(path==='/api/receipts/upload')return {receipt_key:'/api/receipts/evidence-123-abcdef.png'};if(window.mode==='fail')throw Error('vision unavailable');return {receipt_key:'/api/receipts/evidence-123-abcdef.png',suggestions:{amount:'77500',date:'2026-10-08',merchant:'TOKO UJI WIDYA'},text:'<script>doNotExecute()</script>',requiresHumanReview:true};}};
  eval(handler+'\nwindow.testProcessReceipt=processReceipt;');
 },handler);
 const scan=()=>page.evaluate(()=>window.testProcessReceipt(new File(['synthetic'],'test.png',{type:'image/png'})));
 await scan();assert.equal(await page.locator('#scAmount').inputValue(),'123');const apply=page.locator('#widyaReceiptReview button'),check=page.locator('#widyaReceiptReview input');assert.equal(await apply.isDisabled(),true);await check.check();await apply.click();assert.equal(await page.locator('#scAmount').inputValue(),'77500');assert.equal(await page.locator('#scMethod').inputValue(),'QRIS');assert.equal(await page.locator('#scCoa').inputValue(),'5400');
 await page.evaluate(()=>{window.mode='fail';document.getElementById('scAmount').value='4321';});await scan();assert.equal(await page.locator('#scAmount').inputValue(),'4321');assert.equal(await page.evaluate(()=>window.__lastReceiptKey),'/api/receipts/evidence-123-abcdef.png');
 await page.evaluate(()=>{window.mode='ok';});await scan();await check.check();await page.evaluate(()=>window.identity++);await apply.click();assert.equal(await page.locator('#scAmount').inputValue(),'4321');
 const calls=await page.evaluate(()=>window.requests);assert.ok(calls.every(c=>['/api/receipts/upload','/api/receipts/analyze'].includes(c.path)));assert.ok(calls.filter(c=>c.path.endsWith('/analyze')).every(c=>Object.keys(c.body).join()==='receipt_key'));console.log('Chrome actual scan handler PASS; API fixtures, not PostgreSQL auth acceptance');
});
