'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
test('published slip actions show verified recipients; drafts and quarantined jobs cannot send',()=>{
 const html=fs.readFileSync(require.resolve('../public/financial-dashboard.html'),'utf8'),m=html.match(/  function payrollSendControls[\s\S]*?(?=  function payrollPreview)/);assert.ok(m,'manual control renderer exists');
 const ctx={window:{SipekaCurrentUser:{role:'OWNER'}},payrollSafe:v=>String(v??'')};vm.createContext(ctx);vm.runInContext(m[0],ctx);
 const row={entry_id:'entry',full_name:'Name',username:'staff',delivery:{telegram:{eligible:true,verified:true,address:'101'},email:{eligible:false,verified:false,address:'staff@example.test'}}};
 const pub=ctx.payrollSendControls(row,{status:'PUBLISHED'});assert.match(pub,/Kirim ke Telegram/);assert.match(pub,/Kirim ke Email/);assert.match(pub,/staff@example.test/);row.delivery.telegram.telegram_username='proven_staff';assert.match(ctx.payrollSendControls(row,{status:'PUBLISHED'}),/@proven_staff/);assert.match(pub,/belum terdaftar/i);
 assert.equal(ctx.payrollSendControls(row,{status:'DRAFT'}),'');row.delivery.telegram.job={status:'uncertain'};assert.match(ctx.payrollSendControls(row,{status:'PUBLISHED'}),/disabled/);ctx.window.SipekaCurrentUser.role='STAFF';assert.equal(ctx.payrollSendControls(row,{status:'PUBLISHED'}),'');
});
test('professional PDF presents earnings and deductions columns, reference and WIB publication',()=>{const {renderSlipPdf}=require('../payroll-pdf');const bytes=renderSlipPdf({period:'2026-10',entry_id:'entry-1',username:'staff',full_name:'Name',basic_salary:1000,allowances:100,deductions:50,pph21:10,net_salary:1040},{publishedAt:'2026-10-10T18:30:00Z'}).toString();assert.match(bytes,/PENGHASILAN/);assert.match(bytes,/POTONGAN/);assert.match(bytes,/Referensi/);assert.match(bytes,/entry-1/);assert.match(bytes,/WIB/);});
