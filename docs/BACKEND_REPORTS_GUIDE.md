# SiPeKA — Handoff Backend Reports

## 1. Batas pekerjaan dan sumber
- Dokumen rancangan; endpoint laporan **belum tersedia** di server sekarang. Parent boleh menyempurnakan API dengan menaikkan versi kontrak.
- Jangan ubah UI, `server.js`, `db.js`, DB, deployment, atau perilaku backend sekarang. Implementasi memerlukan persetujuan terpisah.
- Pembacaan readonly: `D:/FamilyAgent/Nox/workspace/sipeka-backend/server.js` dan `db.js`.
- Frontend acuan: `D:/FamilyAgent/Flora/generated/sipeka-reports/source-readable.txt`.
- Kontrak pendamping: `reports-contract.json`; tepat 15 reportId, kategori `financial` 6, `tax` 6, `export` 3.
- Temuan berasal dari source, bukan pengujian endpoint live atau pemeriksaan isi DB produksi.

## 2. Backend dan bridge sekarang
- Node `http`, SQLite `node:sqlite`; tabel: `business_units`, `app_users`, `chart_of_accounts`, `ledger_transactions`, `approval_logs`, `cash_closings`, `sessions`.
- `GET /api/transactions`: OWNER menerima `{scope:"all",rows:[...]}`; STAFF menerima `today-own`, milik sendiri pada cabang penugasan dan tanggal UTC server.
- `GET /api/units`: daftar unit aktif untuk Owner; satu unit penugasan untuk Staff. Nama cabang UI bukan ID API.
- Row mentah memuat `id,branch_id,user_id,coa_id,tx_type,amount,payment_method,memo,receipt_key,status,created_at,tx_intent` serta nama/akun hasil JOIN.
- Bridge `bootstrap` mengambil dua endpoint tersebut, lalu mengubah row menjadi array tampilan dan angka Rupiah berformat. Reports harus memakai row mentah, bukan parse teks `Rp ...M`.
- Agregasi bridge sekarang menjumlahkan semua status; jangan pakai agregat itu sebagai total APPROVED laporan baru.
- `cashDrawerBalanceToday` mengecualikan REJECTED tetapi memasukkan PENDING_APPROVAL; bukan rumus laporan approved-only.
- UI pajak, budget, anomali, tanggal periode, serta klaim debit/kredit masih contoh; bukan dataset atau bukti akuntansi.
- Slip gaji masih `Coming soon`; tidak ada dataset payroll, budget, tax config, faktur pajak, atau jurnal double-entry pada skema ini.
- `created_at` SQLite `datetime('now')` adalah UTC tanpa sufiks; bridge saat ini menafsirkannya memakai zona browser. Adapter baru harus eksplisit UTC.

## 3. Risiko penyimpanan — pekerjaan mendatang
- `db.js` memilih `/tmp/sipeka.db` ketika `VERCEL` aktif; selain itu file lokal proyek `sipeka.db`.
- **Risiko besar:** `/tmp` Vercel ephemeral, tidak menjadi sumber keuangan persisten; instance dapat terpisah atau hilang saat lifecycle berubah. WAL tidak menyelesaikannya.
- Bukti foto ditulis ke `public/uploads/receipts`; lifecycle/akses publik juga perlu evaluasi. `receipt_key` tidak membuktikan file tersedia atau sah.
- Sebelum produksi laporan: rancang migrasi ke DB persisten dan object storage privat, backup/restore, transaksi atomik, retensi, rekonsiliasi, uji pemulihan.
- Pertahankan ID, timestamp, status, nominal, approval log, referensi bukti; catat asal legacy dan verifikasi jumlah/hash migrasi. Jangan migrasi sekarang.

