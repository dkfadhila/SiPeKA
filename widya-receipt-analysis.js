'use strict';
const sharp=require('sharp');
const KEY=/^\/api\/receipts\/(evidence-[0-9]+-[a-f0-9]{6}\.(?:jpg|png|webp|gif))$/;
const fail=(code,status=503)=>Object.assign(new Error(code),{code,status});
function permitted(actor,asset){return !!asset&&(actor.role==='OWNER'||actor.role==='STAFF'&&!!actor.assigned_branch_id&&asset.user_id===actor.id&&asset.branch_id===actor.assigned_branch_id);}
function parseVision(output){
 let p;try{p=JSON.parse(output);}catch{throw fail('WIDYA_RECEIPT_INVALID_RESPONSE',502);}
 if(!p||Array.isArray(p)||typeof p.text!=='string'||p.text.length>20000||typeof p.ambiguous!=='boolean')throw fail('WIDYA_RECEIPT_INVALID_RESPONSE',502);
 const text=p.text.replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,'');
 // Cross-check model proposals against its transcription. No tender/change totals.
 const totals=[];for(const l of text.split(/\r?\n/)){if(!/^(?:(?:grand|jumlah)\s+)?total\b/i.test(l.trim()))continue;const m=l.trim().match(/^(?:(?:grand|jumlah)\s+)?total(?:\s+(?:bayar|belanja))?\s*:?[ \t]*(?:Rp\.?[ \t]*)?([1-9]\d*(?:\.\d{3})*(?:,00)?)$/i);if(m){try{totals.push(BigInt(m[1].replace(/,00$/,'').replace(/\./g,'')).toString());}catch{totals.push(null);}}else totals.push(null);}
 const amount=!p.ambiguous&&Number.isSafeInteger(p.amountIDR)&&p.amountIDR>0&&totals.length>0&&totals.every(a=>a===String(p.amountIDR))?String(p.amountIDR):null;
 const dates=[...text.matchAll(/\b20\d{2}-\d{2}-\d{2}\b/g)].map(m=>m[0]);
 for(const m of text.matchAll(/\b(\d{2})[\/-](\d{2})[\/-](20\d{2})\b/g))dates.push(`${m[3]}-${m[2]}-${m[1]}`);
 let date=null;if(!p.ambiguous&&typeof p.date==='string'&&/^20\d{2}-\d{2}-\d{2}$/.test(p.date)){const d=new Date(p.date+'T00:00:00Z');if(Number.isFinite(d.getTime())&&d.toISOString().slice(0,10)===p.date&&dates.length>0&&dates.every(x=>x===p.date))date=p.date;}
 const merchant=!p.ambiguous&&typeof p.merchant==='string'&&p.merchant.trim().length>=3&&p.merchant.length<=100&&text.includes(p.merchant)&&!/[<>\x00-\x1f]/.test(p.merchant)?p.merchant.trim():null;
 return {text,suggestions:{amount,date,merchant},ambiguity:{amount:amount===null,date:date===null,merchant:merchant===null},warnings:[...(!amount?['AMOUNT_AMBIGUOUS_OR_INVALID']:[]),...(!date?['DATE_AMBIGUOUS_OR_INVALID']:[]),...(!merchant?['MERCHANT_AMBIGUOUS_OR_INVALID']:[])]};
}
// Observe both settlements even after abort: late adapter rejection must never escape.
function bounded(call,signal){
 return new Promise((resolve,reject)=>{
  const abort=()=>reject(signal.reason);if(signal.aborted)return abort();
  signal.addEventListener('abort',abort,{once:true});
  Promise.resolve().then(()=>{signal.throwIfAborted();return call();}).then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));
 });
}
function createWidyaReceiptAnalysis({lookupReceipt,readReceipt,bridge,timeoutMs=150000,requestsPerMinute=6}={}){
 if(typeof lookupReceipt!=='function'||typeof readReceipt!=='function'||typeof bridge?.analyzeReceipt!=='function')throw new TypeError('Private receipt adapters and Widya vision bridge required');
 if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>180000||!Number.isInteger(requestsPerMinute)||requestsPerMinute<1||requestsPerMinute>60)throw new TypeError('Invalid vision bounds');
 let busy=false,inference=null;const rates=new Map();
 async function extract({actor,receiptKey,signal}={}){
  if(!actor?.id)throw fail('WIDYA_RECEIPT_UNAUTHORIZED',401);
  if(!['STAFF','OWNER'].includes(actor.role))throw fail('WIDYA_RECEIPT_FORBIDDEN',403);
  const match=typeof receiptKey==='string'&&KEY.exec(receiptKey);if(!match)throw fail('WIDYA_RECEIPT_INVALID_KEY',400);
  const now=Date.now();for(const [id,v] of rates)if(now-v.start>=60000)rates.delete(id);
  const rate=rates.get(actor.id)||{start:now,count:0};if(busy||inference)throw fail('WIDYA_RECEIPT_BUSY',429);if(rate.count>=requestsPerMinute||(!rates.has(actor.id)&&rates.size>=10000))throw fail('WIDYA_RECEIPT_RATE_LIMIT',429);
  rate.count++;rates.set(actor.id,rate);busy=true;
  const combined=signal?AbortSignal.any([signal,AbortSignal.timeout(timeoutMs)]):AbortSignal.timeout(timeoutMs);
  try{
   const asset=await bounded(()=>lookupReceipt(match[1],{signal:combined}),combined);combined.throwIfAborted();if(!asset||asset.filename!==match[1])throw fail('WIDYA_RECEIPT_NOT_FOUND',404);if(!permitted(actor,asset))throw fail('WIDYA_RECEIPT_FORBIDDEN',403);
   const bytes=await bounded(()=>readReceipt(asset,{signal:combined}),combined);combined.throwIfAborted();if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>6000000)throw fail('WIDYA_RECEIPT_INVALID_SIZE',413);
   let meta;try{meta=await bounded(()=>sharp(bytes,{limitInputPixels:12000000,failOn:'warning',animated:false}).metadata(),combined);}catch{throw fail('WIDYA_RECEIPT_INVALID_IMAGE',400);}
   const mime={png:'image/png',jpeg:'image/jpeg',webp:'image/webp',gif:'image/gif'}[meta.format];if(!mime||mime!==asset.mime||!meta.width||!meta.height||meta.width*meta.height>12000000||(meta.pages||1)>1)throw fail('WIDYA_RECEIPT_INVALID_IMAGE',400);
   const pending=Promise.resolve().then(()=>{combined.throwIfAborted();return bridge.analyzeReceipt({bytes,mime,signal:combined});});inference=pending;
   const release=()=>{if(inference===pending)inference=null;};pending.then(release,release);
   const result=await bounded(()=>pending,combined);combined.throwIfAborted();
   if(result.imageTransport?.imageParts!==1||result.imageTransport?.toolCount!==0||result.runtime?.provider!=='custom'||!result.runtime?.model)throw fail('WIDYA_RECEIPT_UNVERIFIED_TRANSPORT',502);
   return {...parseVision(result.output),receipt_key:receiptKey,requiresHumanReview:true,engine:'widya-hermes-vision',runtime:result.runtime};
  }catch(e){if(combined.aborted)throw fail(signal?.aborted?'WIDYA_RECEIPT_CANCELLED':'WIDYA_RECEIPT_TIMEOUT',signal?.aborted?499:504);throw e;}finally{busy=false;}
 }
 return Object.freeze({extract});
}
function createWidyaReceiptRouter({authenticate,checkRequest,lookupReceipt,readReceipt,bridge,service,sendJSON,timeoutMs=150000}={}){
 if(typeof authenticate!=='function'||typeof checkRequest!=='function'||typeof lookupReceipt!=='function')throw new TypeError('Authentication and Origin/CSRF required');
 if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>180000)throw new TypeError('Invalid vision bounds');
 const engine=service||createWidyaReceiptAnalysis({lookupReceipt,readReceipt,bridge,timeoutMs});
 return async function router(req,res){
  if(req.url!=='/api/receipts/analyze')return false;
  const send=(status,value)=>{if(res.destroyed)return true;res.setHeader('Cache-Control','no-store');if(sendJSON)sendJSON(res,status,value);else{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(value));}return true;};
  const controller=new AbortController(),disconnect=()=>{if(!res.writableEnded)controller.abort();};res.once('close',disconnect);
  const overall=AbortSignal.any([controller.signal,AbortSignal.timeout(timeoutMs)]),options={signal:overall};
  try{
   if(req.method!=='POST')return send(405,{error:'WIDYA_RECEIPT_METHOD_NOT_ALLOWED'});
   if(!await bounded(()=>checkRequest(req,options),overall))return send(403,{error:'WIDYA_RECEIPT_FORBIDDEN'});
   const actor=await bounded(()=>authenticate(req,options),overall);if(!actor)return send(401,{error:'WIDYA_RECEIPT_UNAUTHORIZED'});
   if(!['STAFF','OWNER'].includes(actor.role))return send(403,{error:'WIDYA_RECEIPT_FORBIDDEN'});
   if(!(req.headers['content-type']||'').toLowerCase().startsWith('application/json'))return send(415,{error:'WIDYA_RECEIPT_INVALID_CONTENT_TYPE'});
   const chunks=[];let size=0;const deadline=AbortSignal.any([overall,AbortSignal.timeout(5000)]);
   for await(const b of require('node:stream').addAbortSignal(deadline,req)){size+=b.length;if(size>1024)throw fail('WIDYA_RECEIPT_INVALID_SIZE',413);chunks.push(b);}
   let body;try{body=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw fail('WIDYA_RECEIPT_INVALID_KEY',400);}
   if(!body||Array.isArray(body)||Object.keys(body).length!==1||!KEY.test(body.receipt_key||''))throw fail('WIDYA_RECEIPT_INVALID_KEY',400);
   const result=await bounded(()=>engine.extract({actor,receiptKey:body.receipt_key,signal:overall}),overall);
   const current=await bounded(()=>authenticate(req,options),overall);if(!current||current.id!==actor.id||current.role!==actor.role||current.assigned_branch_id!==actor.assigned_branch_id)return send(401,{error:'WIDYA_RECEIPT_UNAUTHORIZED'});
   const asset=await bounded(()=>lookupReceipt(KEY.exec(body.receipt_key)[1],options),overall);if(!asset||asset.filename!==KEY.exec(body.receipt_key)[1]||!permitted(current,asset))return send(403,{error:'WIDYA_RECEIPT_FORBIDDEN'});
   return send(200,result);
  }catch(e){if(overall.aborted)e=fail(controller.signal.aborted?'WIDYA_RECEIPT_CANCELLED':'WIDYA_RECEIPT_TIMEOUT',controller.signal.aborted?499:504);const safe=/^WIDYA_RECEIPT_[A-Z_]+$/.test(e.code||'')&&Number.isInteger(e.status)&&e.status>=400&&e.status<=599;return send(safe?e.status:503,{error:safe?e.code:'WIDYA_RECEIPT_UNAVAILABLE'});}finally{res.removeListener('close',disconnect);}
 };
}
module.exports={createWidyaReceiptAnalysis,createWidyaReceiptRouter,parseVision,permitted,KEY};
