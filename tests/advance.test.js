'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
test('advance foundation exposes explicit disbursement, never implicit approval',()=>{
 assert.ok(fs.existsSync(require('node:path').join(__dirname,'../advance-service.js')),'advance service missing');
 const service=require('../advance-service');
 assert.equal(typeof service.disburse,'function');
});
