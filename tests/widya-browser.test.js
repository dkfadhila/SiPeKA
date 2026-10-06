'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs');
const {chromium}=require('playwright-core');
test('Widya browser escapes replies, cancels pending requests, clears logout boundaries',async()=>{
 let hold=false,payload;
 const server=http.createServer(async(req,res)=>{const p=req.url.split('?')[0];res.setHeader('Content-Type',p.startsWith('/api/')?'application/json':'text/html');let raw='';for await(const c of req)raw+=c;
 if(p==='/api/widya'){payload=JSON.parse(raw);if(hold)return;res.end(JSON.stringify({reply:'<img src=x onerror="window.chatInjected=true"> actual response'}));return;}
 const data=p==='/api/me'?{id:'owner-fixture',role:'OWNER',full_name:'Owner Fixture',session_purpose:'full'}:p==='/api/transactions'?{rows:[]}:p==='/api/widya/status'?{connected:true,profile:'widya'}:[];
 res.end(p==='/'?fs.readFileSync(require('node:path').join(__dirname,'../public/financial-dashboard.html')):JSON.stringify(data));});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
 try{const page=await browser.newPage();await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForSelector('#loginGate.is-hidden',{state:'attached'});
 await page.evaluate(()=>__sipekaApplyState('owner','all',{view:'dewi'}));
 await page.locator('#dewiInput').fill('read only');await page.locator('#dewiForm').evaluate(f=>f.requestSubmit());
 await page.waitForFunction(()=>document.getElementById('conversation').textContent.includes('actual response'));
 assert.equal(await page.evaluate(()=>!!window.chatInjected),false);assert.equal(await page.locator('#conversation img').count(),0);assert.equal(payload.message,'read only');assert.equal(payload.messages,undefined);
 hold=true;await page.locator('#dewiInput').fill('slow read only');await page.locator('#dewiForm').evaluate(f=>f.requestSubmit());await page.getByRole('button',{name:'Batalkan',exact:true}).click();await page.waitForFunction(()=>document.getElementById('conversation').textContent.includes('Permintaan dibatalkan'));
 await page.evaluate(()=>doLogout());assert.equal(await page.locator('#conversation').count(),0);assert.equal(await page.locator('#miniConversation').innerText(),'');assert.equal(await page.locator('#loginGate').isVisible(),true);
 }finally{await browser.close();server.closeAllConnections();await new Promise(r=>server.close(r));}
});
