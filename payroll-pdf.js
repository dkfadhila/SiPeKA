'use strict';
const {fault}=require('./payroll');
// PDF coordinates, points: 50 x 22.6 mm reserved for an Owner-supplied image.
// No signature asset is accepted/rendered until a separately reviewed integration.
const SIGNATURE_AREA=Object.freeze({x:365,y:172,width:142,height:64});
function integer(value){if(typeof value==='number'&&!Number.isSafeInteger(value))throw fault('PAYROLL_INTEGER_IDR');if(!/^(0|[1-9]\d{0,30})$/.test(String(value)))throw fault('PAYROLL_INTEGER_IDR');return BigInt(value);}
function money(value){return 'Rp '+integer(value).toString().replace(/\B(?=(\d{3})+(?!\d))/g,'.');}
function publicationDate(value){if(value==null)return 'Belum diterbitkan';const date=new Date(value);if(!Number.isFinite(date.getTime()))throw fault('PAYROLL_PUBLICATION_DATE');return new Intl.DateTimeFormat('id-ID',{timeZone:'Asia/Jakarta',day:'numeric',month:'long',year:'numeric'}).format(date);}
function plain(value,max=96){return String(value??'Tidak tersedia').replace(/[\x00-\x1f\x7f]/g,' ').slice(0,max);}
function renderSlipPdf(row,{publishedAt,simulation=false,documentIdentity}={}){
 const commands=[];
 const literal=value=>plain(value,180).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/\u2014/g,'\x97').replace(/[^\x20-\x7e\x97]/g,'?').replace(/([\\()])/g,'\\$1');
 const text=(s,x,y,size=11,bold=false,color='0.18 0.23 0.28')=>commands.push(`${color} rg BT /${bold?'F2':'F1'} ${size} Tf 1 0 0 1 ${x} ${y} Tm (${literal(s)}) Tj ET`);
 const line=y=>commands.push(`0.84 0.87 0.88 RG 0.6 w 48 ${y} m 547 ${y} l S`);
 const compName = documentIdentity ? require('./report-identity').companyName(documentIdentity.company_name) : 'SLIP GAJI KARYAWAN';
 text(compName,48,documentIdentity?779:784,documentIdentity?13:15,true,'0.08 0.28 0.32');text('SLIP GAJI',48,746,26,true);text('RAHASIA / HANYA UNTUK PENERIMA',48,722,9);
 if(simulation)text('CONTOH — DATA SIMULASI',320,784,11,true,'0.6 0.22 0.13');
 if(documentIdentity){const name=require('./report-identity').companyName(documentIdentity.company_name);const parts=name.match(/.{1,45}/g);parts.forEach((s,i)=>text(s,48,812-i*12,10,true));}
 line(701);text('Periode',48,675,10);text(row.period,170,675,12,true);
 text('Nama',48,649,10);text(plain(row.full_name,66),170,649,12,true);text('Username',48,625,10);text(plain(row.username,64),170,625);
 const branch=documentIdentity?.branch_name||row.branch_name;const branchLines=branch?(documentIdentity?plain(branch,120).match(/.{1,40}/g):[plain(branch,64)]):[];if(branch){text('Unit / cabang',48,601,10);branchLines.forEach((s,i)=>text(s,170,601-i*11,documentIdentity?9:11));}const branchOffset=Math.max(0,branchLines.length-2)*11;
 text('Referensi: '+plain(row.entry_id||'Tidak tersedia',64),48,579-branchOffset,8);
 text('Penerbitan: '+publicationDate(publishedAt)+' (WIB)',48,563-branchOffset,9);
 line(545);text('PENGHASILAN',48,520,10,true);text('POTONGAN',311,520,10,true);
 // Helvetica amounts use font widths (digits 556, period/space 278).
 const width=(s,size,bold)=>[...s].reduce((n,c)=>n+(/\d/.test(c)?556:c==='R'?722:c==='p'?(bold?611:556):278),0)*size/1000;
 const amount=(label,v,at,x,right,bold=false)=>{text(label,x,at,10,bold);const m=v==null?'Tidak tersedia':money(v),size=9;text(m,right-width(m,size,bold),at,size,bold);};
 amount('Gaji pokok',row.basic_salary,485,48,284);amount('Tunjangan',row.allowances,451,48,284);
 if(row.basic_salary!=null&&row.allowances!=null)amount('Penghasilan bruto',(integer(row.basic_salary)+integer(row.allowances)).toString(),402,48,284,true);
 if(row.deductions!=null)amount('Potongan',row.deductions,485,311,547);
 if(row.pph21!=null)amount('PPh 21',row.pph21,451,311,547);
 if(row.deductions!=null&&row.pph21!=null)amount('Total potongan',(integer(row.deductions)+integer(row.pph21)).toString(),402,311,547,true);
 commands.push('0.84 0.87 0.88 RG 0.6 w 297 390 m 297 526 l S');
 commands.push('0.92 0.96 0.96 rg 48 292 499 70 re f');text('GAJI BERSIH',64,334,10,true);const net=row.net_salary==null?'Tidak tersedia':money(row.net_salary);text(net,531-width(net,20,true),314,20,true,'0.08 0.28 0.32');
 text('Slip diterbitkan oleh Owner; bukan bukti pembayaran.',48,267,9);
 // Reserved image region remains completely blank, no box, fake autograph or ttd.
 text('Raditya Martanegara',365,150,12,true);text('Penanggung jawab',365,132,10);text('Tanggal: '+publicationDate(publishedAt),365,114,10);
 line(79);text('Dokumen pribadi. Diterbitkan melalui SiPeKA. Simpan dengan aman.',48,60,8,false,'0.45 0.5 0.55');
 const stream=Buffer.from(commands.join('\n'),'latin1');
 const objects=[Buffer.from('<< /Type /Catalog /Pages 2 0 R >>'),Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>'),Buffer.from('<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>'),Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>'),Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>'),Buffer.concat([Buffer.from(`<< /Length ${stream.length} >>\nstream\n`),stream,Buffer.from('\nendstream')])];
 const chunks=[Buffer.from('%PDF-1.4\n')],offsets=[0];let length=chunks[0].length;
 objects.forEach((object,i)=>{offsets.push(length);const chunk=Buffer.concat([Buffer.from(`${i+1} 0 obj\n`),object,Buffer.from('\nendobj\n')]);chunks.push(chunk);length+=chunk.length;});
 chunks.push(Buffer.from('xref\n0 7\n0000000000 65535 f \n'+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n${length}\n%%EOF\n`));return Buffer.concat(chunks);
}
function payrollCaption(row,publishedAt){return `Halo ${plain(row.full_name||row.username,80)},\n\nSlip gaji Anda untuk periode ${plain(row.period,7)} telah diterbitkan oleh Owner.\nGaji bersih: ${money(row.net_salary)}\nTanggal penerbitan: ${publicationDate(publishedAt)} (WIB)\n\nRincian pribadi terlampir dalam PDF. Penerbitan slip bukan konfirmasi pembayaran. Jika ada pertanyaan, silakan hubungi penanggung jawab.\n\nTerima kasih.\nSiPeKA — Bot Slip Gaji\nRahasia: hanya untuk Anda.`;}
const onboardingMessages=Object.freeze({welcome:'Selamat datang di SiPeKA — Bot Slip Gaji. Bot ini hanya untuk slip gaji pribadi, bukan akses asisten AI. Masuk ke SiPeKA dan gunakan tautan Hubungkan Telegram dari akun Anda. Tautan berlaku terbatas dan sekali pakai.',pending:'Telegram Anda berhasil diajukan. Menunggu verifikasi Owner; slip belum dapat dikirim sebelum verifikasi selesai.',verified:'Telegram Anda telah diverifikasi Owner. Slip pribadi dapat dikirim melalui tombol kirim Owner setelah periode gaji diterbitkan. Ini bukan konfirmasi pembayaran.'});
module.exports={renderSlipPdf,SIGNATURE_AREA,money,publicationDate,payrollCaption,onboardingMessages};
