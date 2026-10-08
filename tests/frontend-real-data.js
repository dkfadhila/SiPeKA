'use strict';
// Explicit synthetic fixtures; executes functions extracted from production HTML.
// No application server, production database, authentication or writes involved.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');
const html=fs.readFileSync(path.resolve(__dirname,'../public/financial-dashboard.html'),'utf8');
const row=(id,type,amount,extra={})=>({id,branch_id:1,branch_name:'Fixture Branch',user_id:7,account_code:type==='INCOME'?'4101':'5101',account_name:'Fixture account',tx_type:type,amount,status:'APPROVED',tx_intent:'SETOR_NOTA',created_at:'2026-10-06 03:00:00',...extra});
const fixtureRows=[row('fixture-income','INCOME',125000),row('fixture-expense','EXPENSE',600000)];
function fn(name){const start=html.indexOf('function '+name+'(');assert.ok(start>=0,'production function '+name);let source='';for(const line of html.slice(start).split(/\r?\n/)){source+=line+'\n';try{new vm.Script((html.slice(Math.max(0,start-6),start).endsWith('async ')?'async ':'')+source);return source;}catch(error){if(!(error instanceof SyntaxError))throw error;}}throw new Error('Cannot parse production function '+name);}
function context(rows=fixtureRows,role='owner',branch='all'){
 const nodes=new Map();const node=id=>{if(!nodes.has(id))nodes.set(id,{textContent:'',value:'all',hidden:false,style:{},classList:{add(){},remove(){},toggle(){}},setAttribute(){},options:[],appendChild(){}});return nodes.get(id);};
 const c=vm.createContext({console,Intl,Date,Number,Math,Map,Set,JSON,Array,String,window:{SipekaRawRows:rows,SipekaUnits:[{id:1,name:'Fixture Branch',code:'FIX'}],SipekaCurrentUser:{id:7,role:role.toUpperCase(),full_name:'Fixture QA Owner',assigned_branch_name:'Fixture Branch',branch_id:1}},document:{getElementById:node,body:{classList:{add(){},remove(){}}}},role,selectedBranch:branch,selectedChartPeriod:'30D',transactions:[],approvalItems:[],branches:[],branchProfiles:{all:{revenue:.125,expense:.6,net:-.475,ratio:480,status:'Healthy',delta:'—'}},ownerBranchSelect:node('ownerBranchSelect'),ownerBranchSwitcher:node('ownerBranchSwitcher'),rolePreviewButtons:[],calendarYear:2026,calendarMonth:9,selectedCalendarDate:'2026-10-06',calendarNotes:{owner:{},staff:{}},icon:()=>'',cleanDewiText:s=>s});
 vm.runInContext(html.split('<!-- SIPEKA_METRICS_MODULE -->')[1].split('</script>')[0].replace(/^\s*<script>/,''),c);
 for(const name of ['advanceLine','advancePanel','escHtml','scopeName','getTodayWIB','scopeProfile','fmtM','kpi','visibleApprovals','visibleTransactions','pageHead','transactionTable','branchTable','chart','costSection','ownerDashboard','cashFlowPage','summaryPage','operatorDashboard','syncBranchScope','calendarPage','approvals','dewiPage'])vm.runInContext(fn(name),c);
 // New production helpers are loaded when present, never reimplemented by tests.
 for(const match of html.matchAll(/^function (realData\w+|financial\w+|currentAccount\w+|chartPeriod\w+)\(/gm))vm.runInContext(fn(match[1]),c);
 vm.runInContext("getTodayWIB=()=> '2026-10-06';",c);
 return {c,node,run:expr=>vm.runInContext(expr,c)};
}
test('fixture loss: actual consolidated status and negative cost result',()=>{
 const {run}=context();assert.notEqual(run('scopeProfile().status'),'Healthy');
 const output=run('costSection()');assert.match(output,/NEGATIVE/);assert.doesNotMatch(output,/>POSITIVE</);assert.match(output,/480/);
});
test('fixture chart: real amounts/dates; no fake business insights; account identity',()=>{
 const {run,node}=context();
 const plot=run('chart()');assert.doesNotMatch(plot,/38\.4M|21\.7M|16\.7M/);assert.match(plot,/125[.,]000/);assert.match(plot,/600[.,]000/);assert.match(plot,/-475[.,]000/);assert.match(plot,/2026-10-06/);
 const dashboard=run('ownerDashboard()');assert.doesNotMatch(dashboard,/12\.4%|620\.000|above budget|September 2026/);assert.match(dashboard,/budget.*(?:not connected|belum terhubung)/i);
 run('syncBranchScope()');assert.equal(node('profileName').textContent,'Fixture QA Owner');assert.equal(node('profileAvatar').textContent,'FQ');assert.doesNotMatch(run('calendarPage()'),/Radit/);
});
test('fixture staff TODAY: raw exact money, approved realized, WIB date, own branch/user',()=>{
 const today=context().run('getTodayWIB()');
 const rows=[row('today','INCOME',1250000,{created_at:today+'T03:00:00Z'}),row('yesterday','INCOME',9000000,{created_at:'2026-01-01T03:00:00Z'}),row('pending','EXPENSE',800000,{status:'PENDING_APPROVAL',created_at:today+'T03:00:00Z'}),row('advance','EXPENSE',700000,{tx_intent:'PENGAJUAN_DANA',created_at:today+'T03:00:00Z'}),row('other-user','INCOME',4000000,{user_id:8,created_at:today+'T03:00:00Z'}),row('other-branch','INCOME',3000000,{branch_id:2,branch_name:'Other',created_at:today+'T03:00:00Z'})];
 const {run}=context(rows,'staff','Fixture Branch'),output=run('operatorDashboard()');assert.match(output,/Rp 1[.,]250[.,]000/);assert.doesNotMatch(output,/Monday, 28 September|Rp 9[.,]000[.,]000/);assert.match(output,new RegExp(today));
});
test('fixture empty/expense-only: no false health/profit, ratio unavailable',()=>{
 const empty=context([]);assert.equal(empty.run('scopeProfile().result'),'NO DATA');assert.match(empty.run('chart()'),/No data/);assert.doesNotMatch(empty.run('ownerDashboard()+summaryPage()'),/Healthy|PROFITABLE|>POSITIVE<|null%/);
 const expense=context([row('expense-only','EXPENSE',600000)]);assert.equal(expense.run('scopeProfile().ratio'),null);assert.equal(expense.run('scopeProfile().status'),'Negative');assert.match(expense.run('ownerDashboard()'),/N\/A · no revenue/);
 const mixed=context([...fixtureRows,row('pending','INCOME',99999999,{status:'PENDING_APPROVAL'}),row('rejected','EXPENSE',90000000,{status:'REJECTED'}),row('advance','EXPENSE',80000000,{tx_intent:'PENGAJUAN_DANA'})]);assert.equal(mixed.run('scopeProfile().net'),-.475);
});
test('fixture period controls actually change buckets; UTC/WIB parser boundaries',()=>{
 const {run}=context();assert.equal(run("realDataDate('2026-10-05 17:00:00')"),'2026-10-06');assert.equal(run("realDataDate('2026-10-06T00:00:00+07:00')"),'2026-10-06');assert.equal(run("realDataDate('2026-10-06T00:00:00-05:00')"),'2026-10-06');assert.equal(run("realDataDate('invalid')"),null);
 run("selectedChartPeriod='7D'");assert.equal(run('realDataChartBuckets().length'),7);run("selectedChartPeriod='3M'");assert.equal(run('realDataChartBuckets().length'),90);
 const binding=fn('bindDynamic');assert.match(binding,/selectedChartPeriod\s*=/);assert.match(binding,/render\(\)/);
});
test('fixture production bootstrap: approved-only branch/consolidated totals and dates',async()=>{
 const rows=[...fixtureRows,row('pending','EXPENSE',2000000,{status:'PENDING_APPROVAL'}),row('rejected','INCOME',5000000,{status:'REJECTED'}),row('advance','EXPENSE',7000000,{tx_intent:'PENGAJUAN_DANA'})];
 const {c,run}=context(rows);c.bootVersion=0;c.perfCache=[];c.token=()=>null;c.api=async route=>route==='/api/units'?[{id:1,name:'Fixture Branch',code:'FIX'}]:route==='/api/transactions'?{rows}:route==='/api/closing/summary'?{closings:[]}:[];c.fmtWhen=s=>s;c.fmtMoney=n=>'Rp '+Number(n).toLocaleString('id-ID');c.methodName=s=>s;c.syncBranchLabel=()=>{};c.window.SipekaPrivateReceipts={clearAll(){}};c.window.SipekaAuth={};c.window.SipekaRealData={profile:c.realDataProfile,ratio:c.realDataRatio,money:c.fmtM};let state;c.window.__sipekaApplyState=(r,b,d)=>{state=d;};c.document.createElement=()=>({});
 vm.runInContext('async '+fn('bootstrap'),c);await run("bootstrap({id:7,role:'OWNER',full_name:'Fixture QA Owner'})");
 assert.equal(state.branchProfiles.all.expense,.6);assert.equal(state.branchProfiles.all.revenue,.125);assert.notEqual(state.branchProfiles.all.status,'Healthy');assert.equal(state.branchProfiles['Fixture Branch'].net,-.475);assert.equal(state.approvalItems[0][8],'2026-10-06 03:00:00');
});
test('fixture audit/sidebar/chat: no fabricated IDs, periods or monitoring claims',()=>{
 const {c,run}=context();vm.runInContext(fn('auditPage'),c);vm.runInContext(fn('adminDashboard'),c);
 assert.doesNotMatch(run('auditPage()'),/TRX-2609|4\.2×|within 7 minutes/);assert.match(run('auditPage()'),/No data|not connected|Belum terhubung/i);
 assert.doesNotMatch(run('adminDashboard()'),/14\.8%|12\.186\.000|Car Wash Dummy/);
 assert.doesNotMatch(html.slice(html.indexOf('<body>'),html.indexOf('<script>',html.indexOf('<body>'))),/Sep 2026|September 2026|Recent analyses|Monitoring your business/);
});
test('production timestamp display accepts signed UTC offsets and preserves year',()=>{
 const c=vm.createContext({Date,String,Number,isNaN});vm.runInContext(fn('fmtWhen'),c);
 assert.equal(vm.runInContext("fmtWhen('2026-10-06T00:00:00-05:00')",c),'2026-10-06 · 12:00 WIB');assert.equal(vm.runInContext("fmtWhen('2026-10-05 17:00:00')",c),'2026-10-06 · 00:00 WIB');
});
test('fixture chart summaries use same period as plotted rows',()=>{
 const rows=[...fixtureRows,row('outside-chart','INCOME',9000000,{created_at:'2026-01-01T03:00:00Z'})],{run}=context(rows);
 const output=run('ownerDashboard()'),summary=output.match(/<div class="summary-strip">([\s\S]*?)<\/div><\/div><\/article>/)[1];assert.doesNotMatch(summary,/9[.,]125[.,]000/);assert.match(summary,/125[.,]000/);
});
module.exports={context,fixtureRows,row,html,fn};
