'use strict';
const {fault}=require('./payroll');
// Signature area in PDF points. Printed approval text does not simulate an autograph.
const SIGNATURE_AREA=Object.freeze({x:365,y:112,width:142,height:64});
function integer(value){if(typeof value==='number'&&!Number.isSafeInteger(value))throw fault('PAYROLL_INTEGER_IDR');if(!/^(0|[1-9]\d{0,30})$/.test(String(value)))throw fault('PAYROLL_INTEGER_IDR');return BigInt(value);}
function money(value){return 'Rp '+integer(value).toString().replace(/\B(?=(\d{3})+(?!\d))/g,'.');}
function publicationDate(value){if(value==null)return 'Belum diterbitkan';const date=new Date(value);if(!Number.isFinite(date.getTime()))throw fault('PAYROLL_PUBLICATION_DATE');return new Intl.DateTimeFormat('id-ID',{timeZone:'Asia/Jakarta',day:'numeric',month:'long',year:'numeric'}).format(date);}
function plain(value,max=96){return String(value??'Tidak tersedia').replace(/[\x00-\x1f\x7f]/g,' ').slice(0,max);}
function renderSlipPdf(row,{publishedAt,simulation=false,documentIdentity}={}){
 const commands=['q 595 0 0 842 0 0 cm /Frame Do Q'];
 const employeeLayout=!!row.employee_id;
 const literal=value=>plain(value,180).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/\u2014/g,'\x97').replace(/[^\x20-\x7e\x97]/g,'?').replace(/([\\()])/g,'\\$1');
 const text=(s,x,y,size=11,bold=false,color='0.16 0.16 0.16')=>commands.push(`${color} rg BT /${bold?'F2':'F1'} ${size} Tf 1 0 0 1 ${x} ${y} Tm (${literal(s)}) Tj ET`);
 const line=y=>commands.push(`0.82 0.82 0.82 RG 0.6 w 48 ${y} m 547 ${y} l S`);
 // Centered letterhead shared by general and laundry; financial fields stay unchanged.
 const compName=documentIdentity?require('./report-identity').companyName(documentIdentity.company_name):'CV ARTHA MULTI CIPTANUSA';
 const address=plain(documentIdentity?.company_address??row.company_address??'Kompleks Roemah Pelangi Ruko No. 3 Jl. Ori II No. 7, Depok, Daerah Istimewa Yogyakarta, Indonesia, 55281',180);
 const measure=(value,size)=>[...value].reduce((sum,c)=>sum+('ilI.,:;!| '.includes(c)?278:'mwMW@'.includes(c)?833:/[A-Z]/.test(c)?667:556),0)*size/1000;
 const centered=(value,y,size,bold=false)=>text(value,Math.max(48,(595-measure(value,size))/2),y,size,bold,'0.12 0.12 0.12');
 const companyLines=compName.length>52?compName.match(/.{1,52}/g):[compName];
 companyLines.forEach((part,i)=>centered(part,780-i*18,16,true));
 const addressLines=[];let addressLine='';const addressLimit=Math.min(499,measure(address,10)/Math.max(1,Math.ceil(measure(address,10)/499))+20);
 for(const word of address.split(/\s+/)){const candidate=addressLine?addressLine+' '+word:word;if(measure(candidate,10)>addressLimit&&addressLine){addressLines.push(addressLine);addressLine=word;}else addressLine=candidate;}if(addressLine)addressLines.push(addressLine);
 addressLines.forEach((part,i)=>centered(part,754-(companyLines.length-1)*18-i*12,10));line(729-(companyLines.length-1)*18);
 const documentCode=require('./document-format').slipCode(row);
 text('Nomor Dokumen',48,710,12,true);text(': '+(documentCode||plain(row.entry_id||'Tidak tersedia',48)),148,710,12);
 text('Periode',355,710,12,true);text(': '+row.period,430,710,12,true);
 const identity=(label,value,x,y,valueX,max=32)=>{text(label,x,y,12);text(':',valueX-9,y,12);text(plain(value??'-',max),valueX,y,12);};
 identity('Nama Karyawan',row.full_name,48,688,148,39);
 identity('Departemen',employeeLayout?row.department:row.username,48,670,148,39);
 identity('Unit Kerja',documentIdentity?.branch_name||row.branch_name,48,652,148,39);
 identity(employeeLayout?'ID Karyawan':'Username',employeeLayout?row.employee_id:row.username,355,688,443,23);
 identity('Jabatan',row.job_title||row.position,355,670,443,23);
 identity('Status',row.employment_status,355,652,443,23);
 text('Penerbitan: '+publicationDate(publishedAt)+' (WIB)',48,631,10);
 line(583);
 commands.push('0.86 0.86 0.86 rg 48 559 499 24 re f');
 text('Pendapatan',128,566,12,true,'0.12 0.12 0.12');text('Potongan',391,566,12,true,'0.12 0.12 0.12');
 // Helvetica amounts use font widths (digits 556, period/space 278).
 const width=(s,size,bold)=>[...s].reduce((n,c)=>n+(/\d/.test(c)?556:c==='R'?722:c==='p'?(bold?611:556):278),0)*size/1000;
 const amount=(label,v,at,x,right,bold=false)=>{text(label,x,at,12,bold);const m=v==null?'Tidak tersedia':money(v),size=12;text(m,right-width(m,size,bold),at,size,bold);};
 const detailed=row.overtime!=null, laundry=row.payroll_type==='LAUNDRY';
 const additional=row.operational_allowance!=null?[['Tunjangan operasional',row.operational_allowance],['Tunjangan kesehatan',row.health_allowance]]:[];
 const earnings=laundry?[['Gaji pokok',row.basic_salary],...additional,['Uang makan',row.meal_allowance],['Transport',row.transport_allowance],['Setrika reguler',row.ironing_regular],['Setrika express',row.ironing_express],['Lembur',row.overtime],['Bonus',row.bonus]]:detailed?[['Gaji pokok',row.basic_salary],...additional,['Lembur',row.overtime],['Bonus',row.bonus]]:[['Gaji pokok',row.basic_salary],['Tunjangan',row.allowances]];
 const deductions=laundry&&row.absence_deduction!=null?[['Potongan absen',row.absence_deduction],['Potongan telat',row.late_deduction],['Pelanggaran',row.violation_deduction],...(integer(row.other_deductions||0)>0n?[['Potongan lainnya',row.other_deductions]]:[]),...(integer(row.pph21||0)>0n?[['PPh 21',row.pph21]]:[])]:laundry?[['Potongan',row.deductions],...(row.pph21!=null&&integer(row.pph21)>0n?[['PPh 21',row.pph21]]:[])]:detailed?[['Potongan absen',row.absence_deduction],['Potongan telat',row.late_deduction],['Pelanggaran',row.violation_deduction],['PPh 21',row.pph21]]:[...(row.deductions!=null?[['Potongan',row.deductions]]:[]),...(row.pph21!=null?[['PPh 21',row.pph21]]:[])];
 earnings.forEach(([label,value],i)=>amount(label,value,540-i*18,48,284));
 deductions.forEach(([label,value],i)=>amount(label,value,540-i*18,311,547));
 if(row.basic_salary!=null&&row.allowances!=null)amount('Total pendapatan',(integer(row.basic_salary)+integer(row.allowances)).toString(),380,48,284,true);
 if(row.deductions!=null&&row.pph21!=null)amount('Total potongan',(integer(row.deductions)+integer(row.pph21)).toString(),380,311,547,true);
 commands.push('0.82 0.82 0.82 RG 0.6 w 297 368 m 297 574 l S');
 commands.push('0.94 0.94 0.94 rg 48 280 499 70 re f');text('TAKE HOME PAY / GAJI BERSIH',64,328,12,true);const net=row.net_salary==null?'Tidak tersedia':money(row.net_salary);text(net,531-width(net,18,true),306,18,true,'0.16 0.16 0.16');if(row.net_salary!=null){const words=require('./payroll-words').rupiahWords(row.net_salary);const lines=words.match(/.{1,78}(?:\s|$)|.{1,78}/g)||[];lines.slice(0,2).forEach((part,i)=>text((i?'':'Terbilang: ')+part.trim(),64,291-i*12,10));}
 const approval=require('./public/document-approval').wording;
 const atCenter=(value,x,y,size=10,bold=false)=>text(value,x-measure(value,size)/2,y,size,bold);
 atCenter(approval.prepared,173,239,11,true);atCenter(approval.approved,423,239,11,true);
 atCenter(approval.department,173,223);atCenter(approval.company,423,223);
 atCenter('( '+approval.preparer+' )',173,151,11,true);atCenter('( '+approval.approver+' )',423,151,11,true);
 atCenter(approval.preparerRole,173,135);atCenter(approval.approverRole,423,135);
 line(115);
 const wrap=value=>{const result=[];let current='';for(const word of value.split(' ')){const next=current?current+' '+word:word;if(measure(next,10)>499&&current){result.push(current);current=word;}else current=next;}if(current)result.push(current);return result;};
 let footY=99;for(const sentence of [approval.note,approval.responsibility])for(const part of wrap(sentence)){text(part,48,footY,10);footY-=12;}

 const stream=Buffer.from(commands.join('\n'),'latin1');
 const frame=require('./assets/payroll-frame-pdf.json');const rgb=Buffer.from(frame.rgb,'base64'),alpha=Buffer.from(frame.alpha,'base64');
 const objects=[Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),Buffer.from('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> /XObject << /Frame 7 0 R >> >> /Contents 6 0 R >>'),Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'),Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'),Buffer.concat([Buffer.from(`<< /Length ${stream.length} >>\nstream\n`),stream,Buffer.from('\nendstream')])];
 objects.push(Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${frame.width} /Height ${frame.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /FlateDecode /SMask 8 0 R /Length ${rgb.length} >>\nstream\n`),rgb,Buffer.from('\nendstream')]),Buffer.concat([Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${frame.width} /Height ${frame.height} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode /Length ${alpha.length} >>\nstream\n`),alpha,Buffer.from('\nendstream')]));
 const chunks=[Buffer.from('%PDF-1.4\n')],offsets=[0];let length=chunks[0].length;
 objects.forEach((object,i)=>{offsets.push(length);const chunk=Buffer.concat([Buffer.from(`${i+1} 0 obj\n`),object,Buffer.from('\nendobj\n')]);chunks.push(chunk);length+=chunk.length;});
 chunks.push(Buffer.from('xref\n0 9\n0000000000 65535 f \n'+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size 9 /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`));return Buffer.concat(chunks);
}
function payrollCaption(row,publishedAt){return `Halo ${plain(row.full_name||row.username,80)},\n\nSlip gaji Anda untuk periode ${plain(row.period,7)} telah diterbitkan oleh Owner.\nGaji bersih: ${money(row.net_salary)}\nTanggal penerbitan: ${publicationDate(publishedAt)} (WIB)\n\nRincian pribadi terlampir dalam PDF. Penerbitan slip bukan konfirmasi pembayaran. Jika ada pertanyaan, silakan hubungi penanggung jawab.\n\nTerima kasih.\nSiPeKA — Bot Slip Gaji\nRahasia: hanya untuk Anda.`;}
const onboardingMessages=Object.freeze({welcome:'Selamat datang di SiPeKA — Bot Slip Gaji. Bot ini hanya untuk slip gaji pribadi, bukan akses asisten AI. Masuk ke SiPeKA dan gunakan tautan Hubungkan Telegram dari akun Anda. Tautan berlaku terbatas dan sekali pakai.',pending:'Telegram Anda berhasil diajukan. Menunggu verifikasi Owner; slip belum dapat dikirim sebelum verifikasi selesai.',verified:'Telegram Anda telah diverifikasi Owner. Slip pribadi dapat dikirim melalui tombol kirim Owner setelah periode gaji diterbitkan. Ini bukan konfirmasi pembayaran.'});
module.exports={renderSlipPdf,SIGNATURE_AREA,money,publicationDate,payrollCaption,onboardingMessages};
