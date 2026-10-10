'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {createPayrollTelegramOnboarding}=require('../payroll-telegram-onboarding');
const runtime=process.env.PAYROLL_TEST_PGLITE;
const owner={id:'owner',role:'OWNER'},a={id:'a',role:'STAFF'},b={id:'b',role:'STAFF'};
const secret='isolated_webhook_secret_12345678901234567890';
function start(link,chat=101){return {update_id:1,message:{text:'/start '+new URL(link.start_url).searchParams.get('start'),chat:{id:chat,type:'private'},from:{id:chat,is_bot:false}}};}
async function fixture(fn){assert.ok(runtime,'PAYROLL_TEST_PGLITE required');const {PGlite}=require(runtime),db=new PGlite();let tail=Promise.resolve();const pool={query:(s,p)=>db.query(s,p),async connect(){let release;const prior=tail;tail=new Promise(r=>release=r);await prior;return {query:(s,p)=>db.query(s,p),release};}};
try{for(const name of ['001_initial.sql','004_payroll.sql','009_payroll_telegram_onboarding.sql'])await db.exec(fs.readFileSync(require.resolve('../migrations/'+name),'utf8'));
await db.exec(`INSERT INTO app_users(id,username,password_hash,full_name,role) VALUES('owner','owner','fixture','Owner','OWNER'),('a','alice','fixture','Alice','STAFF'),('b','bob','fixture','Bob','STAFF');
CREATE ROLE payroll_narrow NOSUPERUSER NOINHERIT NOCREATEDB NOCREATEROLE;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO payroll_narrow;
GRANT SELECT ON app_users,payroll_telegram_bindings,payroll_access_audit TO payroll_narrow;
GRANT UPDATE(telegram_user_id,telegram_verified) ON app_users TO payroll_narrow;
GRANT INSERT,UPDATE ON payroll_telegram_bindings TO payroll_narrow;
GRANT INSERT ON payroll_access_audit TO payroll_narrow;
SET ROLE payroll_narrow;`);
let observed=0;const original=pool.connect;pool.connect=async()=>{const c=await original();return {...c,async query(s,p){const result=await c.query(s,p);if(s==='SELECT pg_catalog.pg_advisory_xact_lock(1397313611, 9)'){const locks=(await c.query("SELECT mode,granted FROM pg_locks WHERE locktype='advisory' AND classid=1397313611 AND objid=9 AND objsubid=2")).rows;assert.deepEqual(locks,[{mode:'ExclusiveLock',granted:true}]);observed++;}return result;}};};
const onboard=createPayrollTelegramOnboarding({pool,botUsername:'isolated_fixture_bot',webhookSecret:secret});await fn({db,pool,onboard});assert.ok(observed>0,'actual transaction advisory lock observed');assert.equal((await db.query("SELECT count(*) n FROM pg_locks WHERE locktype='advisory'")).rows[0].n,0,'commit/rollback releases lock');}finally{await db.close();}}
test('column-only runtime completes issue/private proof/exact Owner confirmation/revoke without table UPDATE',()=>fixture(async({db,onboard})=>{
const acl=(await db.query("SELECT current_user role,has_table_privilege(current_user,'app_users','UPDATE') broad,has_column_privilege(current_user,'app_users','telegram_user_id','UPDATE') contact,has_column_privilege(current_user,'app_users','role','UPDATE') role_update")).rows[0];assert.deepEqual(acl,{role:'payroll_narrow',broad:false,contact:true,role_update:false});
await assert.rejects(db.query("UPDATE app_users SET role='OWNER' WHERE id='a'"),e=>e.code==='42501');
const link=await onboard.issue(a);await onboard.webhook(secret,start(link));await assert.rejects(onboard.webhook(secret,start(link)),/START_INVALID/);await assert.rejects(onboard.confirm(a,{binding_id:link.id,user_id:'a',chat_id:'101',confirmed:true}),/OWNER_ONLY/);await assert.rejects(onboard.confirm(owner,{binding_id:link.id,user_id:'a',chat_id:'202',confirmed:true}),/REVIEW_STALE/);
await onboard.confirm(owner,{binding_id:link.id,user_id:'a',chat_id:'101',confirmed:true});assert.deepEqual(await onboard.status(a),{verified:true,has_contact:true,pending:false});await onboard.revokeContact(owner,{user_id:'a',chat_id:'101',confirmed:true});assert.deepEqual(await onboard.status(a),{verified:false,has_contact:false,pending:false});
const rejected=await onboard.issue(b);await onboard.reject(owner,rejected.id);assert.equal((await onboard.pending(owner)).length,0);
}));
test('serialized WASM competing worker instances reserve one shared recipient; DB uniqueness independently rejects bypass',()=>fixture(async({db,pool,onboard})=>{
const other=createPayrollTelegramOnboarding({pool,botUsername:'isolated_fixture_bot',webhookSecret:secret});const la=await onboard.issue(a),lb=await other.issue(b);
const results=await Promise.allSettled([onboard.webhook(secret,start(la)),other.webhook(secret,start(lb))]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected'&&/ALREADY_ASSIGNED/.test(r.reason.message)).length,1);
const pending=(await db.query("SELECT id,user_id,chat_id FROM payroll_telegram_bindings WHERE status='pending'")).rows;assert.equal(pending.length,1);const win=pending[0],lose=win.user_id==='a'?lb:la;
await assert.rejects(db.query("UPDATE payroll_telegram_bindings SET status='pending',chat_id='101',consumed_at=clock_timestamp() WHERE id=$1",[lose.id]),e=>e.code==='23505');
await onboard.confirm(owner,{binding_id:win.id,user_id:win.user_id,chat_id:win.chat_id,confirmed:true});await assert.rejects(other.webhook(secret,start(lose)),/ALREADY_ASSIGNED/);await assert.rejects(db.query("UPDATE app_users SET telegram_user_id='101' WHERE id<>$1 AND role='STAFF'",[win.user_id]),e=>e.code==='23505');assert.equal((await db.query("SELECT id FROM app_users WHERE telegram_user_id='101'")).rows.length,1);
}));
