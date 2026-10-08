'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),net=require('node:net'),{spawn}=require('node:child_process');
test('Staff closing bootstrap and GET isolate authenticated user, assigned branch, WIB today; Owner remains branchwide',async t=>{
 const root=path.resolve(__dirname,'..');
 const port=await new Promise(r=>{const s=net.createServer().listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>r(p));});}),base='http://127.0.0.1:'+port;
 const fixture=`const a=require('./db');
 a.db.exec("INSERT INTO business_units(id,code,name,category) VALUES('a','A','Laundry A','LAUNDRY'),('b','B','Laundry B','LAUNDRY');INSERT INTO app_users(id,username,password_hash,full_name,role,assigned_branch_id) VALUES('owner','owner','unused','Owner','OWNER',NULL),('s1','s1','unused','Staff 1','STAFF','a'),('s2','s2','unused','Staff 2','STAFF','a'),('s3','s3','unused','Staff 3','STAFF','b');");
 for(const [id,u,b,d] of [['own','s1','a',0],['same-branch-other-user','s2','a',0],['other-branch','s3','b',0],['own-old-branch','s1','b',0],['yesterday','s1','a',-1],['tomorrow','s1','a',1]])a.db.prepare("INSERT INTO cash_closings(id,user_id,branch_id,closing_date,system_balance,physical_cash,difference) VALUES(?,?,?,date('now','+7 hours',?),0,0,0)").run(id,u,b,d+' days');
 for(const id of ['owner','s1','s2','s3'])a.createSession('fixture-'+id,id);
 // SQLite lacks PG full-session metadata; fixture supplies it, never changes production auth.
 const session=a.getValidSession;a.getValidSession=token=>{const me=session(token);return me&&{...me,session_purpose:'full'};};
 require('./server');`;
 const child=spawn(process.execPath,['-e',fixture],{cwd:root,env:{...process.env,DATABASE_URL:'',DB_PATH:':memory:',SIPEKA_SEED:'0',PORT:String(port),PUBLIC_ORIGIN:base,NODE_ENV:'test',REQUIRE_OWNER_2FA:'0',ALLOW_PRIVATE_QA_BEARER:'0',PAYROLL_DELIVERY_ENABLED:'0',SIPEKA_WIDYA_ENABLED:'0'}});let logs='';child.stderr.on('data',x=>logs+=x);
 t.after(async()=>{if(child.exitCode===null){child.kill();await new Promise(r=>child.once('exit',r));}});
 for(let i=0;i<100;i++){try{if((await fetch(base+'/api/health')).ok)break;}catch{}if(child.exitCode!==null)throw Error(logs);await new Promise(r=>setTimeout(r,50));}
 async function get(route,id){const r=await fetch(base+route,{headers:{Origin:base,Cookie:'sipeka_session=fixture-'+id}});assert.equal(r.status,200);return r.json();}
 for(const route of ['/api/closing/summary','/api/closings']){
  for(const [id,expected] of [['s1',['own']],['s2',['same-branch-other-user']],['s3',['other-branch']]]){
   const body=await get(route+'?user_id=s2&branch_id=b&date=2000-01-01',id),rows=Array.isArray(body)?body:body.closings;
   assert.deepEqual(rows.map(r=>r.id).sort(),expected,route+' must not leak other Staff, branch or date');
   assert.ok(rows.every(r=>r.user_name&&r.branch_name),'preserve joined display fields');
  }
  const body=await get(route,'owner'),rows=Array.isArray(body)?body:body.closings;
  assert.deepEqual(rows.map(r=>r.id).sort(),['other-branch','own','own-old-branch','same-branch-other-user']);
 }
});
