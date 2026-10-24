'use strict';
// Read-only operational reports. No migrations, posting, notifications or balance inference.
const fail=(code,statusCode=400)=>{throw Object.assign(new Error(code),{statusCode});};
function filters(params){
 const allowed=['branch_id','date_from','date_to','timezone','view_mode'];
 for(const key of params.keys())if(!allowed.includes(key)||params.getAll(key).length!==1)fail('REPORT_INVALID_FILTER');
 const start=params.get('date_from'),end=params.get('date_to'),branch=params.get('branch_id')||'all',viewMode=params.get('view_mode');
 if(viewMode!==null&&(!['company','branch','comparison'].includes(viewMode)||(viewMode==='branch'?branch==='all':branch!=='all')))fail('REPORT_INVALID_SCOPE');
 const valid=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&!Number.isNaN(Date.parse(s+'T00:00:00Z'))&&new Date(s+'T00:00:00Z').toISOString().slice(0,10)===s;
 if(!valid(start)||!valid(end)||start>end||params.get('timezone')!=='Asia/Jakarta'||branch.length>120)fail('REPORT_INVALID_FILTER');
 const from=Date.parse(start+'T00:00:00Z')-25200000,to=Date.parse(end+'T00:00:00Z')+86400000-25200000;
 if(to-from>366*86400000)fail('REPORT_RANGE_TOO_LARGE');
 return {branch,dateFrom:start,dateTo:end,timezone:'Asia/Jakarta',utcFrom:new Date(from).toISOString(),utcToExclusive:new Date(to).toISOString(),...(viewMode?{viewMode}:{})};
}
function exact(v){if(!/^[0-9]+$/.test(String(v)))fail('REPORT_INVALID_AMOUNT',503);return BigInt(v);}
function total(rows){let income=0n,expense=0n;for(const r of rows){if(r.tx_type==='INCOME')income+=exact(r.amount);else if(r.tx_type==='EXPENSE')expense+=exact(r.amount);else fail('REPORT_INVALID_TYPE',503);}return {income:String(income),expense:String(expense),net:String(income-expense),count:rows.length};}
async function read(pool,actor,token,id,params,{readAdvances=require('./advance-service').snapshot,template=true}={}){
 if(actor?.role!=='OWNER')fail('REPORT_OWNER_ONLY',403);
 if(template&&require('./report-template').kinds[id]){
  const result=await read(pool,actor,token,id,params,{readAdvances,template:false});
  const f=filters(params),days=(Date.parse(f.dateTo)-Date.parse(f.dateFrom))/86400000+1;
  const previousParams=new URLSearchParams(params),end=new Date(Date.parse(f.dateFrom)-86400000),start=new Date(end.getTime()-(days-1)*86400000);
  previousParams.set('date_from',start.toISOString().slice(0,10));previousParams.set('date_to',end.toISOString().slice(0,10));
  const sourceId=['fund-position','cash-flow'].includes(id)?id:'profit-loss';
  const source=sourceId===id?result:await read(pool,actor,token,sourceId,params,{readAdvances,template:false});
  const previous=await read(pool,actor,token,sourceId,previousParams,{readAdvances,template:false});
  const units=(await pool.query('SELECT id,name,category,is_active FROM business_units ORDER BY id')).rows;
  const calculatedLayout=require('./report-template').make(id,source,previous,units,f);
  result.templateLayout=require('./report-presentation').scoped(calculatedLayout,id,source,previous,units,f);
  result.templateLayout.excelLayout=require('./report-presentation').scoped(calculatedLayout,id,source,previous,units,f,{excel:true});
  result.presentationData=require('./report-presentation').columnsAndRows(result.templateLayout);
  return result;
 }
 if(['company-profit-loss','compare-profit-loss'].includes(id)){
  const source=await read(pool,actor,token,'profit-loss',params,{readAdvances,template:false});
  const units=(await pool.query('SELECT id,name,category,is_active FROM business_units ORDER BY id')).rows;
  return require('./company-pnl').build(source,units,id);
 }
 if(id==='quarterly-owner')return require('./quarterly-owner').read(pool,actor,token,params,{readAdvances});
 if(['fund-position','recorded-income-expense'].includes(id))return require('./informational-statements').read(pool,actor,token,id,params,{readAdvances});
 if(!['profit-loss','cash-flow','fund-requests','daily-closings','audit-evidence','quarterly-data'].includes(id))fail('REPORT_NOT_FOUND',404);
 const f=filters(params);
 const units=(await pool.query('SELECT id,name,category,is_active FROM business_units ORDER BY id')).rows;
 if(f.branch!=='all'&&!units.some(u=>u.id===f.branch))fail('REPORT_BRANCH_NOT_FOUND',404);
 const register=rows=>({id,columns:(id==='daily-closings'?['id','branch_id','branch_name','user_id','user_name','closing_date','system_balance','physical_cash','difference','reason']:['id','branch_id','branch_name','user_id','user_name','created_at','amount','payment_method','status','tx_intent','memo','receipt_key']).map(key=>({key,label:key})),rows,totals:null,filters:f,sourceCount:rows.length,complete:true,readiness:rows.length?'available':'empty',missingDatasets:[],generated_at:new Date().toISOString(),provenance:'Stored operational records; not certified reconciliation.',neracaComplete:false,reconciliationComplete:false,endBalance:null,notices:['Closing adalah observasi uang fisik, bukan reset kas, setoran, atau rekonsiliasi lengkap. Approval pengajuan bukan pencairan.']});
 if(id==='daily-closings'){
  const rows=(await pool.query(`SELECT c.id,c.branch_id,b.name branch_name,c.user_id,u.full_name user_name,c.closing_date,c.system_balance::text system_balance,c.physical_cash::text physical_cash,c.difference::text difference,c.reason FROM cash_closings c JOIN business_units b ON b.id=c.branch_id JOIN app_users u ON u.id=c.user_id WHERE c.closing_date >= $1::date AND c.closing_date <= $2::date AND ($3::text='all' OR c.branch_id=$3) ORDER BY c.closing_date,c.id LIMIT 10001`,[f.dateFrom,f.dateTo,f.branch])).rows;
  if(rows.length>10000)fail('REPORT_TOO_LARGE',413);return register(rows);
 }
 const transactions=(await pool.query(`SELECT t.id,t.branch_id,t.user_id,t.coa_id,t.tx_type,t.amount::text amount,t.payment_method,t.memo,t.receipt_key,t.status,t.tx_intent,t.created_at,u.full_name user_name,b.name branch_name,c.account_code,c.account_name FROM ledger_transactions t JOIN app_users u ON u.id=t.user_id JOIN business_units b ON b.id=t.branch_id JOIN chart_of_accounts c ON c.id=t.coa_id WHERE t.created_at >= $1::timestamp AND t.created_at < $2::timestamp AND ($3::text='all' OR t.branch_id=$3) ORDER BY t.created_at,t.id LIMIT 10001`,[f.utcFrom,f.utcToExclusive,f.branch])).rows;
 if(transactions.length>10000)fail('REPORT_TOO_LARGE',413);
 if(id==='fund-requests')return register(transactions.filter(r=>r.tx_intent==='PENGAJUAN_DANA'));
 const advances=await readAdvances(pool,token);
 if(!Array.isArray(advances?.rows))fail('REPORT_ADVANCE_UNAVAILABLE',503);
 if(id==='quarterly-data'){
  const pending=(await pool.query("SELECT count(*)::text n FROM ledger_transactions WHERE status='PENDING_APPROVAL' AND tx_intent='PENGAJUAN_DANA' AND ($1::text='all' OR branch_id=$1)",[f.branch])).rows[0];
  return {...require('./quarterly-owner').aggregate(transactions,advances.rows,f),pendingRequests:Number(pending.n)};
 }
 const events=[];for(const a of advances.rows){if(f.branch!=='all'&&a.branchId!==f.branch)continue;for(const e of a.events||[]){const date=Date.parse(e.createdAt);if(!Number.isFinite(date))fail('REPORT_INVALID_EVENT_DATE',503);if(date<Date.parse(f.utcFrom)||date>=Date.parse(f.utcToExclusive))continue;if(id==='cash-flow'){if(['DISBURSE','RETURN'].includes(e.action))events.push({id:e.id,branch_id:a.branchId,tx_type:e.action==='RETURN'?'INCOME':'EXPENSE',amount:String(exact(e.amount)),payment_method:'CASH_DRAWER',status:'APPROVED',tx_intent:'ADVANCE_'+e.action,account_code:'ADVANCE',account_name:'Mutasi advance'});continue;}if(e.action!=='APPROVE')continue;if(!Array.isArray(e.lines)||!e.lines.length||e.lines.reduce((n,l)=>n+exact(l.amount),0n)!==exact(e.amount))fail('REPORT_SETTLEMENT_INCOMPLETE',503);for(const l of e.lines)events.push({id:e.id+':'+l.receiptKey,branch_id:a.branchId,user_id:a.userId,coa_id:l.coaId,tx_type:'EXPENSE',amount:String(exact(l.amount)),payment_method:'CASH_DRAWER',status:'APPROVED',tx_intent:'ADVANCE_APPROVE',receipt_key:l.receiptKey,created_at:e.createdAt,account_code:l.coaId,account_name:'Settlement advance'});}}
 if(id==='audit-evidence'){
  const scoped=transactions.concat(events),keys=[...new Set(scoped.map(r=>String(r.receipt_key||'').replace(/^\/api\/receipts\//,'')).filter(Boolean))];
  const assets=keys.length?(await pool.query('SELECT filename,user_id,branch_id,mime FROM receipt_assets WHERE filename=ANY($1::text[])',[keys])).rows:[];
  const report=register(scoped.map(r=>({...r,receipt_registered:assets.some(a=>a.filename===String(r.receipt_key||'').replace(/^\/api\/receipts\//,'')&&a.user_id===r.user_id&&a.branch_id===r.branch_id),file_verified:null})));
  report.columns.push({key:'receipt_registered',label:'Receipt metadata registered'},{key:'file_verified',label:'File verification (not performed)'});return report;
 }
 if(events.length&&id!=='cash-flow'){
  const accounts=(await pool.query('SELECT id,account_code,account_name FROM chart_of_accounts')).rows;
  for(const e of events){const account=accounts.find(a=>a.id===e.coa_id);if(!account)fail('REPORT_SETTLEMENT_ACCOUNT_MISSING',503);e.account_code=account.account_code;e.account_name=account.account_name;}
 }
 const approved=transactions.filter(r=>r.status==='APPROVED'&&r.tx_intent==='SETOR_NOTA').concat(events);
 const groups=new Map();for(const r of approved){const key=JSON.stringify([r.branch_id,id==='cash-flow'?r.payment_method:r.account_code]);if(!groups.has(key))groups.set(key,[]);groups.get(key).push(r);}
 const rows=[...groups.values()].map(rs=>({branch_id:rs[0].branch_id,branch:units.find(u=>u.id===rs[0].branch_id)?.name,account_code:rs[0].account_code,account_name:rs[0].account_name,method:rs[0].payment_method,...total(rs)}));
 return {id,columns:(id==='cash-flow'?['branch_id','branch','method','income','expense','net','count']:['branch_id','branch','account_code','account_name','income','expense','net','count']).map(key=>({key,label:key})),rows,totals:total(approved),filters:f,sourceCount:transactions.length,complete:true,readiness:rows.length?'available':'empty',missingDatasets:[],generated_at:new Date().toISOString(),provenance:'Recorded ordinary transactions; approved advance settlement on event WIB day. Approval is not disbursement.',neracaComplete:false,reconciliationComplete:false,endBalance:null,notices:['Mutasi operasional tercatat, bukan laba akrual atau neraca lengkap.']};
}
function toCsv(report){
 if(report.templateLayout?.presentation==='simple')report={...report,...require('./report-presentation').columnsAndRows(report.templateLayout)};
 report={...report,columns:report.columns.filter(c=>!['account_code','account_name'].includes(c.key))};
 const money=new Set(['amount','income','expense','net','system_balance','physical_cash','difference']);
 const cell=(value,key)=>{let s=value==null?'':String(value);const numeric=(money.has(key)||/^unit_\d+$/.test(key))&&/^-?\d+$/.test(s);if(!numeric&&/^[\s\u0000-\u001f\u007f]*[=+\-@]|^[\u0000-\u001f\u007f]/.test(s))s="'"+s;return /[",\r\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;};
 return '\uFEFF'+[report.columns.map(c=>cell(report.templateLayout?.presentation==='simple'?c.label:c.key)).join(','),...report.rows.map(r=>report.columns.map(c=>cell(r[c.key],c.key)).join(','))].join('\r\n')+'\r\n';
}
module.exports={read,filters,toCsv};
