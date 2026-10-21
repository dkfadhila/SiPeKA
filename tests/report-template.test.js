'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {make}=require('../report-template'),{exportXlsx,unzip}=require('../report-template-xlsx');
const f={branch:'all',dateFrom:'2026-10-01',dateTo:'2026-10-19'},units=[{id:'a',name:'Unit X1'},{id:'b',name:'Unit X2'}];
const source={rows:[{branch_id:'a',account_code:'4-1300',income:'5000000',expense:'0'},{branch_id:'a',account_code:'5-1100',income:'0',expense:'750000'}]};
test('P&L follows exact source row coordinates, unit slots, subtotals, ratios and prior period',()=>{
 const t=make('compare-profit-loss',source,{...source,filters:f},units,f);
 assert.equal(t.grid.length,59);assert.equal(t.grid[5].length,11);assert.equal(t.grid[5][2],'Unit X1');assert.equal(t.grid[9][0],'4-1300');assert.equal(t.grid[9][2],'5000000');assert.equal(t.grid[12][2],'5000000');assert.equal(t.grid[22][2],'4250000');assert.equal(t.grid[23][2],.85);assert.equal(t.grid[36][2],null);assert.equal(t.grid[37][2],null);assert.equal(t.grid[53][1],'Disusun oleh,');assert.equal(t.grid[53][8],'Disetujui oleh,');assert.equal(t.grid[9][10],0);
});
test('incomplete balances remain unavailable, source formulas never imply balanced statements',()=>{
 const t=make('fund-position',{rows:[]},{filters:f,rows:[]},units,f);assert.equal(t.grid[8][2],null);assert.equal(t.grid[51][2],null);assert.equal(t.grid[5][2],f.dateTo);assert.equal(t.grid[5][3],'2025-12-31');
 const cash=make('cash-flow',{rows:[]},{filters:f,rows:[]},units,f);assert.equal(cash.grid[32][2],null);assert.equal(cash.grid[46][2],null);assert.equal(cash.grid[50][1],'Disusun oleh,');
});
test('XLSX preserves original styles, merges, widths and exact integer values; escapes company text',()=>{
 const t=make('company-profit-loss',source,{filters:f,rows:[]},units,f),bytes=exportXlsx(t,'Contoh & Perusahaan');
 const files=unzip(bytes),sheet=files.find(f=>f.name==='xl/worksheets/sheet1.xml').data.toString(),styles=files.find(f=>f.name==='xl/styles.xml').data.toString();
 assert.match(sheet,/Contoh &amp; Perusahaan/);assert.match(sheet,/<mergeCell ref="A1:K1"/);assert.match(sheet,/r="C10"[^>]*><v>5000000<\/v>/);assert.doesNotMatch(sheet,/<f[ >]/);assert.match(styles,/FF1F3864/);
 assert.deepEqual(unzip(require('../report-template-xlsx').zip(files)).map(f=>[f.name,f.data.length]),files.map(f=>[f.name,f.data.length]));
 const prior=fs.readFileSync(require('node:path').join(__dirname,'../report-templates/pnl.xlsx'));assert.ok(prior.length>0);
});

test('more than six units continue in original six-slot worksheets',()=>{
 const all=Array.from({length:8},(_,i)=>({id:'u'+i,name:'Unit '+i}));
 const t=make('compare-profit-loss',{rows:[]},{rows:[]},all,f);assert.equal(t.continuations.length,1);assert.equal(t.continuations[0].grid[5][2],'Unit 6');
 const files=unzip(exportXlsx(t,'QA'));assert.ok(files.find(f=>f.name==='xl/worksheets/sheet3.xml'));assert.match(files.find(f=>f.name==='xl/workbook.xml').data.toString(),/rIdSipeka3/);
});

test('all statement labels and Excel values follow arbitrary dates, leap years and year boundaries',()=>{
 for(const f of [{branch:'all',dateFrom:'2024-02-01',dateTo:'2024-02-29'},{branch:'all',dateFrom:'2027-01-01',dateTo:'2027-01-15'},{branch:'all',dateFrom:'2025-12-20',dateTo:'2026-01-05'}]){
  const prior={filters:{dateFrom:'2023-12-01',dateTo:'2023-12-29'},rows:[]};
  for(const id of ['company-profit-loss','compare-profit-loss','profit-loss','recorded-income-expense','cash-flow','fund-position']){
   const layout=make(id,{rows:[]},prior,units,f),files=unzip(exportXlsx(layout,'Tanggal QA')),sheet=files.find(x=>x.name==='xl/worksheets/sheet1.xml').data.toString();
   assert.match(sheet,new RegExp('<c[^>]*r="C3"[^>]*>[\\s\\S]*?'+f.dateTo+'[\\s\\S]*?</c>'));assert.match(sheet,/<c[^>]*r="B3"[^>]*\/>/);assert.match(sheet,new RegExp(f.dateTo));assert.equal(layout.period.from,f.dateFrom);assert.equal(layout.grid[2][2],id==='fund-position'?f.dateTo:f.dateFrom+' s.d. '+f.dateTo);
   if(id==='fund-position'){const comparison=(Number(f.dateTo.slice(0,4))-1)+'-12-31';assert.equal(layout.grid[5][3],comparison);assert.equal(layout.previousPeriod.to,comparison);assert.match(sheet,new RegExp(comparison));}
   else {assert.match(layout.grid[5][layout.kind==='pnl'?8:2],new RegExp(f.dateFrom));assert.match(layout.grid[5][layout.kind==='pnl'?9:3],/2023-12-01/);}
   assert.doesNotMatch(sheet,/46326/);
  }
 }
});
