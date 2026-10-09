'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{chromium}=require('playwright-core');
const base=process.env.ACCOUNTING_HTTP_ORIGIN||'http://127.0.0.1:4437';
test('actual browser Owner draft review approve and movement-only UI; Staff deny',async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});const errors=[];
 const context=await browser.newContext({viewport:{width:1440,height:1000}});await context.addCookies([{name:'sipeka_session',value:'owner-token',url:base,httpOnly:true,sameSite:'Strict'}]);const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));
 try{await page.goto(base);await page.waitForSelector('#loginGate.is-hidden',{state:'attached'});
 await page.locator('#nav [data-view="accounting"]').click();await page.waitForSelector('#accountingDraft');
 assert.match(await page.locator('#content').innerText(),/Laporan ini menampilkan mutasi tercatat, bukan neraca lengkap/);
 const f=page.locator('#accountingDraft');await f.locator('[name="sourceId"]').fill('tx');await f.locator('[name="fundId"]').fill('drawer');await f.locator('[name="accountingDate"]').fill('2026-10-08');await f.locator('[name="evidence"]').fill('Owner reviewed earned service named drawer evidence');await f.locator('button[type="submit"]').click();
 await page.waitForSelector('#accountingApprove');assert.match(await page.locator('#accountingReview').innerText(),/9007199254740991/);
 assert.equal(await page.locator('#accountingApprove').isDisabled(),true);
 const before=await page.evaluate(async()=>await(await fetch('/api/accounting/trial-balance?start=2026-10-01&end=2026-10-31')).json());assert.equal(before.totalDebit,'0');
 await page.locator('#accountingConsent').check();await page.locator('#accountingApprove').click();await page.waitForFunction(()=>document.querySelector('#accountingStatus')?.textContent.includes('Diposting'));
 const report=page.locator('#accountingTrial');await report.locator('[name="start"]').fill('2026-10-01');await report.locator('[name="end"]').fill('2026-10-31');await report.locator('[type="submit"]').click();await page.waitForFunction(()=>document.querySelector('#accountingResult')?.textContent.includes('9007199254740991'));assert.match(await page.locator('#accountingResult').innerText(),/Laporan ini menampilkan mutasi tercatat, bukan neraca lengkap/);
 await page.setViewportSize({width:360,height:1000});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);await page.setViewportSize({width:1440,height:1000});
 await page.locator('#logoutBtn').click();await page.waitForSelector('#loginGate:not(.is-hidden)');assert.equal(await page.evaluate(async()=>(await fetch('/api/accounting/trial-balance?start=2026-10-01&end=2026-10-31')).status),401);
 const staff=await browser.newContext();await staff.addCookies([{name:'sipeka_session',value:'staff-token',url:base,httpOnly:true,sameSite:'Strict'}]);const sp=await staff.newPage();await sp.goto(base);await sp.waitForSelector('#loginGate.is-hidden',{state:'attached'});assert.equal(await sp.locator('#nav [data-view="accounting"]').count(),0);assert.equal(await sp.evaluate(async()=>(await fetch('/api/accounting/trial-balance?start=2026-10-01&end=2026-10-31')).status),403);
 assert.deepEqual(errors,[]);console.log(JSON.stringify({actualPG:true,ownerReviewNoPosting:true,explicitApproval:true,exactIDR:'9007199254740991',staffDenied:true,logout:true,pageErrors:errors}));
 }finally{await browser.close();}
});
