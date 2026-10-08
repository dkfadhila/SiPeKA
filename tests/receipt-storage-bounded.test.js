'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path'),{Readable}=require('node:stream');
const {createBoundedReceiptReader}=require('../receipt-storage-bounded');
const asset={filename:'evidence-123-abcdef.png'};
test('R2 rejects declared and streamed overflow; timeout aborts body and command signal',async()=>{
 for(const declared of [true,false]){let destroyed=false;const stream=Readable.from([Buffer.alloc(6),Buffer.alloc(6)]);const read=createBoundedReceiptReader({backend:'r2',maxBytes:10,makeClient:()=>({send:async()=>({Body:stream,...(declared?{ContentLength:11}:{})}),destroy:()=>{destroyed=true;}})});await assert.rejects(read(asset),{code:'OCR_INVALID_SIZE'});assert.equal(stream.destroyed,true);assert.equal(destroyed,true);}
 let signal;const stream=new Readable({read(){}});const read=createBoundedReceiptReader({backend:'r2',timeoutMs:20,makeClient:()=>({send:async(command,options)=>{signal=options.abortSignal;return {Body:stream};},destroy(){}})});await assert.rejects(read(asset),{code:'OCR_TIMEOUT',status:504});assert.equal(signal.aborted,true);assert.equal(stream.destroyed,true);
});
test('filesystem reader rejects oversized files before allocation, accepts private file, rejects arbitrary URL',async()=>{
 const root=await fs.mkdtemp(path.join(process.env.TMPDIR||os.tmpdir(),'ocr-storage-'));const file=path.join(root,asset.filename);
 await fs.writeFile(file,Buffer.alloc(11));const read=createBoundedReceiptReader({backend:'filesystem',root,maxBytes:10});
 await assert.rejects(read(asset),{code:'OCR_INVALID_SIZE',status:413});await fs.writeFile(file,'valid');assert.equal((await read(asset)).toString(),'valid');
 await assert.rejects(read({filename:'https://evil.example/a'}),{code:'OCR_INVALID_KEY'});
});
