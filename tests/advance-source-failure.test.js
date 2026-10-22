'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function app(){const html=fs.readFileSync('public/financial-dashboard.html','utf8'),window={};const ctx=vm.createContext({window,console,Intl,Date});for(const marker of ['SIPEKA_METRICS_MODULE','SIPEKA_REPORT_MODULE'])vm.runInContext(html.split('<!-- '+marker+' -->')[1].split('</script>')[0].replace(/^\s*<script>/,''),ctx);return window;}

test('snapshot reports fail closed when advance source unavailable; register export only uses its explicit transaction IDs',async()=>{
 const w=app(),rows=[{id:'i',branch_id:'b',created_at:'2026-10-03T00:00:00Z',tx_type:'INCOME',status:'APPROVED',amount:1000}],units=[{id:'b',name:'Fixture'}],advanceRows=[{advanceId:'a',branchId:'b',events:[{id:'p',action:'APPROVE',amount:'450',createdAt:'2026-10-03T00:00:00Z',lines:[{amount:'450',coaId:'expense'}]}]}],f={branch:'b',dateFrom:'2026-10-01',dateTo:'2026-10-03'};
 // Financial statements now use the Owner backend; branch-performance still exercises snapshot metrics.
 w.SipekaReports.setSnapshot({rows,units,advanceRows});assert.equal(w.SipekaReports.buildReport('branch-performance',f).totals.net,550);
 w.SipekaReports.setSnapshot({rows,units,advanceRows:[],unavailable:true});
 w.SipekaDocumentIdentity={request:async()=>({branches:units,branch_id:'b',branch_name:'Fixture',company_name:'QA'})};
 for(const id of ['expense-breakdown','branch-performance','management-report','general-ledger']){
  const r=w.SipekaReports.buildReport(id,f);assert.equal(r.totals,null,id);assert.equal(r.rows.length,0,id);assert.equal(r.complete,false);assert.ok(r.missingDatasets.includes('advances'));assert.match(r.readiness,/advance.*tidak tersedia/i);assert.throws(()=>w.SipekaReports.toCsv(r),/ADVANCE_SOURCE_UNAVAILABLE/);
  await assert.rejects(w.SipekaReports.downloadCsv(id,f),/ADVANCE_SOURCE_UNAVAILABLE/);await assert.rejects(w.SipekaReports.downloadPdf(id,f),/ADVANCE_SOURCE_UNAVAILABLE/);
 }
 for(const id of ['profit-loss','cash-flow','audit-evidence']){const r=w.SipekaReports.buildReport(id,f);assert.equal(r.complete,false);assert.throws(()=>w.SipekaReports.toCsv(r),/ekspor diblokir/);}
 assert.throws(()=>w.SipekaMetrics.rows(rows,[], 'cash',false),/ADVANCE_SOURCE_UNAVAILABLE/);
 const register=w.SipekaReports.buildRegister(f,['i']);assert.equal(register.rows.length,1);assert.equal(register.totals.income,1000);assert.match(register.provenance,/hanya ID transaksi/);
});
