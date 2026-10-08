'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
test('startup guards inspect column DML, triggers and unique indexes',()=>{const s=fs.readFileSync('advance-service.js','utf8');for(const token of ['has_column_privilege','pg_trigger','indisunique','indisvalid','advance_ordinary_receipt_guard()'])assert.ok(s.includes(token),token);});
