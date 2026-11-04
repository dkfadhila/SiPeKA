'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {service}=require('../employee-payroll'),{createCipher}=require('../payroll');
test('legacy department labels cannot break the entire employee payroll list',async()=>{
 const key='ab'.repeat(32),cipher=createCipher(key),id='entry-legacy',employee_id='a'.repeat(32);
 const row={employee_id,period:'2026-11',full_name:'Karyawan QA',department:'Operasional',department_code:'OPERASIONAL',branch_id:'branch-qa',unit_code:'RD',email:'qa@example.invalid',staff_revision:1,document_code:'SLIP/RD-OPERASIONAL/XI/2026/'+employee_id};
 const payload=cipher.seal(row,id),entry={id,period:row.period,staff_id:employee_id,payload_cipher:payload};
 const staff=[{id:employee_id,employee_code:'007',name:row.full_name,department:row.department,branch_id:row.branch_id,email:row.email,revision:1,active:true}];
 const pool={query:async sql=>({rows:[{result:sql.includes('operational_directory')?staff:[entry]}]})};
 const result=await service({pool,env:{PAYROLL_ENCRYPTION_KEY:key}}).list('qa');
 assert.equal(result.rows.length,1);assert.equal(result.rows[0].row.document_code,'SLIP/RD-OPS/XI/2026/007');
 assert.equal(result.rows[0].recipient_valid,true);assert.equal(result.readiness.encryption,true);
 assert.deepEqual(cipher.open(payload,id),row,'historical ciphertext is unchanged');
 row.document_code='SLIP/RD-OPS/XI/2026/007';entry.payload_cipher=cipher.seal(row,id);
 assert.equal((await service({pool,env:{PAYROLL_ENCRYPTION_KEY:key}}).list('qa')).rows[0].row.document_code,row.document_code);
 assert.throws(()=>require('../document-format').slipCode({...row,document_code:null,employee_code:'007'}),/DOCUMENT_INVALID_DEPARTMENT/,'new documents keep strict department validation');
});
