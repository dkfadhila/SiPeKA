'use strict';
// Informational read models only. No opening balances, postings or balancing equity.
const subtitle='Informasi internal; bukan laporan keuangan lengkap';
const titles={'fund-position':'Ringkasan Posisi Dana (Neraca Terbatas)','recorded-income-expense':'Ringkasan Pendapatan & Beban Tercatat'};
const fail=code=>{throw Object.assign(Error(code),{statusCode:503});};
const amount=v=>{if(!/^\d+$/.test(String(v)))fail('REPORT_INVALID_AMOUNT');return BigInt(v);};
function instant(v){const s=String(v).replace(' ','T'),n=Date.parse(/(?:Z|[+-]\d\d:?\d\d)$/.test(s)?s:s+'Z');if(!Number.isFinite(n))fail('REPORT_INVALID_EVENT_DATE');return n;}
function build(id,transactions,advances,accounts,f){
 const generated_at=new Date().toISOString(),within=v=>instant(v)>=instant(f.utcFrom)&&instant(v)<instant(f.utcToExclusive);
 let income=0n,expense=0n,disbursements=0n,returns=0n,outstanding=0n,incomeCount=0,expenseCount=0,eventCount=0;
 const groups=new Map(),seen=new Set();
 function spending(value,account){if(!account||account.account_type&&account.account_type!=='EXPENSE')fail('REPORT_SETTLEMENT_ACCOUNT_MISSING');expense+=amount(value);expenseCount++;const key=account.account_code;const g=groups.get(key)||{account_code:key,account_name:account.account_name,expense:'0'};g.expense=String(BigInt(g.expense)+amount(value));groups.set(key,g);}
 for(const t of transactions){if(!require('./report-branch-scope').includes(f,t.branch_id))continue;if(!within(t.created_at)||t.status!=='APPROVED'||t.tx_intent!=='SETOR_NOTA')continue;if(t.tx_type==='INCOME'){income+=amount(t.amount);incomeCount++;}else if(t.tx_type==='EXPENSE')spending(t.amount,t);else fail('REPORT_INVALID_TYPE');}
 for(const a of advances){if(!require('./report-branch-scope').includes(f,a.branchId))continue;let d=0n,s=0n,r=0n;
  for(const e of a.events||[]){if(!e.id||seen.has(e.id))fail('REPORT_DUPLICATE_EVENT');seen.add(e.id);const active=within(e.createdAt);
   if(e.action==='DISBURSE'){d+=amount(e.amount);if(active){disbursements+=amount(e.amount);eventCount++;}}
   if(e.action==='RETURN'){r+=amount(e.amount);if(active){returns+=amount(e.amount);eventCount++;}}
   if(e.action==='APPROVE'){if(!e.lines?.length||e.lines.reduce((n,l)=>n+amount(l.amount),0n)!==amount(e.amount))fail('REPORT_SETTLEMENT_INCOMPLETE');s+=amount(e.amount);if(active){for(const l of e.lines)spending(l.amount,accounts.find(c=>c.id===l.coaId));eventCount++;}}
  }
  if(d<s+r)fail('REPORT_SETTLEMENT_INCOMPLETE');outstanding+=d-s-r;
 }
 const coverage={income:{source:'ledger_transactions: APPROVED INCOME SETOR_NOTA',recordedCount:incomeCount,recordedAmount:incomeCount?String(income):null,completeness:'unverified'},expense:{source:'APPROVED EXPENSE SETOR_NOTA + APPROVE settlement lines',recordedCount:expenseCount,completeness:'recorded_only'},history:{completeness:'unverified',dateBasis:'Ordinary: recorded UTC timestamp converted to WIB; settlement/disbursement/return: event WIB day'}};
 const row=(item,value,basis)=>({item,amount:value==null?null:String(value),status:value==null?'Belum tersedia':'Tercatat',basis});
 const rows=id==='fund-position'?[
  row('Dana Staff belum dipertanggungjawabkan',outstanding,'Snapshot saat ini; bukan posisi akhir periode'),
  row('Pencairan dana tercatat',disbursements,'Mutasi periode WIB; bukan beban'),row('Pengembalian dana tercatat',returns,'Mutasi periode WIB; bukan pendapatan'),
  ...['Kas akhir','Total aset','Total kewajiban','Ekuitas'].map(x=>row(x,null,'Belum tersedia'))
 ]:[row('Pendapatan tercatat',incomeCount?income:null,'Cakupan sumber pendapatan belum terverifikasi'),row('Belanja disetujui',expense,'Nota disetujui + settlement disetujui; bukan pencairan'),row('Selisih transaksi tercatat',incomeCount?income-expense:null,'Bukan laba/rugi usaha definitif')];
 return {id,title:titles[id],subtitle,columns:[{key:'item',label:'Keterangan'},{key:'amount',label:'Nominal (Rp)'},{key:'status',label:'Ketersediaan'},{key:'basis',label:'Dasar data'}],rows,totals:id==='fund-position'?null:{income:incomeCount?String(income):null,expense:String(expense),net:incomeCount?String(income-expense):null,count:incomeCount+expenseCount},coverage,expenseAccounts:[...groups.values()],snapshot:{outstanding:String(outstanding),basis:'CURRENT_SNAPSHOT_NOT_PERIOD_END',observedAt:generated_at},filters:f,sourceCount:transactions.length+eventCount,complete:true,financialStatementsComplete:false,neracaComplete:false,reconciliationComplete:false,cash:null,assets:null,liabilities:null,equity:null,endBalance:null,readiness:transactions.length||eventCount?'available':'empty',missingDatasets:[],generated_at,provenance:'Transaksi operasional tercatat dan snapshot advance terautentikasi; tidak memakai trial balance sebagai saldo akhir.',notices:[subtitle,'Pendapatan hanya yang tercatat; sumber penjualan lengkap belum terverifikasi. Tidak ada catatan pendapatan bukan bukti pendapatan nol.','Pencairan ke Staff bukan beban; settlement disetujui menjadi belanja. Pengembalian dana bukan pendapatan.','Dana Staff adalah snapshot saat ini, bukan posisi akhir periode. Mutasi memakai periode aktif WIB; tidak merekonstruksi saldo historis.','Kas akhir, total aset, kewajiban dan ekuitas belum tersedia. Tidak ada ekuitas penyeimbang atau klaim persamaan neraca.']};
}
async function read(pool,actor,token,id,params,{readAdvances=require('./advance-service').snapshot}={}){
 if(actor?.role!=='OWNER')throw Object.assign(Error('REPORT_OWNER_ONLY'),{statusCode:403});
 const f=require('./operational-reports').filters(params),units=(await pool.query('SELECT id FROM business_units')).rows;
 require('./report-branch-scope').validate(f,units);
 if(f.branch!=='all'&&!units.some(u=>u.id===f.branch))throw Object.assign(Error('REPORT_BRANCH_NOT_FOUND'),{statusCode:404});
 const transactions=(await pool.query(`SELECT t.id,t.branch_id,t.tx_type,t.amount::text amount,t.status,t.tx_intent,t.created_at,c.account_code,c.account_name,c.account_type FROM ledger_transactions t JOIN chart_of_accounts c ON c.id=t.coa_id WHERE t.created_at >= $1::timestamp AND t.created_at < $2::timestamp AND ($3::text='all' OR t.branch_id=$3) AND ($4::text[] IS NULL OR t.branch_id=ANY($4)) ORDER BY t.created_at,t.id LIMIT 10001`,[f.utcFrom,f.utcToExclusive,f.branch,f.branchIds||null])).rows.filter(r=>require('./report-branch-scope').includes(f,r.branch_id));
 if(transactions.length>10000)throw Object.assign(Error('REPORT_TOO_LARGE'),{statusCode:413});
 const advances=await readAdvances(pool,token);if(!Array.isArray(advances?.rows))fail('REPORT_ADVANCE_UNAVAILABLE');
 const accounts=(await pool.query('SELECT id,account_code,account_name,account_type FROM chart_of_accounts')).rows;
 return build(id,transactions,advances.rows,accounts,f);
}
module.exports={build,read,titles,subtitle};
