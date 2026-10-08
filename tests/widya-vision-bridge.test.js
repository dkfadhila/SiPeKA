'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
test('receipt bridge exposes isolated worker; ordinary chat validation still rejects image/history overrides',()=>{
 const bridge=require('../widya-bridge').createWidyaBridge();assert.equal(typeof bridge.analyzeReceipt,'function');assert.throws(()=>bridge.validate({message:'hi',conversation_id:'f3ae9d4b-8b13-42a9-8034-abc0b2d34123',image:'bytes'}),{code:'WIDYA_INVALID_INPUT'});
});
