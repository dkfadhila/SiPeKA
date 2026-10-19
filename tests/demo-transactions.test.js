'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {generate}=require('../scripts/demo-transactions'),{byCode}=require('../coa-catalog');
test('100 deterministic new-COA fixtures span all 30 WIB days and each unit without QRIS outflow',()=>{
 const units=[{id:'lp',name:'Laundry',category:'LAUNDRY'},{id:'lc',name:'Laundry Cabang',category:'LAUNDRY'},{id:'cfe',name:'Cafe',category:'FNB'},{id:'cws',name:'Car Wash',category:'JASA'},{id:'kos',name:'Kos',category:'KOS'},{id:'vil',name:'Villa',category:'VILLA'}];
 const rows=generate('2026-10-19',units),days=rows.map(r=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Jakarta'}).format(new Date(r.created_at)));
 assert.equal(rows.length,100);assert.equal(new Set(rows.map(r=>r.id)).size,100);assert.equal(new Set(days).size,30);assert.equal(days[0],'2026-09-20');assert.equal(days.at(-1),'2026-10-19');
 assert.equal(rows.filter(r=>r.tx_type==='INCOME').length,60);assert.equal(rows.filter(r=>r.tx_type==='EXPENSE').length,40);
 for(const unit of units){assert.ok(rows.some(r=>r.branch_id===unit.id&&r.tx_type==='INCOME'));assert.ok(rows.some(r=>r.branch_id===unit.id&&r.tx_type==='EXPENSE'));}
 for(const r of rows){assert.ok(r.memo.startsWith('[DUMMY]'));assert.equal(byCode.get(r.coa_id).type,r.tx_type==='INCOME'?'REVENUE':'EXPENSE');assert.notEqual(r.coa_id,'6-3000');assert.ok(!(r.tx_type==='EXPENSE'&&r.payment_method==='QRIS'));assert.ok(Number.isSafeInteger(r.amount)&&r.amount>0);}
 assert.deepEqual(generate('2026-10-19',units),rows);assert.throws(()=>generate('2026-02-30',units),/INVALID/);
});
