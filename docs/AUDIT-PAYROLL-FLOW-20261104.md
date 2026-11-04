# Audit alur slip gaji — 4 November 2026

## Temuan dan perbaikan

- TAHAN pada tangkapan layar adalah penolakan slip ganda karyawan/periode, bukan kegagalan tombol. November 2026 sudah terbit; jangan mengunggah ulang untuk membuat slip kedua.
- Hasil pemeriksaan sebelumnya mencampur alasan, kode internal, hitungan panjang dan identitas dalam paragraf. Tampilan kini mendahulukan status, alasan, penerima, lalu langkah berikutnya. Catatan lengkap dapat dibuka. Kode internal diterjemahkan, isi AI di-escape, nomor karyawan publik dipakai konsisten.
- Tambah tombol Buka Riwayat Slip untuk duplikasi. Simpan Draft tetap dikunci sampai LANJUT tanpa blocker dan konfirmasi pengguna. Blocker selalu mengalahkan jawaban AI LANJUT.
- Pembaca PDF hanya mengenali ID Karyawan, sementara PDF aplikasi mencetak No. Karyawan dan nomor register publik. Parser kini menerima keduanya dengan tepat satu kecocokan aktif. Duplikasi identitas, kecocokan ambigu, periode salah dan karyawan nonaktif tetap ditolak.
- Modul payroll yang disisipkan dalam dashboard dan berkas terpisah kini sama; test mencegah perbedaan implementasi berikutnya.

## Uji tombol melalui Codex Browser

Seluruh tindakan berikut diuji pada fixture lokal berisi karyawan fiktif dan transport email simulasi. File unduhan fixture membuktikan wiring tombol; bukan pengesahan struktur seluruh workbook produksi.

| Tahap | Hasil |
| --- | --- |
| Enam tombol template umum/laundry CSV, Excel perhitungan, Excel kosong | Memicu unduhan |
| Pilih file PDF + periode, Periksa File | Pemeriksaan dimulai, hasil ditampilkan |
| TAHAN / blocker / duplikasi | Simpan Draft dan konfirmasi dikunci |
| LANJUT + konfirmasi | Simpan Draft bekerja, berpindah ke Riwayat Slip |
| Unduh Slip | PDF diunduh |
| Konfirmasi Terbitkan Slip | Terbitkan bekerja, tombol kirim masih memerlukan konfirmasi penerima |
| Konfirmasi Kirim Email | Transport simulasi diterima, pengiriman ulang diblokir |
| Muat ulang status, tab Input/Riwayat | Bekerja |
| Gangguan polling + Periksa Status Widya | Pulih melalui review yang sama |
| Buka Riwayat Slip dari hasil duplikasi | Membuka tab riwayat |
| Tampilan kecil | Tidak ditemukan overflow horizontal, kartu penerima menjadi dua kolom pada viewport efektif 488 px |

## Verifikasi produksi dan batas audit

Pembacaan read-only tabel dan proses service di VPS menunjukkan dua slip tersimpan, keduanya PUBLISHED, status email sent, recipient_valid true; konfigurasi email memenuhi readiness aplikasi. Ini status database/provider yang tercatat, bukan bukti email dibaca atau masuk inbox.

Tidak ada payroll baru, penerbitan baru, perubahan direktori, atau email nyata baru pada audit ini. Sesi Owner QA yang tersedia masih dibatasi penggantian password; audit interaksi lengkap tidak dilakukan melalui sesi Owner produksi. Pemeriksaan UI menggunakan fixture, sedangkan parsing PDF dan kontrak backend diuji di runtime VPS sebelum aktivasi release. Jangan menyatakan pengiriman provider nyata baru sudah lulus dari hasil simulasi.

Rollback menggunakan symlink release sebelumnya dan restart sipeka.service. Patch tidak memerlukan migrasi atau perubahan ciphertext payroll.


## Penyempurnaan riwayat dan catatan Widya

Dua subagent GPT-6.1 Sol medium mengerjakan layout dan audit perilaku tombol. Tabel riwayat diganti kartu karyawan dengan ringkasan nominal, rincian tambahan/potongan yang dapat dibuka, area unduh/kirim, dan footer konfirmasi penerbitan. Tautan Lanjut ke konfirmasi penerbitan memfokuskan checkbox tanpa mencentangnya. Periode ditulis sebagai nama bulan. Tombol menampilkan Menerbitkan/Mengirim saat permintaan berjalan.

Catatan AI sesudah tanda titik dua kini menampilkan daftar menjorok; angka rupiah dan email dipertahankan utuh. Modul payroll disinkronkan dengan implementasi dashboard yang disisipkan. Stylesheet history tersendiri disisipkan ke halaman.

Tidak ditemukan tombol publish/send yang kehilangan handler. Penonaktifan sebelum konfirmasi, sebelum terbit, untuk penerima tidak cocok, atau setelah kirim adalah pengamanan yang disengaja. Tiga regression test tambahan memverifikasi eligibility, isolasi busy antar batch/penerima, serta penolakan hasil refresh lama. Dua puluh tiga tes lokal lulus dengan PDF parser dan PostgreSQL terisolasi. Codex Browser juga memverifikasi draft -> unduh -> konfirmasi -> terbit -> konfirmasi penerima -> kirim simulasi -> kirim ulang diblokir, tautan konfirmasi, dan penerima tidak valid. Tidak ada browser lain yang diluncurkan; percobaan test UI subagent berhenti sebelum browser terbuka karena dependency tidak tersedia. Viewport efektif 488 px tidak overflow horizontal.

Tidak ada email nyata atau payroll produksi baru pada penyempurnaan ini.


## Kirim Massal

Batch terbit memiliki konfirmasi Kirim Massal dan tautan dari header batch. Saat konfirmasi dicentang, daftar ID dan email yang memenuhi syarat dibekukan. UI menjalankan POST pengiriman per slip secara berurutan melalui route yang sudah ada; tidak ada endpoint panjang, worker, atau perubahan skema. CLAIM/FENCE dan validasi penerima tetap berlaku pada setiap permintaan. Slip yang sudah diproses, sedang diproses, meragukan, atau tidak cocok dengan direktori tidak dimasukkan. Tidak ada retry otomatis. Navigasi/abort menghentikan permintaan berikutnya; permintaan yang sudah berjalan tetap mengikuti status server. Muat ulang dan penerbitan menunggu bulk selesai; hasil dan jumlah yang tersisa ditampilkan per batch.

Dua puluh delapan tes lokal lulus tanpa skip, termasuk sepuluh penerima berbeda pada PostgreSQL terisolasi, klaim bersamaan, perubahan direktori, kegagalan sebagian, karantina uncertain, restart, frozen confirmation, urutan per item, dan cleanup setelah abort. Tidak menggunakan browser lain selain Codex Browser.

Uji pengiriman nyata terpisah: sepuluh karyawan/PDF fiktif, seluruhnya menuju satu inbox yang secara eksplisit ditentukan Owner. UI Kirim Massal yang sama diuji dengan adapter QA localhost ke transport email VPS; sepuluh provider acceptance receipt tersimpan, tidak ada uncertain. Subjek dan dokumen ditandai DATA UJI/UJI MASSAL. Ini bukan sepuluh record karyawan/payroll produksi dan bukan bypass kontak produksi. Direktori produksi tetap mewajibkan email unik. CSV QA dengan email yang sama tidak untuk diimpor langsung ke direktori produksi. Receipt bukan bukti masuk inbox atau dibaca. Bukti berisi alamat/provider ID disimpan hanya di output operator, tidak di repository.
