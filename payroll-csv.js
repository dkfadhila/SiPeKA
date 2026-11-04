'use strict';
const {parseCsv,fault}=require('./payroll');
const labels={period:'Periode',employee_id:'No. Karyawan',full_name:'Nama Karyawan',basic_salary:'Gaji Pokok (Rp)',operational_allowance:'Tunjangan Operasional (Rp)',health_allowance:'Tunjangan Kesehatan (Rp)',meal_allowance:'Uang Makan (Rp)',transport_allowance:'Transport (Rp)',ironing_regular:'Setrika Reguler (Rp)',ironing_express:'Setrika Express (Rp)',overtime:'Lembur (Rp)',bonus:'Bonus (Rp)',absence_deduction:'Potongan Absen (Rp)',late_deduction:'Potongan Telat (Rp)',violation_deduction:'Potongan Pelanggaran (Rp)',other_deductions:'Potongan Lainnya (Rp)',allowances:'Total Tambahan (Rp)',deductions:'Total Potongan (Rp)',pph21:'PPh 21 (Rp)',job_title:'Jabatan',employment_status:'Status Karyawan',payment_method:'Metode Pembayaran',email:'Email'};
const normalize=value=>String(value).trim().toLocaleLowerCase('id-ID').replace(/\s+/g,' ');
const aliases=new Map(Object.entries(labels).flatMap(([key,label])=>[[normalize(key),key],[normalize(label),key]]));
const encode=rows=>rows.map(row=>row.map(value=>'"'+String(value).replace(/"/g,'""')+'"').join(',')).join('\r\n');
function read(csv){
 if(Buffer.byteLength(csv)>1024*1024)throw fault('PAYROLL_CSV_LIMIT');
 for(const delimiter of [',',';']){
  let rows;try{rows=parseCsv(csv.replace(/^\uFEFF/,''),delimiter);}catch{continue;}
  const header=(rows[0]||[]).map(value=>aliases.get(normalize(value))||value);
  if(header.includes('period')&&header.includes('employee_id'))return {rows:[header,...rows.slice(1)]};
 }
 throw fault('PAYROLL_CSV_HEADER');
}
function template(header){const fields=header.split(',');fields.splice(2,0,'full_name');fields.push('email');return '\uFEFF'+fields.map(key=>labels[key]).join(',')+'\r\n';}
module.exports={labels,read,encode,template};
