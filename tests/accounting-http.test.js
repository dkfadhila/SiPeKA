'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const base=process.env.ACCOUNTING_HTTP_ORIGIN||'http://127.0.0.1:4437';
const owner='owner-token',staff='staff-token';
async function call(path,{token=owner,method='GET',body,origin=base}={}){const r=await fetch(base+path,{method,headers:{...(token?{cookie:'sipeka_session='+token}:{}),...(method==='POST'?{origin,'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return{status:r.status,data:await r.json()};}
test('accounting HTTP cookie gates review separate approval exact movements reversal',async()=>{
 const path='/api/accounting/trial-balance?start=2026-10-01&end=2026-10-31';
 assert.equal((await call(path,{token:null})).status,401);
 assert.equal((await call(path,{token:staff})).status,403);
 assert.equal((await call(path+'&branchId=absent')).status,404);
 const draft={sourceType:'CASH_TRANSACTION',sourceId:'tx',fundId:'drawer',accountingDate:'2026-10-08',idempotencyKey:'http-first',evidence:'Owner reviewed earned service drawer evidence'};
 assert.equal((await call('/api/accounting/review',{method:'POST',body:draft,origin:'https://evil.invalid'})).status,403);
 assert.equal((await call('/api/accounting/review',{method:'POST',body:{...draft,actor_id:'staff'}})).status,400);
 assert.equal((await call('/api/accounting/approve',{method:'POST',body:draft})).status,400);
 for(const [change,error] of [[{fundId:'missing'},'NAMED_FUND_REQUIRED'],[{sourceId:'qris',fundId:'wrong-qris'},'QRIS_CLEARING_REQUIRED'],[{accountingDate:'2026-09-30'},'ACCOUNTING_PERIOD_LOCKED']]){const denied=await call('/api/accounting/review',{method:'POST',body:{...draft,...change}});assert.equal(denied.status,error==='ACCOUNTING_PERIOD_LOCKED'?409:400);assert.equal(denied.data.error,error);}
 const before=await call(path);assert.equal(before.status,200);assert.equal(before.data.totalDebit,'0');
 const review=await call('/api/accounting/review',{method:'POST',body:draft});assert.equal(review.status,200);assert.equal(review.data.source.amount,'9007199254740991');
 assert.equal((await call(path)).data.totalDebit,'0');
 assert.equal((await call('/api/accounting/review',{method:'POST',token:staff,body:draft})).status,403);
 assert.equal((await call('/api/accounting/approve',{method:'POST',token:staff,body:{reviewToken:review.data.reviewToken,approved:true}})).status,403);
 assert.equal((await call('/api/accounting/approve',{method:'POST',body:{reviewToken:review.data.reviewToken+'x',approved:true}})).status,400);
 assert.equal((await call('/api/accounting/approve',{method:'POST',body:{reviewToken:review.data.reviewToken,approved:false}})).status,400);
 assert.equal((await call('/api/accounting/approve',{method:'POST',origin:'https://evil.invalid',body:{reviewToken:review.data.reviewToken,approved:true}})).status,403);
 assert.equal((await call(path+'&start=invalid')).status,200); // first start remains authoritative
 assert.equal((await call('/api/accounting/trial-balance?start=2026-02-30&end=2026-10-31')).status,400);
 const approved=await call('/api/accounting/approve',{method:'POST',body:{reviewToken:review.data.reviewToken,approved:true}});assert.equal(approved.status,200);assert.ok(approved.data.id);
 const retry=await call('/api/accounting/approve',{method:'POST',body:{reviewToken:review.data.reviewToken,approved:true}});assert.equal(retry.data.id,approved.data.id);
 const tb=await call(path);assert.equal(tb.data.totalDebit,'9007199254740991');assert.equal(tb.data.totalCredit,tb.data.totalDebit);assert.equal(tb.data.openingBalances,'MISSING');assert.equal(tb.data.neracaComplete,false);
 const reverse=await call('/api/accounting/review',{method:'POST',body:{sourceType:'REVERSAL',sourceId:approved.data.id,accountingDate:'2026-10-09',idempotencyKey:'http-reversal',evidence:'Owner explicit correction evidence'}});assert.equal(reverse.status,200);
 assert.equal((await call('/api/accounting/approve',{method:'POST',body:{reviewToken:reverse.data.reviewToken,approved:true}})).status,200);
 const final=await call(path);assert.ok(final.data.rows.every(r=>r.netMovement==='0'));
 assert.equal((await call('/api/logout',{method:'POST',body:{}})).status,200);assert.equal((await call(path)).status,401);
});
