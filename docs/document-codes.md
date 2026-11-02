# Nomor dokumen AMC

Kode laporan dan kode unit baru terdiri dari 2–4 huruf kapital. Form tambah cabang memberi saran 3 huruf dari nama; Owner dapat menggantinya sebelum menyimpan. Kode unit unik juga terhadap cabang arsip, kode lama yang dipetakan, dan override administrasi. AMC khusus laporan keseluruhan perusahaan. Kode unit eksplisit milik Owner dipakai apa adanya, termasuk pada cabang bernama RedDoorz.

Laporan: `(kode laporan)/(kode unit)/(bulan Romawi)/(tahun)/(urutan minimal 3 digit)`.

Contoh: `NRC/AMC/X/2026/001`, `NRC/RD/X/2026/001`, `LBR/RD/X/2026/001`.

| Laporan | Kode |
| --- | --- |
| Neraca / posisi keuangan | NRC |
| Laba rugi, termasuk perbandingan | LBR |
| Pendapatan dan beban | PNB |
| Arus kas | AKS |
| Rincian beban | RBP |
| Kinerja cabang | KCB |
| Pertanggungjawaban cabang | PJC |
| Anggaran dan realisasi | ANG |
| Ringkasan pajak | PJK |
| PPN | PPN |
| PPh 21 | PPD |
| PPh final | PPF |
| PBJT | PBJ |
| UMKM | UMK |
| Checklist pajak | KPP |
| Buku/register umum | BKU |
| Laporan manajemen | MGT |
| Bukti audit | BKT |
| Pengajuan dana | PDN |
| Closing harian | CLS |
| Laporan triwulan Owner | LTP |
| Data triwulan | DTP |

Slip: `SLIP/(kode unit)-(kode departemen)/(bulan Romawi)/(tahun)/(ID karyawan)`.

Contoh: `SLIP/AMC-HO/X/2026/001`, `SLIP/RD-OPS/X/2026/002`. ID angka dipenuhi nol di depan sampai minimal tiga digit; ID alfanumerik tetap lengkap, tidak diganti nomor acak atau ID entri slip. HO dan OPS dipakai untuk Head Office dan Operasional. Departemen lain memakai tiga huruf awal; kode departemen tersimpan harus 2–4 huruf. Kedua jenis slip, umum dan laundry, memakai pembentuk nomor yang sama.

Nomor terbit lama tetap utuh. Database mengalokasikan nomor laporan secara atomik dan menyimpan hubungan dengan filter, Owner, serta kunci percobaan ulang. Unduh ulang dengan identitas dokumen yang sama tidak mengalokasikan ulang nomor. Permintaan ekspor API harus menyertakan `document_id`; frontend menerbitkannya melalui `/api/documents/issue` sebelum ekspor. Pembacaan laporan biasa tetap read-only.

Migration 019 menambahkan resolver kode unit privat dan aturan kode laporan baru; migration 020 menambahkan registrasi unit khusus Owner. Migration 021 mengizinkan pemilik fungsi penomoran lama memanggil resolver jika role administrator migrasinya berbeda; runtime dan PUBLIC tetap tidak mendapat akses langsung. Perubahan ini tidak mengubah isi ledger, gaji, direktori, unit lama, nomor terbit lama, atau antrean pengiriman.
