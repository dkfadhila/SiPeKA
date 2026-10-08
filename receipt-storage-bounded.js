'use strict';
const fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto');
const {S3Client,GetObjectCommand}=require('@aws-sdk/client-s3');
const VALID=/^evidence-[0-9]+-[a-f0-9]{6}\.(?:jpg|png|webp|gif)$/;
const fail=(code,status)=>Object.assign(new Error(code),{code,status});
function createBoundedReceiptReader({backend=process.env.STORAGE_BACKEND||'filesystem',root=process.env.UPLOADS_DIR||path.join(__dirname,'uploads','receipts'),maxBytes=6000000,timeoutMs=30000,makeClient}={}){
 if(!['r2','filesystem'].includes(backend)||!Number.isInteger(maxBytes)||maxBytes<1||maxBytes>6000000||!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000)throw new TypeError('Invalid storage bounds');
 root=path.resolve(root);const relative=path.relative(path.join(__dirname,'public'),root);if(!relative||(!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative)))throw new TypeError('Receipt storage must be private');
 return async function readReceipt(asset,{signal}={}){
  const name=asset?.filename;if(typeof name!=='string'||!VALID.test(name))throw fail('OCR_INVALID_KEY',400);
  const controller=new AbortController();let stream,handle,s3,timer;let timedOut=false;
  const abort=()=>{controller.abort();stream?.destroy(fail(timedOut?'OCR_TIMEOUT':'OCR_ABORTED',timedOut?504:499));};
  const stop=()=>{if(controller.signal.aborted)throw fail(timedOut?'OCR_TIMEOUT':'OCR_ABORTED',timedOut?504:499);};
  const onAbort=()=>abort();signal?.addEventListener('abort',onAbort,{once:true});if(signal?.aborted)abort();
  timer=setTimeout(()=>{timedOut=true;abort();},timeoutMs);
  try{
   stop();let expectedHash;
   if(backend==='r2'){
    s3=makeClient?makeClient():new S3Client({endpoint:process.env.R2_ENDPOINT,region:'auto',credentials:{accessKeyId:process.env.R2_ACCESS_KEY_ID,secretAccessKey:process.env.R2_SECRET_ACCESS_KEY},maxAttempts:1});
    const result=await s3.send(new GetObjectCommand({Bucket:process.env.R2_ATTACHMENT_BUCKET,Key:'receipts/'+name}),{abortSignal:controller.signal});stream=result.Body;stop();
    if(result.ContentLength!==undefined&&(!Number.isSafeInteger(result.ContentLength)||result.ContentLength<1||result.ContentLength>maxBytes))throw fail('OCR_INVALID_SIZE',413);
    expectedHash=result.Metadata?.sha256;
   }else{
    const file=path.join(root,name),before=await fs.lstat(file);stop();if(!before.isFile()||before.isSymbolicLink())throw fail('OCR_INVALID_FILE',400);
    handle=await fs.open(file,'r');const after=await handle.stat();stop();if(!after.isFile()||before.dev!==after.dev||before.ino!==after.ino)throw fail('OCR_INVALID_FILE',400);
    if(after.size<1||after.size>maxBytes)throw fail('OCR_INVALID_SIZE',413);
    stream=handle.createReadStream({autoClose:false,highWaterMark:Math.min(65536,maxBytes+1),signal:controller.signal});
   }
   if(!stream||typeof stream[Symbol.asyncIterator]!=='function')throw fail('OCR_STORAGE_UNAVAILABLE',503);
   const chunks=[];let size=0;const hash=crypto.createHash('sha256');
   for await(const value of stream){stop();const chunk=Buffer.isBuffer(value)?value:Buffer.from(value);size+=chunk.length;if(size>maxBytes)throw fail('OCR_INVALID_SIZE',413);hash.update(chunk);chunks.push(chunk);}
   stop();if(!size)throw fail('OCR_INVALID_SIZE',413);const digest=hash.digest('hex');if(expectedHash&&digest!==expectedHash)throw fail('OCR_INTEGRITY_MISMATCH',400);
   return Buffer.concat(chunks,size);
  }catch(e){if(controller.signal.aborted)throw fail(timedOut?'OCR_TIMEOUT':'OCR_ABORTED',timedOut?504:499);throw e;}
  finally{clearTimeout(timer);signal?.removeEventListener('abort',onAbort);stream?.destroy();await handle?.close();s3?.destroy();}
 };
}
module.exports={createBoundedReceiptReader};
