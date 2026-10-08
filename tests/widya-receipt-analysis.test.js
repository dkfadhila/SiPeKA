'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),sharp=require('sharp');
const key='/api/receipts/evidence-123-abcdef.png',actor={id:'staff',role:'STAFF',assigned_branch_id:'b'};
test('ambiguous totals invalid date and unverified output remain null',()=>{
 const {parseVision}=require('../widya-receipt-analysis');
 const result=parseVision(JSON.stringify({amountIDR:77500,date:'2026-02-31',merchant:'TOKO',text:'TOKO\n2026-02-31\nTOTAL Rp 77.500\nTOTAL Rp 87.500',ambiguous:false}));assert.equal(result.suggestions.amount,null);assert.equal(result.suggestions.date,null);
 assert.equal(parseVision(JSON.stringify({amountIDR:77500,date:'2026-10-08',merchant:'TOKO',text:'TOKO\n2026-10-08\nTOTAL Rp 77.500',ambiguous:true})).suggestions.merchant,null);
 assert.equal(parseVision(JSON.stringify({amountIDR:77500,date:null,merchant:null,text:'TOTAL Rp 77.500\nTOTAL Rp unreadable',ambiguous:false})).suggestions.amount,null);
 assert.equal(parseVision(JSON.stringify({amountIDR:77500,date:'2026-10-08',merchant:null,text:'2026-10-08\n2026-10-09\nTOTAL Rp 77.500',ambiguous:false})).suggestions.date,null);
 assert.equal(parseVision(JSON.stringify({amountIDR:77500,date:'2026-10-08',merchant:null,text:'Tanggal: 08/10/2026\nTOTAL Rp 77.500',ambiguous:false})).suggestions.date,'2026-10-08');
 assert.equal(parseVision(JSON.stringify({amountIDR:77500,date:'2026-10-08',merchant:null,text:'08/10/2026\n31/02/2026\nTOTAL Rp 77.500',ambiguous:false})).suggestions.date,null);
});
test('mounted HTTP receipt analysis denies overrides and reauthenticates',async t=>{
 const http=require('node:http'),{createWidyaReceiptRouter}=require('../widya-receipt-analysis');let current=actor,calls=0;
 const router=createWidyaReceiptRouter({authenticate:async()=>current,checkRequest:async req=>req.headers.origin==='https://fixture.test',lookupReceipt:async filename=>({filename,user_id:'staff',branch_id:'b'}),service:{extract:async()=>{calls++;return {requiresHumanReview:true,suggestions:{amount:'77500'}};}}});
 const server=http.createServer(async(req,res)=>{if(!await router(req,res)){res.writeHead(404);res.end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const request=async body=>{const r=await fetch('http://127.0.0.1:'+server.address().port+'/api/receipts/analyze',{method:'POST',headers:{origin:'https://fixture.test','content-type':'application/json'},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};};
 assert.equal((await request({receipt_key:key,model:'evil'})).status,400);assert.equal(calls,0);current=null;assert.equal((await request({receipt_key:key})).status,401);current=actor;assert.equal((await request({receipt_key:key})).status,200);
});
test('Widya authorized private bytes give review-only exact proposals',async()=>{
 const mod=require('../widya-receipt-analysis');
 const bytes=await sharp({create:{width:40,height:40,channels:3,background:'white'}}).png().toBuffer();let calls=0;
 const service=mod.createWidyaReceiptAnalysis({lookupReceipt:async filename=>({filename,mime:'image/png',user_id:'staff',branch_id:'b'}),readReceipt:async()=>bytes,bridge:{analyzeReceipt:async({bytes:b,mime})=>{calls++;assert.ok(Buffer.isBuffer(b));assert.equal(mime,'image/png');return {output:JSON.stringify({amountIDR:77500,date:'2026-10-08',merchant:'TOKO UJI WIDYA',text:'TOKO UJI WIDYA\nTanggal: 2026-10-08\nTOTAL BAYAR: Rp 77.500',ambiguous:false}),runtime:{provider:'custom',model:'kr/gpt-5.6-luna'},imageTransport:{imageParts:1,toolCount:0}};}}});
 await assert.rejects(()=>service.extract({actor:{...actor,id:'other'},receiptKey:key}),{code:'WIDYA_RECEIPT_FORBIDDEN'});assert.equal(calls,0);
 const result=await service.extract({actor,receiptKey:key});assert.equal(result.suggestions.amount,'77500');assert.equal(result.suggestions.date,'2026-10-08');assert.equal(result.requiresHumanReview,true);assert.equal(result.engine,'widya-hermes-vision');assert.equal(result.runtime.model,'kr/gpt-5.6-luna');
});
