# SiPeKA — status hardening lokal

## Implementasi
- Error boundary HTTP, validasi JSON/body, rate-limit login, header keamanan, whitelist CORS.
- Seed akun hanya opt-in melalui environment pada DB kosong; akun/DB existing tidak diganti.
- Sesi TTL 12 jam, expiry UTC eksplisit; reset/ganti sandi mencabut sesi. Sesi legacy tanpa expiry akan dicabut pada migrasi.
- Transaksi rupiah safe integer, COA/type sesuai, idempotency aktor/cabang dan fingerprint payload.
- Approval hanya pending dan atomik status + audit log.
- Closing STAFF saja, satu closing harian per pengguna/cabang WIB; retry identik mengembalikan ID sama; transaksi baru sesudah closing pengguna tersebut ditolak.
- Saldo kas dan performance hanya APPROVED SETOR_NOTA. Pengajuan dana belum dianggap pencairan.
- Bukti privat terdaftar; Owner boleh seluruh bukti, Staff hanya milik sendiri pada cabang penugasan; legacy uploads publik ditolak.
- Browser mengambil bukti dengan Bearer lalu blob sementara, revoke pada lifecycle sesi/drawer.
- Renderer legacy escaped; role/view/cache guard, logout server, jenis Income/Expense dan branch diperbaiki.
- Angka contoh finansial pada dashboard/chart/audit/vendor dan notifikasi dihapus/diganti data aktual atau unavailable.
- CSV bisnis header baris pertama, raw IDR, tanggal ISO; metadata JSON terpisah. PDF profesional 15 kategori tetap tersedia.

## Pengujian nyata lokal
- Backend integration: 219/219 assertions pass; HTTP+DB sandbox+OCR stub lokal.
- Backend regressions: 59/59 pass (dua structural checks bukan bukti runtime independen).
- Frontend integration: 15/15 fixture browser checks pass.
- Frontend regressions: 21/21; campuran runtime dan source checks, bukan seluruhnya E2E.
- Reports/settings: 50 UI cases + 30 actual CSV/PDF downloads pass.
- Parent E2E: actual isolated server + browser + DB disposable; login Staff, income, upload/OCR stub, receipt auth decode, closing refresh, logout, Owner report CSV/PDF.
- DB asli tidak dipakai untuk write pengujian. Migrasi pada salinan DB mempertahankan jumlah akun/unit/transaksi/closing.

## Batas sebelum VPS publik
1. Staging target Linux perlu diverifikasi: Node dengan node:sqlite, HTTPS/reverse proxy, non-root supervisor, writable persistent DB_PATH/UPLOADS_DIR, firewall, backup/restore.
2. Rate login memakai remoteAddress; jika di belakang Nginx satu IP proxy, konfigurasi/implementasi trusted proxy wajib diuji agar limiter tidak membatasi semua pengguna bersama.
3. CSP masih inline-compatible, bukan nonce-based. Sanitasi renderer telah diuji, tetapi hardening CSP strict merupakan pekerjaan lanjutan.
4. OCR/Widya live belum diuji; local 9Router pada mesin asal tidak otomatis tersedia di VPS.
5. Dataset pajak/budget/payroll dan settlement pengajuan dana belum ada; tetap template/unavailable, bukan laporan statutory teraudit.
6. Closing sekarang hanya menerima integer untuk kg/liter juga. Untuk kebutuhan pecahan laundry, definisikan presisi/desimal dan tambahkan tes server/frontend sebelum produksi.
7. Legacy receipt files tidak auto-migrated; audit pemetaan kepemilikan dibutuhkan sebelum memindah bukti lama.
8. Password existing tidak diubah otomatis; ganti password default sebelum staging publik. Jangan menaruh rahasia dalam Git.
9. Vercel /tmp SQLite ephemeral tetap bukan storage produksi persisten. Jangan deploy hardening ke Vercel tanpa rencana provisioning/migrasi DB: seed default sengaja dinonaktifkan.

## Environment dan kontrak
- HOST=127.0.0.1; PORT=4321.
- DB_PATH=/var/lib/sipeka/sipeka.db; UPLOADS_DIR=/var/lib/sipeka/receipts (direktori dibuat dan dimiliki service account sebelum startup).
- SESSION_TTL_HOURS=12; SIPEKA_SEED=0 untuk DB existing.
- Seed pertama saja: SIPEKA_SEED=1 dengan SIPEKA_OWNER_PASSWORD rahasia minimal 8 karakter, lalu nonaktifkan seed. Tidak ada password hardcoded.
- API receipt GET /api/receipts/:filename wajib Authorization Bearer, bukan img src langsung.
- Ganti sandi sukses mengirim logout_required=true, frontend wajib re-login.
- Health GET /api/health.

Belum deploy VPS. Status: siap verifikasi staging privat, bukan sertifikasi produksi publik.
