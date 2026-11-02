'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {renderSlipPdf,createNotificationAdapter}=require('../payroll-delivery');
const row={user_id:'s',username:'ayu',full_name:'Ayu (Staff)',branch_name:'Laundry Pusat',period:'2026-09',basic_salary:2500000,allowances:100000,deductions:20000,pph21:10000,net_salary:2570000};
const publishedAt='2026-10-10T18:30:00Z';
test('exact huge integer formatting, escaped PDF literals, missing fields, stable dates',()=>{
 const {money,publicationDate,payrollCaption,onboardingMessages}=require('../payroll-pdf');assert.equal(money('9007199254740993123'),'Rp 9.007.199.254.740.993.123');assert.throws(()=>money(9007199254740992),/INTEGER/);assert.throws(()=>publicationDate('bad'),/DATE/);assert.equal(publicationDate(null),'Belum diterbitkan');assert.match(onboardingMessages.pending,/Menunggu verifikasi Owner/);
 const r={...row,full_name:'evil) Tj ET <b> \\ name',deductions:undefined,pph21:undefined};const pdf=renderSlipPdf(r,{publishedAt});assert.ok(pdf.toString().includes('evil\\) Tj ET'));assert.ok(!pdf.toString().includes('(PPh 21)'));assert.deepEqual(renderSlipPdf(row,{publishedAt}),renderSlipPdf(row,{publishedAt}));assert.match(payrollCaption(row,publishedAt),/bukan konfirmasi pembayaran/);
});
test('one Telegram document request carries private caption and actual PDF bytes',async()=>{
 const calls=[];const adapter=createNotificationAdapter({telegramToken:'offline-fixture',fetchImpl:async(url,opt)=>{calls.push({url,opt});return {ok:true,json:async()=>({ok:true,result:{message_id:7,chat:{id:123,type:'private'}}})};}});
 await adapter.telegram({to:'123',row,publishedAt});assert.equal(calls.length,1);assert.ok(calls[0].url.endsWith('/sendDocument'));const form=calls[0].opt.body;assert.ok(form instanceof FormData);assert.equal(form.get('chat_id'),'123');assert.equal(form.get('protect_content'),'true');assert.match(form.get('caption'),/Halo Ayu/);assert.match(form.get('caption'),/11 Oktober 2026/);assert.ok(!form.has('parse_mode'));assert.equal(form.get('document').type,'application/pdf');const bytes=Buffer.from(await form.get('document').arrayBuffer());assert.equal(bytes.subarray(0,8).toString(),'%PDF-1.4');assert.match(bytes.toString(),/RADITYA MARTANEGARA/);
});
test('A4 private slip includes publication WIB date and clean reserved signature area',()=>{
 const pdf=renderSlipPdf(row,{publishedAt}),s=pdf.toString('latin1');
 assert.match(s,/RADITYA MARTANEGARA/);assert.match(s,/Direktur/);assert.match(s,/11 Oktober 2026/);assert.match(s,/2\.570\.000/);assert.match(s,/Laundry Pusat/);assert.match(s,/MediaBox \[0 0 595 842\]/);assert.ok(!s.includes('ttd.'));
 const {SIGNATURE_AREA}=require('../payroll-pdf');assert.deepEqual(SIGNATURE_AREA,{x:365,y:112,width:142,height:64});assert.ok(SIGNATURE_AREA.y+SIGNATURE_AREA.height<290);
});
