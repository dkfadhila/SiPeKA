'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),sharp=require('sharp'),fs=require('node:fs/promises'),path=require('node:path');
const {friendlyFilename,normalizeReceipt,safeDisplayFilename}=require('../receipt-upload');
test('WIB upload day, bounded safe names, forged headers rejected',()=>{
 assert.equal(friendlyFilename('alice','Laundry Pusat',new Date('2026-10-07T17:00:00Z')),'alice_Laundry_Pusat_081026.jpeg');
 assert.equal(friendlyFilename('alice','Laundry Pusat',new Date('2026-10-07T16:59:59Z')),'alice_Laundry_Pusat_071026.jpeg');
 const result=friendlyFilename('../a\r\n"\u202e','ユニット/\\'+ 'x'.repeat(200),new Date('2026-10-07T17:00:00Z'));assert.match(result,/^[A-Za-z0-9._-]+_081026\.jpeg$/);assert.ok(result.length<=110);
 assert.equal(safeDisplayFilename('x\r\nInjected: yes','fallback'),'fallback');
});
test('decoder rejects corrupt, animated, oversized image; orientation and JPEG cap',async()=>{
 await assert.rejects(normalizeReceipt(Buffer.from('not image')));
 await assert.rejects(normalizeReceipt(Buffer.alloc(6000001)));
 const huge=await sharp({create:{width:5000,height:5000,channels:3,background:'white'}}).png().toBuffer();await assert.rejects(normalizeReceipt(huge));
 const animated=await sharp(Buffer.from([255,0,0,255,0,0,255,0,0,255,0,0,0,0,255,0,0,255,0,0,255,0,0,255]),{raw:{width:2,height:4,channels:3,pageHeight:2}}).gif().toBuffer();assert.equal((await sharp(animated,{animated:true}).metadata()).pages,2);await assert.rejects(normalizeReceipt(animated));
 const source=await sharp({create:{width:30,height:10,channels:3,background:'white'}}).jpeg().withMetadata({orientation:6}).toBuffer();const output=await normalizeReceipt(source),meta=await sharp(output).metadata();assert.equal(meta.width,10);assert.equal(meta.height,30);assert.equal(meta.orientation,undefined);assert.ok(output.length<=800000);
});
test('private sidecar friendly name survives reload, overwrite refused, hash checked',async t=>{
 const root=await fs.mkdtemp(path.join(process.env.TMPDIR||process.env.TEMP,'naming-storage-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));process.env.STORAGE_BACKEND='filesystem';process.env.UPLOADS_DIR=root;
 const storage=require('../storage'),filename='evidence-1234567890123-abcdef.jpg',buffer=await sharp({create:{width:10,height:10,channels:3,background:'white'}}).jpeg().toBuffer();const asset=await storage.saveReceipt({filename,buffer,mime:'image/jpeg',original_filename:'alice_Laundry_081026.jpeg'});
 assert.equal(await storage.receiptDisplayName(asset),'alice_Laundry_081026.jpeg');await assert.rejects(storage.saveReceipt({filename,buffer,mime:'image/jpeg'}));assert.deepEqual(await storage.readReceipt(asset),buffer);
 await fs.writeFile(path.join(root,filename),Buffer.from('tampered'));await assert.rejects(storage.readReceipt(asset),/INTEGRITY/);
});
