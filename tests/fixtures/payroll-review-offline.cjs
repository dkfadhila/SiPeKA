'use strict';
const crypto=require('node:crypto');
// Durable SQL sessions/messages/files; only the Hermes answer is injected offline.
function sessions(pool,{decision='LANJUT',text='Identitas dan nominal sesuai; periksa email penerima.'}={}){
 return {async call(token,op,p){
  const result=(await pool.query('SELECT widya_access($1,$2,$3::jsonb) result',[token,op,JSON.stringify(p)])).rows[0].result;
  if(op==='SEND')await pool.query('SELECT widya_worker($1,$2::jsonb) result',['FINISH',JSON.stringify({id:p.id,capability:p.capability,status:'completed',message_id:crypto.randomUUID(),reply:JSON.stringify({decision,text})})]);
  return result;
 }};
}
module.exports={sessions};
