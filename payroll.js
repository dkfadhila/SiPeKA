'use strict';
const crypto=require('node:crypto');
const HEADER='period,username,basic_salary,allowances,deductions,pph21';
function fault(code,status=400){const e=new Error(code);e.code=code;e.status=status;return e;}
function owner(actor){if(!actor||actor.role!=='OWNER'||!actor.id|| (actor.session_purpose&&actor.session_purpose!=='full'))throw fault('PAYROLL_OWNER_ONLY',403);}
function templateCsv(){return HEADER+'\r\n';}
function parseCsv(input){
 if(typeof input!=='string'||Buffer.byteLength(input)>1024*1024)throw fault('PAYROLL_CSV_LIMIT');
 input=input.replace(/^\uFEFF/,'');
 const rows=[];let row=[],cell='',quoted=false,closed=false;
 for(let i=0;i<input.length;i++){const c=input[i];
  if(quoted){if(c==='"'){if(input[i+1]==='"'){cell+='"';i++;}else{quoted=false;closed=true;}}else cell+=c;}
  else if(c==='"'){if(cell||closed)throw fault('PAYROLL_CSV_QUOTE');quoted=true;}
  else if(c===','||c==='\n'||c==='\r'){row.push(cell);cell='';closed=false;if(c!==','){if(c==='\r'&&input[i+1]==='\n')i++;rows.push(row);row=[];}}
  else {if(closed)throw fault('PAYROLL_CSV_QUOTE');cell+=c;}
  if(cell.length>256||rows.length>1001)throw fault('PAYROLL_CSV_LIMIT');
 }
 if(quoted)throw fault('PAYROLL_CSV_QUOTE');if(cell||row.length){row.push(cell);rows.push(row);}
 return rows;
}
function validateCsv(csv,users){
 const table=parseCsv(csv);const header=table.shift()?.join(',');const byId=header===HEADER.replace('username','user_id');if(header!==HEADER&&!byId)throw fault('PAYROLL_CSV_HEADER');
 if(!table.length||table.length>1000)throw fault('PAYROLL_CSV_ROWS');
 const seen=new Set();let period;
 return table.map((r,index)=>{
  if(r.length!==6||r.some(v=>/[\x00-\x1f\x7f]/.test(v)||/^[=+@-]/.test(v)))throw fault('PAYROLL_CSV_CELL_'+(index+2));
  const [p,username,...amounts]=r;
  if(!/^(?:20\d{2})-(?:0[1-9]|1[0-2])$/.test(p)|| (period&&period!==p))throw fault('PAYROLL_PERIOD');period=p;
  if(!/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,63}$/.test(username))throw fault('PAYROLL_USERNAME');
  const matches=users.filter(u=>(byId?u.id:u.username)===username);if(matches.length>1)throw fault('PAYROLL_AMBIGUOUS_USERNAME');
  const u=matches[0];if(!u||u.role!=='STAFF'||u.is_active===false||u.is_active===0)throw fault('PAYROLL_STAFF_NOT_FOUND');
  if(seen.has(u.id))throw fault('PAYROLL_DUPLICATE_PERIOD_STAFF');seen.add(u.id);
  const n=amounts.map(v=>{if(!/^(0|[1-9]\d{0,15})$/.test(v)||!Number.isSafeInteger(Number(v)))throw fault('PAYROLL_INTEGER_IDR');return Number(v);});
  const [basic_salary,allowances,deductions,pph21]=n;const gross=basic_salary+allowances,net=gross-deductions-pph21;
  if(!Number.isSafeInteger(gross)||!Number.isSafeInteger(net)||net<0)throw fault('PAYROLL_NET_INVALID');
  return {period:p,user_id:u.id,username:u.username,full_name:u.full_name,...(u.branch_name?{branch_name:u.branch_name}:{}),basic_salary,allowances,deductions,pph21,net_salary:net};
 });
}
function createCipher(key){
 if(typeof key!=='string'||!/^[a-fA-F0-9]{64}$/.test(key))throw fault('PAYROLL_ENCRYPTION_KEY_REQUIRED',503);
 const secret=Buffer.from(key,'hex');
 return {seal(value,aad){const iv=crypto.randomBytes(12),c=crypto.createCipheriv('aes-256-gcm',secret,iv);c.setAAD(Buffer.from(aad));const body=Buffer.concat([c.update(JSON.stringify(value),'utf8'),c.final()]);return ['v1',iv.toString('base64'),c.getAuthTag().toString('base64'),body.toString('base64')].join('.');},
 open(value,aad){try{const [v,iv,tag,body]=value.split('.');if(v!=='v1')throw Error();const c=crypto.createDecipheriv('aes-256-gcm',secret,Buffer.from(iv,'base64'));c.setAAD(Buffer.from(aad));c.setAuthTag(Buffer.from(tag,'base64'));return JSON.parse(Buffer.concat([c.update(Buffer.from(body,'base64')),c.final()]).toString('utf8'));}catch{throw fault('PAYROLL_DECRYPT_FAILED',503);}}};
}
async function transaction(pool,fn){const c=await pool.connect();try{await c.query('BEGIN');const result=await fn(c);await c.query('COMMIT');return result;}catch(e){try{await c.query('ROLLBACK');}catch{}if(e.code==='23505')throw fault('PAYROLL_DUPLICATE_PERIOD_STAFF',409);throw e;}finally{c.release();}}
async function audit(c,actor,action,batch){await c.query('INSERT INTO payroll_access_audit(id,actor_id,action,batch_id) VALUES($1,$2,$3,$4)',[crypto.randomUUID(),actor.id,action,batch||null]);}
function createPayrollService({pool,encryptionKey=process.env.PAYROLL_ENCRYPTION_KEY,emailEnabled=false,deliveryReady={email:true,telegram:true}}={}){
 if(!pool||!pool.connect)throw fault('PAYROLL_PG_POOL_REQUIRED',503);const cipher={seal:(...args)=>createCipher(encryptionKey).seal(...args),open:(...args)=>createCipher(encryptionKey).open(...args)};
 async function contact(c,userId,channel){
  const u=(await c.query('SELECT id,username,full_name,role,email,email_verified,email_registration_id,email_registration_source,telegram_user_id,telegram_verified FROM app_users WHERE id=$1 FOR SHARE',[userId])).rows[0];
  const address=channel==='email'?u?.email:u?.telegram_user_id,verified=(channel==='email'?u?.email_verified:u?.telegram_verified)===true,registered=channel==='email'&&!!u?.email_registration_id&&u.email_registration_source==='authenticated_self_registration';
  let reason=u?.role!=='STAFF'?'PAYROLL_STAFF_CONTACT':!(verified||registered)?'PAYROLL_CONTACT_UNVERIFIED':!(channel==='email'?typeof address==='string'&&address.length<=254&&/^[^\s@<>;,]+@[^\s@<>;,]+\.[^\s@<>;,]+$/.test(address):/^[1-9]\d{0,15}$/.test(String(address)))?'PAYROLL_CONTACT_INVALID':null;
  if(!reason){const column=channel==='email'?'email':'telegram_user_id';const matches=(await c.query('SELECT id FROM app_users WHERE '+column+'=$1 FOR SHARE',[address])).rows;if(matches.length!==1||matches[0].id!==userId)reason='PAYROLL_CONTACT_AMBIGUOUS';}
  if(!reason&&deliveryReady[channel]!==true)reason='PAYROLL_PROVIDER_NOT_READY';
  const metadata=channel==='telegram'?(await c.query("SELECT id,telegram_username,telegram_full_name FROM payroll_telegram_bindings WHERE user_id=$1 AND chat_id=$2 AND status='verified' ORDER BY reviewed_at DESC LIMIT 1",[userId,address])).rows[0]:null;
  return {address:address||null,verified,registered,provenance:registered?u.email_registration_source:null,binding_key:channel==='email'?(u?.email_registration_id||address):metadata?.id||address,eligible:!reason,reason,full_name:u?.full_name,username:u?.username,...metadata};
 }
 async function view(c,actor,id,action){await audit(c,actor,action,id);const batch=(await c.query('SELECT * FROM payroll_batches WHERE id=$1',[id])).rows[0];if(!batch)throw fault('PAYROLL_NOT_FOUND',404);const entries=(await c.query('SELECT * FROM payroll_entries WHERE batch_id=$1 ORDER BY user_id',[id])).rows;const rows=[];
  for(const r of entries){const delivery={};for(const channel of ['telegram','email']){const details=await contact(c,r.user_id,channel),job=(await c.query('SELECT id,status,error_code,provider_id FROM payroll_delivery_outbox WHERE entry_id=$1 AND channel=$2',[r.id,channel])).rows[0];delivery[channel]={...details,job:job||null};}rows.push({...cipher.open(r.payload_cipher,r.id),entry_id:r.id,delivery});}
  return {id:batch.id,period:batch.period,status:batch.status,published_at:batch.published_at,preview_token:batch.preview_token,rows};
 }
 return {
 async slip(actor,id,{branchId,identityOnly=false}={}){if(!actor?.id||!['OWNER','STAFF'].includes(actor.role)||(actor.session_purpose&&actor.session_purpose!=='full'))throw fault('PAYROLL_AUTH_REQUIRED',403);return transaction(pool,async c=>{const r=(await c.query('SELECT e.*,b.status,b.published_at FROM payroll_entries e JOIN payroll_batches b ON b.id=e.batch_id WHERE e.id=$1',[id])).rows[0];if(!r||(actor.role==='STAFF'&&(r.user_id!==actor.id||r.status!=='PUBLISHED')))throw fault('PAYROLL_NOT_FOUND',404);const row=cipher.open(r.payload_cipher,r.id);if(row.user_id!==r.user_id||row.period!==r.period)throw fault('PAYROLL_PAYLOAD_IDENTITY',503);const staff=(await c.query('SELECT u.role,u.assigned_branch_id,b.name branch_name FROM app_users u LEFT JOIN business_units b ON b.id=u.assigned_branch_id WHERE u.id=$1',[r.user_id])).rows[0];if(staff?.role!=='STAFF'||!staff.assigned_branch_id||!staff.branch_name)throw fault('PAYROLL_DOCUMENT_BRANCH_UNAVAILABLE',409);const identity={branch_id:String(staff.assigned_branch_id),branch_name:staff.branch_name};if(identityOnly)return identity;if(branchId!==undefined&&branchId!==identity.branch_id)throw fault('PAYROLL_DOCUMENT_BRANCH_MISMATCH',409);await audit(c,actor,'SLIP_DOWNLOAD',r.batch_id);return {row:{...row,entry_id:r.id},publishedAt:r.published_at,identity};});},
 async ownSlips(actor){if(actor?.role!=='STAFF'||!actor.id||(actor.session_purpose&&actor.session_purpose!=='full'))throw fault('PAYROLL_AUTH_REQUIRED',403);return transaction(pool,async c=>{await audit(c,actor,'OWN_SLIP_LIST');return (await c.query("SELECT e.id,e.period,b.published_at FROM payroll_entries e JOIN payroll_batches b ON b.id=e.batch_id WHERE e.user_id=$1 AND b.status='PUBLISHED' ORDER BY e.period DESC LIMIT 100",[actor.id])).rows;});},
 async template(actor){owner(actor);await audit(pool,actor,'TEMPLATE',null);return templateCsv();},
 async importCsv(actor,csv){owner(actor);return transaction(pool,async c=>{
  const users=(await c.query('SELECT u.id,u.username,u.full_name,u.role,b.name branch_name FROM app_users u LEFT JOIN business_units b ON b.id=u.assigned_branch_id')).rows;const rows=validateCsv(csv,users);const id=crypto.randomUUID(),token=crypto.randomUUID();
  await c.query("INSERT INTO payroll_batches(id,period,status,created_by,preview_token) VALUES($1,$2,'DRAFT',$3,$4)",[id,rows[0].period,actor.id,token]);
  for(const row of rows){const entry=crypto.randomUUID();await c.query('INSERT INTO payroll_entries(id,batch_id,period,user_id,payload_cipher) VALUES($1,$2,$3,$4,$5)',[entry,id,row.period,row.user_id,cipher.seal(row,entry)]);}
  return view(c,actor,id,'IMPORT_PREVIEW');
 });},
 async preview(actor,id){owner(actor);return transaction(pool,c=>view(c,actor,id,'PREVIEW'));},
 async publish(actor,id,previewToken){owner(actor);createCipher(encryptionKey);return transaction(pool,async c=>{
  const b=(await c.query('SELECT * FROM payroll_batches WHERE id=$1 FOR UPDATE',[id])).rows[0];if(!b)throw fault('PAYROLL_NOT_FOUND',404);if(previewToken!==b.preview_token)throw fault('PAYROLL_PREVIEW_TOKEN',409);
  if(b.status==='DRAFT'){
   const rows=(await c.query('SELECT id,user_id,payload_cipher FROM payroll_entries WHERE batch_id=$1',[id])).rows;
   for(const r of rows)cipher.open(r.payload_cipher,r.id);
   // Publication exposes approved slips only. Owner must explicitly authorize delivery.
   await c.query("UPDATE payroll_batches SET status='PUBLISHED',published_by=$2,published_at=clock_timestamp() WHERE id=$1",[id,actor.id]);
  }
  await audit(c,actor,'PUBLISH',id);return {id,status:'PUBLISHED'};
 });},
 async queueDelivery(actor,id,channels,confirmation){owner(actor);if(!Array.isArray(channels)||!channels.length||channels.length>2||new Set(channels).size!==channels.length||channels.some(c=>!['email','telegram'].includes(c)))throw fault('PAYROLL_CHANNEL',400);
  return transaction(pool,async c=>{const e=(await c.query('SELECT e.*,b.status FROM payroll_entries e JOIN payroll_batches b ON b.id=e.batch_id WHERE e.id=$1 FOR UPDATE OF b',[id])).rows[0];if(!e)throw fault('PAYROLL_NOT_FOUND',404);if(e.status!=='PUBLISHED')throw fault('PAYROLL_NOT_PUBLISHED',409);const row=cipher.open(e.payload_cipher,e.id);if(row.user_id!==e.user_id||row.period!==e.period)throw fault('PAYROLL_PAYLOAD_IDENTITY',503);
   const checked={};for(const channel of [...channels].sort()){const details=await contact(c,e.user_id,channel);if(!details.eligible)throw fault(details.reason,409);if(confirmation&&(confirmation.user_id!==e.user_id||confirmation.period!==e.period||confirmation.username!==details.username||confirmation.full_name!==details.full_name||confirmation.channel!==channel||confirmation.address!==details.address||confirmation.binding_key!==details.binding_key))throw fault('PAYROLL_CONTACT_REVIEW_STALE',409);checked[channel]=details;}
   const jobs=[];for(const channel of channels){await c.query("INSERT INTO payroll_delivery_outbox(id,entry_id,channel,status,recipient_binding_key) VALUES($1,$2,$3,'pending',$4) ON CONFLICT(entry_id,channel) DO NOTHING",[crypto.randomUUID(),id,channel,checked[channel].binding_key]);const job=(await c.query('SELECT id,channel,status,error_code,provider_id FROM payroll_delivery_outbox WHERE entry_id=$1 AND channel=$2 FOR UPDATE',[id,channel])).rows[0];await audit(c,actor,'QUEUE_'+job.id,e.batch_id);jobs.push(job);}return jobs;
  });
 },
 async deliveryStatus(actor,id){owner(actor);return transaction(pool,async c=>{await audit(c,actor,'DELIVERY_STATUS',id);return (await c.query('SELECT o.id,o.channel,o.status,o.attempts,o.error_code,o.provider_id,o.updated_at,e.user_id FROM payroll_delivery_outbox o JOIN payroll_entries e ON e.id=o.entry_id WHERE e.batch_id=$1 ORDER BY e.user_id,o.channel',[id])).rows;});},
 async retryDelivery(actor,id){owner(actor);return transaction(pool,async c=>{const r=(await c.query('SELECT o.*,e.batch_id FROM payroll_delivery_outbox o JOIN payroll_entries e ON e.id=o.entry_id WHERE o.id=$1 FOR UPDATE OF o',[id])).rows[0];if(!r)throw fault('PAYROLL_NOT_FOUND',404);if(!['blocked','failed'].includes(r.status))throw fault('PAYROLL_RETRY_UNSAFE',409);await audit(c,actor,'RETRY',r.batch_id);await c.query("UPDATE payroll_delivery_outbox SET status='pending',error_code=NULL,updated_at=clock_timestamp() WHERE id=$1",[id]);return {id,status:'pending'};});}
 };
}
module.exports={templateCsv,validateCsv,createCipher,createPayrollService,transaction,fault};
