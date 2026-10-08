'use strict';
// Local-only suggestions. This module has no financial write capability.
function parseIDR(token) {
 if(!/^(?:[1-9]\d*|[1-9]\d{0,2}(?:\.\d{3})+)(?:,00)?$/.test(token))return null;
 const digits=token.replace(/,00$/,'').replace(/\./g,'');
 try{return BigInt(digits)<=9007199254740991n ? BigInt(digits).toString():null;}catch{return null;}
}
function parseReceiptText(text,confidence=0) {
 text=String(text||'').slice(0,20000).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g,'');
 const lines=text.split(/\r?\n/).map(s=>s.trim()).filter(Boolean),amounts=[],dates=[],warnings=[];
 for(const line of lines){
  if(/^(?:(?:grand|jumlah)\s+)?total(?:\s+belanja)?\b/i.test(line)){
   const tail=line.replace(/^(?:(?:grand|jumlah)\s+)?total(?:\s+belanja)?\b\s*:?[ \t]*(?:Rp\.?[ \t]*)?/i,'');
   const amount=parseIDR(tail.trim());
   amounts.push({source:line,value:amount});
  }
  for(const m of line.matchAll(/\b(\d{2})[\/-](\d{2})[\/-](\d{4})\b|\b(\d{4})-(\d{2})-(\d{2})\b/g)){
   const [y,mo,d]=m[4]?[m[4],m[5],m[6]]:[m[3],m[2],m[1]],iso=`${y}-${mo}-${d}`;
   const parsed=new Date(iso+'T00:00:00Z');
   const valid=Number(y)>=2000&&Number(y)<=2099&&Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===iso;
   dates.push({source:m[0],value:valid?iso:null});
  }
 }
 const unique=a=>[...new Set(a.map(x=>x.value).filter(Boolean))];
 const av=unique(amounts),dv=unique(dates);
 const amount=av.length===1&&amounts.every(x=>x.value)?av[0]:null;
 const date=dv.length===1&&dates.every(x=>x.value)?dv[0]:null;
 if(!amount)warnings.push(amounts.length?'AMOUNT_AMBIGUOUS_OR_INVALID':'TOTAL_NOT_FOUND');
 if(!date)warnings.push(dates.length?'DATE_AMBIGUOUS_OR_INVALID':'DATE_NOT_FOUND');
 const merchant=lines.find(line=>!/SYNTHETIC|SINTETIS FIXTURE|NOT A REAL RECEIPT/i.test(line)&&/^[\p{L}][\p{L}\p{N} .&'-]{2,99}$/u.test(line)&&!/(total|tanggal|date|tunai|cash|kembali|receipt|nota|invoice|telp|alamat)/i.test(line))||null;
 if(!merchant)warnings.push('MERCHANT_NOT_FOUND');
 const score=Number.isFinite(confidence)?Math.max(0,Math.min(100,confidence)):0;
 if(score<70)warnings.push('LOW_OCR_CONFIDENCE');
 return {text,confidence:score,requiresHumanReview:true,suggestions:{amount,date,merchant},candidates:{amount:amounts,date:dates},warnings,ambiguity:{amount:amount===null,date:date===null,merchant:merchant===null}};
}
const {fork}=require('node:child_process');const path=require('node:path');
const KEY=/^\/api\/receipts\/(evidence-[0-9]+-[a-f0-9]{6}\.(?:jpg|png|webp|gif))$/;
const MIME={'image/png':'png','image/jpeg':'jpeg','image/webp':'webp','image/gif':'gif'};
function fail(code,status){return Object.assign(new Error(code),{code,status});}
function magic(bytes){
 if(bytes.length>=8&&bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))return 'image/png';
 if(bytes.length>=3&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255)return 'image/jpeg';
 if(bytes.length>=12&&bytes.toString('ascii',0,4)==='RIFF'&&bytes.toString('ascii',8,12)==='WEBP')return 'image/webp';
 if(bytes.length>=6&&/^GIF8[79]a$/.test(bytes.toString('ascii',0,6)))return 'image/gif';return null;
}
function createReceiptOCR({lookupReceipt,readReceipt,timeoutMs=30000,requestsPerMinute=6}={}) {
 if(typeof lookupReceipt!=='function'||typeof readReceipt!=='function')throw new TypeError('Receipt metadata and private storage adapters required');
 if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>60000||!Number.isInteger(requestsPerMinute)||requestsPerMinute<1||requestsPerMinute>60)throw new TypeError('Invalid OCR bounds');
 let busy=false;const rates=new Map();
 async function extract({actor,receiptKey}={}) {
  if(!actor||typeof actor.id!=='string'||!actor.id)throw fail('OCR_UNAUTHORIZED',401);
  const match=typeof receiptKey==='string'&&receiptKey.match(KEY);if(!match)throw fail('OCR_INVALID_KEY',400);
  if(!['STAFF','OWNER'].includes(actor.role))throw fail('OCR_FORBIDDEN',403);
  if(busy)throw fail('OCR_BUSY',429);
  const now=Date.now();for(const [id,entry] of rates)if(now-entry.start>=60000)rates.delete(id);
  const entry=rates.get(actor.id)||{start:now,count:0};if(entry.count>=requestsPerMinute||(!rates.has(actor.id)&&rates.size>=10000))throw fail('OCR_RATE_LIMIT',429);
  entry.count++;rates.set(actor.id,entry);busy=true;
  let child,timer,expired=false;
  try{
   const work=(async()=>{
    const asset=await lookupReceipt(match[1]);
    if(expired)throw fail('OCR_TIMEOUT',504);
    if(!asset||asset.filename!==match[1])throw fail('OCR_NOT_FOUND',404);
    if(actor.role==='STAFF'&&(!actor.assigned_branch_id||asset.user_id!==actor.id||asset.branch_id!==actor.assigned_branch_id))throw fail('OCR_FORBIDDEN',403);
    if(!MIME[asset.mime])throw fail('OCR_UNSUPPORTED_FORMAT',415);
    const bytes=await readReceipt(asset);
    if(expired)throw fail('OCR_TIMEOUT',504);
    if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>6000000)throw fail('OCR_INVALID_SIZE',413);
    if(magic(bytes)!==asset.mime)throw fail('OCR_INVALID_IMAGE',400);
    const result=await new Promise((resolve,reject)=>{
     child=fork(path.join(__dirname,'receipt-ocr-worker.js'),[],{stdio:['ignore','ignore','ignore','ipc'],serialization:'advanced',execArgv:['--max-old-space-size=256']});
     child.once('error',()=>reject(fail('OCR_ENGINE_UNAVAILABLE',503)));
     child.once('exit',()=>reject(fail('OCR_ENGINE_FAILED',503)));
     child.once('message',m=>{
      if(m?.error)return reject(fail(/^OCR_[A-Z_]+$/.test(m.error)?m.error:'OCR_ENGINE_FAILED',m.error==='OCR_ENGINE_UNAVAILABLE'?503:400));
      if(typeof m?.text!=='string'||m.text.length>20000)return reject(fail('OCR_OUTPUT_LIMIT',422));
      resolve(m);
     });
     child.send({bytes,mime:asset.mime},err=>{if(err)reject(fail('OCR_ENGINE_FAILED',503));});
    });
    return {...parseReceiptText(result.text,result.confidence),receipt_key:receiptKey,engine:'tesseract.js-local-eng'};
   })();
   const deadline=new Promise((_,reject)=>{timer=setTimeout(()=>{expired=true;child?.kill();reject(fail('OCR_TIMEOUT',504));},timeoutMs);});
   return await Promise.race([work,deadline]);
  }finally{clearTimeout(timer);child?.kill();busy=false;}
 }
 return Object.freeze({extract});
}
module.exports={parseReceiptText,parseIDR,createReceiptOCR};
