# Tampilan email slip gaji

Email umum dan laundry memakai surat singkat yang sama: perusahaan, penerima/email tujuan, perihal, salam, isi, informasi dokumen, penutup, dan WIDYA sebagai Head of Finance & Accounting (AI System). Nama perusahaan dan nomor dokumen mengikuti snapshot slip. Rincian gaji tetap berada pada PDF; email tidak menyatakan pembayaran sudah terjadi.

Header ilustrasi ditempel sebagai gambar CID `amc-payroll-header` dari aset lokal tetap `assets/payroll-email-header.png`. Tidak ada URL gambar eksternal atau tracking pixel. Plain text tetap lengkap saat gambar/HTML tidak ditampilkan.

Pengiriman terdiri dari satu PDF utama dan satu gambar PNG inline. Batas PDF 256 KiB, pemeriksaan domain, identitas penerima, konfirmasi, idempotensi, serta status uncertain tetap berlaku. Transport hanya mengizinkan bytes gambar yang sama persis dengan aset terpercaya; bukan path atau lampiran gambar bebas.

Helper Widya operator versi `email-visual-v3` harus dipasang bersama release ini karena versi sebelumnya tidak meneruskan lampiran inline. Wrapper tetap root-only dan permintaan kirim tetap memerlukan approval file Owner yang terlindungi. Tidak ada pengiriman email otomatis ketika deploy atau pengujian.

## Aset gambar

Dibuat melalui built-in image_gen; ukuran asli 2172 × 724. Prompt final:

> A refined wide 3:1 banner illustration for official employee salary-slip notification emails from CV Artha Multi Ciptanusa, sent by Widya Finance & Accounting. Minimal premium editorial still-life of neatly arranged ivory paper documents, subtle embossed ledger grid details, a graphite envelope, a brushed silver paperclip and a soft gray architectural frame, on an off-white background. Spacious left and center, stationery cluster to the right. Soft natural lighting, realistic paper texture. No text, numbers, logos, signatures, people, currency symbols, blue or watermark.

## XLSX

Laporan dan kedua Excel gaji memakai garis tabel abu-abu yang benar-benar tercetak, bukan mengandalkan gridlines Excel. Header/subtotal/total memiliki pembeda. Kop, catatan, dan tanda tangan tetap bersih. Kolom laporan dibuat lebih ringkas dan laporan lebih dari tiga kolom memakai landscape. Nama dan metadata karyawan membungkus teks agar tidak menimpa kolom lain.

Verifikasi mencakup buka normal read-only di Microsoft Excel 16.0 untuk enam keluaran. Formula, ID teks dengan nol depan, nilai nol, gaji bersih, dan terbilang diperiksa di Excel asli; renderer preview memiliki keterbatasan pada tampilan lookup nol dan ID. Print preview native tidak dapat diuji pada mesin tanpa printer terpasang.
