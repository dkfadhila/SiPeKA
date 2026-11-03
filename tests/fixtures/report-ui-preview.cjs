'use strict';
// Local, synthetic UI fixture. No authentication provider or production services.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http');
const root=path.resolve(__dirname,'../..'),html=fs.readFileSync(path.join(root,'public/financial-dashboard.html'),'utf8');
const script=marker=>html.split(marker)[1].split('</script>')[0].replace(/^\s*<script>/,'');
const metrics=script('<!-- SIPEKA_METRICS_MODULE -->'),reportsScript=script('<!-- SIPEKA_REPORT_MODULE -->');
const operations=html.slice(html.indexOf('window.SipekaOperations = {'),html.indexOf('\nlet approvalItems=',html.indexOf('window.SipekaOperations = {')));
const units=[{id:'a',name:'Unit Utama',code:'UT',category:'LAUNDRY'},{id:'b',name:'Unit Kedua',code:'KD',category:'LAUNDRY'}];
const rows=[{id:'fixture-income',branch_id:'a',branch_name:'Unit Utama',user_id:'qa',user_name:'Tim Operasional',coa_id:'4-1300',account_code:'4-1300',account_name:'Laundry',account_type:'REVENUE',tx_type:'INCOME',amount:1800000,payment_method:'BANK_TRANSFER',memo:'Pendapatan harian',receipt_key:null,status:'APPROVED',tx_intent:'SETOR_NOTA',created_at:'2026-10-06T03:00:00Z'},{id:'fixture-expense',branch_id:'a',branch_name:'Unit Utama',user_id:'qa',user_name:'Tim Operasional',coa_id:'5-1100',account_code:'5-1100',account_name:'Bahan',account_type:'EXPENSE',tx_type:'EXPENSE',amount:350000,payment_method:'CASH_DRAWER',memo:'Pembelian perlengkapan',receipt_key:null,status:'APPROVED',tx_intent:'SETOR_NOTA',created_at:'2026-10-07T03:00:00Z'}];
const accounts=require('../../coa-catalog').definitions.map(([id,account_name,account_type])=>({id,account_code:id,account_name,account_type}));
const pool={async query(sql,args){
 if(sql.includes('FROM business_units'))return {rows:units};
 if(sql.includes('FROM chart_of_accounts'))return {rows:accounts};
 if(sql.includes('FROM cash_closings')||sql.includes('FROM receipt_assets'))return {rows:[]};
 if(sql.includes('FROM ledger_transactions'))return {rows:rows.filter(r=>r.created_at>=args[0]&&r.created_at<args[1]&&(args[2]==='all'||r.branch_id===args[2])).map(r=>({...r,amount:String(r.amount)}))};
 throw Error('Unsupported fixture query');
}};
function page(section){
 const styles=[...html.matchAll(/<style\b[^>]*>[\s\S]*?<\/style>/g)].map(m=>m[0]).join('');
 const data=JSON.stringify({rows,units,user:{id:'qa',role:'OWNER',full_name:'Pengguna Contoh'},advanceRows:[]}).replace(/</g,'\\u003c');
 return '<!doctype html><html lang="id" data-theme="light"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>SiPeKA · Pratinjau Uji UI</title>'+styles+'<style>body{margin:0}.qa-shell{display:grid;grid-template-columns:220px minmax(0,1fr);min-height:100vh}.qa-nav{padding:30px 22px;border-right:1px solid #ddd;background:var(--surface)}.qa-nav a{display:block;padding:14px 0;color:var(--ink);text-decoration:none}.qa-nav strong{display:block;margin-bottom:30px}.qa-workspace{min-width:0;padding:30px}#content{padding:0}@media(max-width:700px){.qa-shell{display:block}.qa-nav{display:flex;gap:20px;padding:14px 18px;border-right:0;border-bottom:1px solid #ddd}.qa-nav strong{margin:0;align-self:center}.qa-nav a{padding:0}.qa-workspace{padding:18px}}</style></head><body><div class="qa-shell"><aside class="qa-nav"><strong>SiPeKA</strong><a href="/reports">Reports</a><a href="/export">Export</a></aside><main class="qa-workspace" id="content"></main></div><script>const FixtureDate=Date;window.Date=class extends FixtureDate{constructor(...args){super(...(args.length?args:["2026-10-15T05:00:00Z"]));}static now(){return new FixtureDate("2026-10-15T05:00:00Z").getTime();}};window.SipekaCurrentUser={id:"qa",role:"OWNER"};window.SipekaAuth={generation:()=>1};window.SipekaCompany={name:"Perusahaan Contoh"};</script><script>'+fs.readFileSync(path.join(root,'public/document-approval.js'),'utf8')+operations+metrics+'</script><script>'+fs.readFileSync(path.join(root,'public/report-identity-ui.js'),'utf8')+'</script><script>'+reportsScript+'</script><script>SipekaReports.setSnapshot('+data+');document.querySelector("#content").innerHTML=SipekaReports.render('+JSON.stringify(section)+');SipekaReports.bind(document.querySelector("#content"));</script></body></html>';
}
function createServer(){const documents=new Map(),requests=new Map(),counters=new Map();return http.createServer(async(req,res)=>{
 try{
  const url=new URL(req.url,'http://localhost'),match=url.pathname.match(/^\/api\/reports\/([a-z-]+)(\/export)?$/);
  if(url.pathname==='/api/documents/issue'&&req.method==='POST'){let raw='';for await(const chunk of req)raw+=chunk;const body=require('../../document-numbering').normalize(JSON.parse(raw));let doc=requests.get(body.idempotency_key);if(!doc){const unit=body.branch_id==='all'?'AMC':units.find(u=>u.id===body.branch_id).code,prefix=require('../../document-numbering').reportCodes[body.report_id],key=prefix+'-'+unit+'-'+body.date_to.slice(0,7),sequence=(counters.get(key)||0)+1;counters.set(key,sequence);doc={...body,id:require('node:crypto').randomUUID(),code:prefix+'/'+unit+'/'+require('../../document-numbering').romanMonth(Number(body.date_to.slice(5,7)))+'/'+body.date_to.slice(0,4)+'/'+String(sequence).padStart(3,'0')};documents.set(doc.id,doc);requests.set(body.idempotency_key,doc);}res.setHeader('Content-Type','application/json');res.statusCode=201;return res.end(JSON.stringify(doc));}
  if(match){const params=new URLSearchParams(url.searchParams);params.delete('format');params.delete('company_name');const documentId=params.get('document_id');params.delete('document_id');let report=await require('../../operational-reports').read(pool,{role:'OWNER'},'fixture',match[1],params,{readAdvances:async()=>({rows:[]})});
   if(documentId){const doc=documents.get(documentId);require('../../document-numbering').assertMatches(doc,{report_id:match[1],branch_id:params.get('branch_id'),date_from:params.get('date_from'),date_to:params.get('date_to'),view_mode:params.get('view_mode'),...(params.has('branch_ids')?{branch_ids:JSON.parse(params.get('branch_ids'))}:{})});report=require('../../report-document').attach(report,doc);}
   if(match[2]){if(url.searchParams.get('format')==='xlsx'){res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');return res.end(require('../../report-template-xlsx').exportXlsx(report.templateLayout,'Perusahaan Contoh'));}res.setHeader('Content-Type','text/csv');return res.end(require('../../operational-reports').toCsv(report));}
   res.setHeader('Content-Type','application/json');return res.end(JSON.stringify(report));
  }
  if(url.pathname==='/api/units'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify(units));}
  if(url.pathname==='/pdf_bg_base64.txt'){res.end('');return;}
  res.setHeader('Content-Type','text/html; charset=utf-8');res.end(page(url.pathname==='/export'?'export':url.pathname==='/tax'?'tax':'reports'));
 }catch(error){res.writeHead(503,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'FIXTURE_UNAVAILABLE'}));}
});}
module.exports={createServer,page,metrics,reportsScript,rows,units};
if(require.main===module)createServer().listen(5439,'0.0.0.0',()=>console.log('Synthetic report UI ready at http://127.0.0.1:5439/reports'));
