'use strict';
// Isolated retained QA schema, synthetic users and document registry only. No production data changes.
const fs=require('node:fs'),cp=require('node:child_process'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const numbering=require('../document-numbering');
const schema='document_numbers_'+crypto.randomBytes(8).toString('hex');
const sql=s=>cp.execFileSync('sudo',['-n','-u','postgres','psql','-X','-At','-v','ON_ERROR_STOP=1','-d','sipeka'],{input:s,encoding:'utf8'});
(async()=>{
 let setup=`CREATE SCHEMA ${schema};SET search_path=${schema};CREATE TABLE schema_migrations(name text PRIMARY KEY,sha256 text NOT NULL);`;
 for(const f of fs.readdirSync('migrations').filter(x=>/^\d+_.*\.sql$/.test(x)).sort())setup+=fs.readFileSync('migrations/'+f,'utf8')+'\n';
 setup+=`GRANT USAGE ON SCHEMA ${schema} TO sipeka_runtime;INSERT INTO app_users(id,username,password_hash,full_name,role) VALUES('owner1','owner1','unused','Owner1','OWNER'),('owner2','owner2','unused','Owner2','OWNER'),('staff','staff','unused','Staff','STAFF');INSERT INTO sessions(token,user_id,expired_at,purpose) SELECT 'qa-'||id,id,(clock_timestamp() AT TIME ZONE 'UTC')+interval '2 hours','full' FROM app_users;INSERT INTO business_units(id,code,name,category) VALUES('kos','UNIT_KOS','Kos RedDoorz','KOS'),('cafe','UNIT_CFE','Cafe','CAFE');`;sql(setup);
 const raw=cp.execFileSync('sudo',['-n','cat','/etc/sipeka/runtime.env'],{encoding:'utf8'}),url=new URL(raw.split('\n').find(x=>x.startsWith('DATABASE_URL=')).slice(13).trim().replace(/^['"]|['"]$/g,''));url.searchParams.set('options','-c search_path='+schema);
 const pool=new(require('pg').Pool)({connectionString:url.toString(),max:20});const checks=[];
 const body=(extra={})=>({report_id:'company-profit-loss',branch_id:'all',date_from:'2026-10-01',date_to:'2026-10-31',view_mode:'company',idempotency_key:crypto.randomUUID(),...extra});
 const issue=(b,token='qa-owner1')=>numbering.issue(pool,token,b);
 try{
  await numbering.guard(pool);checks.push('runtime ACL and immutable trigger startup guard');
  await assert.rejects(issue(body(),'qa-staff'),{status:403});checks.push('Staff denied by current DB authorization');
  const request=body(),first=await issue(request),retry=await issue(request);assert.equal(first.id,retry.id);assert.equal(first.code,'LR/AMC/X/2026/001');assert.equal(first.sequence,'1');checks.push('exact retry returns the same immutable first number');
  await assert.rejects(issue({...request,date_to:'2026-10-30'}),{code:'DOCUMENT_IDEMPOTENCY_CONFLICT',status:409});checks.push('changed request cannot reuse idempotency key');
  const accountability=await issue(body({report_id:'branch-accountability',date_from:'2026-10-28',date_to:'2026-10-28'}));assert.equal(accountability.code,'PJC/AMC/X/2026/001');checks.push('branch accountability has its own document prefix and counter');
  const repeated=await Promise.all(Array.from({length:15},()=>issue(request)));assert.ok(repeated.every(x=>x.id===first.id));checks.push('15 concurrent same-key retries allocate once');
  const concurrent=await Promise.all(Array.from({length:20},()=>issue(body())));assert.equal(new Set(concurrent.map(x=>x.code)).size,20);assert.deepEqual(concurrent.map(x=>Number(x.sequence)).sort((a,b)=>a-b),Array.from({length:20},(_,i)=>i+2));checks.push('20 concurrent distinct requests allocate unique contiguous sequences');
  const alias=await issue(body({report_id:'profit-loss'}));assert.equal(alias.sequence,'22');checks.push('PNL aliases share LR counter');
  const branch=await issue(body({branch_id:'kos',view_mode:'branch'}));assert.equal(branch.code,'LR/RD/X/2026/001');assert.equal(numbering.unitCode({id:'kos',name:'Kos RedDoorz',code:'UNIT_KOS'}),branch.unit_code);checks.push('RedDoorz RD unit code separate from AMC consolidation');
  const month=await issue(body({date_from:'2026-11-01',date_to:'2026-11-30'})),year=await issue(body({date_from:'2027-10-01',date_to:'2027-10-31'}));assert.equal(month.code,'LR/AMC/XI/2026/001');assert.equal(year.code,'LR/AMC/X/2027/001');checks.push('month and year counter boundaries independent');
  const multiyear=await issue(body({report_id:'general-ledger',date_from:'2024-01-01',date_to:'2026-10-31'}));assert.equal(multiyear.code,'RT/AMC/X/2026/001');assert.equal(multiyear.date_from,'2024-01-01');assert.equal(multiyear.date_to,'2026-10-31');numbering.assertMatches(multiyear,{report_id:'general-ledger',branch_id:'all',date_from:'2024-01-01',date_to:'2026-10-31',view_mode:'company'});await assert.rejects(issue(body({report_id:'profit-loss',date_from:'2024-01-01'})),{code:'DOCUMENT_INVALID_REQUEST'});checks.push('multiyear general-ledger issue and export scope accepted while period reports remain bounded');
  await assert.rejects(numbering.get(pool,'qa-owner2',first.id),{code:'DOCUMENT_NOT_FOUND',status:404});assert.equal((await numbering.get(pool,'qa-owner1',first.id)).code,first.code);checks.push('cross-Owner document reads denied');
  await assert.rejects(pool.query("SELECT document_issue($1,'ISSUE',$2::jsonb)",['qa-owner1',JSON.stringify({...body(),id:crypto.randomUUID(),report_code:'FORGED'})]),/DOCUMENT_INVALID_REQUEST/);checks.push('direct function cannot forge a report prefix');
  const client=await pool.connect();try{await client.query('BEGIN');await client.query("SELECT document_issue($1,'ISSUE',$2::jsonb)",['qa-owner1',JSON.stringify({...body({report_id:'cash-flow'}),id:crypto.randomUUID()})]);await client.query('ROLLBACK');}finally{client.release();}assert.equal((await issue(body({report_id:'cash-flow'}))).code,'AK/AMC/X/2026/001');checks.push('rolled-back issue does not burn a counter');
  sql(`SET search_path=${schema};UPDATE document_counters SET last_sequence=999 WHERE report_code='AK';`);assert.equal((await issue(body({report_id:'cash-flow'}))).code,'AK/AMC/X/2026/1000');checks.push('sequence beyond999 remains intact');
  sql(`SET search_path=${schema};INSERT INTO document_unit_overrides(branch_id,unit_code) VALUES('cafe','CF');`);assert.equal((await issue(body({branch_id:'cafe',view_mode:'branch'}))).unit_code,'CF');checks.push('maintenance-only unit code override resolved server-side');
  sql(`SET search_path=${schema};INSERT INTO sessions(token,user_id,expired_at,purpose) VALUES('new-owner1','owner1',(clock_timestamp() AT TIME ZONE 'UTC')+interval '2 hours','full');DELETE FROM sessions WHERE token='qa-owner1';`);await assert.rejects(numbering.get(pool,'qa-owner1',first.id),{status:403});assert.equal((await numbering.get(pool,'new-owner1',first.id)).code,first.code);checks.push('new login retains numbers while revoked session denied');
  const reopened=new(require('pg').Pool)({connectionString:url.toString()});try{assert.equal((await numbering.get(reopened,'new-owner1',first.id)).code,first.code);}finally{await reopened.end();}checks.push('fresh DB connection recovers issued document');
  for(const table of ['document_registry','document_counters','document_unit_overrides'])for(const action of [`SELECT * FROM ${table}`,`DELETE FROM ${table}`])await assert.rejects(pool.query(action));checks.push('runtime direct table access and deletion denied');
  let immutable=false;try{sql(`SET search_path=${schema};UPDATE document_registry SET code='tampered' WHERE id='${first.id}';`);}catch{immutable=true;}assert.equal(immutable,true);checks.push('registry remains immutable even for maintenance owner');
  console.log(JSON.stringify({ok:true,schema,checks},null,2));
 }finally{await pool.end();}
})().catch(e=>{console.error(e.message);process.exitCode=1;});
