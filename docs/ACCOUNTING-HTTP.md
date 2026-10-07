# Accounting HTTP/UI integration — local review gate

Accounting foundation and integration independently reviewed for authorized GitHub-first release. Review modifications extend migration 007 before its first production application. Startup guard is in server.js; migration runner remains unchanged. Independent artifacts: D:/FamilyAgent/Flora/generated/sipeka-completion/task3-release/.

## Routes and approval
- Owner full cookie session only; Staff denied. Existing exact Host/Origin mutation gate remains. Private QA bearer is not accepted for accounting. No 2FA changes.
- POST `/api/accounting/review`: whitelist `{sourceType,sourceId,fundId?,accountingDate,idempotencyKey,evidence}`. Approved SETOR_NOTA source only, or linked original cash journal reversal. Returns exact source amount string, reviewed draft, signed token. No journal writes. Source amount comes from PG, not client.
- POST `/api/accounting/approve`: only `{reviewToken,approved:true}`. Token bound to Owner ID/session/source/draft, expires after ten minutes, restart invalidates. Changed source blocks approval. Posting function enforces actual fund/category mapping, period lock, unique source and immutable balance constraints. Exact target read back after committed function call. Retry same reviewed token returns same journal ID.
- GET `/api/accounting/trial-balance?start=YYYY-MM-DD&end=YYYY-MM-DD&branchId=...`: archived/history branch accepted; nonexistent branch 404; exact date validation; all amounts/counts strings. No ending balances. Opening MISSING, neracaComplete false.

Owner menu `Jurnal & Mutasi` provides transient draft, review, separate unchecked consent and explicit posting button. Editing draft invalidates review; navigation/session change discards UI continuation. Trial balance deliberately exposes raw exact strings, not Number/currency arithmetic. `Saldo awal belum tersedia`, `Neraca belum lengkap` remain visible. No autonomous/Widya posting integration.

## Startup fail closed
Actual `sipeka_runtime` required. Schema CREATE denied; accounting table/column DML, TRUNCATE, TRIGGER denied; required immutable/deferred balance triggers checked active and correctly bound; bigint debit/credit checked; posting/auth SECURITY DEFINER maintenance ownership, pinned schema search_path, runtime execute and no PUBLIC execute checked. Existing migration checksum checks remain. Startup refuses missing/disabled accounting guard. Deployment must migrate 007 using maintenance then verify runtime before restart; current production intentionally not changed.

## Executed evidence
Artifacts: `D:/FamilyAgent/Flora/generated/sipeka-completion/task3-integration/`.
- `http-green.txt`: actual VPS PG/runtime, isolated fresh 001–007 schema; cookie unauth/Staff gates, bad Origin, forged actor, signed token tampering, unchecked consent, invalid date, review-without-post, approve, idempotent retry, exact trial balance, linked reversal, logout.
- `browser-green.txt`: local Chrome through SSH tunnel to unreleased code copy and actual isolated VPS PG. Owner cookie restoration, actual menu/form review, no posting before checkbox+button, exact 9007199254740991, honest movement labels, mobile geometry, logout, Staff hidden menu/403, zero page errors. Not production or password-login proof. Initial tunnel connection refusals occurred before fixture listener startup, not app/browser failures.
- `guard-green.txt`: actual runtime rejects a deliberately disabled accounting balance trigger in isolated schema; server did not listen.
- `foundation-green.txt`: existing real PG suite rerun; eight concurrent identical retries, runtime finance DML/CREATE denial, reversal, QRIS/bank/locked source checks, exact total 18014398509482005.
- `regression.txt`: eight local tests pass; existing frontend fixture nineteen checks pass.
- `review.diff`: tracked server/frontend changes for parent review; new tests/docs separately untracked.

## Risks / remaining gates
Independent review fixed preview: Owner-authenticated read-only SECURITY DEFINER accounting_preview validates named fund, category, QRIS, period and reversal date before signing. Exact mapped account/fund/category appears in preview; approval rechecks source/mappings. Mapping tables remain inaccessible directly to runtime. Invalid preview regression demonstrated RED then actual PG GREEN. Startup checks preview function ACL/search_path too. Drafts transient, not persisted approval queues. No opening import, period-close API, manual adjustments, bank reconciliation, legal-entity consolidation, accrual/tax engine, CSV/PDF accounting exports or source completeness assertion. Existing cash dashboard/report formulas unchanged.

Owner indispensable inputs: cutover date, verified opening balances and supporting documents; missing means movement-only, never zero opening. Named drawer/bank/QRIS identities/evidence, legal entity/branch membership and separate journal reviewer required before activation. No production balances fabricated, no source backfill, no financial production writes.

Retained new schemas: accounting_test_5cf0a9b3de4c83bd, accounting_test_821a05c8ed2977b4, accounting_test_b4f9a51ee89cfc0d, accounting_test_6f3fd82a465f1b73, accounting_test_11bf6d90dccc83da, accounting_test_98195cfaf77a2d8b, accounting_test_71a010eec2c1669d (disabled guard fixture), accounting_test_f0bc224e2159ce1e. No schemas dropped. Cleanup requires fresh Owner second confirmation. Fixture loopback 4437 verified closed after tests. Parent review required before any commit/push/deployment.
