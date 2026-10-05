# SiPeKA — Checklist Uji Setelah Deploy VPS

## Tujuan
Panduan agent berikutnya untuk membuktikan deployment bekerja dan aman sebelum VPS dibuka ke publik. **Checklist ini belum dijalankan pada VPS.** Centang hanya dengan bukti nyata; jangan menyamakan HTTP 200 atau deployment sukses dengan seluruh fitur aman.

## Konteks handoff
- Project: `D:/FamilyAgent/Nox/workspace/sipeka-backend`.
- Backend: `server.js`; SQLite/schema: `db.js`; frontend: `public/financial-dashboard.html`.
- Commit hardening lokal: `a61977f`. Pada saat handoff, belum push/deploy.
- Style lama yang disetujui wajib dipertahankan; CSV bisnis dan PDF profesional 15 kategori sudah terpasang.
- Lokal sudah diuji: backend integration 219/219, frontend integration 15/15, parent E2E 10/10, reports/settings 50 kasus dan 30 unduhan. Bukti tersebut **bukan** verifikasi VPS/TLS/upstream asli.
- Dokumen terkait: `docs/HARDENING_STATUS.md`, `docs/BACKEND_REPORTS_GUIDE.md`, `docs/reports-contract.json`.
- Artefak audit lokal: `D:/FamilyAgent/Flora/generated/sipeka-hardening/`.

## Aturan pengujian
- [ ] Catat domain, IP, OS, versi Node, commit, waktu UTC/WIB dan nama pemeriksa tanpa mencatat rahasia.
- [ ] Gunakan staging privat dengan akun Owner/Staff disposable dan data bertanda TEST. Jangan menguji write pada data keuangan produksi.
- [ ] Backup dan validasi restore sebelum migrasi atau pengujian write; backup DB dan bukti privat disimpan terpisah dari public web root.
- [ ] Jangan masukkan password/token/key pada Markdown, Git, screenshot, output terminal atau laporan. Masukkan lewat mekanisme kredensial aman.
- [ ] Jangan menghapus/mengubah akun existing tanpa persetujuan. Jangan menghapus ledger untuk cleanup; pakai DB staging terpisah atau reversal sesuai kebijakan.
- [ ] Jika ditemukan kebocoran atau akses lintas pengguna, hentikan pembukaan publik; simpan reproduksi aman dan perbaiki di staging.

## Jalur release wajib: GitHub dahulu, baru VPS
Aturan Tirta untuk setiap versi kode baru SiPeKA:
1. Edit lokal dan jalankan tes yang relevan.
2. Commit + push ke `dkfadhila/SiPeKA`; verifikasi hash commit remote sama dengan release lokal.
3. Setelah push berhasil, VPS mengambil release dari GitHub (git fetch/pull atau checkout commit yang disetujui).
4. Install dependency/build/migrasi bila diperlukan; backup dan uji migrasi sebelum perubahan DB.
5. Restart layanan SiPeKA saja; uji health/login/fitur dan rollback ke commit sebelumnya jika gagal.
**Push bukan deploy otomatis** sampai CI/CD dikonfigurasi. Jangan upload kode lokal yang belum berhasil di-push sebagai pengganti jalur ini.
DB, `.env`, SSH key, token dan bukti privat tetap di luar Git dan folder release; update kode tidak boleh menimpa data persisten.

## 1. Deployment dan proses
- [ ] Commit VPS cocok dengan release yang disetujui; perubahan lokal belum ter-push tidak dianggap sudah terdeploy.
- [ ] Node target mendukung `node:sqlite`; dependency install dan syntax check `node --check server.js` / `node --check db.js` lulus.
- [ ] Aplikasi berjalan sebagai service account non-root; systemd/PM2 hanya mengelola proses SiPeKA.
- [ ] `HOST=127.0.0.1`, `PORT=4321` atau port yang disepakati; port aplikasi tidak terbuka langsung dari internet.
- [ ] `GET /api/health` menghasilkan JSON `ok:true`; proses/log tidak memuat password atau token.
- [ ] Restart service memulihkan aplikasi tanpa kehilangan akun/transaksi/bukti; auto-start setelah reboot diuji dengan izin.
- [ ] Simulasi crash proses pada staging direstart supervisor; tidak ada restart loop/OOM atau port/proses ganda.

