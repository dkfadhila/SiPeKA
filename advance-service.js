'use strict';
// Authenticated session token is supplied exclusively by trusted HTTP integration.
async function disburse(pool,token,request){return (await pool.query('SELECT advance_command($1,$2,$3::jsonb) result',[token,'DISBURSE',JSON.stringify(request)])).rows[0].result;}
const command=operation=>async(pool,token,request)=>(await pool.query('SELECT advance_command($1,$2,$3::jsonb) result',[token,operation,JSON.stringify(request)])).rows[0].result;
const read=operation=>async(pool,token,request={})=>(await pool.query('SELECT advance_read($1,$2,$3::jsonb) result',[token,operation,JSON.stringify(request)])).rows[0].result;
async function guard(pool){
 for(const [table,name,fn,type] of [['advance_events','advance_events_immutable','sipeka_immutable_guard()',27],['advance_settlement_lines','advance_lines_immutable','sipeka_immutable_guard()',27],['advance_receipt_claims','advance_claims_immutable','sipeka_immutable_guard()',27],['ledger_transactions','advance_ordinary_receipt_reserved','advance_ordinary_receipt_guard()',7]]){
  const r=(await pool.query("SELECT t.tgenabled,t.tgtype,t.tgfoid=$3::regprocedure correct FROM pg_trigger t WHERE t.tgrelid=$1::regclass AND t.tgname=$2 AND NOT t.tgisinternal",[table,name,fn])).rows[0];
  if(!r||!['O','A'].includes(r.tgenabled)||r.tgtype!==type||!r.correct)throw Error('ADVANCE_TRIGGER_REQUIRED');
 }
 for(const [name,table,column,actions] of [['advance_disbursed_once','advance_events','advance_id',['DISBURSE']],['advance_approved_once','advance_events','advance_id',['APPROVE']],['advance_review_once','advance_events','settlement_id',['APPROVE','REJECT']],['advance_return_once','advance_events','advance_id',['RETURN']]]){
  const r=(await pool.query("SELECT i.indisunique,i.indisvalid,pg_get_indexdef(i.indexrelid) definition,pg_get_expr(i.indpred,i.indrelid) predicate FROM pg_index i WHERE i.indexrelid=to_regclass($1) AND i.indrelid=$2::regclass",[name,table])).rows[0];
  if(!r||!r.indisunique||!r.indisvalid||!r.definition.includes('('+column+')')||!r.predicate||r.predicate.replace(/\s+/g,'')!==(actions.length===1?"(action='"+actions[0]+"'::text)":"(action=ANY(ARRAY['APPROVE'::text,'REJECT'::text]))"))throw Error('ADVANCE_UNIQUE_INDEX_REQUIRED');
 }
 const role=(await pool.query('SELECT current_user role,current_schema() schema')).rows[0];
 if(role.role!=='sipeka_runtime')throw Error('ADVANCE_RUNTIME_REQUIRED');
 if((await pool.query("SELECT has_schema_privilege(current_user,current_schema(),'CREATE') unsafe")).rows[0].unsafe)throw Error('ADVANCE_SCHEMA_CREATE_DENIED');
 for(const [table,columns] of [['advance_events',['amount']],['advance_settlement_lines',['amount']]]){const r=(await pool.query("SELECT attname,format_type(atttypid,atttypmod) type FROM pg_attribute WHERE attrelid=$1::regclass AND attname=ANY($2::text[]) AND NOT attisdropped",[table,columns])).rows;if(r.length!==columns.length||r.some(c=>c.type!=='bigint'))throw Error('ADVANCE_EXACT_IDR_REQUIRED');}
 for(const table of ['advance_events','advance_settlement_lines','advance_receipt_claims']){
  if((await pool.query("SELECT has_table_privilege(current_user,$1,'INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER') unsafe",[table])).rows[0].unsafe)throw Error('ADVANCE_DML_DENIED');
  if((await pool.query("SELECT EXISTS(SELECT 1 FROM pg_attribute WHERE attrelid=$1::regclass AND attnum>0 AND NOT attisdropped AND (has_column_privilege(current_user,attrelid,attname,'INSERT') OR has_column_privilege(current_user,attrelid,attname,'UPDATE'))) unsafe",[table])).rows[0].unsafe)throw Error('ADVANCE_COLUMN_DML_DENIED');
 }
 for(const signature of ['advance_command(text,text,jsonb)','advance_read(text,text,jsonb)','advance_ordinary_receipt_guard()']){
  const r=(await pool.query("SELECT p.prosecdef,p.proconfig,pg_get_userbyid(p.proowner) owner,has_function_privilege(current_user,p.oid,'EXECUTE') allowed,EXISTS(SELECT 1 FROM aclexplode(p.proacl) a WHERE a.grantee=0 AND a.privilege_type='EXECUTE') public FROM pg_proc p WHERE p.oid=$1::regprocedure",[signature])).rows[0];
  if(!r||!r.prosecdef||r.owner===role.role||(signature==='advance_ordinary_receipt_guard()'?r.allowed:!r.allowed)||r.public||!r.proconfig?.includes('search_path='+role.schema+', pg_temp'))throw Error('ADVANCE_FUNCTION_ACL_REQUIRED');
 }
}
module.exports={disburse,submitSettlement:command('SUBMIT'),approveSettlement:command('APPROVE'),rejectSettlement:command('REJECT'),confirmReturn:command('RETURN'),report:read('REPORT'),listOwn:read('OWN'),snapshot:read('SNAPSHOT'),cash:read('CASH'),guard};
