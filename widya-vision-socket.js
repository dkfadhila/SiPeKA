'use strict';
const net=require('node:net'),crypto=require('node:crypto');
const SOCKET='/run/widya-receipt-vision/vision.sock',MAX_RESPONSE=60000;
const fault=(code,status=502)=>Object.assign(new Error(code),{code,status});
async function analyzeReceipt({bytes,mime,signal}={}){
 if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>6000000||!['image/png','image/jpeg','image/webp','image/gif'].includes(mime))throw fault('WIDYA_RECEIPT_INVALID_IMAGE',400);
 if(process.platform!=='linux')throw fault('WIDYA_RECEIPT_NOT_CONFIGURED',503);
 const combined=signal?AbortSignal.any([signal,AbortSignal.timeout(150000)]):AbortSignal.timeout(150000);combined.throwIfAborted();
 return new Promise((resolve,reject)=>{
  const socket=net.createConnection({path:SOCKET,allowHalfOpen:true});let data=Buffer.alloc(0),expected=null,settled=false;
  const finish=(error,value)=>{if(settled)return;settled=true;combined.removeEventListener('abort',abort);socket.destroy();error?reject(error):resolve(value);};
  const abort=()=>finish(fault(signal?.aborted?'WIDYA_RECEIPT_CANCELLED':'WIDYA_RECEIPT_TIMEOUT',signal?.aborted?499:504));combined.addEventListener('abort',abort,{once:true});
  socket.once('connect',()=>{const h=Buffer.from(JSON.stringify({v:1,mime,size:bytes.length})),len=Buffer.alloc(4);len.writeUInt32BE(h.length);socket.write(len);socket.write(h);socket.end(bytes);});
  socket.on('data',chunk=>{if(data.length+chunk.length>MAX_RESPONSE+4)return finish(fault('WIDYA_RECEIPT_INVALID_RESPONSE'));data=Buffer.concat([data,chunk]);if(expected===null&&data.length>=4){expected=data.readUInt32BE();if(expected<1||expected>MAX_RESPONSE)return finish(fault('WIDYA_RECEIPT_INVALID_RESPONSE'));}if(expected!==null&&data.length>expected+4)finish(fault('WIDYA_RECEIPT_INVALID_RESPONSE'));});
  socket.once('end',()=>{let v;try{if(expected===null||data.length!==expected+4)throw Error();v=JSON.parse(data.subarray(4).toString('utf8'));if(v.v!==1)throw Error();if(v.error){if(Object.keys(v).sort().join(',')!=='error,v')throw Error();return finish(fault(v.error==='WIDYA_RECEIPT_RATE_LIMIT'?v.error:'WIDYA_RECEIPT_VISION_FAILED',v.error==='WIDYA_RECEIPT_RATE_LIMIT'?429:502));}if(Object.keys(v).sort().join(',')!=='result,v')throw Error();const r=v.result;if(Object.keys(r).sort().join(',')!=='imageTransport,output,runtime'||typeof r.output!=='string'||r.output.length>30000||r.runtime?.provider!=='custom'||r.runtime?.model!=='kr/gpt-5.6-luna'||r.imageTransport?.imageParts!==1||r.imageTransport?.toolCount!==0||r.imageTransport?.sha256!==crypto.createHash('sha256').update(bytes).digest('hex')||r.imageTransport?.bytes!==bytes.length)throw Error();finish(null,r);}catch{finish(fault('WIDYA_RECEIPT_UNVERIFIED_TRANSPORT'));}});
  socket.once('error',()=>finish(fault('WIDYA_RECEIPT_BROKER_UNAVAILABLE',503)));socket.once('close',()=>{if(!settled)finish(fault('WIDYA_RECEIPT_BROKER_UNAVAILABLE',503));});if(combined.aborted)abort();
 });
}
module.exports={SOCKET,analyzeReceipt};
