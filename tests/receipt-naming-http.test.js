'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),{spawn}=require('node:child_process'),net=require('node:net'),sharp=require('sharp');
test('mounted upload converts PNG to private JPEG with authentic friendly filename; fixture DB/vision',async t=>{
 const root=await fs.mkdtemp(path.join(process.env.TMPDIR||process.env.TEMP,'receipt-naming-')),uploads=path.join(root,'receipts');await fs.mkdir(uploads);t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const probe=net.createServer();await new Promise(r=>probe.listen(0,'127.0.0.1',r));const port=probe.address().port;await new Promise(r=>probe.close(r));const base='http://127.0.0.1:'+port;
 const repo=path.resolve(__dirname,'..'),preload=path.join(root,'fixture.cjs');
 await fs.writeFile(preload,`const path=require('node:path'),repo=${JSON.stringify(repo)},assets=new Map();
 const actor={id:'staff',username:'test.staff',role:'STAFF',assigned_branch_id:'b',session_purpose:'full'};
 const q={receiptByFilename:{get:async name=>assets.get(name)},insertReceipt:{run:async(filename,user_id,branch_id,mime)=>assets.set(filename,{filename,user_id,branch_id,mime})},unitByIdActive:{get:async id=>id==='b'?{id:'b',name:'Laundry Pusat'}:id==='c'?{id:'c',name:'Laundry Timur'}:null}};
 require.cache[require.resolve(path.join(repo,'db.js'))]={exports:{q,uid:()=>require('crypto').randomBytes(12).toString('hex'),ready:Promise.resolve(),getValidSession:async token=>token==='staff'?actor:token==='other'?{...actor,id:'other'}:token==='owner'?{...actor,id:'owner',username:'owner',role:'OWNER'}:null}};
 const bridgePath=require.resolve(path.join(repo,'widya-bridge.js')),actual=require(bridgePath);require.cache[bridgePath].exports={createWidyaBridge:()=>({...actual.createWidyaBridge(),analyzeReceipt:async args=>({output:JSON.stringify({amountIDR:77500,date:'2026-10-08',merchant:'TOKO UJI',text:'TOTAL Rp 77.500',ambiguous:false}),runtime:{provider:'custom',model:'kr/gpt-5.6-luna'},imageTransport:{imageParts:1,toolCount:0}})})};
 require(path.join(repo,'server.js'));`);
 let logs='';const child=spawn(process.execPath,[preload],{cwd:repo,env:{...process.env,DATABASE_URL:'',NODE_ENV:'test',SIPEKA_SEED:'0',REQUIRE_OWNER_2FA:'0',HOST:'127.0.0.1',PORT:String(port),PUBLIC_ORIGIN:base,STORAGE_BACKEND:'filesystem',UPLOADS_DIR:uploads},stdio:['ignore','pipe','pipe']});child.stdout.on('data',b=>logs+=b);child.stderr.on('data',b=>logs+=b);t.after(()=>child.kill());
 for(let i=0;i<80;i++){try{if((await fetch(base+'/api/health')).ok)break;}catch{}if(child.exitCode!==null)throw Error(logs);await new Promise(r=>setTimeout(r,50));}
 const request=async(route,body,cookie='staff')=>{const r=await fetch(base+route,{method:'POST',headers:{'content-type':'application/json',origin:base,cookie:cookie?'sipeka_session='+cookie:''},body:JSON.stringify(body)});return {status:r.status,body:await r.json()};};
 const image=await sharp({create:{width:100,height:100,channels:4,background:'#ff000088'}}).png().toBuffer();const body={image:'data:image/png;base64,'+image.toString('base64'),branch_id:'c',original_filename:'evil.jpeg',username:'evil',date:'2000-01-01'};
 const upload=await request('/api/receipts/upload',body);assert.equal(upload.status,201);assert.equal(upload.body.mime,'image/jpeg');
 const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Jakarta',day:'2-digit',month:'2-digit',year:'2-digit'}).formatToParts(new Date());const part=k=>parts.find(p=>p.type===k).value;const expected='test.staff_Laundry_Pusat_'+part('day')+part('month')+part('year')+'.jpeg';
 assert.equal(upload.body.original_filename,expected);assert.equal(upload.body.display_name,expected);assert.match(upload.body.receipt_key,/^\/api\/receipts\/evidence-\d+-[a-f0-9]{6}\.jpg$/);
 const read=async(key,cookie)=>fetch(base+key,{headers:{cookie:'sipeka_session='+cookie}});
 const response=await read(upload.body.receipt_key,'staff');assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'image/jpeg');assert.match(response.headers.get('content-disposition'),/filename="test.staff_Laundry_Pusat_\d{6}\.jpeg"/);
 const bytes=Buffer.from(await response.arrayBuffer());assert.equal(bytes.subarray(0,3).toString('hex'),'ffd8ff');assert.equal((await sharp(bytes).metadata()).format,'jpeg');assert.ok(bytes.length<=800000);
 const second=await request('/api/receipts/upload',body);assert.equal(second.status,201);assert.notEqual(second.body.receipt_key,upload.body.receipt_key);assert.equal(second.body.original_filename,expected);assert.deepEqual(Buffer.from(await (await read(upload.body.receipt_key,'staff')).arrayBuffer()),bytes);
 assert.equal((await read(upload.body.receipt_key,'other')).status,403);assert.equal((await read(upload.body.receipt_key,'owner')).status,200);assert.equal((await request('/api/receipts/upload',body,'')).status,401);
 const owner=await request('/api/receipts/upload',{...body,branch_id:'c'},'owner');assert.equal(owner.status,201);assert.match(owner.body.original_filename,/^owner_Laundry_Timur_\d{6}\.jpeg$/);assert.equal((await request('/api/receipts/upload',{...body,branch_id:'missing'},'owner')).status,400);
 assert.equal((await request('/api/receipts/analyze',{receipt_key:upload.body.receipt_key})).status,200);
 await new Promise(resolve=>{child.once('exit',resolve);child.kill();});
});
