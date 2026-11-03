'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {make}=require('../report-template'),{compact}=require('../report-presentation'),{exportXlsx,unzip}=require('../report-template-xlsx');
const filters={branch:'all',dateFrom:'2026-10-01',dateTo:'2026-10-31'},units=[{id:'a',name:'Unit A'}];
const current={rows:[{branch_id:'a',account_code:'4-1300',income:'1000000',expense:'0'}]};
test('missing prior period stays unavailable in PnL detail, totals, ratios and exported workbook',()=>{
 const raw=make('company-profit-loss',current,null,units,filters);
 for(let r=7;r<=51;r++)if(raw.cells['J'+r]!==undefined)assert.equal(raw.cells['J'+r],null,'prior row '+r);
 const layout=compact(raw,'company-profit-loss',{excel:true}),prior=layout.grid[5].findIndex(x=>String(x).startsWith('Periode sebelumnya'));
 assert.match(layout.grid[5][prior],/Belum tersedia/);
 for(let r=6;r<layout.grid.length;r++)if(layout.rowTypes[r]!=='section'){
  assert.equal(layout.grid[r][prior],null,'prior '+layout.grid[r][0]);
  assert.equal(layout.grid[r].at(-1),null,'change '+layout.grid[r][0]);
 }
 const sheet=unzip(exportXlsx(layout,'CV Artha Multi Ciptanusa')).find(x=>x.name==='xl/worksheets/sheet1.xml').data.toString();
 const col=require('../report-template').col(prior);
 assert.doesNotMatch(sheet,new RegExp('<c r="'+col+'(?:[7-9]|[1-4][0-9]|5[01])"[^>]*>[^<]*<v>0</v>'));
 assert.match(sheet,/Belum tersedia/);
});
test('an available empty prior period is a real recorded zero, not unavailable',()=>{
 const prior={filters:{dateFrom:'2026-09-01',dateTo:'2026-09-30'},rows:[]};
 const raw=make('company-profit-loss',current,prior,units,filters);
 assert.equal(raw.cells.J8,'0');assert.equal(raw.cells.J13,'0');assert.equal(raw.cells.J21,'0');
 assert.equal(raw.cells.J50,null,'unavailable accrual/depreciation still prevents a fabricated net total');
 const layout=compact(raw,'company-profit-loss',{excel:true});
 assert.match(layout.grid[5].find(x=>String(x).startsWith('Periode sebelumnya')),/2026-09-01/);
});
