'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const reports=require('../operational-reports'),{unzip,exportXlsx}=require('../report-template-xlsx');
const units=Array.from({length:8},(_,i)=>({id:'u'+i,name:'Cabang '+i,category:'OTHER',is_active:i===7?0:1}));
const transactions=units.flatMap((u,i)=>[{id:'in'+i,branch_id:u.id,account_code:'4-1300',account_name:'Jasa',account_type:'REVENUE',tx_type:'INCOME',amount:String((i+1)*1000),status:'APPROVED',tx_intent:'SETOR_NOTA',payment_method:'CASH_DRAWER',created_at:'2026-10-01T00:00:00Z'}, {id:'out'+i,branch_id:u.id,account_code:'5-1100',account_name:'Bahan',account_type:'EXPENSE',tx_type:'EXPENSE',amount:'100',status:'APPROVED',tx_intent:'SETOR_NOTA',payment_method:'CASH_DRAWER',created_at:'2026-10-02T00:00:00Z'}]);
const accounts=require('../coa-catalog').definitions.map(([id,account_name,account_type])=>({id,account_code:id,account_name,account_type}));
const pool={async query(sql,args){if(sql.includes('FROM business_units'))return {rows:units};if(sql.includes('FROM chart_of_accounts'))return {rows:accounts};if(sql.includes('FROM ledger_transactions'))return {rows:transactions.filter(t=>t.created_at>=args[0]&&t.created_at<args[1]&&(args[2]==='all'||t.branch_id===args[2]))};throw Error('Unexpected '+sql);}};
const params=(mode,branch='all')=>new URLSearchParams({view_mode:mode,branch_id:branch,date_from:'2026-10-01',date_to:'2026-10-24',timezone:'Asia/Jakarta'});
const read=(id,mode,branch='all')=>reports.read(pool,{role:'OWNER'},'fixture',id,params(mode,branch),{readAdvances:async()=>({rows:[]})});
test('scope modes reject contradictory or duplicate filters and keep backwards-compatible filter shape',()=>{
 for(const p of [params('branch'),params('company','u1'),params('comparison','u1'),params('unknown')])assert.throws(()=>reports.filters(p));
 const duplicate=params('company');duplicate.append('view_mode','comparison');assert.throws(()=>reports.filters(duplicate));const old=params('company');old.delete('view_mode');assert.equal(reports.filters(old).viewMode,undefined);
});
test('P&L company equals all branch columns; branch isolates exact ID and keeps unknowns unavailable',async()=>{
 const company=await read('company-profit-loss','company'),comparison=await read('company-profit-loss','comparison');
 const row=r=>r.presentationData.rows.find(x=>x.item==='Total Pendapatan');assert.equal(row(company).amount_1,'36000');
 const combined=row(comparison);assert.equal(Object.keys(combined).length,10);assert.equal(Object.values(combined).slice(1,-1).reduce((n,v)=>n+BigInt(v),0n),36000n);assert.equal(combined.amount_9,'36000');assert.equal(comparison.templateLayout.continuations.length,1);
 for(let i=0;i<8;i++){const branch=await read('company-profit-loss','branch','u'+i);assert.equal(row(branch).amount_1,String((i+1)*1000));assert.equal(branch.templateLayout.units.length,1);assert.equal(branch.templateLayout.grid.find(r=>r[0]==='Biaya penyusutan')[1],null);}
 assert.doesNotMatch(JSON.stringify(comparison.presentationData),/4-1300|5-1100|account_code/);
});
test('cash and stafel balance comparisons keep every branch, repeated company columns once in CSV and unavailable balances',async()=>{
 for(const id of ['fund-position','cash-flow']){
  const report=await read(id,'comparison'),layout=report.templateLayout,cols=report.presentationData.columns;
  assert.equal(cols.length,id==='fund-position'?19:10);assert.equal(layout.continuations.length,id==='fund-position'?2:1);
  for(const i of [0,7])assert.ok(cols.some(c=>c.label.includes('Cabang '+i)));
  assert.equal(cols.filter(c=>c.label.startsWith('Perusahaan')).length,id==='fund-position'?2:1);
  const table=layout.grid.slice(6).filter((_,i)=>layout.rowTypes[i+6]!=='section');if(id==='fund-position')assert.ok(table.every(row=>row.slice(1).every(v=>v===null||v==='')));else{const net=report.presentationData.rows.find(r=>r.item==='KENAIKAN (PENURUNAN) KAS TERCATAT');assert.equal(net.amount_9,'35200');assert.equal(net.amount_8,'7900');assert.ok(layout.grid.find(r=>r[0]==='KAS DAN SETARA KAS PADA AKHIR PERIODE').slice(1).every(v=>v===null));}
  const csv=reports.toCsv(report);assert.match(csv,/Cabang 7/);assert.doesNotMatch(csv,/account_code|4-1300/);
  const files=unzip(exportXlsx(layout,'Perusahaan QA')),content=files.map(f=>f.data.toString()).join('');assert.match(content,/Cabang 7/);assert.match(content,/Belum tersedia/);assert.doesNotMatch(content,/account_code/);if(id==='cash-flow')assert.match(content,/<f>IF\(COUNT/);
 }
});
