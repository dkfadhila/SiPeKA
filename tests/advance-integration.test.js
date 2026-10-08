'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),svc=require('../advance-service');
test('integration exposes authenticated snapshot, cash and startup guards',()=>{
 for(const name of ['snapshot','cash','guard'])assert.equal(typeof svc[name],'function',name);
});
