'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const numbering=require('../document-numbering');
const runtime=process.env.REPORTS_TEST_PGLITE||process.env.PAYROLL_TEST_PGLITE;
test('real PostgreSQL numbering preserves issued identities while new reports use Owner unit codes and three-letter prefixes',{skip:!runtime,timeout:90000},async t=>{
 const {PGlite}=require(runtime),db=new PGlite();t.after(()=>db.close());
 await db.exec('CREATE ROLE sipeka_runtime;');
 const dir=path.join(__dirname,'../migrations');
 for(const name of fs.readdirSync(dir).filter(n=>/^\d+_.*\.sql$/.test(n)&&Number(n.slice(0,3))<=18).sort())await db.exec(fs.readFileSync(path.join(dir,name),'utf8'));
 await db.exec(`INSERT INTO app_users(id,username,password_hash,full_name,role) VALUES('owner','owner','unused','Owner','OWNER'),('other','other','unused','Other Owner','OWNER'),('staff','staff','unused','Staff','STAFF');
 INSERT INTO sessions(token,user_id,expired_at,purpose) SELECT 'session-'||id,id,(clock_timestamp() AT TIME ZONE 'UTC')+interval '2 hours','full' FROM app_users;
 INSERT INTO business_units(id,code,name,category) VALUES('rd','RD','RedDoorz','KOS'),('rdx','RDX','RedDoorz Secondary','KOS'),('oldrd','UNIT_KOS','Kos RedDoorz Lama','KOS'),('legacy','UNIT_CFE','Cafe Lama','CAFE'),('long','ABCDE','Invalid legacy','CAFE'),('number','ABC1','Number legacy','CAFE'),('reserved','AMC','Invalid company branch','CAFE'),('override','OVR','Override','CAFE');`);
 const pool={async query(sql,params){return db.query(sql,params);}};
 const body=(extra={})=>({report_id:'company-profit-loss',branch_id:'all',date_from:'2026-10-01',date_to:'2026-10-31',view_mode:'company',idempotency_key:crypto.randomUUID(),...extra});
 const originalRequest=body(),old=await numbering.issue(pool,'session-owner',originalRequest);
 assert.equal(old.code,'LR/AMC/X/2026/001');
 const before=(await db.query('SELECT * FROM document_registry ORDER BY id')).rows;
 await db.exec(fs.readFileSync(path.join(dir,'019_document_unit_codes.sql'),'utf8'));
 assert.deepEqual((await db.query('SELECT * FROM document_registry ORDER BY id')).rows,before);
 assert.equal((await numbering.issue(pool,'session-owner',originalRequest)).code,old.code,'original retries preserve their issued prefix');
 assert.equal((await numbering.get(pool,'session-owner',old.id)).code,old.code,'stored issued identities are still readable');
 await assert.rejects(numbering.issue(pool,'session-owner',{...originalRequest,date_to:'2026-10-30'}),{code:'DOCUMENT_IDEMPOTENCY_CONFLICT'});
 await assert.rejects(numbering.get(pool,'session-other',old.id),{code:'DOCUMENT_NOT_FOUND'});
 await assert.rejects(numbering.issue(pool,'session-staff',body()),{code:'DOCUMENT_OWNER_REQUIRED',status:403});
 // Exercise each prefix through the SQL issuer, not just a duplicate JS table.
 for(const [report_id,prefix]of Object.entries(numbering.reportCodes)){
  const issued=await numbering.issue(pool,'session-owner',body({report_id}));
  assert.equal(issued.report_code,prefix,report_id);assert.match(issued.code,/^[A-Z]{2,4}\/AMC\/X\/2026\/\d{3,}$/);assert.match(prefix,/^[A-Z]{3}$/);
 }
 for(const [branch_id,code]of [['rd','RD'],['rdx','RDX'],['oldrd','RD'],['legacy','CFE']]){
  const issued=await numbering.issue(pool,'session-owner',body({report_id:'fund-position',branch_id,view_mode:'branch'}));
  assert.equal(issued.unit_code,code,branch_id);assert.equal(issued.report_code,'NRC');assert.match(issued.code,new RegExp('^NRC/'+code+'/X/2026/\\d{3,}$'));
 }
 for(const branch_id of ['long','number','reserved'])await assert.rejects(numbering.issue(pool,'session-owner',body({branch_id,view_mode:'branch'})),{code:'DOCUMENT_INVALID_UNIT'});
 await db.query("INSERT INTO document_unit_overrides(branch_id,unit_code) VALUES('override','OF')");
 assert.equal((await numbering.issue(pool,'session-owner',body({branch_id:'override',view_mode:'branch'}))).unit_code,'OF');
 await db.query("UPDATE document_unit_overrides SET unit_code='INVALID' WHERE branch_id='override'");
 await assert.rejects(numbering.issue(pool,'session-owner',body({branch_id:'override',view_mode:'branch'})),{code:'DOCUMENT_INVALID_UNIT'});
 const same=body({report_id:'fund-position',date_from:'2026-11-01',date_to:'2026-11-30'}),retries=await Promise.all(Array.from({length:10},()=>numbering.issue(pool,'session-owner',same)));
 assert.equal(new Set(retries.map(r=>r.id)).size,1);assert.equal(retries[0].code,'NRC/AMC/XI/2026/001');
 const distinct=await Promise.all(Array.from({length:10},()=>numbering.issue(pool,'session-owner',body({report_id:'fund-position',date_from:'2026-11-01',date_to:'2026-11-30'}))));
 assert.equal(new Set(distinct.map(r=>r.code)).size,10);assert.deepEqual(distinct.map(r=>Number(r.sequence)).sort((a,b)=>a-b),[2,3,4,5,6,7,8,9,10,11]);
 await assert.rejects(db.query("UPDATE document_registry SET code='changed' WHERE id=$1",[old.id]),/APPEND_ONLY_document_registry_TERKUNCI/);
 const helper=(await db.query("SELECT p.prosecdef,p.proconfig,EXISTS(SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE') public,has_function_privilege('sipeka_runtime',p.oid,'EXECUTE') runtime FROM pg_proc p WHERE p.oid='document_unit_code(text)'::regprocedure")).rows[0];
 assert.equal(helper.prosecdef,true);assert.ok(helper.proconfig.includes('search_path=public, pg_temp'));assert.equal(helper.public,false);assert.equal(helper.runtime,false);
 await db.exec('SET ROLE sipeka_runtime');
 await numbering.guard(pool);
 await assert.rejects(db.query("SELECT document_unit_code('rd')"),/permission denied/);
 const runtimeIssue=await numbering.issue(pool,'session-owner',body({report_id:'fund-position',branch_id:'rdx',view_mode:'branch'}));assert.equal(runtimeIssue.unit_code,'RDX');
 await assert.rejects(db.query('SELECT * FROM document_registry'),/permission denied/);
});
