'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {toCsv}=require('../operational-reports');
const money=['amount','income','expense','net','system_balance','physical_cash','difference'];
test('validated signed integer MONEY columns retain exact positive negative and huge CSV numbers',()=>{
 for(const key of money)for(const value of ['0','123','-123','900719925474099312345','-900719925474099312345']){
  assert.equal(toCsv({columns:[{key}],rows:[{[key]:value}]}),'\uFEFF'+key+'\r\n'+value+'\r\n',key+':'+value);
 }
});
test('untrusted text and malformed monetary cells retain spreadsheet formula defense',()=>{
 for(const key of ['memo','branch','amount','net'])for(const value of ['=1+1','+123','-1+2','@SUM(A1)','  -123','\t=1','\r=1']){
  const csv=toCsv({columns:[{key}],rows:[{[key]:value}]});
  assert.ok(csv.split('\r\n')[1].includes("'"),key+':'+JSON.stringify(value));
 }
 assert.equal(toCsv({columns:[{key:'memo'}],rows:[{memo:'-123'}]}),"\uFEFFmemo\r\n'-123\r\n");
 assert.equal(toCsv({columns:[{key:'memo'}],rows:[{memo:'a,"b"\nc'}]}),'\uFEFFmemo\r\n"a,""b""\nc"\r\n');
});
