'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync(require.resolve('../public/employee-payroll-ui.js'),'utf8');
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function fixture(definitions=[['a','batch-a'],['b','batch-a'],['c','batch-a']]){
 const selectors=new Map(),collections=new Map(),listeners={};
 const add=(kind,key,extra={})=>{const node={dataset:{[kind]:key},checked:false,disabled:false,closest:()=>null,matches:s=>s==='[data-employee-bulk-consent]'&&kind==='employeeBulkConsent',...extra};const attribute=kind.replace(/[A-Z]/g,x=>'-'+x.toLowerCase());selectors.set('[data-'+attribute+'="'+key+'"]',node);const selector='[data-'+attribute+']';if(!collections.has(selector))collections.set(selector,[]);collections.get(selector).push(node);return node;};
 const panel={querySelector:s=>selectors.get(s),querySelectorAll:s=>collections.get(s)||[],addEventListener:(kind,fn)=>listeners[kind]=fn};
 selectors.set('[data-employee-import-help]',{});
 const entries=definitions.map(([id,batch])=>({id,batch_id:batch,status:'PUBLISHED',recipient_valid:true,email_status:null,row:{email:id+'@example.invalid',full_name:'Employee '+id}}));
 for(const entry of entries){add('employeeSend',entry.id);add('employeeConsent',entry.id);}
 for(const batch of new Set(entries.map(e=>e.batch_id))){add('employeeBulkConsent',batch);add('employeeBulkSend',batch);add('employeeBulkProgress',batch);add('employeeBulkResults',batch);add('employeePublish',batch);add('employeePublishConsent',batch,{checked:true});}
 const calls=[],context={window:{SipekaCompany:{name:'QA'}},entries,ready:{email:true,encryption:true},busy:new Set(),bulkRuns:new Map(),bulkConfirmations:new Map(),sessionSignal:{aborted:false},panel,current:()=>true,esc:String,status:{},message:e=>e.message,notice:()=>{},importButton:{},importing:false,reviewPolling:false,importError:'',loadCount:0,async load(){context.loadCount++;},async api(path,options){calls.push({path,options});return {status:'sent'};}};
 vm.createContext(context);
 vm.runInContext(source.slice(source.indexOf('  const sendReason='),source.indexOf('  async function load(){'))+source.slice(source.indexOf("  panel.addEventListener('change'"),source.indexOf('  // Saving the company'))+'\nthis.run=sendBulk;this.sync=syncButtons;',context);
 return {c:context,calls,get:(kind,id)=>selectors.get('[data-'+kind+'="'+id+'"]'),confirm(batch){const box=selectors.get('[data-employee-bulk-consent="'+batch+'"]');box.checked=true;listeners.change({target:box});}};
}

test('bulk requires a frozen confirmation and sends sequentially with explicit per-item bodies and no replay',async()=>{
 const {c,calls,confirm,get}=fixture();await c.run('batch-a');assert.equal(calls.length,0);
 get('employee-bulk-consent','batch-a').checked=true;await c.run('batch-a');assert.equal(calls.length,0,'checkbox alone is insufficient without snapshot');
 let active=0,max=0;c.api=async(path,options)=>{active++;max=Math.max(max,active);calls.push({path,options});await Promise.resolve();active--;if(path.includes('/b/'))return {status:'uncertain'};if(path.includes('/c/'))throw Error('fixture failure');return {status:'sent'};};
 confirm('batch-a');await c.run('batch-a');const run=c.bulkRuns.get('batch-a');
 assert.equal(max,1);assert.deepEqual(calls.map(x=>x.path),['a','b','c'].map(id=>'/api/employee-payroll/entries/'+id+'/send'));
 for(let i=0;i<calls.length;i++){assert.equal(calls[i].options.method,'POST');assert.equal(calls[i].options.body.email,['a','b','c'][i]+'@example.invalid');assert.equal(calls[i].options.body.confirmed,true);}
 assert.equal(run.sent,1);assert.equal(run.uncertain,2);assert.equal(run.done,3);assert.equal(run.running,false);assert.equal(c.busy.size,0);assert.equal(c.bulkConfirmations.size,0);assert.equal(c.loadCount,1);
 confirm('batch-a');await c.run('batch-a');assert.equal(calls.length,3,'sent and uncertain recipients are excluded on fresh confirmation');
});

test('snapshot excludes drafts and busy recipients, rejects changed email, and never adds newly eligible entries',async()=>{
 const {c,calls,confirm}=fixture();c.entries[0].status='DRAFT';c.busy.add('b');confirm('batch-a');
 assert.equal(c.bulkConfirmations.get('batch-a').length,1);assert.equal(c.bulkConfirmations.get('batch-a')[0].id,'c');
 c.entries[0].status='PUBLISHED';c.busy.delete('b');c.entries[2].row.email='changed@example.invalid';
 await c.run('batch-a');assert.equal(calls.length,0);assert.equal(c.bulkRuns.get('batch-a').skipped,1);
 // An overlapping individual action prevents starting the entire frozen selection.
 confirm('batch-a');c.busy.add('b');await c.run('batch-a');assert.equal(calls.length,0);assert.equal(c.bulkRuns.get('batch-a').running,false);
});

test('navigation and abort stop future sends and clean locks without refreshing a departed page',async()=>{
 for(const stop of ['navigation','abort']){
  const {c,calls,confirm}=fixture(),started=deferred(),release=deferred();
  c.api=async(path,options)=>{calls.push({path,options});started.resolve();await release.promise;return {status:'sent'};};
  confirm('batch-a');const pending=c.run('batch-a');await started.promise;
  if(stop==='navigation')c.current=()=>false;else c.sessionSignal.aborted=true;
  release.resolve();await pending;const run=c.bulkRuns.get('batch-a');
  assert.equal(calls.length,1);assert.equal(run.stopped,true);assert.equal(run.done,1);assert.equal(run.total-run.done,2);assert.equal(run.running,false);assert.equal(c.busy.size,0);assert.equal(c.loadCount,stop==='navigation'?0:1);
 }
});

test('independent batches can run concurrently, publication stays locked, and refresh waits for all runs',async()=>{
 const {c,calls,confirm,get}=fixture([['a','batch-a'],['b','batch-b']]),startedA=deferred(),startedB=deferred(),releaseA=deferred(),releaseB=deferred();
 c.api=async(path,options)=>{calls.push({path,options});if(path.includes('/a/')){startedA.resolve();await releaseA.promise;}else{startedB.resolve();await releaseB.promise;}return {status:'sent'};};
 confirm('batch-a');const a=c.run('batch-a');await startedA.promise;
 assert.equal(get('employee-publish','batch-b').disabled,true);
 confirm('batch-b');const b=c.run('batch-b');await startedB.promise;
 assert.equal(c.busy.size,2);await c.run('batch-a');assert.equal(calls.length,2,'same running batch cannot restart');
 releaseA.resolve();await a;assert.equal(c.loadCount,0,'first completion cannot refresh over another active batch');assert.equal(c.busy.has('a'),false);assert.equal(c.busy.has('b'),true);assert.equal(get('employee-publish','batch-a').disabled,true);
 releaseB.resolve();await b;assert.equal(c.loadCount,1);assert.equal(c.busy.size,0);assert.equal(get('employee-publish','batch-a').disabled,false);
});
