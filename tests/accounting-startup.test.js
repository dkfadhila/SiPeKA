'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{Pool}=require('pg');
const schema=process.env.ACCOUNTING_TEST_SCHEMA;if(!/^accounting_test_[a-f0-9]{16}$/.test(schema||''))throw Error('ISOLATED_RETAINED_SCHEMA_REQUIRED');
const source=fs.readFileSync(require.resolve('../server'),'utf8');const guard=vm.runInNewContext('('+source.slice(source.indexOf('async function accountingGuard('),source.indexOf('function accountingDraft(')).trim()+')');
const pool=new Pool({connectionString:process.env.DATABASE_URL});test.after(()=>pool.end());
test('actual runtime startup guard rejects disabled balanced trigger',async()=>{await assert.rejects(guard(pool),/ACCOUNTING_GUARD_REQUIRED/);});
