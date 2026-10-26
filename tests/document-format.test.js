'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {slipCode}=require('../document-format');
const row={employee_id:'002',full_name:'Karyawan Contoh',department:'Operasional',branch_name:'RedDoorz',unit_code:'KOS',period:'2026-10',basic_salary:'1000000',overtime:'100000',bonus:'50000',allowances:'150000',absence_deduction:'10000',late_deduction:'5000',violation_deduction:'0',deductions:'15000',pph21:'0',net_salary:'1135000'};
test('slip codes use immutable pay period employee id and AMC unit department convention',()=>{
 assert.equal(slipCode(row),'SLIP/RD-OPS/X/2026/002');assert.equal(slipCode({...row,employee_id:'1',department:'Head Office',branch_name:'Head Office',unit_code:'AMC'}),'SLIP/AMC-HO/X/2026/001');
 assert.equal(slipCode({...row,period:'2026-01'}),'SLIP/RD-OPS/I/2026/002');assert.equal(slipCode({...row,document_code:'SLIP/RD-OPS/X/2026/002',period:'2027-12',department:'Mutasi'}),'SLIP/RD-OPS/X/2026/002');
 const pdf=require('../payroll-pdf').renderSlipPdf(row,{publishedAt:'2026-10-26T01:00:00Z',documentIdentity:{company_name:'AMC',branch_name:'RedDoorz'}}).toString('latin1');assert.match(pdf,/SLIP\/RD-OPS\/X\/2026\/002/);assert.match(pdf,/1\.135\.000/);
 const email=require('../payroll-email-template').payrollEmail(row,{publishedAt:'2026-10-26T01:00:00Z'});assert.equal(email.filename,'SLIP-RD-OPS-X-2026-002.pdf');assert.match(email.text,/SLIP\/RD-OPS\/X\/2026\/002/);
});
test('document attachment annotates all statement panels and Excel without mutating cached report',()=>{
 const filters={branch:'all',dateFrom:'2026-10-01',dateTo:'2026-10-26',viewMode:'comparison'},units=Array.from({length:8},(_,i)=>({id:'u'+i,name:'Unit '+i}));const raw=require('../report-template').make('fund-position',{rows:[]},null,units,filters);
 const layout=require('../report-presentation').scoped(raw,'fund-position',{rows:[]},null,units,filters);layout.excelLayout=structuredClone(layout);const before=JSON.stringify(layout);const original={id:'fund-position',templateLayout:layout,columns:[],rows:[]};const doc={id:'a',code:'NRC/AMC/X/2026/001'},r=require('../report-document').attach(original,doc);
 assert.equal(original.documentCode,undefined);assert.equal(JSON.stringify(original.templateLayout),before);for(const p of [r.templateLayout,...r.templateLayout.continuations,r.templateLayout.excelLayout]){assert.equal(p.documentCode,doc.code);assert.match(p.grid[4][0],/NRC\/AMC\/X\/2026\/001/);}
 const csv=require('../operational-reports').toCsv(r);assert.match(csv,/Kode dokumen/);assert.match(csv,/NRC\/AMC\/X\/2026\/001/);
 const xml=require('../report-template-xlsx').unzip(require('../report-template-xlsx').exportXlsx(r.templateLayout,'AMC')).find(f=>f.name==='xl/worksheets/sheet1.xml').data.toString();assert.match(xml,/NRC\/AMC\/X\/2026\/001/);
});
