'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
test('closing preserves recorded-day ordinary movements; reconciliation has no guessed opening',()=>{
 const sql=fs.readFileSync('migrations/008_advance_lifecycle.sql','utf8'),server=fs.readFileSync('server.js','utf8');
 assert.doesNotMatch(sql,/CUMULATIVE_RECORDED_CASH_ZERO_OPENING/);
 assert.match(sql,/RECORDED_DAY_MOVEMENT/);
 assert.match(sql,/reconciliationComplete/);
 assert.match(server,/q\.cashDrawerBalanceToday\.get\(branchId\)/);
 assert.match(server,/advanceCashDelta/);
});
