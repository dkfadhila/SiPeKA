'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const q=require('../quarterly-owner');
test('WIB default quarter and previous year rollover',()=>{
 assert.deepEqual(q.period(new URLSearchParams(),new Date('2026-12-31T17:00:00Z')).selection,{year:2027,quarter:1});
 const p=q.period(new URLSearchParams('year=2026&quarter=1'));
 assert.equal(p.from,'2026-01-01');assert.equal(p.to,'2026-03-31');assert.equal(p.previous.from,'2025-10-01');
});
test('event WIB boundaries, exact amounts, branch isolation',()=>{
 const rows=[{created_at:'2025-12-31 17:00:00',tx_intent:'PENGAJUAN_DANA',amount:'1000',status:'APPROVED'},{created_at:'2026-02-01',tx_intent:'SETOR_NOTA',tx_type:'EXPENSE',status:'APPROVED',amount:'9007199254740993'}];
 const advances=[{branchId:'a',events:[{id:'d',action:'DISBURSE',createdAt:'2025-12-31T16:59:59Z',amount:'1000'},{id:'s',action:'APPROVE',createdAt:'2026-03-31T16:59:59Z',amount:'600',lines:[{amount:'600'}]},{id:'r',action:'RETURN',createdAt:'2026-03-31T17:00:00Z',amount:'400'}]},{branchId:'b',events:[{id:'other',action:'DISBURSE',createdAt:'2026-02-01T00:00:00Z',amount:'999'}]}];
 const r=q.aggregate(rows,advances,{dateFrom:'2026-01-01',dateTo:'2026-03-31',branch:'a'});assert.equal(r.totals.requests,1);assert.equal(r.totals.disbursements,'0');assert.equal(r.totals.spending,'9007199254741593');assert.equal(r.totals.returns,'0');assert.equal(r.snapshot.outstanding,'0');assert.equal(r.months[2].spending,'600');
});
test('invalid selection denied; empty is known zero',()=>{
 for(const query of ['year=2026x','quarter=5','year=2026&year=2025','timezone=UTC'])assert.throws(()=>q.period(new URLSearchParams(query)),/REPORT_INVALID_FILTER/);
 const r=q.aggregate([],[],{dateFrom:'2026-04-01',dateTo:'2026-06-30',branch:'all'});assert.equal(r.readiness,'empty');assert.equal(r.totals.spending,'0');assert.equal(r.months.length,3);
});
