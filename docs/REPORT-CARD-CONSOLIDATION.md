# Report card consolidation

Local implementation; deployment is separate.

One visible Laba Rugi card uses company-profit-loss with the existing company / branch / comparison selector. Existing profit-loss and compare-profit-loss backend routes remain for compatibility and internal calculation.

One Ringkasan Kinerja Cabang card contains the main summary plus Rincian Pengeluaran and Status Persetujuan sections. Management and expense cards are removed from the grid, while their IDs remain as detail/export targets. Summary retains income, expense, net, approved count, expense count, expense ratio and pending/rejected controls. Expenses now group by branch and expense classification, without exposing account codes. Status detail shows approved/pending/rejected counts by branch.

All three branch views are now read from the same authenticated backend ledger/advance flow, through operational-reports. They use ordinary approved SETOR_NOTA transactions plus APPROVE settlement lines at the event WIB date. Approval of funding, disbursement and returns never count as operating income/expense. Pending/rejected controls use transaction recorded dates within the selected period. A zero-income branch has no expense ratio. Known branches without records remain visible. Money uses integer BigInt sums; large amounts are not rounded to JS numbers.

Frontend detail, CSV and PDF actions use their matching backend ID and applied filters. Source errors disable actions rather than silently falling back to browser financial totals. Original Owner and branch/date validation remain. No migrations, payroll changes, production financial writes or Telegram sends are included.

Validation: 40 selected tests passed. This includes reconciled summary/detail totals with settlement, separate classifications, pending/rejected controls, zero and inactive-period branches, branch isolation, Staff denial, large integers, desktop/mobile scope, CSV/PDF single-file behavior, numbered exports, and simulated backend 503 blocking the summary preview. Scope fixture clock is fixed to October 2026 so seeded records and expected document periods do not depend on today's calendar date. This clock exists only in the test fixture, never the app.

An older pg-mem suite could not run in this workspace because its optional test dependency is absent. The changes were not exercised against production authentication or live finance data in this local run. Selected tests and synthetic HTTP/browser checks are not a claim of exhaustive coverage of the entire application.
