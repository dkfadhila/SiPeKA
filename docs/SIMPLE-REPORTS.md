# Simple financial statements — 22 October 2026

Owner requested plain white reports, concise P&L positions and a vertical balance sheet with debit/credit columns. Account codes and detailed account lists remain internal to recording and calculation.

`report-presentation.js` projects the existing account-based template calculation into statement positions. P&L presents consolidated values; unit comparison preserves every unit (including continuation panels). The balance sheet presents assets, liabilities and equity vertically. Unavailable closing balances and accruals remain unavailable; no cash balance, balancing equity or profit is inferred. Original account-based API rows remain available for internal processing, while `presentationData` supplies report rows and columns.

Browser preview, PDF, XLSX and CSV use the same presentation. Other report tables omit account code/name columns; expense breakdown aggregates by branch. CSV statement headers are now `item,amount_1,...`; associated manifests describe the matching presentation columns. White backgrounds, black text, gray rules and subtotal emphasis replace colored report templates. Application navigation colors are unchanged.

Widya's authenticated Owner context includes the actual chart of accounts, account attribution for the latest 40 transactions and an advisory mapping policy. Historical accounts are identified explicitly. Suggestions do not post, approve, or reclassify records.

Validation: account-based calculation/date regressions; exact integer aggregation; missing balance/accrual handling; all-unit CSV and XLSX export; embedded script syntax/source synchronization; Widya context and bridge tests. The real PostgreSQL/browser fixture checks report permissions, WIB date boundaries, actual PDF/XLSX/CSV downloads, white report previews, stafel columns and mobile overflow. Fixture data stays in retained isolated schemas; no production financial fixtures or real email delivery.

No dependency or schema changes. Release through GitHub before deployment; backup, readiness and release/public HTML checks required. Rollback is compatible with the previous application binary.

## Excel follow-up — 23 October 2026

Owner requested the complete Excel columns from the previous format while keeping accounts out of every report. Excel now uses a separate presentation: P&L includes selected unit columns, consolidation, the previous equal-length period, percentage change and profit margins. More than six units continue on additional worksheets. Balance Excel includes current and prior 31 December debit/credit positions; cash-flow Excel includes current and previous periods. Missing values remain unavailable, and change percentages are unavailable when the prior value is zero.

Preview, PDF and CSV retain the simple presentation. The exported Excel contains grouped report positions and no account codes or account lists. Percentage cells use percentage formats; integers beyond Excel's 15-digit numeric precision are stored as text to preserve the exact amount. Branch scope and date filters apply to both presentations. Tests in `tests/report-excel-complete.test.js` cover source integration, comparison values, unit continuation, missing balances, percentages and large integers.

This follow-up is GitHub-only until the Owner authorizes deployment.
