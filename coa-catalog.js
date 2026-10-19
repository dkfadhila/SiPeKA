'use strict';
// Codes and labels follow the Owner's supplied 03_Laporan_Laba_Rugi.xlsx.
const definitions = [
 ['4-1100','Pendapatan Kamar','REVENUE','Pendapatan usaha'],
 ['4-1200','Pendapatan Sewa','REVENUE','Pendapatan usaha'],
 ['4-1300','Pendapatan Jasa Laundry','REVENUE','Pendapatan usaha'],
 ['4-1400','Penjualan','REVENUE','Pendapatan usaha'],
 ['4-1900','Pendapatan Usaha Lainnya','REVENUE','Pendapatan usaha'],
 ['5-1100','Bahan Habis Pakai (Amenities, Deterjen, Kimia)','EXPENSE','Beban pokok pendapatan'],
 ['5-1200','Pakan & Obat Ikan','EXPENSE','Beban pokok pendapatan'],
 ['5-1300','Bibit','EXPENSE','Beban pokok pendapatan'],
 ['5-1400','Upah Langsung (Housekeeping, Operator, Pembudidaya)','EXPENSE','Beban pokok pendapatan'],
 ['5-1500','Utilitas Produksi (Listrik, Air, Gas)','EXPENSE','Beban pokok pendapatan'],
 ['6-1100','Gaji & Upah (Non-Produksi)','EXPENSE','Beban usaha'],
 ['6-1200','Komisi OTA & Platform','EXPENSE','Beban usaha'],
 ['6-1300','Pemasaran & Promosi','EXPENSE','Beban usaha'],
 ['6-1400','Listrik, Air & Internet (Umum)','EXPENSE','Beban usaha'],
 ['6-1500','Perawatan & Perbaikan','EXPENSE','Beban usaha'],
 ['6-1600','Sewa','EXPENSE','Beban usaha'],
 ['6-1700','Transportasi & BBM','EXPENSE','Beban usaha'],
 ['6-1800','Pajak, Perizinan & Retribusi','EXPENSE','Beban usaha'],
 ['6-1900','Administrasi, Bank & Perlengkapan Kantor','EXPENSE','Beban usaha'],
 ['6-2000','Beban Usaha Lainnya','EXPENSE','Beban usaha'],
 ['6-3000','Beban Penyusutan','EXPENSE','Beban usaha'],
 ['7-1100','Pendapatan Bunga & Pendapatan Lain-lain','REVENUE','Pendapatan dan beban lain-lain'],
 ['7-2100','Beban Bunga & Beban Lain-lain','EXPENSE','Pendapatan dan beban lain-lain'],
 ['8-1000','Beban Pajak Penghasilan (PPh Final)','EXPENSE','Pajak penghasilan'],
];
const byCode=new Map(definitions.map(([code,name,type,group])=>[code,{code,name,type,group}]));
function catalog(rows){return rows.filter(r=>r.account_code!=='6-3000').map(r=>({...r,group:byCode.get(r.account_code)?.group||'Akun historis',legacy:!byCode.has(r.account_code)}));}
function inputAccounts(rows){const all=catalog(rows);return all.some(r=>!r.legacy)?all.filter(r=>!r.legacy):all;}
function transactionAccount(value,rows,txType){
 if(typeof value!=='string'||!value.trim())throw Error('Pilih kode akun COA sesuai transaksi');
 const row=rows.find(r=>r.id===value);
 if(!row)throw Error('COA tidak ditemukan');
 if(row.account_code==='6-3000')throw Error('Penyusutan dicatat lewat jurnal non-kas, bukan input nota');
 if(row.account_type!==(txType==='INCOME'?'REVENUE':'EXPENSE'))throw Error('Jenis transaksi tidak sesuai kode akun COA');
 return row;
}
module.exports={definitions,byCode,catalog,inputAccounts,transactionAccount};
