'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createWidyaReceiptDB}=require('../widya-receipt-db');
test('receipt authentication uses dedicated read-only bounded queries; full session only',async()=>{
 let row={id:'staff',role:'STAFF',session_purpose:'full',password_change_required:0},queries=[],released=0;
 const pool={connect:async()=>({query:async q=>{queries.push(q);return {rows:q.text.startsWith('SELECT set_config')?[]:[row]};},release:()=>released++})};
 const db=createWidyaReceiptDB(pool,{idleMS:60000});assert.equal(await db.authenticate(null),null);assert.equal(queries.length,0);
 assert.equal((await db.authenticate('fixture-token')).id,'staff');
 assert.match(queries[1].text,/s\.expired_at>/);assert.match(queries[1].text,/s\.last_seen_at>/);assert.deepEqual(queries[1].values,['fixture-token',60000]);
 row={...row,session_purpose:'password'};assert.equal(await db.authenticate('fixture-token'),null);
 row={...row,session_purpose:'full',password_change_required:1};assert.equal(await db.authenticate('fixture-token'),null);
 await db.lookupReceipt('evidence-123-abcdef.png');assert.match(queries.at(-1).text,/SELECT \* FROM receipt_assets WHERE filename=\$1/);
 assert.ok(queries.every(q=>q.text.startsWith('SELECT')));assert.equal(released,4);
});
