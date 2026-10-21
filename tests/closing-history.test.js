'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{date,range,page}=require('../closing-history');
test('historical closing accepts real ISO WIB dates only',()=>{assert.equal(date('2026-10-11'),'2026-10-11');for(const bad of ['2026-02-30','2026-2-3','1999-12-31','2101-01-01',null])assert.throws(()=>date(bad));});
test('closing inclusive ranges bounded and ordered',()=>{assert.deepEqual(range(new URLSearchParams('date_from=2026-10-11&date_to=2026-10-12')),{from:'2026-10-11',to:'2026-10-12'});for(const s of ['date_from=2026-10-12&date_to=2026-10-11','date_from=2024-01-01&date_to=2026-01-01'])assert.throws(()=>range(new URLSearchParams(s)));});
test('closing pagination rejects invalid amounts without truncation',()=>{assert.deepEqual(page(new URLSearchParams()),{limit:25,offset:0});for(const s of ['limit=0','limit=101','offset=-1','limit=1.5','offset=100001','limit=1x'])assert.throws(()=>page(new URLSearchParams(s)));});

test('closing rejects duplicate date and pagination filters instead of silently taking first',()=>{for(const q of ['date_from=2026-10-01&date_from=2025-10-01&date_to=2026-10-02','date_from=2026-10-01&date_to=2026-10-02&date_to=2025-10-02'])assert.throws(()=>range(new URLSearchParams(q)));assert.throws(()=>page(new URLSearchParams('limit=25&limit=50')));});
