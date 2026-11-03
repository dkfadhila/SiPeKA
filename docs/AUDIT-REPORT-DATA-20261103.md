# Ketersediaan data laporan — 3 November 2026

Audit read-only production: 103 transaksi operasional disetujui, 37 akun akuntansi, 0 jurnal akuntansi dan 0 baris jurnal. Tidak mencetak identitas karyawan, kredensial, atau rincian penerima.

## Mengapa masih “Belum tersedia”

Transaksi pemasukan/pengeluaran membuktikan mutasi yang tercatat. Transaksi tersebut belum membentuk saldo pembukaan, piutang, persediaan, aset, utang, serta ekuitas. Template neraca saat ini sengaja tidak menurunkan saldo aset/utang/modal dari arus kas; sumber saldo akuntansi belum diintegrasikan ke renderer neraca. Mengunggah berkas referensi template saja tidak mengimpor saldo.

Pada laba rugi, biaya penyusutan saat ini belum memiliki sumber data. Karena penyusutan termasuk beban operasional, ketidaktersediaannya diteruskan ke total beban dan laba bersih. Untuk menghitung hasil akhir diperlukan daftar aset dan perhitungan penyusutan, atau konfirmasi akuntansi yang didukung bukti bahwa penyusutan periode tersebut memang nol. Slip gaji yang disiapkan/dikirim juga belum otomatis menjadi beban gaji; pengeluaran/jurnal gaji perlu dicatat pada periode yang sesuai.

Laporan Anggaran & Realisasi membutuhkan rencana anggaran per pos/cabang/periode. Ringkasan Pajak membutuhkan dasar pengenaan, jenis pajak, perhitungan kewajiban dan pembayaran. Keduanya belum memiliki sumber lengkap, sehingga fitur unduh menunggu kelengkapan data.

| Pos laporan | Data yang perlu disiapkan per unit/cabang dan tanggal posisi |
| --- | --- |
| Kas dan bank | Saldo awal masing-masing kas/rekening, mutasi lengkap sampai tanggal posisi, hasil cocok rekening koran dan kas fisik |
| Piutang | Daftar tagihan belum lunas, tanggal dan saldo tersisa |
| Persediaan | Saldo stok dan nilai persediaan dari stok opname/penilaian pada tanggal posisi |
| Biaya dibayar di muka | Nilai pembayaran, masa manfaat, sisa nilai belum dibebankan |
| Aset tetap dan penyusutan | Daftar aset, unit pemilik, harga/tanggal perolehan, umur manfaat/metode penyusutan dan akumulasi penyusutan |
| Utang dan pinjaman | Saldo utang pemasok, utang gaji/pajak, pinjaman, pendapatan diterima di muka beserta tanggal dan rinciannya |
| Ekuitas | Modal disetor, laba ditahan awal periode, prive, serta hasil usaha yang telah ditutup dan diverifikasi |
| Saldo awal/akhir arus kas | Saldo awal kas/bank, seluruh arus kas, dan rekonsiliasi saldo akhir |
| Investasi/pendanaan | Transaksi pembelian/penjualan aset, setoran/penarikan modal, penerimaan/pembayaran pokok pinjaman dengan klasifikasi terverifikasi |
| Pajak penghasilan P&L | Perhitungan dan nominal pajak periode bersangkutan; omzet kas tidak cukup untuk menetapkannya |
| Pembanding periode | Data periode sebelumnya pada cakupan cabang yang sama |

Format bahan yang disarankan: tanggal posisi, kode unit, nama pos, nominal Rupiah, dan referensi bukti. Seluruh cabang menggunakan tanggal pembukaan yang sama. Transfer antarunit perlu ditandai untuk menghindari penghitungan ganda dalam konsolidasi.

Pendapatan, beban dan mutasi kas yang tersedia tetap dihitung dari sumber transaksi sesuai filter. Nol berarti tidak ada nominal tercatat pada sumber yang didukung; “Belum tersedia” berarti belum ada sumber yang memadai. Dokumen laporan belum membuktikan neraca lengkap atau saldo bank telah direkonsiliasi.

Pekerjaan selanjutnya setelah data diterima: validasi saldo pembukaan, pemetaan pos/akun per cabang, impor melalui alur yang ditinjau, integrasi sumber saldo ke laporan, dan rekonsiliasi. Audit ini tidak membuat saldo, jurnal, atau angka pengganti.
