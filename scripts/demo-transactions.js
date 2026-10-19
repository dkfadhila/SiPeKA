'use strict';
// Pure fixture generator: does not open a database or modify any data.
const {definitions}=require('../coa-catalog');
function generate(dateTo,units){
 const end=new Date(dateTo+'T00:00:00Z');
 if(Number.isNaN(+end)||end.toISOString().slice(0,10)!==dateTo||!Array.isArray(units)||!units.length)throw Error('DEMO_INVALID_INPUT');
 const catalog=new Map(definitions.map(([code,name,type])=>[code,{name,type}]));
 const start=new Date(+end-29*86400000),stamp=dateTo.replace(/-/g,'');
 return Array.from({length:100},(_,i)=>{
  const unit=units[i%units.length],income=i%5>=2;
  const revenues=unit.category==='LAUNDRY'?['4-1300']:['KOS','VILLA'].includes(unit.category)?['4-1100','4-1200']:['4-1400','4-1900'];
  const expenses=['5-1100','5-1500','6-1300','6-1400','6-1500','6-1700','6-1900'];
  const code=(income?revenues:expenses)[Math.floor(i/5)%(income?revenues.length:expenses.length)],account=catalog.get(code);
  const localDay=new Date(+start+Math.floor(i*29/99)*86400000).toISOString().slice(0,10);
  const created_at=localDay+'T01:'+String((i*11)%60).padStart(2,'0')+':00Z'; // 08:00–08:59 WIB.
  return {id:'DEMO-'+stamp+'-'+String(i+1).padStart(3,'0'),idempotency_key:'dummy-v2-'+stamp+'-'+(i+1),branch_id:unit.id,coa_id:code,tx_type:account.type==='REVENUE'?'INCOME':'EXPENSE',amount:income?100000+((i*137)%240)*10000:20000+((i*43)%45)*10000,payment_method:income?['CASH_DRAWER','QRIS','BANK_TRANSFER'][i%3]:['CASH_DRAWER','BANK_TRANSFER'][i%2],memo:'[DUMMY] '+unit.name+' — '+account.name+' — '+localDay,status:'APPROVED',tx_intent:'SETOR_NOTA',created_at};
 });
}
module.exports={generate};