## 4. API usulan — Owner only
```text
GET /api/reports/{reportId}?branch_id=all|id&date_from=YYYY-MM-DD&date_to=YYYY-MM-DD&timezone=Asia/Jakarta
GET /api/reports/{reportId}/export?branch_id=all|id&date_from=YYYY-MM-DD&date_to=YYYY-MM-DD&timezone=Asia/Jakarta&format=csv|pdf
```
- Keempat filter wajib; tidak ada fallback cabang/periode diam-diam. `format` wajib pada export; reportId/format allowlist.
- Autentikasi sesi Bearer pada server; wajib `me.role === "OWNER"` untuk laporan, export, metadata, job/file download. UI hiding bukan RBAC.
- Jangan percaya `user`, role, scope, atau jumlah dari browser; autentikasi ulang server, resolve ID cabang dari DB, bind parameter SQL.
- `all` hanya unit dalam scope yang diotorisasi; manifest menyebut ID ter-resolve. Unit historis/inaktif jangan hilang dari konsolidasi: definisikan kebijakan sebelum implementasi.
- ID tidak ada ditolak; unit inaktif perlu kebijakan eksplisit, bukan fallback `all`. Konsolidasi lintas entitas hukum jangan dianggap satu wajib pajak.
- Validasi tanggal kalender sungguhan, leap day, urutan, zona allowlist hanya `Asia/Jakarta`, parameter ganda/tidak dikenal, panjang input, batas periode/beban eksplisit.
- Usulan error: 400 `INVALID_FILTER`; 401 `UNAUTHENTICATED`; 403 `FORBIDDEN`; 404 `REPORT_NOT_FOUND`/`BRANCH_NOT_FOUND`; 422 `INVALID_SCOPE`; 413 `REPORT_TOO_LARGE`; 500 `INTERNAL_ERROR`.
- Error JSON `{error:{code,message,details},request_id}`; details aman, tanpa SQL, token, payroll, atau stack. Dataset hilang bukan error server otomatis.
- JSON sukses 200 `{report_id,report_version,status,scope,provenance,datasets,columns,rows,totals,warnings,pagination}`.
- `scope`: requested_branch_id, resolved_branch_ids, date_from, date_to, timezone, utc_from, utc_to_exclusive; tampilkan scope yang benar-benar dipakai.
- `provenance`: source_system, source_tables, source_mode, snapshot_id, generated_at UTC, generated_by ID server, data_as_of UTC, source_schema_version, query_version, calculation_version, approval_policy, date_basis, currency, source_row_count, included_row_count, excluded_counts_by_status, missing_fields, legal_config_version.
- Tambahkan provenance per dataset dan lineage per row/agregat (`source_ids` atau reference manifest); jangan kirim seluruh identitas pegawai untuk agregat.
- `snapshot_id`/data_as_of harus snapshot konsisten, bukan nama timestamp saja; sort stabil `created_at,id`, filter identik JSON/CSV/PDF.
- Pagination `{total_rows,returned_rows,next_cursor,complete}`; total agregat meliputi seluruh scope, bukan halaman. Tanpa pemotongan tersembunyi.

## 5. Waktu, status, dan angka
- Rentang tanggal UI inklusif; ubah tengah malam lokal date_from dan tengah malam lokal hari setelah date_to ke UTC.
- SQL memakai interval setengah terbuka `created_at >= utc_from AND created_at < utc_to_exclusive`; jangan `23:59:59` atau potong string tanggal UTC.
- Contoh satu hari `2026-09-01` WIB: `[2026-08-31T17:00:00Z,2026-09-01T17:00:00Z)`; gunakan library zona waktu, bukan zona mesin/browser.
- Normalisasi format timestamp legacy ke UTC sebelum perbandingan; jangan membandingkan campuran `YYYY-MM-DD HH:mm:ss` dengan ISO mentah.
- Date basis sekarang `created_at` (waktu pencatatan), bukan tanggal nota/settlement/recognition. Basis pajak/accrual kelak wajib eksplisit.
- Status dataset: `available` = sumber ada/cakupan lengkap; `partial` = cakupan/bukti kurang; `unavailable` = sumber tidak ada/tidak bisa diverifikasi.
- Status laporan: `ready` semua kebutuhan tersedia; `partial` ada bagian valid dan bagian hilang; `unavailable` tidak ada dasar utama; `empty` sumber tersedia lengkap, nol row pada scope.
- Nol sah hanya dari sumber tersedia dan query lengkap. Dataset budget/pajak tidak ada menghasilkan `null`, bukan 0; CSV sel kosong, PDF `— / Belum tersedia`.
- `datasets[]` wajib mencantumkan id, status, source_tables, coverage, row_count (null bila unknown), missing_fields, reason, data_as_of.
- Field nullable tetap tercantum pada columns/rows/totals; jangan membuat dummy row finansial. Rasio pembagi nol = null disertai alasan.
- Default total operasional hanya `status=APPROVED`; PENDING_APPROVAL/REJECTED dicatat terpisah pada kontrol/provenance, tidak menambah total.
- Nominal sumber integer IDR positif; `signed_amount = amount` untuk INCOME, `-amount` untuk EXPENSE. Jangan hilangkan tanda saat export.
- Jumlah gunakan integer aman/BigInt atau decimal; kontrak money berupa string integer nullable, bukan float/tulisan Rupiah. Rasio decimal string nullable.
- Approval bukan pencairan. PENGAJUAN_DANA approved tidak membuktikan kas keluar; tampilkan terpisah, kecualikan dari actual expense sampai realisasi/settlement terdokumentasi.
- Kas/QRIS/transfer dalam sumber adalah metode yang dicatat, bukan rekonsiliasi bank. Total approved SETOR_NOTA hanya proksi operasional, bukan cash flow terverifikasi.
- Skema bernama ledger tetapi single-entry INCOME/EXPENSE; surplus = approved inflow minus approved outflow, **bukan laba akrual**.
- P&L akrual memerlukan recognition date, piutang/utang, accrual, persediaan/COGS, aset/depresiasi, pajak, adjustment, pemetaan COA lengkap.
- General ledger sejati memerlukan journal header/lines, debit=credit, akun lawan, opening balances, posting period, reversal; jangan rekaan debit/kredit dari tx_type.
- Trigger melarang delete dan sebagian update finansial, tetapi status mutable; receipt_key/tx_intent serta perubahan memo null belum sepenuhnya terkunci. Jangan klaim immutable penuh.
- Kelak jurnal append-only, koreksi melalui reversal/adjustment terkait ID asli; approval + log atomik, transisi/idempotency diuji, otorisasi manusia tetap wajib.

