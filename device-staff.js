'use strict';
const financialPath = p => ['/api/transactions','/api/closing','/api/approvals','/api/receipts/upload'].includes(p) || p.startsWith('/api/advances/');
async function bind(req, token) {
 const pg=require('./db-postgres');
 return (await pg.query('SELECT operational_bind($1,$2,$3) result',[token,req.headers['x-operational-staff']||null,req.headers['x-operational-revision']||null])).rows[0].result;
}
async function directory(token, body=null) {
 return (await require('./db-postgres').query('SELECT operational_directory($1,$2::jsonb) result',[token,body===null?null:JSON.stringify(body)])).rows[0].result;
}
async function annotate(pool,type,rows) {
 if(!rows.length)return rows;
 const ids=rows.map(r=>r.id||r.filename);
 const records=(await pool.query('SELECT * FROM operational_attributions WHERE entity_type=$1 AND entity_id=ANY($2::text[])',[type,ids])).rows;
 const byId=new Map(records.map(r=>[r.entity_id,r]));
 const settlements=rows.filter(r=>r.tx_intent==='ADVANCE_APPROVE');
 if(settlements.length){
  const eventIds=settlements.map(r=>r.id.split(':')[0]);
  const linked=(await pool.query("SELECT e.entity_id review_id,a.* FROM operational_attributions e JOIN operational_attributions a ON a.entity_type='advance_events' AND a.entity_id=e.source_entity_id WHERE e.entity_type='advance_events' AND e.entity_id=ANY($1::text[])",[eventIds])).rows;
  for(const r of settlements){const a=linked.find(a=>a.review_id===r.id.split(':')[0]);if(a)byId.set(r.id,a);}
 }
 return rows.map(r=>{const a=byId.get(r.id||r.filename);return {...r,staff_id:a?.staff_id||null,staff_name:a?.staff_name||'Staff legacy (akun historis)',department:a?.staff_department||null,device_id:a?.device_id||r.user_id||r.actor_id,attribution:a?'RECORDED':'LEGACY',...(r.user_name!==undefined?{device_name:r.user_name,user_name:a?.staff_name||r.user_name+' · Staff legacy'}:{})};});
}
async function advances(pool,result){
 for(const row of result.rows||[]){
  Object.assign(row,(await annotate(pool,'ledger_transactions',[{id:row.advanceId,user_id:row.userId}]))[0]);
  row.events=await annotate(pool,'advance_events',row.events||[]);
 }
 return result;
}
async function guard(pool){
 const role=(await pool.query('SELECT current_user role,current_schema() schema')).rows[0];
 if(role.role!=='sipeka_runtime')throw Error('OPERATIONAL_RUNTIME_REQUIRED');
 for(const table of ['operational_staff','operational_staff_audit','operational_attributions']){
  if((await pool.query("SELECT has_table_privilege(current_user,$1,'INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER') unsafe",[table])).rows[0].unsafe)throw Error('OPERATIONAL_DIRECT_DML_DENIED');
 }
 for(const [table,trigger] of [['ledger_transactions','ledger'],['cash_closings','closing'],['receipt_assets','receipt'],['approval_logs','approval'],['advance_events','advance']]){
  const r=(await pool.query("SELECT tgenabled,tgfoid='operational_capture()'::regprocedure correct FROM pg_trigger WHERE tgrelid=$1::regclass AND tgname=$2",[table,'operational_capture_'+trigger])).rows[0];
  if(!r||!['O','A'].includes(r.tgenabled)||!r.correct)throw Error('OPERATIONAL_CAPTURE_REQUIRED');
 }
 for(const signature of ['operational_directory(text,jsonb)','operational_bind(text,text,text)']){
  const r=(await pool.query("SELECT p.prosecdef,p.proconfig,has_function_privilege(current_user,p.oid,'EXECUTE') allowed,EXISTS(SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE') public FROM pg_proc p WHERE p.oid=$1::regprocedure",[signature])).rows[0];
  if(!r?.prosecdef||!r.allowed||r.public||!r.proconfig?.includes('search_path='+role.schema+', pg_temp'))throw Error('OPERATIONAL_FUNCTION_ACL_REQUIRED');
 }
}
module.exports={financialPath,bind,directory,annotate,advances,guard};
