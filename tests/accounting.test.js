'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const accounting=require('../accounting');
test('exact balanced IDR rejects ambiguity and overflow without Number arithmetic',()=>{
 assert.equal(accounting.validateLines([{account_id:'cash',branch_id:'b',debit:'9007199254740993',credit:'0'},{account_id:'r',branch_id:'b',debit:'0',credit:'9007199254740993'}]).debit,'9007199254740993');
 for(const lines of [[],[{account_id:'c',branch_id:'b',debit:'1',credit:'1'}],[{account_id:'c',branch_id:'b',debit:'1',credit:'0'},{account_id:'r',branch_id:'b',debit:'0',credit:'2'}]])assert.throws(()=>accounting.validateLines(lines));
});