## 6. Katalog tepat 15 template
Format setiap item: **field**; sumber tersedia; kekurangan/label. Semua memakai scope, periode, IDR, status dataset, provenance di atas.

### Financial — 6
1. `profit-loss`: revenue_operational, expense_operational, operational_surplus, accrual_revenue, cogs, depreciation, accrual_profit; approved realisasi ledger + COA/unit; recognition, accrual, COGS, aset, adjustment hilang. Label ringkasan operasional; field laba akrual null.
2. `cash-flow`: payment_method, inflow_recorded, outflow_recorded, net_recorded, opening_balance, closing_balance, settled_inflow, settled_outflow; approved realisasi ledger per metode; saldo awal, settlement, bank statement, transfer internal, klasifikasi aktivitas hilang. Bukan laporan arus kas terverifikasi.
3. `expense-breakdown`: coa_id, account_code, account_name, branch_id, expense_recorded, transaction_count, share_pct; approved EXPENSE realisasi + COA/unit; vendor, invoice lines, cost center, accrual mapping hilang. Share null bila total nol.
4. `branch-performance`: branch_id, branch_name, income_recorded, expense_recorded, surplus_recorded, expense_ratio_pct, pending_count; ledger + business_units; KPI layanan, target, opening balance, allocation, eliminasi intra-cabang hilang. Tidak memberi label Healthy/audited otomatis.
5. `budget-actual`: branch_id, coa_id, budget_version, budget_amount, actual_operational, variance_amount, variance_pct; actual dari approved realisasi; budget periode/cabang/akun, versi, approval, allocation belum ada. Budget/variance null, bukan selisih terhadap nol.
6. `tax-summary`: tax_type, legal_entity_id, tax_period, taxable_base, tax_due, tax_paid, payable, filing_status, evidence_count; ledger hanya kandidat transaksi; seluruh register/config/legal entity/payment/filing belum ada. Tidak menghitung pajak dari total pendapatan mentah.

### Tax & Compliance — 6
7. `ppn`: invoice_id, invoice_date, counterparty_npwp, tax_object, dpp, output_tax, input_tax_creditable, net_due, invoice_validation; butuh register faktur, PKP, klasifikasi objek, periode, DPP, aturan kredit/nonkredit, retur; sumber sekarang hanya kandidat ledger/receipt. Tarif UI tidak sah sebagai config.
8. `pph21`: employee_ref, payroll_period, gross_pay, deduction, non_taxable_allowance, ter_category, withholding, annual_reconciliation; butuh payroll lengkap, PTKP/status keluarga, NPWP/NIK, masa kerja, komponen penghasilan/iuran/potongan, TER berlaku, bukti potong; semua belum tersedia. Akses data pribadi minimal.
9. `pph4`: contract_id, object_type, counterparty_npwp, taxable_base, rate_config_id, withheld, proof_ref, paid; butuh kontrak/objek final spesifik, status pihak, kewajiban pemotong, dasar pengenaan, periode, bukti potong/bayar. Jangan terapkan tarif sewa UI ke semua beban.
10. `pbjt`: jurisdiction, local_rule_version, business_object, transaction_date, taxable_sales, exempt_sales, tax_due, paid; butuh perda/lokasi, objek jasa, pengecualian, tarif efektif, register penjualan, dokumen pembayaran. Category unit bukan penentu pajak otomatis.
11. `umkm`: legal_entity_id, eligibility, regime_period, annual_turnover, non_taxable_turnover, taxable_turnover, rate_config_id, final_tax, paid; butuh jenis wajib pajak, NPWP, batas/masa penggunaan regime, omzet kumulatif lintas cabang, pengecualian, surat fasilitas. Opsi aktif UI bukan eligibilitas.
12. `tax-checklist`: obligation_id, tax_type, period, applicability, deadline, responsible_ref, document_ref, evidence_status, filing_ref, payment_ref, review_status; butuh kalender kewajiban/legal config dan register dokumen/pelaporan. Tanpa bukti status unknown, bukan Ready/filed; ledger/receipt hanya kandidat.

