'use strict';
const {test}=require('node:test');const assert=require('node:assert/strict');
const {createNotificationAdapter}=require('../payroll-delivery');
const row={period:'2026-09',net_salary:123};
test('provider factory requires explicit SMTP configuration; scoped Telegram token only',()=>{
 const {createPayrollProviderConfig}=require('../payroll-provider-config');let options;
 const nodemailer={createTransport(o){options=o;return {sendMail(){}};}};
 const empty=createPayrollProviderConfig({env:{TELEGRAM_BOT_TOKEN:'unscoped'},nodemailer});assert.equal(empty.readiness.telegram,false);assert.equal(empty.readiness.email,false);
 const env={PAYROLL_SMTP_HOST:'smtp.example.com',PAYROLL_SMTP_PORT:'587',PAYROLL_SMTP_USER:'user',PAYROLL_SMTP_PASSWORD:'secret',PAYROLL_EMAIL_FROM:'payroll@example.com',PAYROLL_TELEGRAM_BOT_TOKEN:'scoped',PAYROLL_ENCRYPTION_KEY:'1'.repeat(64)};
 const ready=createPayrollProviderConfig({env,nodemailer});assert.equal(ready.readiness.email,false);assert.equal(ready.readiness.email_deferred,true);assert.equal(ready.readiness.telegram,true);assert.equal(ready.readiness.encryption,true);assert.equal(ready.readiness.worker_enabled,false);assert.equal(options,undefined);
 assert.ok(!JSON.stringify(ready.readiness).includes('secret'));
 assert.equal(createPayrollProviderConfig({env:{...env,PAYROLL_SMTP_PASSWORD:''},nodemailer}).readiness.email,false);
 assert.equal(createPayrollProviderConfig({env:{...env,PAYROLL_SMTP_PORT:''},nodemailer}).readiness.email,false);
});
test('email contact rejects recipient lists before transport access',()=>{
 const adapter=createNotificationAdapter({emailFrom:'payroll@example.com',emailTransport:{sendMail(){throw Error('transport accessed');}}});
 for(const to of ['a@example.com,b@example.com','a@example.com;b@example.com'])assert.throws(()=>adapter.check('email',to),/EMAIL_CONTACT/);
 assert.throws(()=>adapter.check('sms','123'),/CHANNEL/);
});
test('Telegram publication never asserts email delivery; requires positive receipt',async()=>{
 let text;const adapter=createNotificationAdapter({telegramToken:'fixture',fetchImpl:async(u,o)=>{text=JSON.parse(o.body).text;return {ok:true,json:async()=>({ok:true,result:{message_id:1,chat:{id:123,type:'private'}}})};}});
 await adapter.telegram({to:'123',row});assert.ok(!text.includes('Slip lengkap dikirim melalui email.'));
 const invalid=createNotificationAdapter({telegramToken:'fixture',fetchImpl:async()=>({ok:true,json:async()=>({ok:true,result:{chat:{id:123,type:'private'}}})})});
 await assert.rejects(invalid.telegram({to:'123',row}),/ACCEPTANCE_UNKNOWN/);
});
