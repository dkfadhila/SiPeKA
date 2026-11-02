'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const html=fs.readFileSync(path.join(__dirname,'../public/financial-dashboard.html'),'utf8');
function moduleScript(marker){return html.split('<!-- '+marker+' -->')[1].split('</script>')[0].replace(/^\s*<script>/,'');}
function fixture(){let issued='NRC/AMC/X/2026/001',override={};const calls=[],host={crypto,fetch:async(url,options)=>{const body=JSON.parse(options.body);calls.push({url,body});return {ok:true,json:async()=>({...body,id:crypto.randomUUID(),code:issued,...override})};}},context=vm.createContext({window:host,console,Intl,Date,Set,URLSearchParams,Blob});
 for(const marker of ['SIPEKA_METRICS_MODULE','SIPEKA_REPORT_MODULE'])vm.runInContext(moduleScript(marker),context);
 return {api:host.SipekaReports,calls,answer(code,patch={}){issued=code;override=patch;}};
}
function report(){return {id:'fund-position',filters:{branch:'all',dateFrom:'2026-10-01',dateTo:'2026-10-31',viewMode:'company'},documentIdentity:{company_name:'AMC'},columns:[{key:'label',label:'Keterangan',type:'text'}],rows:[{label:'Aktiva'}],complete:true,missingDatasets:[],templateLayout:{grid:[[],[],[],[],[],[]],continuations:[{grid:[[],[],[],[],[],[]]}],excelLayout:{grid:[[],[],[],[],[],[]]}}};}
test('Frontend accepts only new report/unit codes of 2–4 uppercase letters and retains exact document scope',async()=>{
 const f=fixture();for(const code of ['NRC/AMC/X/2026/001','LR/RD/X/2026/001','PPHD/ABCD/XII/2026/1000']){f.answer(code);assert.equal((await f.api.numberDocument(report())).documentCode,code);}
 for(const code of ['N/AMC/X/2026/001','NERACA/AMC/X/2026/001','NRC/A/X/2026/001','NRC/ABCDE/X/2026/001','NRC/RD1/X/2026/001','PPH21/RD/X/2026/001','nrc/AMC/X/2026/001','NRC/AMC/13/2026/001','NRC/AMC/X/2026/01']){f.answer(code);await assert.rejects(f.api.numberDocument(report()),/Identitas dokumen tidak cocok/);}
 f.answer('NRC/AMC/X/2026/002',{date_to:'2026-11-30'});await assert.rejects(f.api.numberDocument(report()),/Identitas dokumen tidak cocok/);
 assert.ok(f.calls.every(c=>c.url==='/api/documents/issue'&&c.body.report_id==='fund-position'));assert.equal(f.calls[0].body.code,undefined);
});
test('Issued code reaches CSV metadata and every PDF/Excel template panel without mutating the source report',async()=>{
 const f=fixture(),source=report(),before=JSON.stringify(source);f.answer('NRC/AMC/X/2026/001');const numbered=await f.api.numberDocument(source);
 assert.equal(JSON.stringify(source),before);assert.equal(numbered.documentIdentity.document_code,'NRC/AMC/X/2026/001');assert.ok(numbered.document_id);
 for(const panel of [numbered.templateLayout,...numbered.templateLayout.continuations,numbered.templateLayout.excelLayout]){assert.equal(panel.documentCode,'NRC/AMC/X/2026/001');assert.equal(panel.grid[4][0],'Kode dokumen: NRC/AMC/X/2026/001');}
 assert.match(f.api.toCsv(numbered),/Kode dokumen,label\r\nNRC\/AMC\/X\/2026\/001,Aktiva/);assert.equal(f.api.csvManifest(numbered).document_code,'NRC/AMC/X/2026/001');
});
