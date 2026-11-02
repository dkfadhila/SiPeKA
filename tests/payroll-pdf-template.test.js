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

test('generated employee IDs and long document codes wrap inside their metadata columns without truncation',()=>{
 const id='172914fb8ced26f4bcf3e8383bf1c1ad';
 const input={employee_id:id,full_name:'Karyawan Dummy Uji',department:'Pengujian',branch_name:'CafeDummy',unit_code:'CD',period:'2026-11',basic_salary:3000000,operational_allowance:250000,health_allowance:100000,overtime:150000,bonus:200000,absence_deduction:50000,late_deduction:25000,violation_deduction:25000,pph21:0,allowances:700000,deductions:100000,net_salary:3600000,payroll_type:'GENERAL'};
 const pdf=renderSlipPdf(input,{publishedAt}).toString('latin1');
 const draws=[...pdf.matchAll(/\/(F[12]) (\d+) Tf 1 0 0 1 ([\d.-]+) ([\d.-]+) Tm \(((?:\\.|[^\\)])*)\) Tj/g)].map(m=>({font:m[1],size:Number(m[2]),x:Number(m[3]),y:Number(m[4]),text:m[5]}));
 const code=draws.find(d=>d.text==='SLIP/CD-PEN/XI/2026/'+id);assert.ok(code);assert.equal(code.x,48);assert.ok(code.y<710);assert.equal(code.size,10);
 const identity=draws.filter(d=>d.x===443&&/^[a-f0-9]+$/.test(d.text));assert.ok(identity.length>1);assert.equal(identity.map(d=>d.text).join(''),id);assert.ok(identity.every(d=>d.size>=10));
 assert.ok(identity.slice(1).every((d,i)=>identity[i].y-d.y>=14));
 const role=draws.find(d=>d.text==='Jabatan'),publication=draws.find(d=>d.text.startsWith('Penerbitan:'));assert.ok(role.y<identity.at(-1).y-6);assert.ok(publication.y>583+8);
 assert.match(pdf,/3\.600\.000/);assert.match(pdf,/RADITYA MARTANEGARA/);
});
