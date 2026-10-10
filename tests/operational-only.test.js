'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=()=>fs.readFileSync('public/financial-dashboard.html','utf8');
const opening=/saldo\s+awal|opening\s+balances?|carryforward/i;
function modules(){const window={},ctx=vm.createContext({window,console,Intl,Date,URLSearchParams});for(const marker of ['SIPEKA_METRICS_MODULE','SIPEKA_REPORT_MODULE'])vm.runInContext(html().split('<!-- '+marker+' -->')[1].split('</script>')[0].replace(/^\s*<script>/,''),ctx);return window;}
test('operational UI has no opening-balance prompts or prerequisites',()=>{
 assert.doesNotMatch(html(),opening);
});
test('all 17 report notices and CSV metadata describe movements; backend reports require async source',async()=>{
 const w=modules();w.SipekaCurrentUser={id:'owner-fixture',role:'OWNER'};w.SipekaReports.setSnapshot({rows:[],units:[{id:'fixture',name:'FIXTURE'}],advanceRows:[]});
 const ids=['profit-loss','cash-flow','fund-requests','daily-closings','audit-evidence'],input={branch:'all',dateFrom:'2026-10-01',dateTo:'2026-10-31'},calls=[];
 w.fetch=async(url,options)=>{calls.push(url);assert.equal(options.credentials,'same-origin');assert.equal(options.cache,'no-store');const u=new URL(url,'http://fixture'),id=u.pathname.split('/').pop();assert.ok(ids.includes(id));assert.equal(u.searchParams.get('branch_id'),'all');assert.equal(u.searchParams.get('date_from'),input.dateFrom);assert.equal(u.searchParams.get('date_to'),input.dateTo);assert.equal(u.searchParams.get('timezone'),'Asia/Jakarta');return {ok:true,json:async()=>({id,columns:[{key:'amount',label:'amount'}],rows:[{amount:'900719925474099312345'}],totals:null,filters:{...input,timezone:'Asia/Jakarta'},complete:true,missingDatasets:[],notices:['Mutasi operasional tercatat, bukan neraca lengkap.'],sourceCount:1,readiness:'available',neracaComplete:false,reconciliationComplete:false,endBalance:null})};};
 assert.equal(w.SipekaReports.catalog.length,17);assert.equal(new Set(w.SipekaReports.catalog.map(c=>c.id)).size,17);
 for(const c of w.SipekaReports.catalog){let r=w.SipekaReports.buildReport(c.id,input);assert.doesNotMatch(JSON.stringify(w.SipekaReports.csvManifest(r)),opening,c.id);
  if(ids.includes(c.id)){assert.equal(r.complete,false,c.id);assert.equal(r.rows.length,0,c.id);assert.throws(()=>w.SipekaReports.toCsv(r),/diblokir/,c.id);r=await w.SipekaReports.loadOperational(c.id,input);assert.equal(r.complete,true);assert.equal(r.rows[0].amount,'900719925474099312345');assert.equal(w.SipekaReports.buildReport(c.id,input).complete,true);const m=w.SipekaReports.csvManifest(r);assert.equal(m.neracaComplete,false);assert.equal(m.reconciliationComplete,false);assert.equal(m.endBalance,null);}
  assert.doesNotMatch(JSON.stringify(w.SipekaReports.csvManifest(r)),opening,c.id);assert.doesNotMatch(w.SipekaReports.toCsv(r),opening,c.id);if(r.template)assert.equal(r.totals,null,c.id);
 }
 assert.equal(calls.length,5);
});
test('async operational source failure never becomes a complete zero report or export',async()=>{
 const w=modules();w.SipekaCurrentUser={id:'owner-fixture',role:'OWNER'};w.SipekaReports.setSnapshot({rows:[],units:[],advanceRows:[]});w.fetch=async()=>({ok:false,status:503});const input={branch:'all',dateFrom:'2026-10-01',dateTo:'2026-10-31'};
 for(const id of ['profit-loss','cash-flow','fund-requests','daily-closings','audit-evidence']){await assert.rejects(w.SipekaReports.loadOperational(id,input),/HTTP 503/);const r=w.SipekaReports.buildReport(id,input);assert.equal(r.complete,false);assert.equal(r.totals,null);assert.equal(r.rows.length,0);assert.throws(()=>w.SipekaReports.toCsv(r),/diblokir/);}
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
