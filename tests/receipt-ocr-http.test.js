'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),http=require('node:http'),fs=require('node:fs/promises'),path=require('node:path'),sharp=require('sharp');
const {createReceiptOCRRouter}=require('../receipt-ocr-router');
const key='/api/receipts/evidence-123-abcdef.png',owner={id:'owner',role:'OWNER'},staff={id:'staff',role:'STAFF',assigned_branch_id:'b'};
async function fixture(lines){const svg='<svg xmlns="http://www.w3.org/2000/svg" width="1500" height="700"><rect width="100%" height="100%" fill="white"/>'+lines.map((s,i)=>`<text x="60" y="${90+i*90}" font-family="Arial" font-size="48">${s}</text>`).join('')+'</svg>';return sharp(Buffer.from(svg)).png().toBuffer();}
async function harness(t){let bytes=await fixture(['TOKO UJI LAUNDRY','SYNTHETIC FIXTURE','Tanggal 08/10/2026','TOTAL Rp 125.000,00']);let readCount=0;
 const asset={filename:key.split('/').pop(),mime:'image/png',user_id:'staff',branch_id:'b'};
 const handler=createReceiptOCRRouter({authenticate:async req=>req.headers.authorization==='owner'?owner:req.headers.authorization==='staff'?staff:req.headers.authorization==='other'?{...staff,id:'other'}:null,lookupReceipt:async()=>asset,readReceipt:async()=>{readCount++;return bytes;},checkRequest:async req=>req.headers.origin==='https://local.test'});
 const server=http.createServer(async(req,res)=>{if(!await handler(req,res)){res.writeHead(404);res.end();}});await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const request=async(actor,body={receipt_key:key},origin='https://local.test')=>{const res=await fetch(`http://127.0.0.1:${server.address().port}/api/receipts/ocr`,{method:'POST',headers:{authorization:actor||'',origin,'content-type':'application/json'},body:JSON.stringify(body)});return {status:res.status,cache:res.headers.get('cache-control'),body:await res.json()};};return {request,setBytes:b=>{bytes=b;},reads:()=>readCount};
}
test('HTTP authenticated local engine exact suggestions; unauthorized forbidden origin and invalid contracts read nothing',async t=>{
 const h=await harness(t);assert.equal((await h.request('')).status,401);assert.equal((await h.request('other')).status,403);assert.equal((await h.request('staff',undefined,'https://evil.test')).status,403);assert.equal((await h.request('staff',{receipt_key:key,image:'base64'})).status,400);assert.equal(h.reads(),0);
 const r=await h.request('staff');assert.equal(r.status,200);assert.equal(r.cache,'no-store');assert.equal(r.body.suggestions.amount,'125000');assert.equal(r.body.suggestions.date,'2026-10-08');assert.equal(r.body.requiresHumanReview,true);
 h.setBytes(Buffer.alloc(6000001));assert.equal((await h.request('owner')).status,413);
 h.setBytes(Buffer.from('not an image'));assert.equal((await h.request('owner')).status,400);
 h.setBytes(await fixture(['TOKO UJI LAUNDRY','SYNTHETIC FIXTURE','Tanggal 31/02/2026','TOTAL Rp 125.000','TOTAL Rp 150.000']));const ambiguous=await h.request('owner');assert.equal(ambiguous.status,200);assert.equal(ambiguous.body.suggestions.amount,null);assert.equal(ambiguous.body.suggestions.date,null);
 const root=process.env.OCR_ARTIFACT_DIR;if(root){await fs.mkdir(root,{recursive:true});await fs.writeFile(path.join(root,'http-exact-result.json'),JSON.stringify(r,null,2));}
});
