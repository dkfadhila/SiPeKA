'use strict';
// Dedicated receipt reads: never inherit request transactions or perform session writes.
const {boundedQuery}=require('./widya-receipt-query');
function createWidyaReceiptDB(pool,{idleMS}={}){
 const read=async(text,values,options)=> (await boundedQuery(pool,text,values,options)).rows[0]||null;
 return {
  lookupReceipt:(filename,options)=>read('SELECT * FROM receipt_assets WHERE filename=$1',[filename],options),
  authenticate:async(token,options)=>{
   if(!token)return null;
   const row=await read("SELECT u.*,s.purpose AS session_purpose FROM sessions s JOIN app_users u ON u.id=s.user_id WHERE s.token=$1 AND s.expired_at>(clock_timestamp() AT TIME ZONE 'UTC') AND s.last_seen_at>(clock_timestamp() AT TIME ZONE 'UTC')-($2::bigint * interval '1 millisecond')",[token,idleMS],options);
   return row?.session_purpose==='full'&&!row.password_change_required?row:null;
  },
 };
}
module.exports={createWidyaReceiptDB};
