'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {classify}=require('../cashflow-classification'),{make}=require('../report-template'),{scoped}=require('../report-presentation');
const f={branch:'all',viewMode:'company',dateFrom:'2026-10-01',dateTo:'2026-10-28'},units=[{id:'a',name:'Unit A'},{id:'b',name:'Unit B'}];
const e=(code,type,amount,branch='a',intent='SETOR_NOTA')=>({account_code:code,tx_type:type,amount,branch_id:branch,tx_intent:intent});
const source={cashEntries:[e('4-1300','INCOME','900719925474099100'),e('5-1100','EXPENSE','750000'),e('6-1100','EXPENSE','100000'),e('7-2100','EXPENSE','500'),e('legacy','INCOME','100'),e('ADVANCE','EXPENSE','5000','a','ADVANCE_DISBURSE'),e('ADVANCE','INCOME','1000','a','ADVANCE_RETURN'),e('4-1300','INCOME','10','b')]};
test('cash classification preserves exact cash and incomplete accounting; advance cash is not settlement spending',()=>{
 const c=classify(source,'a');assert.equal(c.values[9],'900719925474099100');assert.equal(c.values[12],'750000');assert.equal(c.values[13],'100000');assert.equal(c.values[16],null);assert.equal(c.unclassifiedIncome,'1100');assert.equal(c.unclassifiedExpense,'5500');assert.equal(c.values[31],'900719925473244700');assert.equal(classify(source,'b').values[31],'10');assert.equal(classify({rows:[]}),null);
 assert.throws(()=>classify({cashEntries:[e('4-1300','INCOME','1e6')]}),/INVALID_CASH/);
});
test('cash reference sections have plain labels, real movement, prior period, unknown balances and no account identifiers',()=>{
 const prior={cashEntries:[e('4-1300','INCOME','25')],filters:{dateFrom:'2026-09-03',dateTo:'2026-09-30'}};
 const layout=scoped(make('cash-flow',source,prior,units,f),'cash-flow',source,prior,units,f,{excel:true});
 const row=label=>layout.grid.find(r=>r[0]===label);assert.equal(row('Penerimaan dari Pelanggan – Jasa Laundry')[1],'900719925474099110');assert.equal(row('Penerimaan dari Pelanggan – Jasa Laundry')[2],'25');assert.equal(row('KAS DAN SETARA KAS PADA AKHIR PERIODE')[1],null);assert.equal(row('Penerimaan belum dikelompokkan')[1],'1100');assert.ok(layout.rowTypes.includes('section'));assert.doesNotMatch(JSON.stringify(layout.grid),/4-1300|5-1100|account_code|Kode Akun/);
 const csv=require('../operational-reports').toCsv({templateLayout:layout});assert.match(csv,/900719925474099110/);assert.doesNotMatch(csv,/account_code/);
 const negative={templateLayout:{...layout,grid:layout.grid.map(r=>r[0]==='KENAIKAN (PENURUNAN) KAS TERCATAT'?[r[0],'-200','-100']:r)}};
 assert.match(require('../operational-reports').toCsv(negative),/,-200,-100/);
});
