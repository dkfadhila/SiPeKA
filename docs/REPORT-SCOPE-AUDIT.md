# Audit template dan pilihan lingkup laporan — 24 Oktober 2026

## Template tambahan
Tiga berkas dari Downloads identik byte-per-byte dengan template versi Git yang sudah digunakan SiPeKA:

| Berkas | Sheet utama | Rumus | Sel error tersimpan | SHA256 |
|---|---|---:|---:|---|
| 01_Laporan_Posisi_Keuangan.xlsx | Posisi Keuangan | 22 | 0 | b3494bfb91906e8b2f755e98ecb64a450b1aee73697d81df8105d1459e7bd383 |
| 03_Laporan_Laba_Rugi.xlsx | Laba Rugi | 144 | 0 | 52719fb22200becddf35a46d27801e7ad8aeb9f4a47d8ade93b9cb5815c43a3b |
| 04_Laporan_Arus_Kas.xlsx | Arus Kas | 16 | 0 | 5e8f0846bd3ae27eed99ad986c00da8cd06c1655660df323c1513a2bd45362b7 |

Masing-masing memiliki sheet Petunjuk & Catatan. Tidak ada referensi formula eksternal. Ini pemeriksaan sumber OOXML dan nilai tersimpan; bukan bukti saldo sumber sudah lengkap atau rekalkulasi Excel asli. Berbeda dari contoh Google Sheet April/November dengan referensi rusak yang diaudit sebelumnya.

## Perubahan aplikasi
Filter Tampilan laporan menawarkan satu perusahaan/semua cabang, per cabang, dan perbandingan cabang. Cabang serta periode WIB yang dipilih ikut ke permintaan data, pratinjau, PDF, Excel, CSV, manifest dan nama unduhan. Cache turut dibedakan menurut mode. Server menolak kombinasi scope yang bertentangan dan parameter mode duplikat.

PnL gabungan dan tiap cabang memakai sumber perhitungan yang sama. Cabang historis tetap ikut dalam lingkup perusahaan; unit tanpa transaksi tidak hilang. PnL lebih dari enam unit dilanjutkan pada panel/worksheet berikutnya. Neraca perbandingan memakai tiga unit per panel dengan debit/kredit terpisah; arus kas memakai enam unit per panel. Kolom perusahaan diulang untuk kenyamanan membaca panel, tetapi CSV memuat kolom total perusahaan sekali saja. Header CSV laporan keuangan menggunakan label pos/cabang agar dapat dipahami tanpa membuka metadata terpisah.

Akun tetap menjadi basis internal; laporan dan unduhan menyajikan pos ringkas tanpa kode/daftar akun. Format polos yang sudah disetujui dipertahankan. Excel standar tetap mencakup pembanding periode dan margin PnL yang sebelumnya tersedia; tampilan perbandingan neraca/arus kas berfokus pada cabang dan total perusahaan pada periode pilihan.

## Batas data dan audit
Neraca belum punya sumber saldo awal/akhir, aset, kewajiban dan ekuitas terverifikasi. Arus kas template belum punya pemetaan operasi/investasi/pendanaan serta rekonsiliasi saldo awal/akhir yang lengkap. Pilihan lingkup tidak mengubah keterbatasan tersebut: kosong/Belum tersedia dipertahankan, bukan diberi nol atau angka penyeimbang. Pendapatan tercatat dan arus kas operasional bukan bukti laporan akrual lengkap. Gabungan merupakan agregasi catatan; eliminasi transaksi antarunit belum memiliki dataset tersendiri.

Payroll tidak diubah atau diposting otomatis melalui perubahan ini. Tidak ada migrasi schema, penulisan transaksi, pemetaan ulang sejarah, atau perubahan kredensial. File gaji Google Sheet ketiga masih memerlukan akses terpisah agar rumus detailnya dapat diaudit.

## Verifikasi
Tes baru memeriksa penolakan mode invalid/duplikat, agregat perusahaan = jumlah delapan kolom cabang, isolasi satu cabang, cabang historis, panel lanjutan, CSV total tunggal, Excel tanpa akun, saldo tak tersedia, serta mode/periode pada UI dan PDF nyata jsPDF. Lebar desktop/tablet/mobile diperiksa. Suite laporan dan regresi Widya/payroll/UI yang relevan dijalankan; bukti rilis dan pemeriksaan VPS disimpan di luar Git. Release mengikuti tes -> GitHub -> VPS, backup dan readiness/public-source verification. Helper baca Widya perlu provisioning ulang setelah pergantian release untuk ACL berkas kode baru.
