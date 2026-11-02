# Slip Gaji: template, pemeriksaan penerima, dan dokumen

Revisi 2 November 2026. Pengaturan SMTP/domain/catch-all karyawan ditunda sesuai instruksi Owner. Provider email, kredensial email, master email dan antrean payroll tidak diubah. Rilis aplikasi a81d236 sudah dipasang pada production/staging; konteks dan kebijakan output file Hermes diperbarui terpisah dengan backup.

## Menu dan template

- Menu Owner **Slip Gaji** berada di sidebar Reporting. Identitas perusahaan tetap di Device & Cabang > Perusahaan; direktori di Karyawan. Staff/device tidak mendapat menu atau akses endpoint payroll.
- Template CSV umum/laundry mengisi komponen nominal rupiah. Backend menghitung total tambahan, potongan dan take-home pay dengan aturan yang sudah ada. CSV tidak menyimpan rumus Excel.
- Template XLSX umum/laundry mempunyai Database dan Slip Gaji, selector periode/ID, formula total dan terbilang. Perhitungan dan variabel sebelumnya dipertahankan. XLSX untuk pengisian/perhitungan; jalur upload dashboard menerima CSV atau PDF.

## Alur upload

1. `POST /api/employee-payroll/review` memeriksa CSV atau PDF. Belum membuat draft atau memanggil provider email.
2. CSV memakai ID karyawan yang persis sama dengan direktori. Kolom tambahan terakhir `email` boleh disertakan, tetapi tidak dapat mengganti email master.
3. PDF dibatasi satu slip/satu halaman, teks terbaca, maksimal 256 KB. Field berlabel Nama Karyawan, ID/ID Karyawan, dan Periode harus jelas dan cocok. Periode menerima YYYY-MM atau nama bulan Indonesia beserta tahun; pilihan periode harus sama. PDF scan, terenkripsi/tidak terbaca, beberapa identitas, beberapa halaman, JavaScript atau lampiran tambahan ditolak. Parser berjalan dalam child process sekali pakai dengan batas 192 MB dan 12 detik; tidak menjalankan action PDF.
4. Email sumber dibandingkan dengan direktori. Jika tidak ada email dalam PDF, UI menampilkan email master beserta warning wajib pemeriksaan ulang. Email master kosong/ganda atau alamat berbeda/multiple di PDF memblokir penyimpanan draft. Email kop perusahaan ikut dianggap alamat sumber; kasus beberapa alamat memerlukan koreksi dokumen, bukan tebakan penerima.
5. Owner memeriksa identitas dan penerima, lalu mencentang persetujuan **Simpan Draft**. Token HMAC terikat sesi, isi sumber, snapshot master/profil, alamat kop dan masa berlaku 10 menit. Import mengulangi pemeriksaan; perubahan sumber/master atau token ditolak.
6. **Tinjau dengan Widya AI** memasukkan file dan hasil pembanding ke sesi Widya yang tersimpan menggunakan endpoint sesi/Hermes yang sudah ada. Hasil AI adalah tinjauan tambahan; tidak mengganti ID/email atau memberi izin kirim. Prompt meminta pemeriksaan saja, tanpa pengiriman atau perubahan data. Tidak ada endpoint baru yang memberi AI kewenangan mengubah penerima.
7. Penerbitan draft dan pengiriman adalah dua konfirmasi berbeda. Saat mengirim, server memeriksa lagi status terbit, email, nama, departemen, unit, revision dan keunikan penerima. SQL FENCE mengunci master sebelum provider dipanggil. Perubahan master memblokir pengiriman, bukan memperbarui penerima secara diam-diam.
8. Satu email membawa satu PDF. PDF unggahan disimpan dalam payload AES-GCM dan dikirim persis seperti aslinya; tidak direkonstruksi dari perkiraan AI. Base64 PDF tidak dikembalikan pada daftar/hasil review dan tidak dimasukkan ke workbook komponen gaji.
9. Outbox unik mencegah pengiriman ganda. Status `sent` berarti diterima provider, bukan bukti masuk inbox. Hasil tidak pasti menjadi `uncertain`, tanpa retry otomatis. Penanganan error menggunakan kembali client DB setelah rollback agar tidak menunggu client kedua ketika pool penuh.

## Footer yang disetujui Owner

Wording bersama berada di `public/document-approval.js`. Laporan PDF, slip PDF hasil aplikasi, serta worksheet laporan/slip XLSX menggunakan dua kolom WIDYA dan Direktur, ruang tanda tangan, garis pemisah dan catatan tanggung jawab hukum sesuai kiriman Owner. Area ini bukan gambar tanda tangan atau sertifikat tanda tangan digital. PDF unggahan dipertahankan sebagai dokumen sumber; tidak diberi pengesahan tambahan secara otomatis. CSV tetap format data/import dan tidak diberi baris tanda tangan yang mengubah struktur datanya.

## Validasi dan batas

- Tes unit, browser, HTTP server dan prosedur PostgreSQL berjalan pada fixture terisolasi dengan provider email palsu/offline.
- PDF.js dipin `6.5.438`; produksi Node 24 memenuhi kebutuhan runtime. Rilis berikutnya harus menginstal dependency lockfile; jangan hanya memakai symlink node_modules dari rilis lama yang belum memiliki pembaca PDF.
- Microsoft Excel membuka dan menghitung ulang 48 varian XLSX tanpa error formula; dua slip PDF dirender dan ditinjau. Pagination cetak PDF dari Excel belum diverifikasi karena host tidak memiliki printer.
- Audit awal VPS dilakukan read-only, kemudian deploy diotorisasi Owner. Production dan staging kini memakai rilis a81d236. Staging telah dimigrasikan ke 18 migrasi dengan database/login terpisah, env terisolasi dan pin rilis immutable. Email/worker/Hermes staging nonaktif. Production tidak menerima migrasi baru atau perubahan data gaji.
- Teks PDF dapat dimanipulasi secara visual; pencocokan teks tidak menggantikan pemeriksaan dokumen oleh Owner. Tes live Hermes menggunakan PDF/JSON payroll simulasi dan berhasil membaca identitas, email kosong, membuat output file dan mempertahankan sesi. Satu file TXT simulasi dikirim lewat Hermes native ke Radit untuk memverifikasi transport Telegram; tidak ada payroll/email nyata dikirim. Lihat docs/widya/telegram-native-files.md untuk batas acceptance dan rollback.
