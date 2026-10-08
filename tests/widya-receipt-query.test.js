'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {boundedQuery}=require('../widya-receipt-query');
test('database query timeout destroys connection, late rejection observed, retry works',async()=>{
 let released=[],rejectLate;const calls=[];
 const client={query:q=>{calls.push(q);if(calls.length===1)return Promise.resolve({rows:[]});return new Promise((r,j)=>rejectLate=j);},release:e=>released.push(e)};
 const pool={connect:async()=>client};
 await assert.rejects(boundedQuery(pool,'SELECT pg_sleep(10)',[],{timeoutMs:20}),{code:'WIDYA_RECEIPT_TIMEOUT'});
 assert.equal(released.length,1);assert.equal(released[0],true);assert.match(calls[0].text,/statement_timeout/);assert.equal(calls[1].query_timeout,20);rejectLate(Error('late PG error'));
 const next={query:async()=>({rows:[{ok:1}]}),release:e=>released.push(e)};pool.connect=async()=>next;
 assert.equal((await boundedQuery(pool,'SELECT 1',[],{timeoutMs:20})).rows[0].ok,1);
});
test('late database connection acquisition is released, not queried',async()=>{
 let resolve,queries=0,released=0;const pool={connect:()=>new Promise(r=>resolve=r)};
 await assert.rejects(boundedQuery(pool,'SELECT 1',[],{timeoutMs:20}),{code:'WIDYA_RECEIPT_TIMEOUT'});
 resolve({query:()=>queries++,release:()=>released++});await new Promise(r=>setTimeout(r,10));assert.equal(queries,0);assert.equal(released,1);
});
