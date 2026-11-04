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
