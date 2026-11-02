'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {payrollEmail}=require('../payroll-email-template'),visual=require('../payroll-email-visual');
const row={employee_id:'002',full_name:'Ayu Contoh',company_name:'CV Artha Multi Ciptanusa',department:'Operasional',branch_name:'RedDoorz',unit_code:'RD',period:'2026-10'};
test('salary email includes complete formal correspondence, exact recipient, immutable document code and embedded generated visual',()=>{
 const mail=payrollEmail(row,{publishedAt:'2026-11-02T02:00:00Z',recipientEmail:'ayu@example.test'});
 for(const text of ['Kepada: Ayu Contoh','Email tujuan: ayu@example.test','Perihal: Penyampaian slip gaji Oktober 2026','Yth. Bapak/Ibu Ayu Contoh,','Dengan hormat,','SLIP/RD-OPS/X/2026/002','Terima kasih atas perhatian dan kerja sama Anda.','Hormat kami,','WIDYA','Head of Finance & Accounting (AI System)','Finance & Accounting Department','CV Artha Multi Ciptanusa'])assert.ok(mail.text.includes(text),text);
 assert.equal(mail.filename,'SLIP-RD-OPS-X-2026-002.pdf');assert.match(mail.subject,/Oktober 2026/);assert.match(mail.html,/cid:amc-payroll-header/);assert.doesNotMatch(mail.html,/<img[^>]+src="https?:/);
 assert.equal(mail.inlineAttachments.length,1);assert.equal(visual.validHeaderAttachment(mail.inlineAttachments[0]),true);assert.ok(mail.inlineAttachments[0].content.length<=visual.MAX_BYTES);
 assert.ok(mail.html.includes('Head of Finance &amp; Accounting (AI System)'));assert.doesNotMatch(mail.html,/gaji.*telah dibayar|pembayaran berhasil/i);
});
test('salary email escapes recipient and company content and keeps the visual optional when images are not rendered',()=>{
 const mail=payrollEmail({...row,full_name:'<img src=x onerror=alert(1)>',company_name:'AMC <script>x</script>'},{recipientEmail:'name&tag@example.test'});
 assert.ok(mail.html.includes('&lt;img src=x onerror=alert(1)&gt;'));assert.ok(mail.html.includes('AMC &lt;script&gt;x&lt;/script&gt;'));assert.ok(!mail.html.includes('<script>'));assert.ok(mail.html.includes('name&amp;tag@example.test'));
 assert.ok(mail.html.includes('alt=""'));assert.ok(mail.text.includes('Hormat kami,'));
 const mutated={...mail.inlineAttachments[0],content:Buffer.from(mail.inlineAttachments[0].content)};mutated.content[mutated.content.length-1]^=1;assert.equal(visual.validHeaderAttachment(mutated),false);
 assert.equal(visual.validHeaderAttachment({...mail.inlineAttachments[0],path:'https://tracking.invalid/pixel'}),false);
 assert.equal(visual.validHeaderAttachment({...mail.inlineAttachments[0],cid:'untrusted'}),false);
 assert.equal(visual.validHeaderAttachment({...mail.inlineAttachments[0],content:Buffer.alloc(visual.MAX_BYTES+1)}),false);
});
