'use strict';
// Payroll HTTP success is intentionally retired by the device model. The real
// PostgreSQL fixture verifies every retired route returns 410, even with the
// delivery environment flag enabled. No crypto/history assertions are removed.
const test=require('node:test'),assert=require('node:assert/strict'),{execFile}=require('node:child_process'),{promisify}=require('node:util'),path=require('node:path');
test('device model: actual PostgreSQL HTTP/browser attribution and payroll denial',{timeout:120000},async()=>{
 const root=path.resolve(__dirname,'..');
 assert.ok(root.startsWith('/home/ubuntu/sipeka-'),'Run only in retained isolated VPS QA checkout');
 const result=await promisify(execFile)(process.execPath,['tests/device-unit-vps.cjs'],{cwd:root,timeout:110000,maxBuffer:1024*1024});
 const proof=JSON.parse(require('node:fs').readFileSync(path.join(root,'device-proof.json')));
 assert.equal(proof.failed,0);assert.equal(proof.productionWrites,false);assert.equal(proof.providersCalled,false);
 assert.ok(proof.checks.some(x=>x.includes('/api/payroll/own-slips 410')));
 assert.ok(proof.checks.some(x=>x.includes('browser PDF recorded-income-expense')));
 assert.match(result.stdout,/"failed":0/);
});
