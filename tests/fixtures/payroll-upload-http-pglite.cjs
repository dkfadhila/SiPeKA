'use strict';
// Current HTTP server and SQL procedures, isolated in-memory PostgreSQL; outbound network disabled.
const path=require('node:path'),root=path.resolve(__dirname,'../..');
const {PGlite}=require(process.env.PAYROLL_TEST_PGLITE||process.env.REPORTS_TEST_PGLITE);
(async()=>{
 const engine=new PGlite();
 const run=async(sql,args)=>{
  const result=!args&&sql.includes(';')?(await engine.exec(sql)).at(-1):await engine.query(sql,args);
  for(const field of result.fields||[])if([1114,1082].includes(field.dataTypeID))for(const row of result.rows)if(row[field.name] instanceof Date)row[field.name]=row[field.name].toISOString().slice(0,field.dataTypeID===1082?10:23).replace('T',' ');
  return {...result,rowCount:result.rows.length||result.affectedRows||0};
 };
 let tail=Promise.resolve();async function acquire(){let release;const prior=tail;tail=new Promise(r=>release=r);await prior;return release;}
 class Pool{
  async query(sql,args){const release=await acquire();try{return await run(sql,args);}finally{release();}}
  async connect(){const release=await acquire();return {query:run,release};}
  on(){}async end(){}
 }
 const pool=new Pool();
 await pool.query('CREATE ROLE sipeka_runtime; REVOKE CREATE ON SCHEMA public FROM PUBLIC;');
 await require(root+'/migrations/runner').migrate(pool);
 await pool.query(`INSERT INTO business_units(id,code,name,category) VALUES('ho','AMC','Head Office','LAUNDRY');
 INSERT INTO app_users(id,username,password_hash,full_name,role,assigned_branch_id) VALUES('owner','fixture-owner','unused','Owner QA','OWNER',NULL),('staff','fixture-staff','unused','Device QA','STAFF','ho');
 INSERT INTO sessions(token,user_id,expired_at,purpose) VALUES('fixture-owner','owner',(clock_timestamp() AT TIME ZONE 'UTC')+interval '1 hour','full'),('fixture-staff','staff',(clock_timestamp() AT TIME ZONE 'UTC')+interval '1 hour','full');
 INSERT INTO operational_staff(id,name,branch_id,department,email) VALUES('HO-26002','Ayu Contoh','ho','Operasional','ayu@example.test');
 INSERT INTO company_profile(singleton,name,updated_by) VALUES(true,'CV Artha Multi Ciptanusa','owner');
 GRANT USAGE ON SCHEMA public TO sipeka_runtime;
 GRANT SELECT ON business_units,app_users,chart_of_accounts,ledger_transactions,cash_closings,receipt_assets,sessions,schema_migrations,approval_logs TO sipeka_runtime;
 GRANT UPDATE(last_seen_at),DELETE ON sessions TO sipeka_runtime;
 SET ROLE sipeka_runtime;`);
 require(require.resolve('pg',{paths:[root]})).Pool=Pool;
 const sent=[];
 require(root+'/payroll-resend').createResendTransport=()=>({async sendMail(mail){sent.push({to:mail.to,attachments:mail.attachments.length,pdf:mail.attachments[0].content.toString('base64')});return {accepted:[mail.to],messageId:'offline-'+sent.length};}});
 globalThis.fetch=async()=>{throw Error('OUTBOUND_NETWORK_DISABLED_IN_TEST');};
 process.on('message',async message=>{
  if(message.action!=='state')return;
  // Read through the application Owner function, preserving payroll direct-table restrictions.
  try{const rows=(await pool.query("SELECT employee_payroll_access('fixture-owner','LIST','{}'::jsonb) result")).rows[0].result;process.send({request:message.request,value:{sent,entries:rows.map(e=>({id:e.id,status:e.status,email_status:e.email_status}))}});}catch(error){process.send({request:message.request,error:error.message});}
 });
 const reviewModule=require(root+'/payroll-widya-review'),realCreate=reviewModule.create;reviewModule.create=()=>realCreate({sessions:require('./payroll-review-offline.cjs').sessions(pool)});
 require(root+'/server');
})().catch(error=>{console.error(error.message);process.exit(1);});
