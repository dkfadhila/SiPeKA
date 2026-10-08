# Advance lifecycle foundation (local integration candidate)

Integration status, actual tests and policy gaps: [ADVANCE-INTEGRATION.md](ADVANCE-INTEGRATION.md). Integration preserves recorded-day ordinary closing movements, adds actual event-day disbursement/refund only. No assumed opening or cumulative closing. Historical foundation wording below is superseded by that document.

Original `PENGAJUAN_DANA` ledger approval is authorization, **not cash paid, not expense**. Original ledger rows stay immutable. Migration 008 adds append-only events, settlement lines and permanent receipt claims. No seeds/backfill/journals, no new authentication/2FA. Existing ordinary Staff today-only history remains unchanged.

## Supported initial policy

Cash-drawer advances only; one explicit full disbursement of the approved amount. Staff submits ONE full actual-expense settlement (1–100 positive integer IDR receipt lines). Owner explicitly approves/rejects; rejected submissions remain audited and permit correction/resubmission. One approved settlement per advance. Full surplus is reconciled only by explicit Owner physical receipt confirmation AFTER approval. Partial disbursement/settlement/refund, zero-expense cancellation, supplemental disbursement, reversal and bank advances are unsupported. Overbudget rejects `SUPPLEMENTAL_DISBURSEMENT_REQUIRED`; that error does not implement or authorize supplemental funding. Obtain separate reviewed policy/workflow; never infer expense, invent funds or silently cap costs.

Amounts are canonical decimal strings, positive integers, at most 9007199254740991 per amount; sums use PostgreSQL numeric. Reports remain decimal strings, including wide aggregate sums. Event times are server-generated timestamptz, accounting operational day Asia/Jakarta. No arbitrary client backdating. Approval day recognizes expense, not alleged purchase/accrual day; no tax/accrual inference.

Staff must own original advance and still be assigned its branch, regardless of advance creation day. Reassigned users require explicit Owner handling; do not weaken branch scope. `listOwn` returns approved unresolved own cash advances across days, not ordinary historical transactions. Closed advances disappear when approved expense equals funding or full surplus return is confirmed.

Receipts must exist under original Staff/branch, never have appeared in an ordinary ledger transaction, never belong to another advance claim. Each receipt occurs once in each settlement; rejected corrections may reuse the same receipt for SAME advance, never another advance. Claims remain permanently reserved. A new INSERT trigger blocks ordinary ledger reuse of any claimed receipt. Existing ledger rows are not modified; Owner approval revalidates receipt scope/ordinary use.

## Service and proposed HTTP contract (parent integration required)

Import `advance-service.js`, supply existing pool and **server-authenticated** session token. Never accept actor ID, session token, branch, role or event date from request body. Existing secure cookie, full-session validation, CSRF/Origin, rate limits, Owner/Staff middleware remain mandatory.

Suggested routes:

| Route | Role | Service |
|---|---|---|
| POST `/api/advances/:id/disburse` | Owner | `disburse(pool,token,p)` |
| POST `/api/advances/:id/settlements` | Staff | `submitSettlement(pool,token,p)` |
| POST `/api/advances/:id/settlements/:settlementId/approve` | Owner | `approveSettlement(pool,token,p)` |
| POST `/api/advances/:id/settlements/:settlementId/reject` | Owner | `rejectSettlement(pool,token,p)` |
| POST `/api/advances/:id/return` | Owner | `confirmReturn(pool,token,p)` |
| GET `/api/advances/own-unresolved` | Staff | `listOwn(pool,token)` |
| GET `/api/reports/advance-movements?start=...&end=...&branchId=...` | Owner | `report(pool,token,filters)` |

Every command: `{advanceId,idempotencyKey,evidence}`. Submission adds `lines:[{receiptKey,coaId,amount}]`. Review adds `settlementId`. Return adds exact `amount`. Route integration sets path identifiers explicitly; rejects inconsistent body IDs. Responses `{id,advanceId,action,cashDelta,expenseDelta,returnDue}`; submission `id` is settlement ID. `returnDue` is an event outcome, not current advance balance (SUBMIT/REJECT report zero).

Idempotency scope `(authenticated actor, original branch, operation, key)`. Retry identical complete JSON returns exact original outcome even after later state changes. Changed JSON/advance within scope rejects `IDEMPOTENCY_CONFLICT`; rejected commands create no key/event/claim. JSON object key order irrelevant; array order significant. Different key cannot duplicate final transitions. Atomic SQL function, unique indexes and shared transaction advisory lock `1397313611` serialize with existing ledger/closing transactions. No nested caller transaction needed; one SELECT is atomic. Runtime gets EXECUTE only, no lifecycle table writes/reads; functions SECURITY DEFINER, pinned schema/pg_temp, PUBLIC revoked.

