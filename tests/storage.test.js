const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs/promises');const path=require('node:path');
test('filesystem receipt write read delete preserves bytes outside public root',async()=>{
 const dir=path.join('D:/FamilyAgent/Flora/generated/sipeka-vps-implementation','storage-'+Date.now());process.env.STORAGE_BACKEND='filesystem';process.env.UPLOADS_DIR=dir;
 const storage=require('../storage');const input={filename:'evidence-1234567890123-abcdef.png',buffer:Buffer.from('test-byte-content'),mime:'image/png'};
 const result=await storage.saveReceipt(input);assert.equal(result.filename,input.filename);assert.deepEqual(await storage.readReceipt(result),input.buffer);await storage.deleteReceipt(result);await assert.rejects(storage.readReceipt(result));await fs.rm(dir,{recursive:true,force:true});
});
test('rejects receipt path traversal before provider access',async()=>{
 const s=require('../storage');await assert.rejects(s.saveReceipt({filename:'../private',buffer:Buffer.from('x'),mime:'image/png'}));await assert.rejects(s.readReceipt({filename:'../../etc/passwd'}));
});
