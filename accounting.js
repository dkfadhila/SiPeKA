'use strict';
function money(v){if(typeof v!=='string'||!/^(0|[1-9][0-9]*)$/.test(v)||BigInt(v)>9223372036854775807n)throw Error('EXACT_IDR_REQUIRED');return BigInt(v);}
function validateLines(lines){if(!Array.isArray(lines)||lines.length<2||lines.length>500)throw Error('JOURNAL_LINES_REQUIRED');let debit=0n,credit=0n;for(const l of lines){if(!l.account_id||!l.branch_id)throw Error('DIMENSION_REQUIRED');const d=money(l.debit),c=money(l.credit);if((d>0n)===(c>0n))throw Error('DEBIT_XOR_CREDIT');debit+=d;credit+=c;}if(debit!==credit)throw Error('UNBALANCED_JOURNAL');return{debit:debit.toString(),credit:credit.toString()};}
async function post(pool,sessionToken,request){
 // Only trusted HTTP integration may supply the authenticated session token.
 const result=await pool.query('SELECT accounting_post($1,$2::jsonb) id',[sessionToken,JSON.stringify(request)]);
 return{id:result.rows[0].id};
}
function date(v){if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v+'T00:00:00Z'))||new Date(v+'T00:00:00Z').toISOString().slice(0,10)!==v)throw Error('ISO_DATE_REQUIRED');return v;}
async function trialBalance(pool,sessionToken,{start,end,branchId=null}){
 date(start);date(end);if(start>end)throw Error('INVALID_DATE_RANGE');
 if(branchId!==null&&(typeof branchId!=='string'||!branchId||branchId.length>128))throw Error('INVALID_BRANCH');
 const client=await pool.connect();
 try{
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  await client.query('SELECT accounting_owner($1)',[sessionToken]);
  const {rows}=await client.query(`SELECT a.id,a.code,a.name,a.type,
   sum(l.debit::numeric)::text debit,sum(l.credit::numeric)::text credit,
   sum(l.debit::numeric-l.credit::numeric)::text AS "netMovement"
   FROM accounting_lines l JOIN accounting_journals j ON j.id=l.journal_id JOIN accounting_accounts a ON a.id=l.account_id
   WHERE j.accounting_date >= $1::date AND j.accounting_date <= $2::date AND ($3::text IS NULL OR l.branch_id=$3)
   GROUP BY a.id ORDER BY a.code`,[start,end,branchId]);
  const counts=(await client.query(`SELECT count(DISTINCT j.id)::text journals,count(*)::text lines
   FROM accounting_lines l JOIN accounting_journals j ON j.id=l.journal_id
   WHERE j.accounting_date >= $1::date AND j.accounting_date <= $2::date AND ($3::text IS NULL OR l.branch_id=$3)`,[start,end,branchId])).rows[0];
  let d=0n,c=0n;for(const r of rows){d+=BigInt(r.debit);c+=BigInt(r.credit);}
  if(d!==c)throw Error('TRIAL_BALANCE_INVARIANT');
  await client.query('COMMIT');
  return{basis:'POSTED_RECORDED_CASH_BASIS_MOVEMENTS',openingBalances:'MISSING',neracaComplete:false,
   notices:['Saldo awal belum diketahui; saldo akhir tidak tersedia.','Seimbang tidak berarti akrual lengkap, rekonsiliasi bank, kewajiban pajak, atau laporan audit.'],
   start,end,branchId,rows,...counts,totalDebit:d.toString(),totalCredit:c.toString()};
 }catch(e){try{await client.query('ROLLBACK');}catch{}throw e;}finally{client.release();}
}
module.exports={validateLines,post,trialBalance};