### Export Center — 3
13. `general-ledger`: transaction_id, created_at_utc, branch_id, coa_id, tx_type, amount, signed_amount, status, tx_intent, payment_method, memo, receipt_ref, journal_id, debit, credit, running_balance; raw ledger + COA/unit; journal lines, opening balance, akun lawan belum ada. Export jurnal operasional single-entry; debit/credit/running balance null.
14. `management-report`: section_id, metric, value, unit, dataset_status, warning, source_ref; komposisi profit-loss/cash-flow/branch-performance/budget-actual/tax-summary satu snapshot; kekurangan mengikuti masing-masing. Jangan jumlahkan KPI berbeda atau menyebut paket laporan audited.
15. `audit-evidence`: transaction_id, amount, signed_amount, status, receipt_ref, receipt_available, evidence_hash, reviewer_ref, approval_action, approval_at, finding_ref, human_review_status; ledger/receipt_key, approval_logs di DB (belum endpoint bridge); hashes/file existence/verifikasi OCR/temuan audit tervalidasi belum ada. Status APPROVED bukan bukti Verified.

## 7. Konfigurasi pajak wajib
- Tidak ada tarif/TER yang diasumsikan dari contoh UI. Kontrak `rate=null` sampai config legal tervalidasi; tidak ada kalkulator pajak statutory pada tahap template.
- Config wajib: entitas/regime, yurisdiksi, masa berlaku/periode, objek, tarif/TER table version, DPP, batas/pengecualian/non-taxable, deductible/non-deductible, rounding, NPWP/status, dokumen sumber, legal reference, reviewer manusia.
- Pisahkan tax period dari rentang pencatatan; untuk banyak masa/config tampilkan tiap masa, jangan satu tarif. Jangan duplikasi kewajiban PPN/PBJT/regime tanpa keputusan legal.
- Review akuntan/pajak sebelum hitung final, filing, pembayaran, atau perubahan status compliance; agent hanya menyiapkan draft.

## 8. Integrasi frontend non-invasif
- Target antarmuka modul `window.SipekaReports`: `render(section)`, `bind(root)`, `setSnapshot({rows,units,user})`, `catalog`, `buildReport(id,{branch,dateFrom,dateTo})`, `toCsv(report)`, `downloadCsv(id)`, `downloadPdf(id)`.
- Modul sudah terintegrasi inline pada financial-dashboard.html. API laporan server di §4 masih usulan, belum tersedia.
- Bridge penerus menyerahkan `txData.rows` dan `units` asli; jangan menyerahkan `_tx` array berformat atau localStorage/token dalam snapshot.
- `user` hanya identitas aman/role; scope memakai unit.id, tampilan unit.name. Kosongkan snapshot saat logout, pergantian user, fetch gagal; cegah stale export.
- `buildReport` dan export frontend-ready memakai snapshot mentah, filter/status benar, label `source_mode=frontend_snapshot`, tanpa klaim server-verified/full audit.
- Bila status cakupan tidak diketahui, tandai partial; jangan ubah kegagalan fetch menjadi nol. approval_logs/closings tidak tersedia dalam snapshot tiga-key ini.
- Kelak adapter mengambil envelope API server; render/bind tetap terisolasi ke halaman reports/tax/export, tidak mengubah alur transaksi/backend sekarang.

