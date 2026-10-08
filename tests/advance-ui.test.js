'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
test('settlement upload multiline category picker with action-payload retry binding',()=>{const h=fs.readFileSync('public/financial-dashboard.html','utf8');for(const token of ['data-advance-upload','data-advance-add','data-advance-line','advanceRetryBindings','JSON.stringify({action','SipekaAdvanceCategories'])assert.ok(h.includes(token),token);assert.ok(h.includes("'/api/advance-categories'"));});
