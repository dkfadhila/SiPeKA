'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {randomBytes}=require('node:crypto');
const {Pool}=require('pg');
const {migrate}=require('../migrations/runner');

test('real PostgreSQL API parity, rollback, concurrent approval, idempotency, closing finality and session revocation',async()=>{
 assert.ok(process.env.DATABASE_URL,'Disposable PostgreSQL required');
 const original=process.env.DATABASE_URL;
 const schema='pgbusiness_'+randomBytes(8).toString('hex');
 const admin=new Pool({connectionString:original});
 let direct,adapter;
 try {
  await admin.query(`CREATE SCHEMA ${schema}`);
  const url=new URL(original);url.searchParams.set('options',`-c search_path=${schema}`);process.env.DATABASE_URL=url.toString();
  direct=new Pool({connectionString:process.env.DATABASE_URL});
  await migrate(direct);
  adapter=require('../db-postgres');await adapter.ready;
  const {q,withRequestTransaction:transaction}=adapter;
  await q.insertBranch.run('B','B','Fixture branch','LAUNDRY');
  await q.insertBranch.run('B2','B2','Fixture branch 2','LAUNDRY');
  await q.insertUser.run('O','owner','fixture-hash','Owner','OWNER',null);
  await q.insertUser.run('S','staff','fixture-hash','Staff','STAFF','B');
  await q.insertUser.run('S2','staff2','fixture-hash','Staff 2','STAFF','B');
  await direct.query("INSERT INTO chart_of_accounts VALUES('R','4101','Income','REVENUE'),('E','5101','Expense','EXPENSE')");
  assert.equal((await q.userByUsername.get('staff')).id,'S');
  assert.equal((await q.unitByIdActive.get('B')).is_active,1);
  assert.equal((await q.allCoa.all()).length,2);
  assert.equal((await q.coaById.get('E')).account_type,'EXPENSE');
  assert.equal((await q.allUnits.all()).length,2);
  assert.equal((await q.allUsers.all()).length,3);
  assert.match((await q.userById.get('S')).created_at,/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  await assert.rejects(transaction(async()=>{await q.insertBranch.run('ROLL','ROLL','Rollback','LAUNDRY');throw new Error('rollback');}),/rollback/);
  assert.equal(await q.unitById.get('ROLL'),undefined);
  await transaction(async()=>{
   await assert.rejects(q.insertBranch.run('B','DUP','Duplicate','LAUNDRY'));
   await q.insertBranch.run('RECOVER','RECOVER','Recovered after constraint error','LAUNDRY');
  });
  assert.ok(await q.unitById.get('RECOVER'));
  await transaction(async()=>{
   const siblings=await Promise.allSettled([
    transaction(async()=>{await q.insertBranch.run('NESTED-FAIL','NF','Nested rollback','LAUNDRY');await new Promise(r=>setTimeout(r,20));throw new Error('nested-rollback');}),
    transaction(async()=>{await q.insertBranch.run('NESTED-OK','NO','Nested success','LAUNDRY');}),
   ]);
   assert.equal(siblings[0].status,'rejected');assert.equal(siblings[1].status,'fulfilled');
  });
  assert.equal(await q.unitById.get('NESTED-FAIL'),undefined);
  assert.ok(await q.unitById.get('NESTED-OK'),'Sibling savepoints must not roll back successful work');
  await assert.rejects(q.updateUserPassword.run('hash','missing'),e=>e.code==='ROW_COUNT_MISMATCH');
  const insert=(id,amount=100,status='APPROVED',intent='SETOR_NOTA',method='CASH_DRAWER',user='S')=>
   q.insertTx.run(id,'key-'+id,'B',user,'R','INCOME',amount,method,'memo',null,status,intent,user,'B','fingerprint-'+id);
  await insert('T',9007199254740991,'APPROVED','SETOR_NOTA','QRIS');
  assert.equal((await q.txById.get('T')).amount,9007199254740991);
  assert.equal((await q.txAll.all())[0].user_name,'Staff');
  await q.updateUserPassword.run('changed-hash-before-reset','S');
  assert.equal((await q.userById.get('S')).password_hash,'changed-hash-before-reset');
  await assert.rejects(adapter.db.prepare("INSERT INTO business_units(id,code,name,category) VALUES('RAW','RAW','Unsafe unscoped mutation','LAUNDRY')").get(),/mutating|write|read-only/i);
  assert.equal(await q.unitById.get('RAW'),undefined);
  assert.equal((await adapter.checkIdempotency('key-T','S','B','fingerprint-T')).conflict,false);
  assert.equal((await adapter.checkIdempotency('key-T','S2','B','fingerprint-T')).conflict,true);
  assert.equal((await adapter.checkIdempotency('key-T','S','B','changed-memo')).conflict,true);
  assert.equal((await adapter.checkIdempotency('absent','S','B','x')).exists,false);
  await insert('P',500,'PENDING_APPROVAL');
  const approvals=await Promise.all([adapter.atomicApprove('P','APPROVED','O','approved'),adapter.atomicApprove('P','REJECTED','O','rejected')]);
  assert.equal(approvals.filter(r=>r.ok).length,1);
  assert.equal(approvals.filter(r=>r.statusCode===409).length,1);
  assert.equal((await q.approvalLogsByTx.all('P')).length,1);
  assert.equal((await adapter.atomicApprove('absent','APPROVED','O','')).statusCode,404);
  assert.equal((await adapter.atomicApprove('P','INVALID','O','')).statusCode,400);
  await insert('FAIL',1,'PENDING_APPROVAL');
  assert.equal((await adapter.atomicApprove('FAIL','APPROVED','missing-reviewer','')).statusCode,500);
  assert.equal((await q.txById.get('FAIL')).status,'PENDING_APPROVAL');
  assert.equal((await q.approvalLogsByTx.all('FAIL')).length,0);
  await direct.query("INSERT INTO ledger_transactions(id,idempotency_key,branch_id,user_id,coa_id,tx_type,amount,payment_method,status,tx_intent,created_at) VALUES('OLD','key-OLD','B','S','R','INCOME',42,'QRIS','APPROVED','SETOR_NOTA','2000-01-01 17:00:00')");
  assert.ok(!(await q.txStaffToday.all('S','B')).some(r=>r.id==='OLD'));
  assert.equal((await q.txStaffToday.all('S','B2')).length,0);
  await insert('ADV',999,'APPROVED','PENGAJUAN_DANA');
  await insert('CASH',25);
  const expected=25+((await q.txById.get('P')).status==='APPROVED'?500:0);
  assert.equal((await q.cashDrawerBalanceToday.get('B')).balance,expected);
  await assert.rejects(q.staffPerf.all(),/safe API numeric range/); // Aggregate max-safe+42 cannot silently round.
  for(const sql of ["UPDATE ledger_transactions SET memo='tamper' WHERE id='T'","DELETE FROM ledger_transactions WHERE id='T'","UPDATE ledger_transactions SET status='REJECTED' WHERE id='T'","DELETE FROM approval_logs WHERE transaction_id='P'"]) await assert.rejects(direct.query(sql),e=>e.code==='23514');
  const closing=user=>q.insertClosing.run('C-'+user,'B',user,expected,expected,0,'',1,1.25,0.5,0,expected,0,0,1.125,2.5,'notes','closing-'+user,'closing-fingerprint');
  await closing('S');await closing('S2');
  await assert.rejects(closing('S'),e=>e.code==='23505');
  assert.equal((await q.closingTodayByBranch.get('B')).n,2);
  assert.equal((await q.closingsByBranchToday.all('B')).length,2);
  assert.equal((await q.allClosingsToday.all()).length,2);
  const close=await q.closingTodayByUser.get('S','B');
  assert.equal((await q.closingByUserDate.get('S','B',close.closing_date)).id,close.id);
  assert.equal(close.kg_reguler,1.25);
  await assert.rejects(direct.query("UPDATE cash_closings SET reason='tamper' WHERE id='C-S'"),e=>e.code==='23514');
  await assert.rejects(direct.query("DELETE FROM cash_closings WHERE id='C-S'"),e=>e.code==='23514');
  assert.equal((await adapter.atomicApprove('FAIL','APPROVED','O','after-close')).statusCode,409);
  assert.equal((await q.approvalLogsByTx.all('FAIL')).length,0);
  assert.equal((await adapter.atomicApprove('FAIL','REJECTED','O','allowed-rejection')).ok,true);
  await q.insertReceipt.run('fixture.jpg','S','B','image/jpeg');assert.equal((await q.receiptByFilename.get('fixture.jpg')).user_id,'S');
  await adapter.createSession('fixture-token','S');assert.equal((await adapter.getValidSession('fixture-token')).id,'S');
  await direct.query("UPDATE sessions SET expired_at='2000-01-01 00:00:00' WHERE token='fixture-token'");
  assert.equal(await adapter.getValidSession('fixture-token'),null);
  await adapter.createSession('a','S');await adapter.createSession('b','S');
  await transaction(async()=>{await q.resetUserPassword.run('changed-hash','S');await adapter.revokeUserSessions('S');});
  assert.equal(await adapter.getValidSession('a'),null);assert.equal(await adapter.getValidSession('b'),null);
  assert.equal((await q.dropSession.run('absent')).changes,0);
  let active=0,max=0;
  await Promise.all(Array.from({length:6},()=>transaction(async()=>{active++;max=Math.max(max,active);await new Promise(r=>setTimeout(r,15));active--;})));
  assert.equal(max,1,'Global transaction lock serializes pooled request mutations');
 } finally {
  if(adapter)await adapter.db.close();if(direct)await direct.end();
  await admin.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await admin.end();process.env.DATABASE_URL=original;
 }
});
