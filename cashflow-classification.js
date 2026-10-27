'use strict';
// Only unambiguous cash transaction categories are mapped. Balances and accruals are never inferred.
const mapping={'4-1100':8,'4-1200':11,'4-1300':9,'4-1400':10,'4-1900':11,'5-1100':12,'5-1200':12,'5-1300':12,'5-1400':13,'5-1500':14,'6-1100':13,'6-1200':14,'6-1300':14,'6-1400':14,'6-1500':14,'6-1600':14,'6-1700':14,'6-1800':14,'6-1900':14,'6-2000':14,'8-1000':15};
function classify(source,branch='all'){
 if(!Array.isArray(source?.cashEntries))return null;
 const values=Object.fromEntries([8,9,10,11,12,13,14,15,16].map(r=>[r,0n]));let income=0n,expense=0n,unclassifiedIncome=0n,unclassifiedExpense=0n;
 for(const entry of source.cashEntries){if(branch!=='all'&&entry.branch_id!==branch)continue;
  if(!/^\d+$/.test(String(entry.amount))||!['INCOME','EXPENSE'].includes(entry.tx_type))throw Error('REPORT_INVALID_CASH_ENTRY');
  const amount=BigInt(entry.amount),incoming=entry.tx_type==='INCOME',row=entry.tx_intent==='SETOR_NOTA'?mapping[entry.account_code]:null;
  if(incoming)income+=amount;else expense+=amount;
  if(row&&(row<=11)===incoming)values[row]+=amount;else if(incoming)unclassifiedIncome+=amount;else unclassifiedExpense+=amount;
 }
 // Mixed interest/other expense accounts cannot establish the interest row.
 values[16]=null;values[17]=[8,9,10,11].reduce((n,r)=>n+values[r],0n)-[12,13,14,15].reduce((n,r)=>n+values[r],0n);
 values[31]=income-expense;
 return {values:Object.fromEntries(Object.entries(values).map(([r,v])=>[r,v===null?null:String(v)])),unclassifiedIncome:String(unclassifiedIncome),unclassifiedExpense:String(unclassifiedExpense),unclassifiedNet:String(unclassifiedIncome-unclassifiedExpense)};
}
module.exports={classify};
