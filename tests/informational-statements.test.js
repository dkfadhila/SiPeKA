'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('fs');
test('informational statements expose recorded coverage, not invented balances',()=>{
 const {build}=require('../informational-statements');
 const f={branch:'a',dateFrom:'2026-01-01',dateTo:'2026-03-31',utcFrom:'2025-12-31T17:00:00Z',utcToExclusive:'2026-03-31T17:00:00Z',timezone:'Asia/Jakarta'};
 const ordinary=[{id:'n',branch_id:'a',tx_type:'EXPENSE',status:'APPROVED',tx_intent:'SETOR_NOTA',amount:'9007199254740993',created_at:'2026-02-01 00:00:00',account_code:'5-101',account_name:'Bahan'}];
 const advances=[{branchId:'a',events:[{id:'d',action:'DISBURSE',amount:'1000',createdAt:'2026-01-01T00:00:00Z'},{id:'ap',action:'APPROVE',amount:'600',createdAt:'2026-03-31T16:59:59Z',lines:[{coaId:'internal-id',amount:'600'}]},{id:'r',action:'RETURN',amount:'400',createdAt:'2026-03-31T17:00:00Z'}]}];
 const accounts=[{id:'internal-id',account_code:'5-101',account_name:'Bahan',account_type:'EXPENSE'}];
 const r=build('recorded-income-expense',ordinary,advances,accounts,f);
 assert.equal(r.totals.expense,'9007199254741593');assert.equal(r.totals.income,null);assert.equal(r.totals.net,null);assert.equal(r.coverage.income.completeness,'unverified');assert.equal(r.rows.find(x=>x.item==='Belanja disetujui').amount,'9007199254741593');assert.ok(r.rows.some(x=>x.item==='Selisih transaksi tercatat'&&x.amount===null));assert.equal(r.financialStatementsComplete,false);
 const b=build('fund-position',ordinary,advances,accounts,f);assert.equal(b.rows.find(x=>x.item==='Dana Staff belum dipertanggungjawabkan').amount,'0');assert.equal(b.snapshot.basis,'CURRENT_SNAPSHOT_NOT_PERIOD_END');for(const key of ['cash','assets','liabilities','equity','endBalance'])assert.equal(b[key],null);assert.equal(b.rows.find(x=>x.item==='Pengembalian dana tercatat').amount,'0');assert.match(b.notices.join(' '),/bukan posisi akhir periode/);
});
