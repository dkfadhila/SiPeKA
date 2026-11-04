const test=require('node:test'),assert=require('node:assert/strict'),{matchPdf}=require('../payroll-upload');
test('PDF employee number uses one active directory match and rejects duplicate identity labels',()=>{
 const person={id:'a'.repeat(32),employee_code:'007',name:'Karyawan QA',department:'Operasional',email:'qa@example.invalid',active:true};
 const text='Nama Karyawan : Karyawan QA\nNo. Karyawan : 007\nPeriode : 2026-12\n';
 assert.equal(matchPdf(text,[person],'2026-12').employee.id,person.id);
 assert.throws(()=>matchPdf(text,[person,{...person,id:'b'.repeat(32)}],'2026-12'),/PAYROLL_STAFF_NOT_FOUND/);
 assert.throws(()=>matchPdf(text+'ID Karyawan : 007\n',[person],'2026-12'),/PAYROLL_PDF_IDENTITY_REQUIRED/);
 assert.throws(()=>matchPdf(text,[{...person,active:false}],'2026-12'),/PAYROLL_STAFF_NOT_FOUND/);
 assert.throws(()=>matchPdf(text.replace('2026-12','2026-11'),[person],'2026-12'),/PAYROLL_PDF_PERIOD_MISMATCH/);
});
