'use strict';
const test=require('node:test');const assert=require('node:assert/strict');
const api=()=>require('../receipt-ocr');
test('exact Indonesian rupiah suggestions require review, never financial actions',()=>{
 assert.equal(typeof api().parseReceiptText,'function');
 const r=api().parseReceiptText('TOKO SINTETIS\nTanggal 08/10/2026\nSUBTOTAL Rp 100.000\nTOTAL Rp 125.000,00\nTUNAI Rp 150.000\nKEMBALI Rp 25.000',95);
 assert.equal(r.suggestions.amount,'125000');assert.equal(r.suggestions.date,'2026-10-08');assert.equal(r.suggestions.merchant,'TOKO SINTETIS');assert.equal(r.requiresHumanReview,true);assert.equal(r.payment_method,undefined);
});
test('ambiguous totals, fractional or foreign currency, unsafe integers never become amounts',()=>{
 for(const text of ['TOTAL Rp 10.000\nTOTAL Rp 20.000','TOTAL Rp 1.250,50','TOTAL 1,250.00','TOTAL USD 125000','TOTAL Rp 9007199254740992','TOTAL Rp O0.000','TOTAL Rp 0','TOTAL Rp 001000'])assert.equal(api().parseReceiptText(text).suggestions.amount,null,text);
 assert.equal(api().parseIDR('9007199254740991'),'9007199254740991');
});
test('invalid calendar dates and conflicting dates require manual review without throwing',()=>{
 for(const text of ['Tanggal 31/02/2026','Tanggal 00/00/2026','Tanggal 08/10/2026\nTanggal 09/10/2026','Tanggal 08/10/26'])assert.equal(api().parseReceiptText(text).suggestions.date,null);
 assert.equal(api().parseReceiptText('Tanggal 2024-02-29').suggestions.date,'2024-02-29');
});
test('authorized receiptKey-only local OCR service blocks foreign Staff before storage reads',async()=>{
 assert.equal(typeof api().createReceiptOCR,'function');let reads=0;
 const service=api().createReceiptOCR({lookupReceipt:async()=>({filename:'evidence-123-abcdef.png',user_id:'staff',branch_id:'b',mime:'image/png'}),readReceipt:async()=>{reads++;return Buffer.from('not an image');}});
 for(const receiptKey of ['https://evil.test/a','/etc/passwd','/api/receipts/../private','/api/receipts/evidence-123-abcdef.png?x'])await assert.rejects(service.extract({actor:{id:'staff',role:'STAFF',assigned_branch_id:'b'},receiptKey}),{code:'OCR_INVALID_KEY'});
 await assert.rejects(service.extract({actor:null,receiptKey:'/api/receipts/evidence-123-abcdef.png'}),{code:'OCR_UNAUTHORIZED'});
 for(const actor of [{id:'other',role:'STAFF',assigned_branch_id:'b'},{id:'staff',role:'STAFF',assigned_branch_id:'other'},{id:'staff',role:'ADMIN'}])await assert.rejects(service.extract({actor,receiptKey:'/api/receipts/evidence-123-abcdef.png'}),{code:'OCR_FORBIDDEN'});
 assert.equal(reads,0);
 const make=(asset,bytes)=>api().createReceiptOCR({lookupReceipt:async()=>asset,readReceipt:async()=>bytes});
 const own={filename:'evidence-123-abcdef.png',user_id:'staff',branch_id:'b',mime:'image/png'},request={actor:{id:'staff',role:'STAFF',assigned_branch_id:'b'},receiptKey:'/api/receipts/evidence-123-abcdef.png'};
 await assert.rejects(make(null,null).extract(request),{code:'OCR_NOT_FOUND'});
 await assert.rejects(make({...own,mime:'application/pdf'},Buffer.from('%PDF')).extract(request),{code:'OCR_UNSUPPORTED_FORMAT'});
 for(const bytes of [Buffer.alloc(0),Buffer.alloc(6000001)])await assert.rejects(make(own,bytes).extract(request),{code:'OCR_INVALID_SIZE'});
 const unsafe=api().parseReceiptText('<img src=x onerror=alert(1)>');assert.equal(unsafe.suggestions.merchant,null);assert.equal(unsafe.suggestions.amount,null);assert.equal(unsafe.requiresHumanReview,true);
 await assert.rejects(service.extract({actor:{id:'owner',role:'OWNER'},receiptKey:'/api/receipts/evidence-123-abcdef.png'}),{code:'OCR_INVALID_IMAGE'});assert.equal(reads,1);
});
