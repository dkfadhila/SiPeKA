'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=()=>fs.readFileSync('public/financial-dashboard.html','utf8');
const opening=/saldo\s+awal|opening\s+balances?|carryforward/i;
function modules(){const window={},ctx=vm.createContext({window,console,Intl,Date});for(const marker of ['SIPEKA_METRICS_MODULE','SIPEKA_REPORT_MODULE'])vm.runInContext(html().split('<!-- '+marker+' -->')[1].split('</script>')[0].replace(/^\s*<script>/,''),ctx);return window;}
test('operational UI has no opening-balance prompts or prerequisites',()=>{
 assert.doesNotMatch(html(),opening);
});
test('all report notices and CSV metadata describe movements without opening-balance reminders',()=>{
 const w=modules();w.SipekaReports.setSnapshot({rows:[],units:[{id:'fixture',name:'FIXTURE'}],advanceRows:[]});
 assert.equal(w.SipekaReports.catalog.length,15);
 for(const c of w.SipekaReports.catalog){const r=w.SipekaReports.buildReport(c.id,{branch:'all',dateFrom:'2026-01-01',dateTo:'2099-12-31'});assert.doesNotMatch(JSON.stringify(w.SipekaReports.csvManifest(r)),opening,c.id);assert.doesNotMatch(w.SipekaReports.toCsv(r),opening,c.id);if(r.template)assert.equal(r.totals,null,c.id);}
});
test('accounting notice describes movement-only reporting; immutable incompleteness metadata preserved',async()=>{
 const accounting=require('../accounting');const client={query:async sql=>sql.includes('count(DISTINCT')?{rows:[{journals:'0',lines:'0'}]}:{rows:[]},release(){}};
 const r=await accounting.trialBalance({connect:async()=>client},'fixture-token',{start:'2026-10-01',end:'2026-10-31'});
 assert.equal(r.openingBalances,'MISSING');assert.equal(r.neracaComplete,false);assert.equal(r.totalDebit,'0');assert.equal(r.totalCredit,'0');assert.doesNotMatch(r.notices.join(' '),opening);assert.ok(r.notices.includes('Laporan ini menampilkan mutasi tercatat, bukan neraca lengkap'));
});
test('closing retains null end balance and false reconciliation without prerequisite notice',()=>{
 const server=fs.readFileSync('server.js','utf8');assert.match(server,/endBalance:null/);assert.match(server,/reconciliationComplete:false/);assert.match(server,/openingBalances:'MISSING'/);assert.match(server,/carryforward:'UNVERIFIED'/);
 for(const notice of server.matchAll(/notice:'([^']*)'/g))assert.doesNotMatch(notice[1],opening);
});
