'use strict';
const {createReceiptOCR}=require('./receipt-ocr');
const {createBoundedReceiptReader}=require('./receipt-storage-bounded');
const KEY=/^\/api\/receipts\/(evidence-[0-9]+-[a-f0-9]{6}\.(?:jpg|png|webp|gif))$/;
const fail=(code,status)=>Object.assign(new Error(code),{code,status});
function permitted(actor,asset){return asset&&(actor.role==='OWNER'||(actor.role==='STAFF'&&actor.assigned_branch_id&&asset.user_id===actor.id&&asset.branch_id===actor.assigned_branch_id));}
async function body(req){
 const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),5000);let size=0;const chunks=[];
 try{for await(const chunk of require('node:stream').addAbortSignal(controller.signal,req)){size+=chunk.length;if(size>1024)throw fail('OCR_INVALID_SIZE',413);chunks.push(chunk);}let value;try{value=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw fail('OCR_INVALID_KEY',400);}if(!value||Array.isArray(value)||Object.keys(value).length!==1||typeof value.receipt_key!=='string'||!KEY.test(value.receipt_key))throw fail('OCR_INVALID_KEY',400);return value;}finally{clearTimeout(timer);}
}
function createReceiptOCRRouter({authenticate,lookupReceipt,readReceipt=createBoundedReceiptReader(),checkRequest,...bounds}={}){
 if(typeof authenticate!=='function'||typeof checkRequest!=='function')throw new TypeError('Session and Origin/CSRF checks required');
 const service=createReceiptOCR({lookupReceipt,readReceipt,...bounds});
 return async function receiptOCRRouter(req,res){
  if(req.url!=='/api/receipts/ocr')return false;
  const send=(status,value)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));return true;};
  try{
   if(req.method!=='POST')return send(405,{error:'OCR_METHOD_NOT_ALLOWED'});
   if(!await checkRequest(req))return send(403,{error:'OCR_FORBIDDEN'});
   const actor=await authenticate(req);if(!actor)return send(401,{error:'OCR_UNAUTHORIZED'});
   if(!['STAFF','OWNER'].includes(actor.role))return send(403,{error:'OCR_FORBIDDEN'});
   if(!(req.headers['content-type']||'').toLowerCase().startsWith('application/json'))return send(415,{error:'OCR_INVALID_CONTENT_TYPE'});
   const {receipt_key}=await body(req);const result=await service.extract({actor,receiptKey:receipt_key});
   const current=await authenticate(req);if(!current||current.id!==actor.id||current.role!==actor.role||current.assigned_branch_id!==actor.assigned_branch_id)return send(401,{error:'OCR_UNAUTHORIZED'});
   const asset=await lookupReceipt(KEY.exec(receipt_key)[1]);if(!asset||asset.filename!==KEY.exec(receipt_key)[1]||!permitted(current,asset))return send(403,{error:'OCR_FORBIDDEN'});
   return send(200,result);
  }catch(e){const safe=/^OCR_[A-Z_]+$/.test(e.code||'')&&Number.isInteger(e.status)&&e.status>=400&&e.status<=599;return send(safe?e.status:503,{error:safe?e.code:'OCR_ENGINE_UNAVAILABLE'});}
 };
}
module.exports={createReceiptOCRRouter};
