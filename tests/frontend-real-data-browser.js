'use strict';
// Run this file inside the actual financial-dashboard.html browser document.
// Synthetic read-only API fixtures; NEVER production/VPS API verification.
if(typeof window!=='undefined')window.runFrontendRealDataBrowserFixture=async function(){
 const results=[];const check=(name,condition,actual)=>{results.push({name,pass:!!condition,actual});if(!condition)throw new Error(name+': '+JSON.stringify(actual));};
 const originalFetch=window.fetch,errors=[];const onError=e=>errors.push(e.message);window.addEventListener('error',onError);
 const user={id:707,username:'fixture-owner',full_name:'Fixture QA Owner',role:'OWNER',branch_id:null};
 const units=[{id:701,name:'Fixture Branch',code:'FIX'},{id:702,name:'Empty Fixture Branch',code:'EMPTY'}];
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jakarta',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
 const row=(id,type,amount,extra={})=>({id,branch_id:701,branch_name:'Fixture Branch',user_id:707,tx_type:type,amount,status:'APPROVED',tx_intent:'SETOR_NOTA',account_code:type==='INCOME'?'4101':'5101',account_name:'Fixture account',memo:'SYNTHETIC FIXTURE · '+id,payment_method:'CASH_DRAWER',created_at:today+'T03:00:00Z',...extra});
 let rows=[row('fixture-income','INCOME',125000),row('fixture-expense','EXPENSE',600000),row('fixture-pending','EXPENSE',2000000,{status:'PENDING_APPROVAL'}),row('fixture-advance','EXPENSE',3000000,{tx_intent:'PENGAJUAN_DANA'})];
 window.fetch=async(url,opts={})=>{if((opts.method||'GET')!=='GET')throw new Error('Fixture forbids writes');const data=String(url)==='/api/units'?units:String(url)==='/api/transactions'?{rows}:String(url)==='/api/closing/summary'?{closings:[],system_balance:0}:[];return {ok:true,status:200,json:async()=>data};};
 try{
  await SipekaAuth.bootstrap(user);document.getElementById('loginGate').classList.add('is-hidden');document.querySelector('.app').removeAttribute('inert');
  const body=()=>document.getElementById('content').innerText;
  check('owner identity from current account',document.getElementById('profileName').textContent===user.full_name,document.getElementById('profileName').textContent);
  check('owner exact approved totals',body().includes('Rp 125.000')&&body().includes('Rp 600.000')&&body().includes('Rp -475.000'),body().slice(0,700));
  check('loss truth 480% NEGATIVE',body().includes('480%')&&body().includes('NEGATIVE')&&!body().includes('Healthy')&&!body().includes('POSITIVE'),body().match(/480%|NEGATIVE|Healthy|POSITIVE/g));
  check('fake business claims removed',!body().match(/12\.4%|620\.000|above budget|September 2026/),body().match(/12\.4%|620\.000|above budget|September 2026/g));
  check('budget explicitly unknown',body().includes('Budget not connected'),body().match(/Budget not connected/g));
  const sample=document.querySelector('.chart-sample[data-date="'+today+'"]');check('dated SVG tooltip exact money',sample&&sample.textContent.includes('125.000')&&sample.textContent.includes('600.000')&&sample.textContent.includes('-475.000'),sample?.textContent);
  const period=[...document.querySelectorAll('.tabs button')].find(b=>b.textContent==='7D');period.click();check('period changes actual data buckets',document.querySelectorAll('.chart-sample').length===7,document.querySelectorAll('.chart-sample').length);
  document.querySelector('[data-series="revenue"]').click();check('legend toggles actual series',document.querySelector('.chart-series.revenue').classList.contains('is-hidden'));
  const select=document.getElementById('ownerBranchSelect');select.value='Empty Fixture Branch';select.dispatchEvent(new Event('change',{bubbles:true}));check('empty branch no fake chart/health',body().includes('No data')&&!document.querySelector('.chart-sample')&&!body().includes('Healthy'),body().slice(0,500));
  __sipekaApplyState('owner','all',{view:'summary'});check('summary negative not profitable',body().includes('NEGATIVE')&&!body().includes('PROFITABLE'),body().slice(0,400));
  __sipekaApplyState('owner','all',{view:'approvals'});check('approval actual date',body().includes(today)&&!body().includes('SEP 2026'),body().slice(0,500));
  __sipekaApplyState('owner','all',{view:'payslip'});check('Slip Gaji unchanged Coming soon',body().includes('Coming soon'));
  __sipekaApplyState('owner','all',{view:'audit'});check('audit unavailable not fabricated',body().includes('No data')&&!body().match(/TRX-2609|4\.2×/));
  __sipekaApplyState('owner','all',{view:'calendar'});check('calendar real account current day',body().includes(user.full_name)&&document.querySelector('.calendar-day.today')?.dataset.calendarDate===today);
  check('mini chat real snapshot period',document.getElementById('miniContextPeriod').textContent.includes(today));
  const staff={id:707,username:'fixture-staff',full_name:'Fixture QA Staff',role:'STAFF',branch_id:701};rows=[row('staff-million','INCOME',1250000),row('staff-old','INCOME',9000000,{created_at:'2026-01-01T03:00:00Z'}),row('staff-pending','EXPENSE',600000,{status:'PENDING_APPROVAL'}),row('other-user','INCOME',3000000,{user_id:708})];
  await SipekaAuth.bootstrap(staff);check('staff today raw exact money own user',body().includes('Rp 1.250.000')&&!body().includes('Monday, 28 September'),body().slice(0,900));check('staff actual account/branch',document.getElementById('profileName').textContent===staff.full_name&&document.getElementById('profileBranch').textContent==='Fixture Branch');
  const app=document.querySelector('.app');check('accepted geometry no document overflow',document.documentElement.scrollWidth<=innerWidth,{scroll:document.documentElement.scrollWidth,width:innerWidth,app:app.getBoundingClientRect().width});
  check('no uncaught browser errors',errors.length===0,errors);
  return {label:'SYNTHETIC READ-ONLY FRONTEND FIXTURE · NOT VPS/API PROOF',results};
 }finally{window.fetch=originalFetch;window.removeEventListener('error',onError);}
};
