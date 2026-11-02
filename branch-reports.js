'use strict';
const money=v=>{if(!/^\d+$/.test(String(v)))throw Error('REPORT_INVALID_AMOUNT');return BigInt(v);};
const currency=(key,label)=>({key,label,type:'currency'}),number=(key,label)=>({key,label,type:'number'});
function build(id,transactions,approved,units,filters){
 for(const row of approved)if(!['INCOME','EXPENSE'].includes(row.tx_type))throw Error('REPORT_INVALID_TYPE');
 const selected=units.filter(u=>filters.branch==='all'||u.id===filters.branch),sum=(rows,type)=>String(rows.filter(r=>r.tx_type===type).reduce((n,r)=>n+money(r.amount),0n));
 const allIncome=sum(approved,'INCOME'),allExpense=sum(approved,'EXPENSE');
 const ratio=(expense,income)=>{if(BigInt(income)===0n)return null;const scaled=(BigInt(expense)*10000n+BigInt(income)/2n)/BigInt(income);return (scaled/100n)+'.'+String(scaled%100n).padStart(2,'0');};
 const rows=selected.map(u=>{const actual=approved.filter(r=>r.branch_id===u.id),control=transactions.filter(r=>r.branch_id===u.id),income=sum(actual,'INCOME'),expense=sum(actual,'EXPENSE');return {branch_id:u.id,branch:u.name,category:u.category||'',income,expense,net:String(BigInt(income)-BigInt(expense)),count:actual.length,income_count:actual.filter(r=>r.tx_type==='INCOME').length,expense_count:actual.filter(r=>r.tx_type==='EXPENSE').length,ratio:ratio(expense,income),pending:control.filter(r=>r.status==='PENDING_APPROVAL').length,rejected:control.filter(r=>r.status==='REJECTED').length,coverage:'Transaksi disetujui + settlement pada tanggal persetujuan'};});
 let columns=[{key:'branch',label:'Cabang'},{key:'category',label:'Jenis usaha'},currency('income','Pemasukan (Rp)'),currency('expense','Pengeluaran (Rp)'),currency('net','Selisih (Rp)'),number('count','Catatan disetujui'),number('expense_count','Catatan pengeluaran'),{key:'ratio',label:'Rasio beban (%)'},number('pending','Menunggu persetujuan'),number('rejected','Ditolak')];
 let output=rows;
 if(id==='management-report')columns=[columns[0],number('count','Catatan disetujui'),number('pending','Menunggu persetujuan'),number('rejected','Ditolak')];
 if(id==='expense-breakdown'){
  columns=[{key:'branch',label:'Cabang'},{key:'expense_type',label:'Jenis pengeluaran'},currency('expense','Pengeluaran (Rp)'),number('count','Catatan pengeluaran')];
  output=[];
  for(const u of selected){const expenses=approved.filter(r=>r.branch_id===u.id&&r.tx_type==='EXPENSE'),groups=new Map();for(const e of expenses){const key=e.coa_id||e.account_code||e.account_name||'unclassified';if(!groups.has(key))groups.set(key,[]);groups.get(key).push(e);}
   for(const group of groups.values())output.push({branch:u.name,branch_id:u.id,expense_type:group[0].account_name||'Jenis belum dipetakan',expense:sum(group,'EXPENSE'),count:group.length});
   if(!expenses.length)output.push({branch:u.name,branch_id:u.id,expense_type:'Tidak ada pengeluaran disetujui',expense:'0',count:0});
  }
 }
 return {id,columns,rows:output,totals:{income:allIncome,expense:allExpense,net:String(BigInt(allIncome)-BigInt(allExpense)),count:approved.length},filters,sourceCount:transactions.length+approved.filter(r=>r.tx_intent==='ADVANCE_APPROVE').length,complete:true,readiness:transactions.length||approved.length?'available':'empty',missingDatasets:[],generated_at:new Date().toISOString(),notices:['Pemasukan/pengeluaran hanya transaksi disetujui dan settlement disetujui pada periode WIB. Pencairan dan pengembalian advance bukan pendapatan atau beban.','Pending/ditolak menghitung transaksi berdasarkan tanggal pencatatan pada periode terpilih. Catatan settlement dihitung per baris pengeluaran. Rasio beban kosong jika pemasukan nol.'],provenance:'Ringkasan cabang dari ledger dan settlement backend yang sama; bukan laba akrual.'};
}
module.exports={build};
