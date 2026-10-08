'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),sharp=require('sharp'),http=require('node:http');
const {createWidyaReceiptAnalysis,createWidyaReceiptRouter}=require('../widya-receipt-analysis');
const actor={id:'staff',role:'STAFF',assigned_branch_id:'b'},receiptKey='/api/receipts/evidence-123-abcdef.png';
const asset={filename:'evidence-123-abcdef.png',mime:'image/png',user_id:'staff',branch_id:'b'};
const output={output:JSON.stringify({text:'TOKO\n2026-10-08\nTOTAL Rp 77.500',amountIDR:77500,date:'2026-10-08',merchant:'TOKO',ambiguous:false}),runtime:{provider:'custom',model:'test'},imageTransport:{imageParts:1,toolCount:0}};
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
test('never-resolving metadata times out, releases busy, retry succeeds; late rejection handled',async()=>{
 let first=true,rejectLate,seen;
 const bytes=await sharp({create:{width:2,height:2,channels:3,background:'white'}}).png().toBuffer();
 const service=createWidyaReceiptAnalysis({timeoutMs:25,lookupReceipt:(f,options)=>{seen=options?.signal;if(first){first=false;return new Promise((r,j)=>rejectLate=j);}return asset;},readReceipt:async()=>bytes,bridge:{analyzeReceipt:async()=>output}});
 const result=await Promise.race([service.extract({actor,receiptKey}).catch(e=>e.code),sleep(150).then(()=> 'STUCK')]);assert.equal(result,'WIDYA_RECEIPT_TIMEOUT');assert.equal(seen.aborted,true);
 assert.equal((await service.extract({actor,receiptKey})).suggestions.amount,'77500');rejectLate(Error('late'));await sleep(10);
});
test('late-resolving metadata cannot start inference after timeout',async()=>{
 let resolve,calls=0;const service=createWidyaReceiptAnalysis({timeoutMs:20,lookupReceipt:()=>new Promise(r=>resolve=r),readReceipt:async()=>{calls++;return Buffer.alloc(1);},bridge:{analyzeReceipt:async()=>{calls++;return output;}}});
 assert.equal(await Promise.race([service.extract({actor,receiptKey}).catch(e=>e.code),sleep(150).then(()=> 'STUCK')]),'WIDYA_RECEIPT_TIMEOUT');resolve(asset);await sleep(10);assert.equal(calls,0);
});
test('abandoned inference cannot overlap, releases reservation only on settlement',async()=>{
 const bytes=await sharp({create:{width:2,height:2,channels:3,background:'white'}}).png().toBuffer();let rejectLate,calls=0;
 const service=createWidyaReceiptAnalysis({timeoutMs:25,lookupReceipt:async()=>asset,readReceipt:async()=>bytes,bridge:{analyzeReceipt:()=>{calls++;if(calls===1)return new Promise((r,j)=>rejectLate=j);return output;}}});
 assert.equal(await Promise.race([service.extract({actor,receiptKey}).catch(e=>e.code),sleep(150).then(()=> 'STUCK')]),'WIDYA_RECEIPT_TIMEOUT');
 await assert.rejects(service.extract({actor,receiptKey}),{code:'WIDYA_RECEIPT_BUSY'});assert.equal(calls,1);rejectLate(Error('late inference'));await sleep(10);assert.equal((await service.extract({actor,receiptKey})).suggestions.amount,'77500');
});
test('final authorization and final metadata share end-to-end deadline',async t=>{
 for(const stage of ['auth','metadata']){
 let authCalls=0,metaCalls=0;
 const router=createWidyaReceiptRouter({timeoutMs:30,authenticate:async()=>{if(++authCalls===2&&stage==='auth')return new Promise(()=>{});return actor;},checkRequest:async()=>true,lookupReceipt:async()=>{if(++metaCalls===1&&stage==='metadata')return new Promise(()=>{});return asset;},service:{extract:async()=>{await sleep(15);return output;}}});
 const server=http.createServer(async(req,res)=>{await router(req,res);});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 try{const response=await fetch('http://127.0.0.1:'+server.address().port+'/api/receipts/analyze',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({receipt_key:receiptKey}),signal:AbortSignal.timeout(250)});assert.equal(response.status,504);assert.equal((await response.json()).error,'WIDYA_RECEIPT_TIMEOUT');}finally{server.closeAllConnections();await new Promise(r=>server.close(r));}
 }
});
