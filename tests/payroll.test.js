'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
test('AES GCM binds entry identity and hides amounts; OWNER gate precedes DB',async()=>{
 const {createCipher,createPayrollService}=require('../payroll');const key=crypto.randomBytes(32).toString('hex'),cipher=createCipher(key);
 const encrypted=cipher.seal({net_salary:2570000},'entry');assert.ok(!encrypted.includes('2570000'));
 assert.deepEqual(cipher.open(encrypted,'entry'),{net_salary:2570000});assert.throws(()=>cipher.open(encrypted,'other'),/DECRYPT/);
 assert.throws(()=>createCipher(''),/KEY_REQUIRED/);
 const svc=createPayrollService({pool:{connect(){throw Error('DB accessed');}},encryptionKey:key});
 for(const role of ['STAFF','ADMIN','OPERATOR','CEO'])await assert.rejects(svc.preview({id:'x',role},'batch'),/OWNER_ONLY/);
 await assert.rejects(svc.publish({id:'o',role:'OWNER',session_purpose:'mfa'},'batch','token'),/OWNER_ONLY/);
});
test('PDF contains official slip and adapter blocks missing config and private chat violations',async()=>{
 const {renderSlipPdf,createNotificationAdapter}=require('../payroll-delivery');
 const row={period:'2026-09',username:'staff',full_name:'Staff',basic_salary:2500000,allowances:100000,deductions:20000,pph21:10000,net_salary:2570000};
 const pdf=renderSlipPdf(row,{companyName:'Company'});assert.equal(pdf.subarray(0,8).toString(),'%PDF-1.4');assert.match(pdf.toString(),/SiPeKA/);assert.match(pdf.toString(),/2\.570\.000/);assert.match(pdf.toString(),/SLIP GAJI/);
 const adapter=createNotificationAdapter({});await assert.rejects(adapter.email({to:'staff@example.com',row}),/EMAIL_CONFIG/);
 await assert.rejects(adapter.telegram({to:'-123',row}),/PRIVATE_CHAT/);
 await assert.rejects(adapter.telegram({to:'123',row}),/TELEGRAM_CONFIG/);
});
test('CSV limits, injection, quoting, exact integers and contact privacy',()=>{
 const p=require('../payroll'),users=[{id:'s',username:'staff',role:'STAFF',full_name:'Staff'}],h=p.templateCsv();
 assert.equal(p.validateCsv(h+'"2026-09","staff","1","0","0","0"\r\n',users)[0].net_salary,1);
 for(const body of ['2026-09,staff,1,0,0,0,evil@example.com','2026-09,staff,+1,0,0,0','2026-09,staff,-1,0,0,0','2026-09,staff,1e5,0,0,0','2026-09,staff,9007199254740992,0,0,0','2026-09,staff,9007199254740991,1,0,0','2026-09,staff,01,0,0,0','2026-09,staff,1,0,0,0\n2026-10,staff,1,0,0,0','2026-09,"staff"x,1,0,0,0','2026-09,"staff,1,0,0,0'])assert.throws(()=>p.validateCsv(h+body,users));
 assert.throws(()=>p.validateCsv('x'.repeat(1024*1024+1),users),/LIMIT/);
 assert.throws(()=>p.validateCsv(h+Array(1001).fill('2026-09,staff,1,0,0,0').join('\n'),users));
 assert.throws(()=>p.validateCsv(h+'2026-09,staff,1,0,0,0',[{...users[0],is_active:false}]));
});
test('configured adapter sends single email attachment and private summary only',async()=>{
 const {createNotificationAdapter}=require('../payroll-delivery');let message,payload;
 const row={period:'2026-09',username:'staff',full_name:'Staff',basic_salary:1,allowances:0,deductions:0,pph21:0,net_salary:1};
 const adapter=createNotificationAdapter({emailFrom:'payroll@example.com',emailTransport:{async sendMail(m){message=m;return {accepted:[m.to],messageId:'r'};}},telegramToken:'fixture',fetchImpl:async(u,o)=>{payload=require('./fixtures/payroll-document.cjs')(o.body);return {ok:true,json:async()=>({ok:true,result:{message_id:2,chat:{id:123,type:'private'}}})};}});
 assert.equal((await adapter.email({to:'staff@example.com',row,idempotencyKey:'job'})).providerId,'r');assert.equal(message.to,'staff@example.com');assert.equal(message.cc,undefined);assert.equal(message.bcc,undefined);assert.equal(message.attachments.length,1);assert.equal(message.messageId,'<job@payroll.sipeka>');
 assert.equal((await adapter.telegram({to:'123',row})).providerId,'2');assert.equal(payload.parse_mode,undefined);assert.equal(payload.protect_content,true);assert.ok(!payload.text.includes('Potongan'));
});
test('CSV strict amounts, unique STAFF matching and template roundtrip',()=>{
 const p=require('../payroll');
 const staff=[{id:'s',username:'staff',role:'STAFF',full_name:'Staff'}];
 const csv=p.templateCsv();
 assert.equal(csv,'period,username,basic_salary,allowances,deductions,pph21\r\n');
 const rows=p.validateCsv(csv+'2026-09,staff,2500000,100000,20000,10000\r\n',staff);
 assert.equal(rows[0].net_salary,2570000);
 for(const text of ['2026-13,staff,1,0,0,0','2026-09,staff,1.1,0,0,0','2026-09,staff,=1,0,0,0','2026-09,unknown,1,0,0,0','2026-09,staff,1,0,2,0']) assert.throws(()=>p.validateCsv(csv+text,staff));
 assert.throws(()=>p.validateCsv(csv+'2026-09,staff,1,0,0,0\n2026-09,staff,2,0,0,0',staff),/DUPLICATE/);
 assert.throws(()=>p.validateCsv(csv+'2026-09,staff,1,0,0,0',[...staff,...staff]),/AMBIGUOUS/);
 assert.throws(()=>p.validateCsv(csv+'2026-09,staff,1,0,0,0',[{...staff[0],role:'OWNER'}]),/STAFF/);
});
