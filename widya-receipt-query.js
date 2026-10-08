'use strict';
const fault=()=>Object.assign(new Error('WIDYA_RECEIPT_TIMEOUT'),{code:'WIDYA_RECEIPT_TIMEOUT',status:504});
async function boundedQuery(pool,text,values,{signal,timeoutMs=5000}={}){
 if(!Number.isInteger(timeoutMs)||timeoutMs<1||timeoutMs>5000)throw new TypeError('Invalid receipt query deadline');
 let client,finished=false,timer,abort;
 const expired=new Promise((resolve,reject)=>{abort=()=>{finished=true;if(client){client.release(true);client=null;}reject(fault());};timer=setTimeout(abort,timeoutMs);if(signal?.aborted)abort();else signal?.addEventListener('abort',abort,{once:true});});
 const work=(async()=>{
  if(finished)throw fault();const acquired=await pool.connect();
  if(finished){acquired.release(true);throw fault();}client=acquired;
  // Server-side cancellation plus a client deadline. A timeout destroys the dedicated
  // connection, rather than returning a still-running query to the shared pool.
  await client.query({text:"SELECT set_config('statement_timeout',$1,false),set_config('lock_timeout',$1,false)",values:[String(timeoutMs)],query_timeout:timeoutMs});
  if(finished||signal?.aborted)throw fault();
  return client.query({text,values,query_timeout:timeoutMs});
 })();
 try{return await Promise.race([work,expired]);}finally{finished=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);if(client){client.release(true);client=null;}}
}
module.exports={boundedQuery};
