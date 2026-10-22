'use strict';
function build(transactions,accounts){
 return JSON.stringify({scope:'latest_40_only_not_complete_period',
  account_mapping:{mode:'advisory_only',policy:'Usulkan akun dari bagan yang tersedia sesuai jenis pemasukan/pengeluaran. Jika ambigu, jelaskan pilihan dan minta konteks. Jangan mengubah pencatatan. Laporan menyajikan pos ringkas, tanpa kode atau daftar akun. Akun historis tidak dipetakan ulang tanpa review.'},
  chart_of_accounts:accounts.map(a=>{const definition=require('./coa-catalog').byCode.get(a.account_code);return {id:a.id,code:a.account_code,name:a.account_name,type:a.account_type,group:definition?.group||'Akun historis',legacy:!definition,transaction_input_allowed:!!definition&&a.account_code!=='6-3000'&&['REVENUE','EXPENSE'].includes(a.account_type)};}),
  transactions:transactions.slice(0,40).map(t=>({id:t.id,date:t.created_at,branch:t.branch_name,type:t.tx_type,amount:t.amount,payment:t.payment_method,status:t.status,memo:t.memo,account_id:t.coa_id,account_code:t.account_code,account_name:t.account_name}))});
}
module.exports={build};
