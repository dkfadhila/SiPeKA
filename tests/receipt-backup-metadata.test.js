'use strict';
// Isolated filesystem and injected R2/backup-provider fixtures only.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),crypto=require('node:crypto'),{Readable}=require('node:stream');
const backup=require('../scripts/backup-receipts'),{canonical,encryptFile,sha256File}=require('../scripts/backup-postgres');
const filename='evidence-1234567890-abcdef.jpg',display='username_unit_081026.jpeg',bytes=Buffer.from('fixture receipt bytes'),sha256=crypto.createHash('sha256').update(bytes).digest('hex');
const snapshot={assets:[{filename,user_id:'fixture',branch_id:'unit',mime:'image/jpeg',created_at:'2026-10-08'}],references:[]};
const artifact='D:/FamilyAgent/Flora/generated/sipeka-completion/staff-refresh-fix';
function targets(){return ['r2','supabase'].map(name=>{const objects=new Map();return {name,ready:async()=>{},upload:async(k,p)=>objects.set(k,await fs.readFile(p)),download:async(k,p)=>fs.writeFile(p,objects.get(k),{flag:'wx'}),close(){}};});}
function frame(header){const data=Buffer.from(canonical(header)),length=Buffer.alloc(4);length.writeUInt32BE(data.length);return Buffer.concat([Buffer.from('SIPERC01'),length,data,bytes]);}
test('legacy v1 encrypted bundle restores unchanged bytes without friendly sidecars',async t=>{
 await fs.mkdir(artifact,{recursive:true});const root=await fs.mkdtemp(path.join(artifact,'legacy-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const env={BACKUP_DIR:path.join(root,'backups'),BACKUP_ENCRYPTION_KEY:crypto.randomBytes(32).toString('hex')};
 const buffer=frame({format:backup.FORMAT,snapshot,files:[{filename,size:bytes.length,sha256}]}),decoded=backup.inspectBundle(buffer);assert.deepEqual(decoded.files[0].bytes,bytes);assert.equal(decoded.files[0].metadata,undefined);
 const createdAt='2026-10-08T00:00:00.000Z',id=createdAt.replace(/[:.]/g,'-')+'_'+crypto.randomUUID(),metadata={format:backup.FORMAT,id,createdAt,...decoded.summary};const plain=path.join(root,'plain'),encrypted=path.join(root,'encrypted');await fs.writeFile(plain,buffer);await encryptFile(plain,encrypted,env.BACKUP_ENCRYPTION_KEY,metadata);
 const key=backup.PREFIX+id+'.manifest.json',manifest={...metadata,encryptedKey:backup.PREFIX+id+'.receipts.enc',encryptedSha256:await sha256File(encrypted),encryptedBytes:(await fs.stat(encrypted)).size},replicas=targets();for(const target of replicas){await target.upload(key,await (async()=>{const p=path.join(root,'manifest-'+target.name);await fs.writeFile(p,JSON.stringify(manifest));return p;})());await target.upload(manifest.encryptedKey,encrypted);}
 const output=path.join(root,'restore');assert.equal((await backup.runVerify(env,key,{targets:replicas,output})).ok,true);for(const name of ['r2','supabase']){assert.deepEqual(await fs.readFile(path.join(output,name,'receipts',filename)),bytes);await assert.rejects(fs.stat(path.join(output,name,'receipts',filename+'.metadata.json')),{code:'ENOENT'});}
});
test('unsafe or inexact friendly metadata rejected at source and bundle inspection',async()=>{
 for(const value of ['../unsafe.jpeg','good.jpeg\n','bad\r.jpeg','bad".jpeg','bad\\name.jpeg','x'.repeat(121)+'.jpeg','bidi\u202e.jpeg',''])await assert.rejects(backup.buildBundle(snapshot,{read:async()=>({bytes,original_filename:value})}),/storage metadata/);
 for(const metadata of [{original_filename:display,sha256:'0'.repeat(64)},{original_filename:display,sha256,extra:true},{original_filename:'safe.jpeg\n',sha256},null])assert.throws(()=>backup.inspectBundle(frame({format:'sipeka-receipts-backup-v2',snapshot,files:[{filename,size:bytes.length,sha256,metadata}]})),/storage metadata/);
});
for(const backend of ['filesystem','r2'])test(backend+' friendly metadata survives encrypted backup and isolated restore',async t=>{
 await fs.mkdir(artifact,{recursive:true});const root=await fs.mkdtemp(path.join(artifact,backend+'-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 const env={STORAGE_BACKEND:backend,UPLOADS_DIR:path.join(root,'source'),BACKUP_DIR:path.join(root,'backups'),BACKUP_ENCRYPTION_KEY:crypto.randomBytes(32).toString('hex'),R2_ENDPOINT:'https://fixture.invalid',R2_ATTACHMENT_BUCKET:'fixture'};
 await fs.mkdir(env.UPLOADS_DIR);await fs.writeFile(path.join(env.UPLOADS_DIR,filename),bytes);await fs.writeFile(path.join(env.UPLOADS_DIR,filename+'.metadata.json'),JSON.stringify({original_filename:display,sha256}));
 const source=backup.createSource(env,{client:{send:async()=>({Body:Readable.from([bytes]),ContentType:'image/jpeg',Metadata:{sha256,original_filename:display}}),destroy(){}}});
 const replicas=targets(),result=await backup.runBackup(env,{snapshot,source,targets:replicas});assert.equal(result.ok,true);
 const output=path.join(root,'restore'),restored=await backup.runVerify(env,result.manifestKey,{targets:replicas,output});assert.equal(restored.ok,true);
 for(const name of ['r2','supabase']){assert.deepEqual(await fs.readFile(path.join(output,name,'receipts',filename)),bytes);assert.deepEqual(JSON.parse(await fs.readFile(path.join(output,name,'receipts',filename+'.metadata.json'))),{original_filename:display,sha256});const objects=JSON.parse(await fs.readFile(path.join(output,name,'storage-metadata.json')));assert.deepEqual(objects['receipts/'+filename],{ContentType:'image/jpeg',Metadata:{sha256,original_filename:display}});}
});