HTTP map reviewed domain conflicts to 409, validation to 400/422, SQLSTATE 42501 to 403 (unauthenticated AUTH_REQUIRED to 401), absent IDs to scoped 404. Do not emit raw SQL/query/session data. Database receipts trigger may surface `RECEIPT_RESERVED_FOR_ADVANCE` in ordinary submission; show actionable non-reuse message.

## Reports, cash and closing integration

`report` returns `{basis:'ADVANCE_EVENT_MOVEMENTS',start,end,branchId,cashDelta,expenseDelta,disbursed,returned,events,openingBalances:'MISSING',neracaComplete:false}` with inclusive WIB event-date/branch filter, Owner-only. This is lifecycle movements only, NOT total ledger cash/P&L. Never add pending/rejected submissions to expense.

| Event | Drawer | Expense |
|---|---:|---:|
| Original approval | 0 | 0 |
| DISBURSE | -approved amount | 0 |
| SUBMIT / REJECT | 0 | 0 |
| APPROVE settlement | 0 | +actual expense |
| RETURN (Owner physically received) | +surplus | 0 |

Parent must augment existing `cashDrawerBalanceToday` and branch/Owner cash report sums with DISBURSE negative and RETURN positive for THAT event day, never original advance creation day. Expense/P&L reports augment ordinary APPROVED SETOR_NOTA expense with approved settlement lines on APPROVE event day; preserve receipt/COA detail; exclude disbursement. Do NOT create a SETOR_NOTA expense ledger row for settlement: current drawer queries would deduct cash twice.

Closing `system_balance` needs combined ordinary cash movements plus lifecycle `cashDelta` in one transaction using the shared lock. Preserve immutable historical closing snapshots. Do not recompute previous day closing by attaching later expense/returns to original request day. Explicitly review cash carry-forward/opening balance policy: current today-only movements are not verified carried cash. Existing posted closings plus subsequent same-day cash events need a reviewed late-event/adjustment policy before routes go live; service enforces current WIB creator/branch closing cutoff for DISBURSE/RETURN/SUBMIT; successful exact replay precedes cutoff. Preserve ordinary Staff per-user today-only closing/history. Reports/CSV/PDF and daily-movement closing integrations are implemented; complete cash reconciliation remains disabled pending verified opening/carryforward policy.

Example fixture: funding 700000, approved actual 450000, returned 250000. Funding day cash -700000, expense 0; approval day cash 0, expense 450000; physical return day cash +250000, expense 0. Total cash -450000, expense 450000. Prior baseline income 1250000 plus an independent ordinary nota 450000 is a DIFFERENT scenario, not an advance settlement.

## Mapping to current movement journals (not implemented)

Current migration 007 accepts only `CASH_TRANSACTION` realized SETOR_NOTA and `REVERSAL`, cash-basis source restrictions. Do NOT send advance events through current `accounting_post` or pretend a disbursement is EXPENSE. Future explicitly Owner-approved journal source extension should snapshot immutable lifecycle events/lines with unique source and period/fund/category validation:

* DISBURSE: debit reviewed **employee advance asset**, credit named branch drawer asset.
* APPROVE: debit mapped actual expense categories, credit employee advance asset (NO cash line).
* RETURN: debit named drawer asset, credit employee advance asset.

`liability_advance` (2201) means customer deferred revenue, NOT employee advance asset; never reuse it. Employee asset definition/mapping requires reviewed accounting migration. Preserve independent operational approval and journal approval, accounting period locks, balanced immutable movement journals, missing-opening-balances/incomplete-neraca disclosures. No autojournal/backfill or production financial writes.

## Acceptance and next gate

Isolated retained schemas, real `sipeka_runtime` via VPS SSH helper; fixture maintenance precreates schema/copies deployed ACLs. TDD red evidence recorded before service/disbursement, settlement, read/report implementation. Tests cover RBAC, own cross-day advances, receipt ownership/branch/reuse, exact budget, rejection/resubmission, concurrent retries, contradictory reviews, atomic rollback, immutable originals and runtime denial. Local regression: accounting money, closing privacy, no-2FA tests.

Parent must review migration privileges/invariants, add startup guard coverage, integrate routes/UI/report/closing and test live-like cookie/Origin plus CSV/PDF before release. No commit/push/deploy authorized. Retain every fixture schema; cleanup/archive requires separate warning and fresh explicit confirmation.
