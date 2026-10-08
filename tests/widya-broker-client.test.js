'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
test('private broker client fixed server-only path, invalid inputs refused',async()=>{
 let client;try{client=require('../widya-vision-socket');}catch{}assert.ok(client,'private socket client missing');
 assert.equal(client.SOCKET,'/run/widya-receipt-vision/vision.sock');
 await assert.rejects(client.analyzeReceipt({bytes:Buffer.alloc(0),mime:'image/png'}),{code:'WIDYA_RECEIPT_INVALID_IMAGE'});
});
