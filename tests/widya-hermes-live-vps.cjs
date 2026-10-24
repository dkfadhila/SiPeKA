'use strict';
// Manual VPS acceptance only: creates a retained isolated QA schema, never business rows or Telegram sends.
if(process.env.WIDYA_LIVE_PROBE!=='1')throw Error('Set WIDYA_LIVE_PROBE=1 explicitly');
const fs=require('node:fs'),cp=require('node:child_process'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {setTimeout:delay}=require('node:timers/promises');
const schema=process.env.WIDYA_QA_SCHEMA||'widya_live_'+crypto.randomBytes(8).toString('hex');if(!/^widya_live_[a-f0-9]{16}$/.test(schema))throw Error('Invalid QA schema');
const sql=s=>cp.execFileSync('sudo',['-n','-u','postgres','psql','-X','-At','-v','ON_ERROR_STOP=1','-d','sipeka'],{input:s,encoding:'utf8'});
(async()=>{
 if(process.getuid()===0){
 let setup=`CREATE SCHEMA ${schema};SET search_path=${schema};CREATE TABLE schema_migrations(name text PRIMARY KEY,sha256 text NOT NULL);`;
 for(const f of fs.readdirSync('migrations').filter(x=>/^\d+_.*\.sql$/.test(x)).sort())setup+=fs.readFileSync('migrations/'+f,'utf8')+'\n';
 setup+=`GRANT USAGE ON SCHEMA ${schema} TO sipeka_runtime;INSERT INTO app_users(id,username,password_hash,full_name,role) VALUES('qa-owner','qa-owner','unused','QA integration only','OWNER');INSERT INTO sessions(token,user_id,expired_at,purpose) VALUES('qa-live-session','qa-owner',(clock_timestamp() AT TIME ZONE 'UTC')+interval '2 hours','full');`;sql(setup);
 process.stdout.write(cp.execFileSync('sudo',['-n','-u','sipeka','env','WIDYA_LIVE_PROBE=1','WIDYA_QA_SCHEMA='+schema,'WIDYA_QA_EXPECTED_BRANCHES='+sql('SELECT count(*) FROM public.business_units;').trim(),process.execPath,__filename],{encoding:'utf8',timeout:660000}));return;

 }
 const pid=cp.execFileSync('systemctl',['show','sipeka.service','-p','MainPID','--value'],{encoding:'utf8'}).trim(),env=Object.fromEntries(fs.readFileSync('/proc/'+pid+'/environ','utf8').split('\0').filter(s=>s.includes('=')).map(s=>[s.slice(0,s.indexOf('=')),s.slice(s.indexOf('=')+1)]));
 const url=new URL(env.DATABASE_URL);url.searchParams.set('options','-c search_path='+schema);
 const pool=new(require('pg').Pool)({connectionString:url.toString()}),bridge=require('../widya-bridge').createWidyaBridge({url:env.WIDYA_HERMES_URL,key:env.WIDYA_HERMES_KEY});
 const storage=require('../widya-sessions').createWidyaFiles({root:env.WIDYA_FILES_DIR,acl:async(p,mode,defaults=false)=>{cp.execFileSync('setfacl',['-m',`u:ubuntu:${mode}`,...(defaults?['-m','d:u:ubuntu:rwx,d:u:sipeka:rwx']:[]),p]);}});
 const options={pool,bridge,storage,context:async()=>'SYNTHETIC QA. No dashboard financial records supplied.'};let service=require('../widya-sessions').createWidyaSessions(options);const token='qa-live-session',sessionId=crypto.randomUUID(),marker='WIDYA_QA_'+crypto.randomBytes(8).toString('hex');
 const access=(op,p)=>service.call(token,op,p);const checks=[];
 try{
  await require('../widya-sessions').guard(pool);checks.push('actual runtime privileges guarded');
  await access('CREATE',{id:sessionId,title:'SYNTHETIC Hermes integration QA',hermes_session_id:'sipeka-qa-'+crypto.randomBytes(24).toString('hex')});
  const fid=crypto.randomUUID();await access('UPLOAD',{id:fid,session_id:sessionId,name:'synthetic-marker.txt',mime:'text/plain',data_base64:Buffer.from(marker).toString('base64')});
  async function turn(message,attachments=[]){const id=crypto.randomUUID(),clean={message,attachment_ids:attachments};await access('SEND',{...clean,session_id:sessionId,id,message_id:crypto.randomUUID(),client_message_id:crypto.randomUUID(),fingerprint:crypto.createHash('sha256').update(JSON.stringify(clean)).digest('hex'),capability:crypto.randomBytes(32).toString('hex')});const deadline=Date.now()+300000;while(Date.now()<deadline){await service.tick();const state=await access('READ',{session_id:sessionId,limit:101});if(state.session.status==='completed')return state;if(['failed','interrupted','uncertain','waiting_for_approval'].includes(state.session.status))throw Error('QA_RUN_'+state.session.status);await delay(1500);}throw Error('QA_RUN_TIMEOUT');}
  let state=await turn('Synthetic integration QA only. Do not touch business data, credentials, other files, or send messages. Use the terminal to read the attached synthetic-marker.txt. Remember its exact marker for the next turn. Create widya-smoke-result.txt in the exact session output directory given in your instructions, copying that exact marker into the file. Reply with the marker and an explicit MEDIA:"absolute output file path" so the dashboard can download it.',[fid]);
  const reply=state.messages.findLast(m=>m.role==='assistant');assert.ok(reply.content.includes(marker),'Actual agent read synthetic attachment');assert.ok(reply.attachments.length,'Generated file persisted');const file=await access('FILE_GET',{id:reply.attachments[0].id});assert.equal(Buffer.from(file.data_base64.replace(/\s/g,''),'base64').toString().trim(),marker);checks.push('actual Hermes reads input via private ACL');checks.push('actual Hermes creates file and download bytes match');
  service.stop();service=require('../widya-sessions').createWidyaSessions(options);state=await access('READ',{session_id:sessionId,limit:101});assert.ok(state.messages.some(m=>m.attachments.length));checks.push('new service retrieves original file metadata');
  state=await turn('What was the exact synthetic marker in the file from the previous turn? Reply only with the marker from our conversation. Do not open any file or use any tools.');assert.ok(state.messages.findLast(m=>m.role==='assistant').content.includes(marker),'Actual Hermes retained previous turn context');checks.push('actual Hermes second turn retains session context');
  state=await turn('Use the authorized SiPeKA dashboard reader now. Run /usr/local/bin/widya-dashboard-read with one JSON argument {"report":"branches"}. Count its returned rows. This is an authorized read-only branch-master integration check, no writes or messages. Reply only WIDYA_BRANCH_COUNT=N where N is the actual number of returned branches.');
  const count=state.messages.findLast(m=>m.role==='assistant').content.match(/WIDYA_BRANCH_COUNT=(\d+)/);assert.ok(count,'Actual agent returned reader count');assert.equal(count[1],process.env.WIDYA_QA_EXPECTED_BRANCHES);checks.push('actual Widya profile executes private reader against dashboard master');
  const before=state.messages.length;await pool.query("INSERT INTO sessions(token,user_id,expired_at,purpose) VALUES('qa-live-relogin','qa-owner',(clock_timestamp() AT TIME ZONE 'UTC')+interval '2 hours','full')");state=await service.call('qa-live-relogin','READ',{session_id:sessionId,limit:101});assert.equal(state.messages.length,before);checks.push('new login retains real Hermes messages');
  console.log(JSON.stringify({ok:true,schema,sessionId,checks,telegram_messages_sent:0,financial_writes:0}));
 }finally{service.stop();await pool.end();}
})().catch(e=>{console.error('WIDYA_LIVE_PROBE_FAILED '+e.message);process.exitCode=1;});
