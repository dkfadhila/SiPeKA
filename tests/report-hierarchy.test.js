 'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {make}=require('../report-template'),{compact,scoped}=require('../report-presentation'),{exportXlsx,unzip}=require('../report-template-xlsx');
const filters={branch:'all',dateFrom:'2026-10-01',dateTo:'2026-10-26'},units=[{id:'a',name:'Unit A'},{id:'b',name:'Unit B'}];
const balance=()=>compact(make('fund-position',{rows:[]},null,units,filters),'fund-position');
test('Neraca hierarchy is explicit and unchanged in comparison panels, without exposing accounts',()=>{
 for(const layout of [balance(),scoped(make('fund-position',{rows:[]},null,units,filters),'fund-position',{rows:[]},null,units,{...filters,viewMode:'comparison'})]){
  assert.equal(layout.rowLevels.length,layout.grid.length);const level=label=>layout.rowLevels[layout.grid.findIndex(r=>r[0]===label)];
  for(const label of ['AKTIVA','PASIVA','TOTAL AKTIVA','TOTAL PASIVA','TOTAL'])assert.equal(level(label),0,label);
  for(const label of ['Aktiva Lancar','Aktiva Tetap','Kewajiban','Ekuitas','Total Aktiva Lancar','Total Aktiva Tetap','Total Kewajiban','Total Ekuitas'])assert.equal(level(label),1,label);
  for(const label of ['Kas dan bank','Peralatan dan inventaris','Utang usaha','Modal'])assert.equal(level(label),2,label);
  assert.doesNotMatch(JSON.stringify(layout.grid),/\d-\d{4}|account_code/);
 }
});
test('XLSX uses real alignment indent styles for group, detail and subtotal label cells only',()=>{
 const layout=balance(),files=unzip(exportXlsx(layout,'Perusahaan Uji')),styles=files.find(f=>f.name==='xl/styles.xml').data.toString(),sheet=files.find(f=>f.name==='xl/worksheets/sheet1.xml').data.toString();
 assert.match(styles,/<cellXfs count="10">/);assert.match(styles,/<alignment horizontal="left" indent="1"/);assert.match(styles,/<alignment horizontal="left" indent="2"/);
 for(const [label,style] of [['AKTIVA',2],['Aktiva Lancar',8],['Kas dan bank',7],['Total Aktiva Lancar',8]]){const r=layout.grid.findIndex(row=>row[0]===label)+1;assert.match(sheet,new RegExp('<c r="A'+r+'" s="'+style+'"'));}
 assert.doesNotMatch(sheet,/  Kas dan bank/);
});
test('PDF label padding follows row levels and document code is included in repeating heading',()=>{
 const layout=balance();layout.documentCode='WIDYA-NERACA-20261026-0001';const tables=[],texts=[];
 class Doc{constructor(){this.internal={pageSize:{getWidth:()=>210,getHeight:()=>297},getNumberOfPages:()=>1};this.lastAutoTable={finalY:230};}setTextColor(){}setFont(){}setFontSize(){}text(...args){texts.push(args);}autoTable(opts){tables.push(opts);opts.didDrawPage();}splitTextToSize(t){return[t];}setPage(){}addPage(){}}
 const context={window:{}};vm.runInNewContext(fs.readFileSync('public/report-template-pdf.js','utf8'),context);context.window.SipekaTemplatePdf.create({templateLayout:layout,branch:'Semua Cabang'},Doc,'Perusahaan Uji');
 assert.ok(texts.some(t=>String(t[0]).includes(layout.documentCode)));assert.equal(tables[0].startY,43);
 for(const [label,left] of [['AKTIVA',2],['Aktiva Lancar',6],['Kas dan bank',10],['Total Aktiva Lancar',6]]){const cell={styles:{}},r=layout.grid.findIndex(row=>row[0]===label)-6;tables[0].didParseCell({section:'body',column:{index:0},row:{index:r},cell});assert.equal(cell.styles.cellPadding.left,left,label);}
});
test('Recorded income and expense uses exact informational totals rather than full P&L subtotal assumptions',()=>{
 const base=make('recorded-income-expense',{rows:[]},null,units,filters);base.recordedSummary={totals:{income:null,expense:'150000',net:null},notices:['Pendapatan hanya yang tercatat; sumber penjualan lengkap belum terverifikasi.']};base.recordedByBranch={a:{totals:{income:'200',expense:'100',net:'100'}}};
 const layout=compact(base,'recorded-income-expense',{excel:true});assert.equal(layout.grid[1][0],'Pendapatan & Beban Tercatat');assert.equal(layout.grid.length,9);const expense=layout.grid.find(r=>r[0]==='Beban tercatat'),net=layout.grid.find(r=>r[0]==='Selisih Pendapatan dan Beban Tercatat');assert.equal(expense[1],'100');assert.equal(expense[3],'150000');assert.equal(net[3],null);assert.doesNotMatch(JSON.stringify(layout.grid),/Laba|LABA|Penyusutan|Harga Pokok/);assert.match(layout.notes.join(' '),/belum terverifikasi/);
});

test('Recorded comparison retains every unit, prior totals and nulls across continuation panels',()=>{
 const many=Array.from({length:8},(_,i)=>({id:'u'+i,name:'Unit '+i})),base=make('recorded-income-expense',{rows:[]},null,many,{...filters,viewMode:'comparison'});
 base.recordedSummary={totals:{income:'800',expense:'160',net:'640'},notices:[]};base.recordedPreviousSummary={totals:{income:'700',expense:'100',net:'600'}};base.recordedByBranch=Object.fromEntries(many.map(u=>[u.id,{totals:{income:'100',expense:'20',net:'80'}}]));
 const report=compact(base,'recorded-income-expense',{excel:true});assert.equal(report.continuations.length,1);const last=report.continuations[0];assert.equal(last.grid[6][1],'100');assert.equal(last.grid[6][2],'100');assert.equal(last.grid[6][3],'800');assert.equal(last.grid[6][4],'700');assert.equal(last.grid[8][3],'640');assert.equal(last.grid[8][4],'600');
 const fallback=compact(make('recorded-income-expense',{rows:[]},null,units,filters),'recorded-income-expense');assert.equal(fallback.grid.length,9);assert.equal(fallback.grid[6][1],null);assert.doesNotMatch(JSON.stringify(fallback.grid),/Laba|LABA|4-1300/);
});
