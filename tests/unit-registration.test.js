'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const registration=require('../unit-registration');
test('unit registration API validation normalizes letters and rejects missing, forged, reserved or malformed fields',async()=>{
 assert.deepEqual(registration.normalize({name:' RedDoorz ',code:' rd ',category:' KOS '}),{name:'RedDoorz',code:'RD',category:'KOS'});
 for(const code of ['RD','RDX','ABCD'])assert.equal(registration.normalize({name:'Unit',code}).code,code);
 for(const code of ['','A','ABCDE','RD1','R-D','R_D','RD/','éé'])assert.throws(()=>registration.normalize({name:'Unit',code}),{code:'UNIT_CODE_INVALID'});
 assert.throws(()=>registration.normalize({name:'Unit',code:'amc'}),{code:'UNIT_CODE_RESERVED'});
 for(const body of [null,[],{name:'Unit'},{name:'Unit',code:12},{name:'\nUnit',code:'NEW'},{name:'Unit',code:'NEW',category:'\nOTHER'},{name:'Unit',code:'NEW',id:'caller-id'}])assert.throws(()=>registration.normalize(body));
 const calls=[],pool={async query(sql,args){calls.push({sql,args});return {rows:[{result:{ok:true,code:'RD'}}]};}};
 assert.equal((await registration.create(pool,'private-session',{name:'RedDoorz',code:'rd'})).code,'RD');assert.equal(calls.length,1);assert.match(calls[0].sql,/unit_create\(\$1,\$2::jsonb\)/);assert.equal(calls[0].args[0],'private-session');assert.match(JSON.parse(calls[0].args[1]).id,/^UNIT_[a-f0-9]{24}$/);
 for(const [message,sqlcode,status]of [['UNIT_CODE_DUPLICATE','P0001',409],['UNIT_NAME_DUPLICATE','P0001',409],['UNIT_OWNER_REQUIRED','42501',403],['sensitive connection detail','08006',503]]){
  await assert.rejects(registration.create({async query(){throw Object.assign(Error(message),{code:sqlcode});}},'private-session',{name:'Unit',code:'NEW'}),{code:message.startsWith('UNIT_')?message:'UNIT_CREATE_UNAVAILABLE',status});
 }
});
const runtime=process.env.PAYROLL_TEST_PGLITE||process.env.REPORTS_TEST_PGLITE;
test('real PostgreSQL unit registration rejects effective/archived collisions, preserves history and enforces Owner authority',{skip:!runtime,timeout:90000},async t=>{
 const db=new(require(runtime).PGlite)();t.after(()=>db.close());const pool={query:(sql,args)=>db.query(sql,args)};
 await db.exec('CREATE ROLE sipeka_runtime');
 for(const name of fs.readdirSync(path.join(__dirname,'../migrations')).filter(n=>/^\d+_.*\.sql$/.test(n)).sort())await db.exec(fs.readFileSync(path.join(__dirname,'../migrations',name),'utf8'));
 await db.exec(`INSERT INTO business_units(id,code,name,category,is_active) VALUES('legacy','UNIT_KOS','Kos RedDoorz','KOS',1),('archived','OLD','Archived Unit','OTHER',0),('override','VIL','Villa','OTHER',1),('badlegacy','TOOLONG','Old invalid code','OTHER',0);
 INSERT INTO document_unit_overrides(branch_id,unit_code) VALUES('override','VLL');
 INSERT INTO app_users(id,username,password_hash,full_name,role) VALUES('owner','owner','unused','Owner','OWNER'),('staff','staff','unused','Staff','STAFF');
 INSERT INTO sessions(token,user_id,expired_at,purpose) SELECT 'session-'||id,id,(clock_timestamp() AT TIME ZONE 'UTC')+interval '1 hour','full' FROM app_users;`);
 const before=(await db.query('SELECT * FROM business_units ORDER BY id')).rows;
 const acl=(await db.query("SELECT prosecdef,proconfig,has_function_privilege('sipeka_runtime',oid,'EXECUTE') runtime,EXISTS(SELECT 1 FROM aclexplode(proacl) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE') public FROM pg_proc WHERE oid='unit_create(text,jsonb)'::regprocedure")).rows[0];assert.equal(acl.prosecdef,true);assert.equal(acl.runtime,true);assert.equal(acl.public,false);assert.ok(acl.proconfig.includes('search_path=public, pg_temp'));
 await db.exec('SET ROLE sipeka_runtime');
 await assert.rejects(registration.create(pool,'session-staff',{name:'Forbidden',code:'FOR'}),{code:'UNIT_OWNER_REQUIRED',status:403});
 for(const code of ['RD','OLD','VLL'])await assert.rejects(registration.create(pool,'session-owner',{name:'Attempt '+code,code}),{code:'UNIT_CODE_DUPLICATE',status:409});
 await assert.rejects(registration.create(pool,'session-owner',{name:'Villa',code:'NEW'}),{code:'UNIT_NAME_DUPLICATE',status:409});
 for(const code of ['A','ABCDE','RD1','amc'])await assert.rejects(pool.query("SELECT unit_create('session-owner',$1::jsonb)",[JSON.stringify({id:'UNIT_'+'a'.repeat(24),name:'Forged '+code,code,category:'OTHER'})]),/UNIT_CODE_INVALID/);
 await assert.rejects(pool.query("SELECT unit_create('session-owner',$1::jsonb)",[JSON.stringify({id:'UNIT_'+'a'.repeat(24),name:'Reserved',code:'AMC',category:'OTHER'})]),/UNIT_CODE_RESERVED/);
 const results=await Promise.allSettled([registration.create(pool,'session-owner',{name:'New A',code:'NEW'}),registration.create(pool,'session-owner',{name:'New B',code:'NEW'})]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.find(r=>r.status==='rejected').reason.code,'UNIT_CODE_DUPLICATE');
 const created=results.find(r=>r.status==='fulfilled').value;assert.equal(created.code,'NEW');assert.match(created.id,/^UNIT_[a-f0-9]{24}$/);
 const document=await require('../document-numbering').issue(pool,'session-owner',{report_id:'fund-position',branch_id:created.id,view_mode:'branch',date_from:'2026-10-01',date_to:'2026-10-31',idempotency_key:require('node:crypto').randomUUID()});assert.equal(document.code,'NRC/NEW/X/2026/001');
 assert.equal(require('../document-format').slipCode({period:'2026-10',employee_id:'002',unit_code:created.code,department:'Operasional'}),'SLIP/NEW-OPS/X/2026/002');
 await assert.rejects(pool.query("SELECT document_unit_code('legacy')"),/permission denied/);
 await db.exec('RESET ROLE');assert.deepEqual((await db.query('SELECT * FROM business_units WHERE id<>$1 ORDER BY id',[created.id])).rows,before);assert.equal((await db.query('SELECT count(*)::integer n FROM ledger_transactions')).rows[0].n,0);
});
