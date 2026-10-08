'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{spawn}=require('node:child_process'),net=require('node:net');
test('actual runtime HTTP cookies, Origin, explicit cash confirmation, Staff denial, reports and daily movement',async t=>{
 const port=await new Promise(r=>{const s=net.createServer().listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>r(p));});});const base='http://127.0.0.1:'+port;
 const child=spawn(process.execPath,['server.js'],{env:{...process.env,PORT:String(port),HOST:'127.0.0.1',PUBLIC_ORIGIN:base,NODE_ENV:'test',REQUIRE_OWNER_2FA:'0',PAYROLL_DELIVERY_ENABLED:'0',SIPEKA_WIDYA_ENABLED:'0',ALLOW_PRIVATE_QA_BEARER:'0'}});let logs='';child.stderr.on('data',x=>logs+=x);t.after(()=>child.kill());
 for(let i=0;i<100;i++){try{if((await fetch(base+'/api/health')).ok)break;}catch{}if(child.exitCode!==null)throw Error(logs);await new Promise(r=>setTimeout(r,100));}
 async function api(path,actor='owner',body,origin=base){const r=await fetch(base+path,{method:body?'POST':'GET',headers:{Cookie:'sipeka_session='+actor+'-token',Origin:origin,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});return {status:r.status,body:await r.json()};}
 assert.equal((await api('/api/advances','staff')).status,403);
 assert.equal((await api('/api/advances/adv/disburse','owner',{idempotencyKey:'http',evidence:'Explicit fixture cash paid'},'https://evil.invalid')).status,403);
 assert.equal((await api('/api/advances/adv/disburse','owner',{idempotencyKey:'http',evidence:'Explicit fixture cash paid'})).status,400);
 const snap=await api('/api/advances');if(snap.status!==200){const {Pool}=require('pg'),pool=new Pool({connectionString:process.env.DATABASE_URL});try{await require('../advance-service').snapshot(pool,'owner-token');}catch(e){console.log(e.message);}finally{await pool.end();}}assert.equal(snap.status,200);assert.ok(snap.body.rows.length);
 assert.equal((await api('/api/advances/own-unresolved','staff')).status,200);
 assert.equal((await api('/api/advances/adv/disburse','staff',{confirmed:true,idempotencyKey:'bad',evidence:'Explicit fixture cash paid'})).status,403);
 const cash=await api('/api/closing/summary?branch_id=b');assert.equal(cash.status,200);assert.equal(cash.body.system_balance,-1150000);assert.equal(cash.body.basis,'RECORDED_DAY_MOVEMENT');
 const report=await api('/api/reports/advance-movements?start=2026-01-01&end=2099-12-31&branchId=b');assert.equal(report.status,200);assert.equal(report.body.cashDelta,'-1150000');
 assert.equal((await api('/api/reports/advance-movements?start=2026-01-01&end=2099-12-31','staff')).status,403);
 const close=await api('/api/closing','staff',{physical_cash:0,reason:'Fixture negative recorded cash without opening',idempotency_key:'advance-close'});assert.equal(close.status,201);
 const denied=await api('/api/advances/adv2/disburse','owner',{confirmed:true,idempotencyKey:'closed',evidence:'Fixture closed event day test'});assert.equal(denied.status,409);assert.equal(denied.body.error,'ADVANCE_SHIFT_CLOSED');
 const replay=await api('/api/advances/adv2/disburse','owner',{confirmed:true,idempotencyKey:'other-disburse',evidence:'Owner paid second fixture advance'});assert.equal(replay.status,200);
 console.log(JSON.stringify({actualHttp:true,schema:process.env.ADVANCE_TEST_SCHEMA,cash:cash.body,productionFinancialWrites:false}));
});
