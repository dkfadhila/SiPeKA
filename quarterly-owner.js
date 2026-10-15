'use strict';
const fail=(s,c=400)=>{throw Object.assign(Error(s),{statusCode:c});};
function period(params,now=new Date()){
 for(const k of params.keys())if(!['year','quarter','branch_id'].includes(k)||params.getAll(k).length!==1)fail('REPORT_INVALID_FILTER');
 const w=new Date(now.getTime()+25200000),y=params.get('year')??String(w.getUTCFullYear()),q=params.get('quarter')??String(Math.floor(w.getUTCMonth()/3)+1);
 if(!/^\d{4}$/.test(y)||Number(y)<2000||Number(y)>2100||! /^[1-4]$/.test(q))fail('REPORT_INVALID_FILTER');
 const range=(year,quarter)=>({from:new Date(Date.UTC(year,(quarter-1)*3,1)).toISOString().slice(0,10),to:new Date(Date.UTC(year,quarter*3,0)).toISOString().slice(0,10)});
 return {...range(+y,+q),selection:{year:+y,quarter:+q},previous:range(+q===1?+y-1:+y,+q===1?4:+q-1)};
}
const amount=v=>{if(!/^\d+$/.test(String(v)))fail('REPORT_INVALID_AMOUNT',503);return BigInt(v);};
const day=v=>{const s=String(v).replace(' ','T'),d=new Date(/(?:Z|[+-]\d\d:?\d\d)$/.test(s)?s:s+'Z');if(!Number.isFinite(+d))fail('REPORT_INVALID_EVENT_DATE',503);return new Date(+d+25200000).toISOString().slice(0,10);};
function aggregate(rows,advances,f){
 const keys=['requests','requestAmount','disbursements','spending','returns'];
 const blank=()=>({requests:0,requestAmount:'0',disbursements:'0',spending:'0',returns:'0',sourceCount:0});
 const months=Array.from({length:3},(_,i)=>({month:f.dateFrom.slice(0,4)+'-'+String(Number(f.dateFrom.slice(5,7))+i).padStart(2,'0'),...blank()}));
 const totals=blank(),bucket=d=>months.find(m=>d>=f.dateFrom&&d<=f.dateTo&&m.month===d.slice(0,7));
 function add(d,key,value){const m=bucket(d);if(!m)return;for(const b of [m,totals]){if(key==='requests')b.requests++;else b[key]=String(BigInt(b[key])+amount(value));} }
 function count(d){const m=bucket(d);if(m){m.sourceCount++;totals.sourceCount++;}}
 for(const r of rows){const d=day(r.created_at);if(r.tx_intent==='PENGAJUAN_DANA'){add(d,'requests');add(d,'requestAmount',r.amount);count(d);}else if(r.tx_intent==='SETOR_NOTA'&&r.status==='APPROVED'&&r.tx_type==='EXPENSE'){add(d,'spending',r.amount);count(d);}}
 let outstanding=0n,pendingSettlements=0;const seen=new Set();
 for(const a of advances){if(f.branch!=='all'&&a.branchId!==f.branch)continue;let d=0n,s=0n,r=0n;const events=a.events||[];
 for(const e of events){if(!e.id||seen.has(e.id))fail('REPORT_DUPLICATE_EVENT',503);seen.add(e.id);const when=day(e.createdAt);
 if(e.action==='DISBURSE'){d+=amount(e.amount);add(when,'disbursements',e.amount);count(when);}
 if(e.action==='RETURN'){r+=amount(e.amount);add(when,'returns',e.amount);count(when);}
 if(e.action==='APPROVE'){if(!e.lines?.length||e.lines.reduce((n,l)=>n+amount(l.amount),0n)!==amount(e.amount))fail('REPORT_SETTLEMENT_INCOMPLETE',503);s+=amount(e.amount);add(when,'spending',e.amount);count(when);}
 if(e.action==='SUBMIT'&&!events.some(x=>['APPROVE','REJECT'].includes(x.action)&&x.settlementId===e.id))pendingSettlements++;
 }
 if(d<s+r)fail('REPORT_SETTLEMENT_INCOMPLETE',503);outstanding+=d-s-r;
 }
 return {months,totals,snapshot:{outstanding:String(outstanding),pendingSettlements,basis:'CURRENT_SNAPSHOT_NOT_QUARTER_END'},readiness:totals.sourceCount?'available':'empty',complete:true};
}
async function read(pool,actor,token,params,options={}){
 if(actor?.role!=='OWNER')fail('REPORT_OWNER_ONLY',403);
 const p=period(params,options.now),branch=params.get('branch_id')||'all';
 const reports=require('./operational-reports');
 const f=(range)=>reports.filters(new URLSearchParams({branch_id:branch,date_from:range.from,date_to:range.to,timezone:'Asia/Jakarta'}));
 const current=await reports.read(pool,actor,token,'quarterly-data',new URLSearchParams({branch_id:branch,date_from:p.from,date_to:p.to,timezone:'Asia/Jakarta'}),options);
 const previous=await reports.read(pool,actor,token,'quarterly-data',new URLSearchParams({branch_id:branch,date_from:p.previous.from,date_to:p.previous.to,timezone:'Asia/Jakarta'}),options);
 const today=day((options.now||new Date()).toISOString());
 // Compare complete recorded sources only; no claim of certified historical coverage.
 const available=p.to<today&&current.complete&&previous.complete&&current.totals.sourceCount>0&&previous.totals.sourceCount>0;
 const comparison={available,reason:available?'COMPLETE_RECORDED_SOURCES':'EMPTY_OR_OPEN_PERIOD',previousPeriod:p.previous,recordedPrevious:previous.totals,delta:available?Object.fromEntries(['requests','requestAmount','disbursements','spending','returns'].map(k=>[k,String(BigInt(current.totals[k])-BigInt(previous.totals[k]))])):null};
 return {id:'quarterly-owner',selection:p.selection,filters:f(p),...current,periodClosed:p.to<today,comparison,generated_at:new Date().toISOString(),notices:['Belanja = nota biasa EXPENSE disetujui + settlement APPROVE. Pencairan bukan belanja. Verifikasi file nota tidak dilakukan.','Outstanding dan approval adalah snapshot saat ini, bukan posisi akhir triwulan.','Perbandingan hanya mutasi tercatat pada dua periode selesai dengan sumber tersedia; bukan audit kelengkapan historis.'],snapshot:{...current.snapshot,pendingRequests:current.pendingRequests}};
}
module.exports={period,aggregate,read};
