# Advance integration — local acceptance candidate; release paused

No commit/push/deploy. Parent review required. No production financial writes, credentials reset, schema deletion, 2FA/monitor changes or autonomous journals.

## Cash policy preserved

Closing preserves deployed `cashDrawerBalanceToday` ordinary APPROVED SETOR_NOTA CASH_DRAWER recorded-day query. Adds DISBURSE negative / RETURN positive only on actual event WIB date. Settlement APPROVE recognizes expense once, never cash. Request dates never receive later event cash. Original ledger advance and historical closing snapshots unchanged.

Basis `RECORDED_DAY_MOVEMENT`. Compatibility `system_balance` means daily recorded movement, NOT opening/carryforward/end balance. Summary separates `ordinaryDailyMovement` / `advanceCashDelta`; `openingBalances:'MISSING'`, `carryforward:'UNVERIFIED'`, `reconciliationComplete:false`, `endBalance:null`, `neracaComplete:false`. UI labels daily movement, does not prefill physical cash from movement. Existing closing submission/replay remains supported. Stored difference physical-minus-daily-movement is not certified reconciliation variance.

Complete cash reconciliation deliberately unavailable. Missing Owner-verified policy/data: opening/carryforward; deposit/reset/transfer events; branch shared drawer versus per-user closing; variance corrections; reassigned Staff unresolved advances; late adjustments. No guessed zero-opening/cumulative end balance, accrual/neraca or full-financial-model claims.

DISBURSE/RETURN/SUBMIT deny after creator current-WIB branch/user closing; exact successful replay precedes cutoff. APPROVE/REJECT review is noncash and may occur after closing.

## Implementation

- Cookie/full-session/Origin/RBAC HTTP routes. Owner explicit confirmed:true disburse/refund; review approve/reject.
- Staff own unresolved cross-day queue includes pending/rejected event evidence/receipt details. Ordinary today-own history unchanged.
- Actual file picker/upload through existing scoped receipt API, dynamic expense category picker, 1–100 full settlement lines add/remove. Identity/sequence checks ignore stale uploads.
- Owner receipt links/category/amount/evidence review. Equal-budget approved SETTLED; surplus RETURN_DUE; confirmed full refund SETTLED.
- Retry map binds actor/target/action/review ID/exact payload; survives active-page rerender. Real committed HTTP response deliberately lost, same-key UI replay verified. Page-memory binding is not durable offline draft storage; restart loses draft binding but server uniqueness prevents duplicate financial effects.
- Receipt URL-to-filename claims prevent ordinary/other-advance reuse; original Staff/branch revalidated. No ledger settlement insert/double cash charge.
- Startup actual runtime/no schema CREATE, bigint amounts, table/inherited column DML denial, SECURITY DEFINER pinned search_path/PUBLIC EXECUTE denial, immutable/reservation triggers, valid unique indexes. Real runtime negative trigger/column/PUBLIC grant probes rejected; isolated changes restored/read back.
- CASH_DRAWER only, full disbursement/full settlement/full surplus refund, overbudget rejection. Partial/supplemental/bank/reversal/zero-expense cancellation unsupported.

## Metrics/export

Shared `SipekaMetrics` ordinary+advance projections feed reports, overview expense movement, cash-flow profile/chart. Expense APPROVE lines only; cash DISBURSE/RETURN only. Approval authorization excluded. BigInt aggregates fail explicitly beyond safe range rather than approximate. Staff unresolved queue is not full historical performance data.

CSV/PDF share buildReport. All 15 catalog UI CSV/PDF downloads verified; PDF realbytes parsed by PyMuPDF, currency/date/branch/template notices checked. Tax/budget templates remain missing-data templates, not implemented calculations. Operational general-ledger/audit projects APPROVE expense receipt lines; lifecycle cash remains cash-flow/Owner event queue, not double-entry journals. Accounting journal lifecycle source extension unimplemented pending reviewed mapping/explicit Owner approval.

## Actual proof

Artifacts `D:/FamilyAgent/Flora/generated/sipeka-completion/advance-final/`: canonical `run.py`, `setup.js`, `acceptance.js`, `verify-pdfs.py`, `matrix.json`, `pdf-parsed.json`, `exports.json`, actual PDFs/CSVs/parsed text.

Actual local server.js/production frontend against maintenance-created isolated VPS PG, application connection actual **sipeka_runtime**, private in-process SSH forwarding. No mocked API/business fixture copies. Last schema `advance_final_e02ec8adf9566126` retained; all earlier fixtures retained. No production R2 writes; isolated filesystem receipts.

Explicit simulated dates: QA-only fixture clock table; migrated lifecycle clock_timestamp/default instrumentation; actual db adapter clock replaced and loaded under require.resolve module filename; browser Date override. Oct1 23:59 WIB disburse700000; Oct2 00:01 upload/submit/reject/re-upload/resubmit; Oct3 00:01 approve450000/refund250000. Persisted event dates asserted before totals. This is simulated boundary proof, not elapsed wall-clock days. Generated fixture full-session cookie restoration used; password-login browser coverage not claimed.

Full UI lifecycle, eight concurrent HTTP retries each transition, ambiguous-response same-key replay/conflict, four actual uploaded receipt files, original ledger row unchanged, one expense/cash recognition, exact equal-budget final state, contradictory review one winner, no journals, same/cross-branch Staff denial, exact receipt-byte readback Owner/original Staff, evil Origin/confirmed:false denial, real closing snapshot/replay/cutoff/post-close successful event retry passed. Zero pageerrors. Owned HTTP listener stopped/readback, SSH forwarding stopped. 15 parsed PDFs/CSV download parity.

Local regressions 36 passed/0failed: advance policy/metrics/UI/guard, accounting money, closing privacy, frontend real-data, final UI source, no-2FA, auth primitives, storage, branch operations, payroll. Unit/SQLite fixtures are separate from PG browser acceptance. Legacy remote advance-browser.test.js is only previous smoke coverage; not completion evidence.

## Remaining gates / intentionally unavailable

- Parent review dirty source and unshipped008 checksum, financial policy labels. Migrations001–007 unchanged. Never reapply modified008 over old retained schemas. No production release authorized.
- Complete cash reconciliation/end balance/opening inputs, lifecycle double-entry posting, partial/supplemental/bank/reversal/zero-expense paths unavailable by policy.
- R2 provider and OCR/delivery not verified here; filesystem scoped receipt route verified. OCR/delivery remain deferred.
- Environment-dependent legacy accounting/PG suites need their own isolated setup; not falsely reported as local regression passes.
- Precise acceptance/disclosure matrix artifact acceptance-matrix.json. Parent review is final gate, no release claim.
