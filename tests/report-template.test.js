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
