'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path');
const sharp=require('sharp');const {createReceiptOCR}=require('../receipt-ocr');
const root=process.env.OCR_ARTIFACT_DIR||path.join(__dirname,'../.receipt-ocr-fixtures');
const key='/api/receipts/evidence-123-abcdef.png';const actor={id:'staff',role:'STAFF',assigned_branch_id:'b'};
async function fixture(name,lines){await fs.mkdir(root,{recursive:true});const svg='<svg xmlns="http://www.w3.org/2000/svg" width="1500" height="900"><rect width="100%" height="100%" fill="white"/>'+lines.map((s,i)=>`<text x="60" y="${90+i*90}" font-family="Arial" font-size="48" fill="black">${s}</text>`).join('')+'</svg>';const bytes=await sharp(Buffer.from(svg)).png().toBuffer();await fs.writeFile(path.join(root,name+'.png'),bytes);return bytes;}
function service(bytes,options={}){return createReceiptOCR({lookupReceipt:async()=>({filename:'evidence-123-abcdef.png',user_id:'staff',branch_id:'b',mime:'image/png'}),readReceipt:async()=>bytes,...options});}
test('actual offline engine reads synthetic receipt exact IDR/date/merchant',async()=>{
 const bytes=await fixture('synthetic-clear',['TOKO UJI LAUNDRY','SYNTHETIC FIXTURE - NOT A REAL RECEIPT','Tanggal 08/10/2026','SUBTOTAL Rp 100.000','TOTAL Rp 125.000,00','TUNAI Rp 150.000','KEMBALI Rp 25.000']);
 const r=await service(bytes).extract({actor,receiptKey:key});await fs.writeFile(path.join(root,'synthetic-clear-result.json'),JSON.stringify(r,null,2));
 assert.equal(r.suggestions.amount,'125000');assert.equal(r.suggestions.date,'2026-10-08');assert.equal(r.suggestions.merchant,'TOKO UJI LAUNDRY');assert.equal(r.requiresHumanReview,true);assert.equal(r.receipt_key,key);assert.ok(r.confidence>70);assert.equal(r.engine,'tesseract.js-local-eng');
});
test('actual engine exposes ambiguity and invalid date without invented amount',async()=>{
 const bytes=await fixture('synthetic-ambiguous',['TOKO UJI LAUNDRY','SYNTHETIC FIXTURE - NOT A REAL RECEIPT','Tanggal 31/02/2026','TOTAL Rp 125.000','TOTAL Rp 150.000']);const r=await service(bytes).extract({actor,receiptKey:key});await fs.writeFile(path.join(root,'synthetic-ambiguous-result.json'),JSON.stringify(r,null,2));assert.equal(r.suggestions.amount,null);assert.equal(r.suggestions.date,null);assert.ok(r.warnings.includes('AMOUNT_AMBIGUOUS_OR_INVALID'));
});
test('existing upload formats JPEG WebP GIF work locally; malformed and oversized pixels fail closed',async()=>{
 const png=await fs.readFile(path.join(root,'synthetic-clear.png'));
 for(const [format,mime,ext] of [['jpeg','image/jpeg','jpg'],['webp','image/webp','webp'],['gif','image/gif','gif']]){
  const bytes=await sharp(png)[format]().toBuffer();const k=`/api/receipts/evidence-123-abcdef.${ext}`;
  const s=createReceiptOCR({lookupReceipt:async()=>({filename:k.split('/').pop(),user_id:'staff',branch_id:'b',mime}),readReceipt:async()=>bytes});
  const r=await s.extract({actor,receiptKey:k});assert.equal(r.suggestions.amount,'125000',format);
 }
 await assert.rejects(service(Buffer.from([137,80,78,71,13,10,26,10,0,1,2])).extract({actor,receiptKey:key}),{code:'OCR_INVALID_IMAGE'});
 const huge=await sharp({create:{width:4000,height:4000,channels:3,background:'white'}}).png().toBuffer();
 await assert.rejects(service(huge).extract({actor,receiptKey:key}),{code:'OCR_INVALID_IMAGE'});
});
test('bounds actual worker lifetime, concurrency and per-user rate',async()=>{
 const bytes=await fixture('synthetic-timeout',['SYNTHETIC FIXTURE','TOTAL Rp 125.000']);const s=service(bytes,{timeoutMs:20,requestsPerMinute:1});const pending=s.extract({actor,receiptKey:key});await assert.rejects(s.extract({actor:{id:'owner',role:'OWNER'},receiptKey:key}),{code:'OCR_BUSY'});await assert.rejects(pending,{code:'OCR_TIMEOUT'});await assert.rejects(s.extract({actor,receiptKey:key}),{code:'OCR_RATE_LIMIT'});
});
