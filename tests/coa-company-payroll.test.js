'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {definitions,inputAccounts}=require('../coa-catalog');
const {build}=require('../company-pnl');
test('cash input includes revenue beginning with 7 and excludes noncash depreciation and legacy defaults',()=>{
 const rows=definitions.map(([id,account_name,account_type])=>({id,account_code:id,account_name,account_type}));
 rows.push({id:'5101',account_code:'5101',account_name:'Legacy',account_type:'EXPENSE'});
 const actual=inputAccounts(rows);assert.ok(actual.some(r=>r.id==='7-1100'&&r.account_type==='REVENUE'));
 assert.ok(!actual.some(r=>r.id==='6-3000'||r.id==='5101'));assert.equal(actual.length,23);
 assert.equal(inputAccounts(rows.slice(-1))[0].id,'5101');
});
test('company P&L reconciles exact large amounts, unit comparisons and ambiguous historical categories',()=>{
 const units=[{id:'a',name:'Unit X1'},{id:'b',name:'Unit X2'},{id:'c',name:'Tanpa transaksi'}];
 const source={filters:{branch:'all'},rows:[
  {branch_id:'a',account_code:'4-1300',income:'9007199254740993',expense:'0'},
  {branch_id:'a',account_code:'5-1100',income:'0',expense:'100'},
  {branch_id:'b',account_code:'7-1100',income:'50',expense:'0'},
  {branch_id:'b',account_code:'5102',account_name:'Utilitas legacy',income:'0',expense:'25'},
 ],totals:{net:'9007199254740918'},notices:[],sourceCount:4};
 const matrix=build(source,units,'compare-profit-loss'),consolidated=build(source,units,'company-profit-loss');
 assert.equal(matrix.rows.at(-1).amount,source.totals.net);assert.equal(matrix.rows.at(-1).unit_0,'9007199254740893');assert.equal(matrix.rows.at(-1).unit_1,'25');assert.equal(matrix.rows.at(-1).unit_2,'0');
 assert.deepEqual(matrix.rows.map(r=>r.amount),consolidated.rows.map(r=>r.amount));
 assert.equal(matrix.rows.find(r=>r.account_code==='5102').unit_1,'-25');
 assert.throws(()=>build({...source,totals:{net:'1'}},units,'company-profit-loss'),/RECONCILIATION/);
 assert.throws(()=>build({...source,rows:[{branch_id:'a',account_code:'7-1100',income:'0',expense:'1'}]},units,'company-profit-loss'),/TYPE_MISMATCH/);
});
test('employee payroll uses employee identity, requires department, preserves existing salary math and prevents CSV injection',()=>{
 const {validate,HEADER}=require('../employee-payroll'),employee={id:'employee1',name:'Ayu',department:'Operasional',branch_id:'x1',branch_name:'Unit X1',active:true,email:'ayu@example.test'};
 const csv=HEADER+'\r\n2026-10,employee1,2500000,100000,20000,10000\r\n';
 const row=validate(csv,[employee])[0];assert.equal(row.employee_id,employee.id);assert.equal(row.net_salary,2570000);assert.equal(row.department,'Operasional');
 assert.throws(()=>validate(csv,[{...employee,department:null}]),/DEPARTMENT/);
 assert.throws(()=>validate(csv,[{...employee,active:false}]),/STAFF_NOT_FOUND/);
 assert.throws(()=>validate(csv.replace('2500000','=1+1'),[employee]),/CSV_CELL/);
 const pdf=require('../payroll-pdf').renderSlipPdf({...row,company_name:'Perusahaan Contoh'},{documentIdentity:{company_name:'Perusahaan Contoh',branch_name:'Unit X1'}}).toString('latin1');
 assert.match(pdf,/Departemen/);assert.match(pdf,/Operasional/);assert.match(pdf,/Unit X1/);assert.equal(pdf.split('(Perusahaan Contoh)').length-1,1);assert.doesNotMatch(pdf,/Username/);
});
test('every current inline app script parses after integration',()=>{
 const html=fs.readFileSync(require('node:path').join(__dirname,'../public/financial-dashboard.html'),'utf8');
 for(const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi))new vm.Script(match[1]);
});
