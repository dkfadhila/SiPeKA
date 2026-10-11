'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const runtime=process.env.REPORTS_TEST_PGLITE;
test('isolated PostgreSQL/WASM actual migrations + authenticated advance lifecycle produce Owner outstanding queue',{skip:!runtime},async()=>{
 const {PGlite}=require(runtime),db=new PGlite();try{const pool={query:async(sql,args)=>{if(!args&&sql.includes(';'))return (await db.exec(sql)).at(-1);return db.query(sql,args);}};pool.connect=async()=>({query:pool.query,release(){}});await require('../migrations/runner').migrate(pool);
 await db.exec(`INSERT INTO business_units(id,code,name,category,is_active) VALUES('a','A','Laundry','LAUNDRY',1),('b','B','Other','LAUNDRY',1);
 INSERT INTO app_users(id,username,password_hash,full_name,role,assigned_branch_id) VALUES('owner','fixture-owner','unused','Fixture Owner','OWNER',NULL),('staff','fixture-staff','unused','Fixture Staff','STAFF','a');
 INSERT INTO chart_of_accounts VALUES('coa','5101','Expense','EXPENSE');
 INSERT INTO sessions(token,user_id,expired_at,purpose) VALUES('fixture-owner','owner',(clock_timestamp() AT TIME ZONE 'UTC')+interval '1 hour','full'),('fixture-staff','staff',(clock_timestamp() AT TIME ZONE 'UTC')+interval '1 hour','full');
 INSERT INTO receipt_assets(filename,user_id,branch_id,mime) VALUES('one.jpeg','staff','a','image/jpeg'),('two.jpeg','staff','a','image/jpeg');
 INSERT INTO ledger_transactions(id,idempotency_key,branch_id,user_id,coa_id,tx_type,amount,payment_method,memo,status,tx_intent) VALUES('request','request','a','staff','coa','EXPENSE',1000,'CASH_DRAWER','Request','PENDING_APPROVAL','PENGAJUAN_DANA'),('advance','advance','a','staff','coa','EXPENSE',1000,'CASH_DRAWER','Settlement','APPROVED','PENGAJUAN_DANA'),('unpaid','unpaid','a','staff','coa','EXPENSE',1000,'CASH_DRAWER','Unpaid','APPROVED','PENGAJUAN_DANA');`);
 const src=fs.readFileSync(path.join(__dirname,'../public/financial-dashboard.html'),'utf8'),ctx={};vm.runInNewContext(src.match(/\/\* OWNER_QUEUE_PURE_START \*\/([\s\S]*?)\/\* OWNER_QUEUE_PURE_END \*\//)[1]+';this.build=ownerApprovalQueue',ctx);
 const svc=require('../advance-service');async function queue(){return ctx.build({role:'OWNER',rows:(await db.query('SELECT * FROM ledger_transactions')).rows,advances:(await svc.snapshot(pool,'fixture-owner')).rows,branchId:'a'});}
 assert.equal((await queue()).length,1);assert.equal((await queue())[0].id,'request');
 await svc.disburse(pool,'fixture-owner',{advanceId:'advance',idempotencyKey:'d1',evidence:'Physical cash transferred'});assert.equal((await queue()).length,1);
 const s1=await svc.submitSettlement(pool,'fixture-staff',{advanceId:'advance',idempotencyKey:'s1',evidence:'Receipt supplied by Staff',lines:[{receiptKey:'one.jpeg',coaId:'coa',amount:'600'}]});assert.equal((await queue()).length,2);assert.equal((await queue())[1].settlementId,s1.id);
 await assert.rejects(svc.snapshot(pool,'fixture-staff'),/OWNER_REQUIRED/);
 await svc.rejectSettlement(pool,'fixture-owner',{advanceId:'advance',settlementId:s1.id,idempotencyKey:'r1',evidence:'Receipt requires correction'});assert.equal((await queue()).length,1);
 const s2=await svc.submitSettlement(pool,'fixture-staff',{advanceId:'advance',idempotencyKey:'s2',evidence:'Corrected receipt submitted',lines:[{receiptKey:'two.jpeg',coaId:'coa',amount:'600'}]});assert.equal((await queue()).length,2);
 await svc.approveSettlement(pool,'fixture-owner',{advanceId:'advance',settlementId:s2.id,idempotencyKey:'a1',evidence:'Reviewed original receipt'});assert.equal((await queue()).length,1);
 assert.equal(ctx.build({role:'OWNER',rows:(await db.query('SELECT * FROM ledger_transactions')).rows,advances:(await svc.snapshot(pool,'fixture-owner')).rows,branchId:'b'}).length,0);
 console.log('SQL_PROOF actual migrations, session authentication, disburse not approval queue, Staff submit, Owner reject/resubmit/approve, branch scope, Staff denied; isolated PGlite only');
 }finally{await db.close();}
});