## 9. CSV, PDF, dan kontrol export
- CSV UTF-8 BOM, delimiter koma, CRLF, header stabil; quote field berisi koma/quote/newline; double quote di dalam field menjadi dua quote.
- Hindari formula injection pada kolom teks: setelah deteksi prefix whitespace/control, awalan `=`, `+`, `-`, `@`, tab/CR/LF dinetralisir dengan apostrof dan quoting. Money numerik tervalidasi tetap bertanda negatif, bukan formula teks.
- Uji parser round-trip; null sel kosong, nol `0`; metadata/provenance dalam kolom stabil atau manifest terpisah, bukan komentar yang merusak parser CSV.
- PDF branding SiPeKA, A4, margin, font tertanam, wrap teks, page break, header tabel berulang, footer `halaman x/y`; jangan memotong baris/kolom.
- PDF memuat nama laporan, cabang ter-resolve, periode inklusif, timezone, generated_at, basis, versi template/calculation, snapshot, auditor/reviewer (null bila belum ditinjau), warning dan dataset unavailable.
- Export endpoint mengirim attachment filename aman, MIME `text/csv; charset=utf-8` atau `application/pdf`, `Cache-Control: no-store`; hindari shared cache.
- Export log persisten append-only: export_id, actor_id, waktu, report/version, scope, snapshot, format, total_rows, file_hash, outcome, human_authorization_ref. Frontend download lokal belum memiliki log server tepercaya.
- Download bukan approval, filing, atau pembayaran. Konfirmasi pengguna untuk paket sensitif; server tetap memeriksa role/scope tiap download termasuk link/job.
- Bukti/NPWP/payroll hanya kebutuhan sah; referensi aman/private download, bukan public URL/browser log. Jangan log token, password, raw receipt, payroll, atau seluruh snapshot.
- Export penuh memakai snapshot/filter identik; untuk data besar gunakan streaming CSV/renderer PDF berbatas sumber daya atau job berotorisasi, jangan truncation diam-diam.

## 10. Checklist agent implementasi berikutnya
- [ ] Sepakati versi kontrak, signature modul, definisi scope unit historis, batas rentang, basis tanggal, status dan aturan realisasi advance.
- [ ] Rancang persistence/migrasi/backup, storage bukti privat, provenance schema dan snapshot konsisten; persetujuan manusia sebelum perubahan.
- [ ] Tambah server RBAC, validasi allowlist, prepared SQL, query approved-only, exclusion counters, pagination/cursor stabil, money exact.
- [ ] Sediakan dataset budgets/payroll/legal config/journal double-entry hanya dari sumber sah; sampai tersedia pertahankan null + missing_fields.
- [ ] Pisahkan approval manusia dan journal posting; koreksi append-only, approval-log atomik, reversal linkage, audit export log.
- [ ] Adapter frontend memakai row mentah; pertahankan UI/bridge lama; cegah data Staff/mantan sesi/failed-fetch menjadi laporan Owner.
- [ ] CSV/PDF render dari model laporan yang sama; no secrets; attachment headers, versi, manifest, log; dokumenkan rollout/rollback.

## 11. Tes penerimaan wajib
- [ ] 15 ID unik; kategori 6/6/3; field/missing/source tiap template; rate/TER tidak hardcoded dari UI; kontrak JSON parse/validate.
- [ ] 401 tanpa sesi; 403 STAFF/role palsu; export direct URL/job/re-download juga ditolak; parameter SQL injection tidak mengubah scope.
- [ ] branch_id tidak dikenal/inaktif/`all`, nama vs ID, parameter duplikat/unknown; resolved IDs sesuai izin, tidak bocor lintas scope.
- [ ] WIB awal hari: tepat UTC 17:00 hari sebelumnya masuk; sebelum batas tidak; tepat end-exclusive tidak; akhir bulan/tahun/leap day; zona browser berbeda hasil identik.
- [ ] Tanggal tidak valid/rentang terbalik/timezone salah; timestamp legacy UTC vs ISO; created_at bukan tanggal nota; coverage dipertahankan.
- [ ] APPROVED/PENDING/REJECTED dan advance belum cair; signs/negative surplus; nol vs unavailable, pembagi nol, missing budget/tax tidak menjadi nol.
- [ ] Jurnal double-entry belum tersedia tidak menghasilkan debit/credit palsu; append-only/reversal, approval-log transaction rollback dan idempotency kelak.
- [ ] CSV parser BOM, Unicode, koma, quotes, multiline, control/formula text, nominal negatif, null vs 0; round-trip count/value cocok JSON.
- [ ] PDF lebih dari satu halaman: header/footer/nomor halaman, A4, long memo/Unicode, branding, versi/provenance/warnings, unavailable placeholders, tidak overflow.
- [ ] Dataset besar: halaman/cursor lengkap tanpa duplikasi, total seluruh scope, memori/waktu terukur, export count/hash; mutation concurrent tidak mencampur snapshot.
- [ ] Failed-fetch/logout/user switch, spoof snapshot, file bukti hilang, config legal expired; no secret browser/server logs; backup restore dan migrasi direkonsiliasi.
- Uji di lingkungan terpisah; laporan keberhasilan harus menyertakan output nyata. Dokumen ini belum mengimplementasikan atau menjalankan endpoint usulan.