## 2. Reverse proxy, HTTPS dan jaringan
- [ ] Validasi konfigurasi Nginx dengan `nginx -t` pada VPS; template lokal bukan bukti syntax valid.
- [ ] Sertifikat valid untuk domain; HTTP redirect ke HTTPS; perpanjangan sertifikat diuji.
- [ ] Firewall hanya membuka port layanan yang dibutuhkan; SSH dibatasi sesuai kebijakan; 4321/DB/gateway internal tidak publik.
- [ ] Respons memuat `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, Referrer-Policy dan CSP sesuai release.
- [ ] Font Google, gambar login WebP, script PDF dan unduhan Blob bekerja tanpa pelanggaran CSP yang memutus fitur.
- [ ] Tidak ada CORS wildcard; origin asing tidak mendapat izin. Jangan menambah wildcard untuk menutupi salah konfigurasi proxy.
- [ ] Body limit proxy konsisten dengan aplikasi: JSON biasa 1 MB, endpoint gambar sekitar 8 MB; oversize mendapat 413 dan server tetap hidup.
- [ ] Timeout proxy cukup untuk AI/OCR (request aplikasi sampai 90 detik), tetapi tidak membiarkan koneksi tak terbatas.
- [ ] **Rate-limit proxy:** backend saat ini memakai `remoteAddress`. Di belakang Nginx, banyak user bisa dianggap satu IP. Uji dua klien berbeda; konfigurasi limiter/trusted-proxy harus eksplisit dan tidak percaya X-Forwarded-For dari internet sembarangan.
- [ ] Bila CSP masih `unsafe-inline`, catat sebagai hardening lanjutan; jangan klaim sudah nonce-based.

## 3. Penyimpanan, migrasi dan backup
- [ ] `DB_PATH` persisten, misalnya `/var/lib/sipeka/sipeka.db`; bukan `/tmp` Vercel dan bukan direktori release yang diganti saat deploy.
- [ ] `UPLOADS_DIR` persisten di luar public root, misalnya `/var/lib/sipeka/receipts`; permission hanya service account yang diperlukan.
- [ ] Direktori sudah dibuat dan writable oleh service account sebelum startup.
- [ ] Migrasi diuji pada salinan DB; jumlah akun/unit/transaksi/closing dan identitas record dibandingkan sebelum/sesudah.
- [ ] Akun existing tidak di-seed ulang. `SIPEKA_SEED=0`; provision Owner pertama hanya opt-in melalui env rahasia pada DB kosong, lalu nonaktifkan.
- [ ] Sesi legacy tanpa expiry dicabut sesuai migrasi; pengguna diberi tahu untuk login ulang.
- [ ] Backup SQLite menggunakan online backup API atau mekanisme konsisten WAL; bukan hanya menyalin `sipeka.db` saat aktif.
- [ ] Restore ke DB staging baru berhasil; `PRAGMA integrity_check` dan `foreign_key_check`, jumlah record dan relasi bukti diverifikasi.
- [ ] Retensi/jadwal backup, permission, penyimpanan off-host dan prosedur rollback tercatat.
- [ ] Legacy receipt `/uploads/*` tidak dimigrasikan otomatis. Jika ada, tentukan pemetaan owner/cabang dan migrasi privat secara terpisah; jangan membuka kembali akses publik.

## 4. Login, sesi dan akun
- [ ] Password existing/default telah diganti sebelum publik tanpa mencatat passwordnya; DB baru tidak membuat Owner default otomatis.
- [ ] Login valid bekerja; password salah, username tidak ada, token salah dan request tanpa auth ditolak.
- [ ] Burst login staging mendapat 429; setelah jendela limit berakhir login kembali bekerja. Uji keterpisahan dua pengguna/IP di belakang proxy.
- [ ] `SESSION_TTL_HOURS` valid (default 12 jam); sesi expired ditolak memakai UTC, tidak bergantung timezone OS.
- [ ] Logout sidebar dan topbar benar-benar memanggil `/api/logout`, menghapus token/cache/DOM sensitif dan tidak bisa replay token lama.
- [ ] Ganti sandi sukses menghasilkan `logout_required:true`, memaksa re-login; seluruh token lama akun itu ditolak.
- [ ] Owner reset sandi Staff mencabut sesi Staff; sesi pengguna lain tidak ikut berubah.
- [ ] Pergantian akun/role tidak mempertahankan data Owner, receipt blob, cache laporan atau halaman restricted.
- [ ] Request malformed JSON/null/array, COA tidak sah dan nominal tidak aman mendapat error terkontrol; health tetap hidup.

## 5. RBAC dan XSS
- [ ] Staff hanya melihat transaksi sendiri hari berjalan WIB dan cabang penugasan; Owner scope semua/per cabang benar.
- [ ] Staff ditolak endpoint Users, tambah cabang, reset akun, approval, performance dan chat Owner.
- [ ] Owner tidak mendapat form closing dan POST `/api/closing` ditolak 403; Slip Gaji masih Coming soon khusus Owner.
- [ ] Catatan/nama dummy yang mengandung karakter HTML muncul sebagai teks di ledger, drawer, pengguna, closing dan laporan; tidak mengeksekusi script.
- [ ] Nilai untrusted/response AI tidak disisipkan sebagai HTML mentah. URL `javascript:`, domain asing, traversal, query receipt tidak diizinkan.
- [ ] Session token tidak muncul pada URL, dokumen ekspor, DOM receipt link atau log.

## 6. Transaksi dan approval
- [ ] Owner pilih cabang konkret; Staff otomatis cabang penugasan. Cabang baru muncul pada selector setelah create/refresh.
- [ ] COA pendapatan mengirim INCOME; COA beban mengirim EXPENSE. Nominal rupiah integer aman; `1.9`, `1e6`, negatif dan terlalu besar ditolak tanpa dipotong.
- [ ] Simpan transaksi, baca ulang DB/API/UI; nominal, cabang, user, metode, intent, memo dan receipt cocok.
- [ ] Retry key/payload sama menghasilkan ID sama; key lintas user/cabang atau payload/memo/receipt berbeda mendapat 409.
- [ ] Approval hanya PENDING_APPROVAL; perubahan terminal/replay tidak membalik APPROVED/REJECTED.
- [ ] Approval dan audit log atomik; failure staging tidak meninggalkan status berubah tanpa log.
- [ ] Pending/Rejected dan pengajuan dana yang belum settlement tidak dihitung sebagai kas terealisasi.
- [ ] Grafik/KPI/table/report memakai sumber nyata; tidak ada angka demonstrasi atau periode hardcoded.
- [ ] Server tidak memunculkan detail SQL/upstream atau rahasia pada error klien.

## 7. Closing harian
- [ ] Staff yang belum closing dapat submit sesuai cabang, tanggal WIB dan saldo sistem; selisih wajib alasan.
- [ ] Seluruh nilai divalidasi; rupiah/nota nonnegative safe integer.
- [ ] **Kontrak sementara:** kg dan liter juga integer pada release ini. Kebutuhan pecahan laundry belum didukung; jika wajib bisnis, perbaiki kontrak dan uji sebelum go-live.
- [ ] Satu closing per user + cabang + hari WIB; Staff lain cabang sama tetap dapat mencatat/closing.
- [ ] Retry key/payload sama mendapat 200 ID/result sama; perubahan payload/key ditolak 409, bukan record tambahan.
- [ ] Sesudah closing miliknya, transaksi baru Staff itu ditolak; retry transaksi sebelumnya tetap idempotent.
- [ ] Approval kas SETOR_NOTA yang mengubah periode pencipta yang sudah closing ditolak; penolakan pending tidak mengubah kas.
- [ ] UI refresh history/status setelah sukses; form terkunci hanya untuk user yang telah closing.
- [ ] Uji pergantian hari WIB: batas UTC 17:00, historical approval, akses hari berikutnya dan timestamp history.
- [ ] Definisi saldo awal/pindah shift dan kebutuhan multi-shift per pengguna disepakati sebelum operasional penuh; daily close saat ini bukan mesin multi-shift umum.

## 8. Receipt, scan dan AI nyata
- [ ] PNG/JPEG/WebP/GIF valid dapat diunggah; signature palsu, file bukan gambar, base64 corrupt, traversal dan file terlalu besar ditolak.
- [ ] File tersimpan privat dan record receipt asset mencatat uploader/cabang/MIME yang benar.
- [ ] Receipt tanpa auth ditolak; Staff lain, termasuk cabang sama, ditolak; uploader dan Owner dapat membaca.
- [ ] `/uploads/*` legacy tidak bisa diakses publik. Browser memakai Bearer fetch lalu object URL sementara.
- [ ] Close drawer/logout/role change/new file membatalkan fetch lama dan mencabut blob URL; bukti lama tidak menempel pada transaksi baru.
- [ ] Upload/OCR timeout/gagal memberi error jujur; receipt yang sudah tersimpan bisa dikoreksi manual tanpa reuse key salah.
- [ ] `KARA_BASE_URL`, model dan key ada di env server, bukan browser. `localhost:20128` mesin lama tidak dianggap otomatis tersedia di VPS.
- [ ] Uji satu OCR dan satu chat Widya pada upstream nyata memakai fixture yang diizinkan; hasil dibandingkan dengan bukti/snapshot, tanpa angka rekaan.
- [ ] Bila upstream tidak tersedia, UI menampilkan unavailable, bukan respons contoh. Tes stub lokal sebelumnya tidak membuktikan integrasi AI live.

## 9. Laporan dan ekspor
- [ ] Semua 15 kategori tersedia: financial 6, tax/compliance 6, export 3.
- [ ] Cabang ID nyata/satu cabang/semua cabang dan rentang tanggal inklusif WIB bekerja; tanggal invalid/terbalik ditolak.
- [ ] Scope/periode bertahan saat berpindah tab report. Snapshot lama kosong saat logout/fetch gagal/pergantian identitas.
- [ ] CSV header baris pertama, snake_case, UTF-8 BOM/CRLF, kolom konsisten, ISO datetime, raw IDR, angka negatif dan blank unknown benar.
- [ ] Formula injection, koma, quote dan multiline diuji parser round-trip. Ekspor Income tidak mencampur Expense; nominal jutaan tidak diparse dari teks Rp/M.
- [ ] Metadata JSON terpisah menjelaskan scope, periode, provenance dan missing dataset.
- [ ] PDF semua kategori dapat diunduh: SiPeKA, cabang, periode, status sumber, tabel readable, nominal rata kanan, negatif berkurung, header/footer/nomor halaman, lampiran berkunci dan tanda tangan.
- [ ] Periksa PDF multipage secara visual dan parser; tidak kehilangan kolom/baris, tidak clipping, bukan halaman signature tanpa konteks.
- [ ] Browser bisa membatasi repeated downloads; uji kategori pada konteks baru bila perlu dan verifikasi file benar-benar tersimpan.
- [ ] Pajak/budget/payroll tetap Belum terhubung saat dataset tidak tersedia; tidak ada angka statutory default atau klaim laporan teraudit.

## 10. Keputusan go-live
- [ ] Semua blocker keamanan dan integritas lulus, termasuk real reverse proxy dan dua pengguna bersamaan.
- [ ] Daftar fitur belum tersedia dan batas closing pecahan/multi-shift disetujui pengguna, bukan disembunyikan.
- [ ] Bukti backup/restore dan rollback release tersedia; monitoring health/error/disk/expiry sertifikat disiapkan.
- [ ] Data TEST terisolasi, tidak dicampur ke ledger produksi; rahasia tidak ada pada paket/log/Git.
- [ ] Owner menyetujui pembukaan publik setelah menerima hasil aktual.

## Format laporan agent setelah pengujian
Simpan `docs/VPS_TEST_RESULT_<YYYY-MM-DD>.md` atau artefak aman yang disepakati:

```markdown
# Hasil Uji VPS SiPeKA
- Domain / host:
- Commit / Node / OS:
- Waktu UTC / WIB:
- Lingkungan: staging privat / produksi read-only
- Backup dan restore: bukti/path aman
- Tes: total / lulus / gagal / tidak diuji
- Bukti per tes: aksi, expected, actual, timestamp, screenshot/ID artefak tanpa rahasia
- Blocker:
- Batas fitur dan risiko tersisa:
- Keputusan: belum siap / staging lulus / siap publik dengan persetujuan
- Rollback:
```

**Jangan centang item yang belum dijalankan. Belum ada domain/akses VPS yang diberikan pada handoff ini.**
