'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),{spawn}=require('node:child_process'),net=require('node:net'),sharp=require('sharp');
test('actual server mounted cookie/Origin receipt gates, private storage, retired routes; fixture DB/vision adapters',async t=>{
 const root=await fs.mkdtemp(path.join(process.env.TMPDIR||process.env.TEMP,'widya-http-')),uploads=path.join(root,'receipts');await fs.mkdir(uploads);t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));const base='http://127.0.0.1:'+port;
 const repo=path.resolve(__dirname,'..'),preload=path.join(root,'fixture.cjs');
 await fs.writeFile(preload,`const path=require('node:path'),repo=${JSON.stringify(repo)},assets=new Map();
 const actor={id:'staff',role:'STAFF',assigned_branch_id:'b',session_purpose:'full'};
 const q={receiptByFilename:{get:async name=>assets.get(name)},insertReceipt:{run:async(filename,user_id,branch_id,mime)=>assets.set(filename,{filename,user_id,branch_id,mime})},unitByIdActive:{get:async()=>({id:'b'})}};
 require.cache[require.resolve(path.join(repo,'db.js'))]={exports:{q,uid:()=>require('crypto').randomBytes(12).toString('hex'),ready:Promise.resolve(),getValidSession:async token=>token==='staff'?actor:token==='other'?{...actor,id:'other'}:token==='owner'?{...actor,id:'owner',role:'OWNER'}:null}};
 const bridgePath=require.resolve(path.join(repo,'widya-bridge.js')),actual=require(bridgePath);require.cache[bridgePath].exports={createWidyaBridge:()=>({...actual.createWidyaBridge(),analyzeReceipt:async()=>({output:JSON.stringify({amountIDR:77500,date:'2026-10-08',merchant:'TOKO UJI',text:'TOKO UJI\\n2026-10-08\\nTOTAL Rp 77.500',ambiguous:false}),runtime:{provider:'custom',model:'kr/gpt-5.6-luna'},imageTransport:{imageParts:1,toolCount:0}})})};
 require(path.join(repo,'server.js'));
 `);
 let logs='';const child=spawn(process.execPath,[preload],{cwd:repo,env:{...process.env,DATABASE_URL:'',NODE_ENV:'test',SIPEKA_SEED:'0',REQUIRE_OWNER_2FA:'0',HOST:'127.0.0.1',PORT:String(port),PUBLIC_ORIGIN:base,STORAGE_BACKEND:'filesystem',UPLOADS_DIR:uploads},stdio:['ignore','pipe','pipe']});child.stdout.on('data',b=>logs+=b);child.stderr.on('data',b=>logs+=b);t.after(()=>{child.kill();});
 for(let i=0;i<80;i++){try{if((await fetch(base+'/api/health')).ok)break;}catch{}if(child.exitCode!==null)throw Error(logs);await new Promise(r=>setTimeout(r,50));}
 const request=async(route,body,cookie='staff',origin=base)=>{const r=await fetch(base+route,{method:'POST',headers:{'content-type':'application/json',origin,cookie:cookie?'sipeka_session='+cookie:''},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};};
 const image=await sharp({create:{width:100,height:100,channels:3,background:'white'}}).png().toBuffer();const upload=await request('/api/receipts/upload',{image:'data:image/png;base64,'+image.toString('base64')});assert.equal(upload.status,201);const key=upload.body.receipt_key;
 assert.equal((await request('/api/receipts/analyze',{receipt_key:key},'')).status,401);assert.equal((await request('/api/receipts/analyze',{receipt_key:key},'other')).status,403);assert.equal((await request('/api/receipts/analyze',{receipt_key:key},'staff','https://evil.test')).status,403);assert.equal((await request('/api/receipts/analyze',{receipt_key:key,model:'evil'})).status,400);
 const result=await request('/api/receipts/analyze',{receipt_key:key});assert.equal(result.status,200);assert.equal(result.body.suggestions.amount,'77500');assert.equal(result.body.requiresHumanReview,true);
 for(const route of ['/api/widya/extract','/api/dewi/extract'])assert.equal((await request(route,{image:'anything'})).status,410);
 await new Promise(resolve=>{child.once('exit',resolve);child.kill();});console.log('Actual mounted server cookie+Origin+storage PASS; injected DB/vision adapters; no PostgreSQL acceptance');
});
