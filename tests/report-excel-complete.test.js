'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {make}=require('../report-template'),{compact}=require('../report-presentation'),{exportXlsx,unzip}=require('../report-template-xlsx');
const filters={branch:'all',dateFrom:'2026-10-01',dateTo:'2026-10-22'},units=[{id:'a',name:'Unit A'},{id:'b',name:'Unit B'}];
const source={rows:[{branch_id:'a',account_code:'4-1300',income:'1000',expense:'0'},{branch_id:'b',account_code:'4-1300',income:'2000',expense:'0'},{branch_id:'a',account_code:'5-1100',income:'0',expense:'100'}]};
const previous={filters:{dateFrom:'2026-09-09',dateTo:'2026-09-30'},rows:[{branch_id:'a',account_code:'4-1300',income:'500',expense:'0'}]};
const complete=(id='company-profit-loss',us=units,s=source,f=filters)=>compact(make(id,s,previous,us,f),id,{excel:true});
test('complete Excel restores unit, consolidation, prior period, variance and margins without account lists',()=>{
 const layout=complete(),row=label=>layout.grid.find(r=>r[0]===label);
 assert.equal(layout.grid[5].length,6);assert.deepEqual(layout.grid[5].slice(0,3),['Keterangan','Unit A','Unit B']);assert.match(layout.grid[5][3],/Konsolidasi.*\n2026-10-01/);assert.match(layout.grid[5][4],/2026-09-09 s.d. 2026-09-30/);
 assert.deepEqual(row('Total Pendapatan'),['Total Pendapatan','1000','2000','3000','500',5]);assert.deepEqual(row('TOTAL LABA KOTOR').slice(1,5),['900','2000','2900','500']);assert.equal(row('Margin laba kotor')[3],2900/3000);assert.equal(row('Biaya penyusutan')[3],null);assert.equal(row('LABA/(RUGI) BERSIH')[5],null);
 assert.doesNotMatch(JSON.stringify(layout.grid),/\d-\d{4}|Kode|Pendapatan Jasa Laundry/);
 const simple=compact(make('company-profit-loss',source,previous,units,filters),'company-profit-loss');assert.equal(simple.grid[5].length,2);assert.ok(!simple.grid.some(r=>r[0]==='Margin laba kotor'));
});
test('XLSX uses complete layout, percentage formats and all continuation units; large integers stay exact text',()=>{
 const us=Array.from({length:8},(_,i)=>({id:'u'+i,name:'Cabang '+i}));
 const rows={rows:us.map(u=>({branch_id:u.id,account_code:'4-1300',income:'900719925474099100',expense:'0'}))};
 const raw=make('company-profit-loss',rows,previous,us,filters),layout=compact(raw,'company-profit-loss');layout.excelLayout=compact(raw,'company-profit-loss',{excel:true});
 const files=unzip(exportXlsx(layout,'Perusahaan & Uji')),sheet=files.find(f=>f.name==='xl/worksheets/sheet1.xml').data.toString(),next=files.find(f=>f.name==='xl/worksheets/sheet2.xml').data.toString(),styles=files.find(f=>f.name==='xl/styles.xml').data.toString();
 assert.match(sheet,/Konsolidasi/);assert.match(sheet,/Periode sebelumnya/);assert.match(sheet,/Perubahan \(%\)/);assert.match(sheet,/t="inlineStr"><is><t xml:space="preserve">7205759403792792800<\/t>/);assert.match(sheet,/s="4"><v>1<\/v>/);assert.match(styles,/numFmtId="10"/);assert.match(next,/Cabang 7/);assert.match(next,/<col min="2" max="6"/);
 for(const file of files)assert.doesNotMatch(file.data.toString(),/4-1300|account_code|account_name|<f[ >]/);
});
test('balance Excel includes current and prior position dates; cash Excel includes both periods',()=>{
 const balance=complete('fund-position');assert.equal(balance.grid[5].length,5);assert.match(balance.grid[5][1],/2026-10-22/);assert.match(balance.grid[5][3],/2025-12-31/);assert.deepEqual(balance.grid.find(r=>r[0]==='Kas dan bank').slice(1),[null,'',null,'']);assert.deepEqual(balance.grid.find(r=>r[0]==='TOTAL').slice(1),[null,null,null,null]);
 const cash=complete('cash-flow');assert.equal(cash.grid[5].length,3);assert.match(cash.grid[5][1],/2026-10-01 s.d. 2026-10-22/);assert.match(cash.grid[5][2],/2026-09-09 s.d. 2026-09-30/);assert.ok(cash.grid.slice(6).every(r=>r[1]===null&&r[2]===null));
});
test('operational source wires separate complete Excel and simple presentation, preserving selected branch and dates',async()=>{
 const txs=source.rows.map((r,i)=>({...r,id:String(i),branch_name:r.branch_id==='a'?'Unit A':'Unit B',amount:r.income==='0'?r.expense:r.income,tx_type:r.income==='0'?'EXPENSE':'INCOME',status:'APPROVED',tx_intent:'SETOR_NOTA'}));
 const pool={async query(sql,args){if(sql.includes('FROM business_units'))return {rows:units};if(sql.includes('FROM ledger_transactions'))return {rows:args[0].startsWith('2026-09-30')?txs.filter(r=>args[2]==='all'||args[2]===r.branch_id):[]};throw Error('Unexpected query '+sql);}};
 for(const branch of ['all','a']){
  const report=await require('../operational-reports').read(pool,{role:'OWNER'},'test','company-profit-loss',new URLSearchParams({branch_id:branch,date_from:filters.dateFrom,date_to:filters.dateTo,timezone:'Asia/Jakarta'}),{readAdvances:async()=>({rows:[]})});
  assert.equal(report.templateLayout.grid[5].length,2);const excel=report.templateLayout.excelLayout;assert.equal(excel.grid[5].length,branch==='all'?6:5);assert.equal(report.totals.income,branch==='all'?'3000':'1000');assert.equal(excel.grid.find(r=>r[0]==='Total Pendapatan').at(-3),report.totals.income);assert.match(excel.grid[5].at(-2),/2026-09-09 s.d. 2026-09-30/);assert.ok(report.presentationData.columns.length===2);if(branch==='a')assert.doesNotMatch(JSON.stringify(excel.grid),/Unit B/);
  const sheet=unzip(exportXlsx(report.templateLayout,'Uji')).find(f=>f.name==='xl/worksheets/sheet1.xml').data.toString();assert.match(sheet,/Perubahan/);
 }
});
