'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {service,HEADER}=require('../employee-payroll');
const runtime=process.env.PAYROLL_TEST_PGLITE||process.env.REPORTS_TEST_PGLITE;

test('ten-recipient delivery preserves per-item checks, isolation, partial results and restart idempotency',{skip:!runtime,timeout:90000},async t=>{
 const {PGlite}=require(runtime),db=new PGlite();t.after(()=>db.close());
 let tail=Promise.resolve();
 async function lock(){let release;const before=tail;tail=new Promise(r=>release=r);await before;return release;}
 const run=async(sql,args)=>!args&&sql.includes(';')?(await db.exec(sql)).at(-1):db.query(sql,args);
 const pool={async query(sql,args){const release=await lock();try{return await run(sql,args);}finally{release();}},async connect(){const release=await lock();return {query:run,release};}};
 await require('../migrations/runner').migrate(pool);
 await pool.query(`INSERT INTO business_units(id,code,name,category) VALUES('qa','QA','QA Unit','LAUNDRY');
 INSERT INTO app_users(id,username,password_hash,full_name,role,assigned_branch_id) VALUES('owner','owner','unused','Owner QA','OWNER',NULL),('staff','staff','unused','Staff QA','STAFF','qa');
 INSERT INTO sessions(token,user_id,expired_at,purpose) VALUES('owner-token','owner',(clock_timestamp() AT TIME ZONE 'UTC')+interval '1 hour','full'),('staff-token','staff',(clock_timestamp() AT TIME ZONE 'UTC')+interval '1 hour','full');
 INSERT INTO company_profile(singleton,name,updated_by) VALUES(true,'QA Company','owner');`);
 const staff=Array.from({length:10},(_,i)=>({id:'employee-'+i,name:'Dummy Employee '+i,email:'dummy'+i+'@example.invalid',salary:3000000+i}));
 for(const s of staff)await pool.query('INSERT INTO operational_staff(id,name,branch_id,department,email) VALUES($1,$2,$3,$4,$5)',[s.id,s.name,'qa','Operasional',s.email]);
 // The master directory must retain one unique canonical recipient per employee.
 await assert.rejects(pool.query('INSERT INTO operational_staff(id,name,branch_id,department,email) VALUES($1,$2,$3,$4,$5)',['duplicate','Duplicate','qa','Operasional',staff[0].email]),/employee_email_unique/);
 const calls=[],env={PAYROLL_ENCRYPTION_KEY:'ab'.repeat(32),PAYROLL_EMAIL_FROM:'qa@example.invalid'};
 const transport={async sendMail(mail){calls.push(mail);if(mail.to===staff[3].email)throw Error('fixture provider timeout');return {accepted:[mail.to],messageId:'offline-'+calls.length};}};
 const make=()=>service({pool,env,transport}),svc=make();
 const csv=HEADER+'\r\n'+staff.map(s=>'2026-11,'+s.id+','+s.salary+',0,0,0,0,0,0').join('\r\n');
 const draft=await svc.importCsv('owner-token',csv),listing=await svc.list('owner-token');
 const entries=staff.map(s=>listing.rows.find(e=>e.row.employee_id===s.id));
 const body=i=>({email:staff[i].email,confirmed:true});
 await assert.rejects(svc.send('owner-token',entries[0].id,body(0)),/PAYROLL_NOT_PUBLISHED/);
 await svc.publish('owner-token',{id:draft.id,preview_token:entries[0].preview_token,confirmed:true});
 assert.equal(calls.length,0,'publication never sends automatically');
 await assert.rejects(svc.send('staff-token',entries[0].id,body(0)),/PAYROLL_OWNER_ONLY/);
 await assert.rejects(svc.send('owner-token',entries[0].id,{...body(0),confirmed:false}),/PAYROLL_CONFIRM_REQUIRED/);
 await assert.rejects(svc.send('owner-token',entries[0].id,{...body(0),email:staff[1].email}),/PAYROLL_CONTACT_CHANGED/);
 assert.equal(calls.length,0);
 // Two submissions of the same entry still produce one provider request.
 await Promise.all([svc.send('owner-token',entries[0].id,body(0)),svc.send('owner-token',entries[0].id,body(0))]);
 assert.equal(calls.filter(c=>c.to===staff[0].email).length,1);
 // Directory drift after confirmation blocks that item; unrelated recipients continue.
 await pool.query('UPDATE operational_staff SET email=$1 WHERE id=$2',['changed@example.invalid',staff[4].id]);
 const results=[];
 for(let i=1;i<entries.length;i++){
  try{results.push({i,status:(await svc.send('owner-token',entries[i].id,body(i))).status});}
  catch(error){results.push({i,error:error.message});}
 }
 assert.equal(results.find(r=>r.i===3).status,'uncertain');
 assert.equal(results.find(r=>r.i===4).error,'PAYROLL_CONTACT_CHANGED');
 assert.equal(results.filter(r=>r.status==='sent').length,7);
 assert.equal(calls.length,9);
 for(const call of calls){
  const s=staff.find(s=>s.email===call.to);assert.ok(s);
  const pdf=call.attachments.find(a=>a.contentType==='application/pdf');assert.ok(pdf);assert.match(pdf.content.toString('latin1'),new RegExp(s.name));
  assert.equal(call.attachments.filter(a=>a.contentType==='application/pdf').length,1,'each recipient receives only their own slip');
 }
 // A fresh service instance models restart: no sent or uncertain job is replayed.
 const restarted=make();
 for(let i=0;i<entries.length;i++){
  if(i===4)await assert.rejects(restarted.send('owner-token',entries[i].id,body(i)),/PAYROLL_CONTACT_CHANGED/);
  else assert.equal((await restarted.send('owner-token',entries[i].id,body(i))).status,i===3?'uncertain':'sent');
 }
 assert.equal(calls.length,9);
 await pool.query('UPDATE operational_staff SET email=$1 WHERE id=$2',[staff[4].email,staff[4].id]);
 assert.equal((await restarted.send('owner-token',entries[4].id,body(4))).status,'sent','a corrected unsent item requires another explicit invocation');
 assert.equal(calls.length,10);assert.equal(new Set(calls.map(c=>c.to)).size,10);
 const outbox=(await pool.query('SELECT status,attempts FROM payroll_delivery_outbox')).rows;
 assert.equal(outbox.length,10);assert.equal(outbox.filter(x=>x.status==='sent').length,9);assert.equal(outbox.filter(x=>x.status==='uncertain').length,1);assert.ok(outbox.every(x=>x.attempts===1));
});

