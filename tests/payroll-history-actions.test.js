'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync(require.resolve('../public/employee-payroll-ui.js'),'utf8');
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function harness(){
 const controls=new Map(),sendButtons=[],publishButtons=[];
 const panel={querySelector:s=>controls.get(s),querySelectorAll:s=>s==='[data-employee-send]'?sendButtons:s==='[data-employee-publish]'?publishButtons:[]};
 controls.set('[data-employee-import-help]',{});
 const context={window:{SipekaCompany:{name:'QA'}},panel,entries:[],ready:{encryption:true,email:true},busy:new Set(),importButton:{},importing:false,reviewPolling:false,importError:'',loading:0,current:()=>true,status:{},output:{innerHTML:''},esc:v=>String(v??''),amount:v=>String(v??''),earningsDetail:()=>'',deductionsDetail:()=>''};
 vm.createContext(context);
 vm.runInContext(source.slice(source.indexOf('  const sendReason='),source.indexOf('  const importReady='))+source.slice(source.indexOf('  function syncButtons(){'),source.indexOf("  panel.addEventListener('change'"))+'\nthis.syncButtons=syncButtons;this.load=load;this.canSend=canSend;',context);
 context.addEntry=(id,status='DRAFT')=>{const e={id,batch_id:'batch-'+id,period:'2026-10',status,email_status:null,recipient_valid:true,row:{full_name:'Employee '+id,employee_id:id,email:id+'@example.invalid',upload_kind:'PDF'}};context.entries.push(e);const send={dataset:{employeeSend:id}},publish={dataset:{employeePublish:e.batch_id}};sendButtons.push(send);publishButtons.push(publish);const sendConsent={checked:false},publishConsent={checked:false};controls.set('[data-employee-consent="'+id+'"]',sendConsent);controls.set('[data-employee-publish-consent="'+e.batch_id+'"]',publishConsent);return {e,send,publish,sendConsent,publishConsent};};
 return context;
}

test('send eligibility preserves intentional publication, recipient and delivery-status gates',()=>{
 const c=harness(),a=c.addEntry('a');a.sendConsent.checked=true;c.syncButtons();assert.equal(a.send.disabled,true);
 a.e.status='PUBLISHED';c.syncButtons();assert.equal(a.send.disabled,false);
 for(const status of ['sent','sending','uncertain']){a.e.email_status=status;c.syncButtons();assert.equal(a.send.disabled,true,status);}
 a.e.email_status=null;a.e.recipient_valid=false;c.syncButtons();assert.equal(a.send.disabled,true);
 a.e.recipient_valid=true;c.ready.email=false;c.syncButtons();assert.equal(a.send.disabled,true);
 c.ready.email=true;a.e.row.email='';c.syncButtons();assert.equal(a.send.disabled,true);
});

test('publication and recipient busy keys disable only their own confirmed actions',()=>{
 const c=harness(),a=c.addEntry('a','PUBLISHED'),b=c.addEntry('b','PUBLISHED');
 c.syncButtons();assert.equal(a.publish.disabled,true);assert.equal(a.send.disabled,true);
 for(const x of [a,b]){x.publishConsent.checked=true;x.sendConsent.checked=true;}
 c.busy.add('batch-a');c.busy.add('a');c.syncButtons();
 assert.equal(a.publish.disabled,true);assert.equal(a.send.disabled,true);assert.equal(b.publish.disabled,false);assert.equal(b.send.disabled,false);
 c.busy.clear();c.syncButtons();assert.equal(a.publish.disabled,false);assert.equal(a.send.disabled,false);
 // Consent cleared by a new history rendering must never leave an action enabled.
 a.sendConsent.checked=false;a.publishConsent.checked=false;c.syncButtons();assert.equal(a.publish.disabled,true);assert.equal(a.send.disabled,true);
});

test('a late payroll list response cannot overwrite the latest refresh',async()=>{
 const c=harness(),older=deferred(),newer=deferred();let calls=0;c.api=()=>++calls===1?older.promise:newer.promise;
 const first=c.load(),second=c.load();
 const entry=name=>({id:name,batch_id:name,period:'2026-10',status:'DRAFT',row:{full_name:name,upload_kind:'PDF'}});
 newer.resolve({rows:[entry('Newest employee')],readiness:{encryption:true,email:true}});await second;
 assert.match(c.output.innerHTML,/Newest employee/);
 older.resolve({rows:[entry('Stale employee')],readiness:{encryption:false,email:false}});await first;
 assert.match(c.output.innerHTML,/Newest employee/);assert.doesNotMatch(c.output.innerHTML,/Stale employee/);assert.equal(c.ready.encryption,true);
});
