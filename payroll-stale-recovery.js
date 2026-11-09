'use strict';
// Bounded sweeper for the employee-payroll email delivery path (migration 024).
// A claimed row can only leave 'sending' here when its lease has expired; it becomes
// 'failed' with PAYROLL_STALE_CLAIM_RECOVERED and is never resent automatically.
const DEFAULT_LEASE_MINUTES=15;
const DEFAULT_INTERVAL_MS=5*60*1000;
const MIN_INTERVAL_MS=60*1000;
function clampLease(value){
 const n=Number(value);
 return Number.isInteger(n)&&n>=1&&n<=1440?n:DEFAULT_LEASE_MINUTES;
}
function createStaleClaimRecovery({pool,leaseMinutes=DEFAULT_LEASE_MINUTES,intervalMs=DEFAULT_INTERVAL_MS,onError}={}){
 if(!pool||typeof pool.query!=='function')throw new Error('PAYROLL_STALE_RECOVERY_CONFIG');
 const lease=clampLease(leaseMinutes);
 const interval=Number.isFinite(intervalMs)&&intervalMs>=MIN_INTERVAL_MS?intervalMs:MIN_INTERVAL_MS;
 let timer=null,running=false,lastResult=null,lastErrorAt=null;
 async function runOnce(){
  if(running)return null;
  running=true;
  try{
   const result=(await pool.query('SELECT payroll_recover_stale_claims($1) result',[lease])).rows[0]?.result||null;
   lastResult=result;
   return result;
  }catch(err){
   lastErrorAt=new Date().toISOString();
   try{onError?.(err);}catch{}
   throw err;
  }finally{running=false;}
 }
 function start(){
  if(timer)return timer;
  const tick=()=>{runOnce().catch(()=>{});};
  timer=setInterval(tick,interval);
  if(typeof timer.unref==='function')timer.unref();
  tick();
  return timer;
 }
 function stop(){if(timer){clearInterval(timer);timer=null;}}
 return {runOnce,start,stop,lease,interval,status:()=>({running,timer:!!timer,lastResult,lastErrorAt})};
}
module.exports={createStaleClaimRecovery,clampLease,DEFAULT_LEASE_MINUTES,DEFAULT_INTERVAL_MS,MIN_INTERVAL_MS};
