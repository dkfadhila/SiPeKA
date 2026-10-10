'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),net=require('node:net'),{spawn}=require('node:child_process');
test('report HTTP gates authenticate, deny Staff, require PostgreSQL; no public report export',async t=>{
 const port=await new Promise(r=>{const s=net.createServer().listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>r(p));});}),base='http://127.0.0.1:'+port;
 const fixture=`const a=require('./db');a.db.exec("INSERT INTO business_units(id,code,name,category) VALUES('a','A','Laundry','LAUNDRY');INSERT INTO app_users(id,username,password_hash,full_name,role,assigned_branch_id) VALUES('owner','owner','unused','Owner','OWNER',NULL),('staff','staff','unused','Staff','STAFF','a');");for(const id of ['owner','staff'])a.createSession('fixture-'+id,id);const get=a.getValidSession;a.getValidSession=token=>{const me=get(token);return me&&{...me,session_purpose:'full'};};require('./server');`;
 const child=spawn(process.execPath,['-e',fixture],{cwd:path.resolve(__dirname,'..'),env:{...process.env,DATABASE_URL:'',DB_PATH:':memory:',SIPEKA_SEED:'0',PORT:String(port),PUBLIC_ORIGIN:base,NODE_ENV:'test',ALLOW_PRIVATE_QA_BEARER:'0',PAYROLL_DELIVERY_ENABLED:'0',SIPEKA_WIDYA_ENABLED:'0'}});let logs='';child.stderr.on('data',x=>logs+=x);t.after(async()=>{if(child.exitCode===null){child.kill();await new Promise(r=>child.once('exit',r));}});
 for(let i=0;i<100;i++){try{if((await fetch(base+'/api/health')).ok)break;}catch{}if(child.exitCode!==null)throw Error(logs);await new Promise(r=>setTimeout(r,50));}
 const suffix='?branch_id=all&date_from=2026-10-01&date_to=2026-10-01&timezone=Asia%2FJakarta';
 for(const route of ['/api/reports/profit-loss','/api/reports/fund-requests','/api/reports/daily-closings','/api/reports/audit-evidence/export']){
  const anonymous=await fetch(base+route+suffix);assert.equal(anonymous.status,401);
  const staff=await fetch(base+route+suffix,{headers:{Cookie:'sipeka_session=fixture-staff'}});assert.equal(staff.status,403);assert.equal((await staff.json()).error,'REPORT_OWNER_ONLY');
  const owner=await fetch(base+route+suffix,{headers:{Cookie:'sipeka_session=fixture-owner'}});assert.equal(owner.status,503);assert.equal((await owner.json()).error,'REPORT_POSTGRES_REQUIRED');
 }
});
