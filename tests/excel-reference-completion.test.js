'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {make}=require('../report-template'),{scoped}=require('../report-presentation'),{unzip,exportXlsx}=require('../report-template-xlsx');
const units=Array.from({length:8},(_,i)=>({id:'u'+i,name:'Cabang '+(i+1)})),source={rows:[{branch_id:'u0',account_code:'4-1300',income:'1000000',expense:'0'},{branch_id:'u0',account_code:'5-1100',income:'0',expense:'100000'}]};
const f={branch:'all',dateFrom:'2026-10-01',dateTo:'2026-10-31'};
test('complete Excel retains reference detail, pretax profit, formulas, missing data and signatures without account codes',()=>{
 const l=scoped(make('company-profit-loss',source,{rows:[]},units,f),'company-profit-loss',source,{rows:[]},units,f,{excel:true});
 for(const text of ['Pendapatan Kamar','Pendapatan Jasa Laundry','Komisi OTA & Platform','Pemasaran & Promosi','LABA SEBELUM PAJAK'])assert.ok(l.grid.some(r=>r[0]===text),text);
 const files=unzip(exportXlsx(l,'AMC')),xml=files.find(f=>f.name==='xl/worksheets/sheet1.xml').data.toString(),wb=files.find(f=>f.name==='xl/workbook.xml').data.toString();
 assert.match(xml,/<f>IF\(COUNT/);assert.match(xml,/Disusun oleh,/);assert.match(xml,/Disetujui oleh,/);assert.doesNotMatch(xml,/4-1300|6-1100/);assert.match(wb,/_xlnm.Print_Area/);assert.match(wb,/_xlnm.Print_Titles/);
 const formulas=require('../report-xlsx-formulas').formulas(l,require('../report-template').col),r=l.grid.findIndex(r=>r[0]==='Jumlah Beban Usaha');assert.match(formulas['B'+(r+1)],/IF\(COUNT.*Belum tersedia/,'unknown depreciation stays guarded while permitting later edits');
});
test('balance comparison continuation names match three branches per panel',()=>{
 const ff={...f,viewMode:'comparison'};const l=scoped(make('fund-position',{rows:[]},{rows:[]},units,ff),'fund-position',{rows:[]},{rows:[]},units,ff,{excel:true});const book=unzip(exportXlsx(l,'AMC')).find(f=>f.name==='xl/workbook.xml').data.toString();assert.match(book,/Cabang 4-6/);assert.match(book,/Cabang 7-8/);assert.doesNotMatch(book,/Unit 13/);
});
test('payroll Excel keeps selector neighbours, all reference fields, formulas, IDs and print area',()=>{
 for(const type of ['general','laundry']){
 const data=require('../payroll-workbook').workbook(type,[{period:'2026-10',employee_id:'001',full_name:'=Not a formula',basic_salary:1000000}]),files=unzip(data),s=files.find(f=>f.name==='xl/worksheets/sheet1.xml').data.toString(),db=files.find(f=>f.name==='xl/worksheets/sheet2.xml').data.toString(),book=files.find(f=>f.name==='xl/workbook.xml').data.toString();
 assert.match(s,/Nama Karyawan/);assert.match(s,/ID Karyawan/);assert.match(s,/COUNTIF/);assert.match(s,/Terbilang/);assert.match(s,/Tunjangan Operasional/);assert.match(db,/<t[^>]*>=Not a formula/);assert.match(book,/_xlnm.Print_Area/);assert.ok(files.some(f=>f.name==='xl/media/payroll-frame.png'));assert.match(s,/<c r="G6" t="inlineStr"><is><t>001/);
 }
});
