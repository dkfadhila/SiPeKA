'use strict';
const {definitions,byCode}=require('./coa-catalog');
// Uses the existing, reviewed realized-transaction source; does not invent accruals.
function build(source,units,id){
 const scoped=units.filter(u=>source.filters.branch==='all'||u.id===source.filters.branch);
 const comparison=id==='compare-profit-loss';
 const columns=[{key:'account_code',label:'Kode'},{key:'account_name',label:'Uraian'},
  ...(comparison?scoped.map((u,i)=>({key:'unit_'+i,label:u.name,type:'currency'})):[]),
  {key:'amount',label:source.filters.branch==='all'?'Total Perusahaan':'Total Unit',type:'currency'}];
 const buckets=new Map(definitions.map(([code])=>[code,new Map()]));
 const legacy=new Map();
 for(const row of source.rows){
  const code=row.account_code,definition=byCode.get(code);
  const income=BigInt(row.income),expense=BigInt(row.expense);
  if(definition&&((definition.type==='REVENUE'&&expense!==0n)||(definition.type==='EXPENSE'&&income!==0n)))throw Object.assign(Error('REPORT_ACCOUNT_TYPE_MISMATCH'),{statusCode:503});
  // Legacy categories can be ambiguous (e.g. production/general utilities).
  // Display explicitly rather than silently remapping historical transactions.
  const target=definition?buckets.get(code):legacy.get(code)?.values||new Map();
  target.set(row.branch_id,(target.get(row.branch_id)||0n)+(definition?.type==='EXPENSE'?expense:definition?income:income-expense));
  if(!definition)legacy.set(code,{name:row.account_name,values:target});
 }
 const rows=[];
 const add=(code,name,values)=>{const r={account_code:code,account_name:name};let total=0n;scoped.forEach((u,i)=>{const v=values?.get(u.id)||0n;total+=v;if(comparison)r['unit_'+i]=values?String(v):null;});r.amount=values?String(total):null;rows.push(r);};
 const sumCodes=codes=>new Map(scoped.map(u=>[u.id,codes.reduce((sum,code)=>sum+(buckets.get(code)?.get(u.id)||0n),0n)]));
 const combine=(a,b,subtract=true)=>new Map(scoped.map(u=>[u.id,(a.get(u.id)||0n)+(subtract?-1n:1n)*(b.get(u.id)||0n)]));
 const codes=prefix=>definitions.filter(d=>d[0].startsWith(prefix)).map(d=>d[0]);
 const section=(prefix,title)=>{add('',title,null);for(const [code,name] of definitions.filter(d=>d[0].startsWith(prefix)))add(code,name,code==='6-3000'?null:buckets.get(code));return sumCodes(codes(prefix));};
 const revenue=section('4-','PENDAPATAN USAHA');add('','Jumlah Pendapatan Usaha',revenue);
 const cogs=section('5-','BEBAN POKOK PENDAPATAN');add('','Jumlah Beban Pokok Pendapatan',cogs);
 const gross=combine(revenue,cogs);add('','LABA KOTOR TERCATAT',gross);
 const opex=section('6-','BEBAN USAHA');add('','Jumlah Beban Usaha',opex);
 const operating=combine(gross,opex);add('','LABA USAHA TERCATAT',operating);
 section('7-','PENDAPATAN DAN BEBAN LAIN-LAIN');
 const other=combine(sumCodes(['7-1100']),sumCodes(['7-2100']));add('','Pendapatan / Beban Lain-lain Bersih',other);
 const beforeTax=combine(operating,other,false);add('','LABA SEBELUM PAJAK TERCATAT',beforeTax);
 const tax=section('8-','PAJAK PENGHASILAN');const net=combine(beforeTax,tax);add('','HASIL BERSIH AKUN TERPETAKAN',net);
 const legacyTotal=new Map();
 if(legacy.size){add('','AKUN HISTORIS — BELUM DIPETAKAN KE FORMAT BARU',null);for(const [code,item] of legacy){add(code,item.name,item.values);for(const [unit,value] of item.values)legacyTotal.set(unit,(legacyTotal.get(unit)||0n)+value);}add('','Mutasi bersih akun historis',legacyTotal);}
 add('','TOTAL HASIL BERSIH TERCATAT',combine(net,legacyTotal,false));
 if(rows.at(-1).amount!==source.totals.net)throw Object.assign(Error('REPORT_PNL_RECONCILIATION_FAILED'),{statusCode:503});
 return {...source,id,columns,rows,sourceCount:source.sourceCount,financialStatementsComplete:false,
  branchColumns:scoped.map((u,i)=>({key:'unit_'+i,id:u.id,name:u.name})),
  notices:[...source.notices,'Format mengikuti referensi laba rugi Owner. Hanya realisasi tercatat; penyusutan/akrual belum ditambahkan otomatis.',...(legacy.size?['Akun historis ditampilkan terpisah. Klasifikasi lama tidak ditebak atau ditulis ulang.']:[])]};
}
module.exports={build};
