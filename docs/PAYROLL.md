# SiPeKA payroll integration

Integrated Owner-only HTTP routes and Slip Gaji UI; actual db-postgres getPool exported, bounded worker installed but DISABLED by default. Apply `migrations/004_payroll.sql` after 001/002/003 using existing migration runner; 003 belongs to operations worker. Migration adds `app_users.email`, `app_users.telegram_user_id` if absent. Parent owns authenticated Owner-only contact edit with CSRF protection; never accept recipients from CSV.

## Exact API

```js
const {createPayrollService}=require('./payroll');
const payroll=createPayrollService({pool, encryptionKey:process.env.PAYROLL_ENCRYPTION_KEY});
await payroll.template(actor); // CSV string, access audited
await payroll.importCsv(actor,csv); // {id,period,status:'DRAFT',preview_token,rows}
await payroll.preview(actor,id); // same shape, decrypted rows, audited
await payroll.publish(actor,id,preview_token); // {id,status:'PUBLISHED'}; repeat safe
await payroll.deliveryStatus(actor,id); // [{id,channel,status,attempts,error_code,provider_id,updated_at,user_id}]
await payroll.retryDelivery(actor,outboxId); // blocked/failed only; {id,status:'pending'}
```

`actor` is trusted authenticated `{id,role:'OWNER',session_purpose:'full'}`. Role CEO in brief maps to OWNER in application. Do not construct actors from request body. Service rejects STAFF/ADMIN/OPERATOR/CEO and non-full sessions. Parent must preserve existing session/password/MFA gates, CSRF checks, rate limits, enforce body limits before accumulating uploads, audit authorization failures in security log. Set `Cache-Control: no-store` for every payroll response. Never send payroll into AI contexts, group notifications, general transaction feeds, admin per-person reports or public PDF paths.

Errors have sanitized `code`, `status`; parent catches errors, returns `code` only. Do not log SQL parameters, raw CSV, decrypted rows, PDFs, provider errors or encryption keys. No partial import: validation/unique conflict rolls back complete batch. Duplicate `(period,user_id)` prohibited across draft and published batches. Draft rows immutable; publish must use token returned by preview. No draft deletion/replacement API; corrections require controlled audited operational policy before implementation.

CSV header exactly `period,username,basic_salary,allowances,deductions,pph21`. UTF-8, optional BOM; CRLF/LF; quoted fields supported. No addresses/name/chat fields. Exact case-sensitive unique STAFF username from master data; period `20YY-MM`, one period per upload. Maximum 1 MiB UTF-8, 1000 staff rows, 256 characters/cell. Integer nonnegative IDR only, JS safe integer limits and safe sums; net = basic + allowances - deductions - pph21 must be nonnegative. Formula prefixes, control characters, decimals, separators, negative/exponent values rejected. PPh21 supplied by Owner, not computed TER/compliance engine. Template is header only; externally prepared file uploaded only by Owner.

## Durable delivery

```js
const {createNotificationAdapter,createPayrollDeliveryWorker}=require('./payroll-delivery');
const adapter=createNotificationAdapter({
 emailTransport, // Nodemailer-compatible async sendMail; must return accepted:[recipient],messageId
 emailFrom:process.env.PAYROLL_EMAIL_FROM,
 telegramToken:process.env.TELEGRAM_BOT_TOKEN,
 companyName:'Configured legal entity name'
});
const worker=createPayrollDeliveryWorker({pool,adapter,encryptionKey:process.env.PAYROLL_ENCRYPTION_KEY});
await worker.recoverStale();
await worker.runOnce(); // null when no job, otherwise {id,status[,error_code]}
```

Pool contract: node-postgres `query(sql,params)`, `connect()` returning dedicated client `query`, `release`. Never use SQLite/current db.js facade as pool. Adapter methods `check(channel,to)` synchronous, `email({to,row,idempotencyKey})`/`telegram({...})` async returning `{providerId}`. Worker must be private background code, not a staff-callable API. Parent runs/schedules worker after publish; no sends occur during imports/previews. Drain with bounded loop/concurrency. Worker reads master contacts at delivery time; only current STAFF recipient, exact individual email or positive numeric Telegram user ID. Parent must validate ownership/verified contacts; wrong saved contact means privacy breach. User must first start bot's private chat.

Statuses: pending, processing, sending, sent, blocked, failed, uncertain. Atomic publish creates exactly one outbox row per staff/channel; unique constraint prevents repeat broadcast. `FOR UPDATE SKIP LOCKED` claims jobs. `processing` does no external calls. `sending` recorded before network send. Stale processing (>10 min) returns pending; stale sending becomes uncertain. Conditional attempt-fenced transition prevents stale processing workers sending twice. Adapter/config/contact/decryption failures before send become explicit blocked, never simulated success. Any exception after network entry becomes uncertain; never automatically retry uncertain/sending/sent. Owner can retry only blocked/failed after repairing contacts/config. Current stock adapters conservatively classify all network failures uncertain, not failed.

SMTP/Telegram cannot guarantee exactly-once delivery: crash after acceptance before DB acknowledgement is ambiguous. Preserve uncertain, reconcile provider receipt manually; do not blindly reset status. Stable email Message-ID aids investigation, not a provider idempotency guarantee. `sent` means provider accepted, not recipient read/inbox guaranteed. Network body/token suppressed. Telegram summary contains SiPeKA header, period, net only; private target, protect_content true; full PDF only individual email attachment. No cc/bcc/broadcast implementation.

## Current priority / delivery disabled

Email, Telegram and AI setup deferred. No external deliveries performed. Worker starts ONLY with explicit `PAYROLL_DELIVERY_ENABLED=1`; absent/0 leaves durable outbox pending with zero attempts. UI shows `Belum dikonfigurasi`. Publishing remains available without SMTP/Telegram; template works without payroll encryption key. CSV import/preview requires dedicated key and responds honest 503 `PAYROLL_ENCRYPTION_KEY_REQUIRED` when missing. Do not enable deliveries during acceptance.

HTTP: GET `/api/payroll/template`, `/api/payroll/batches`, `/api/payroll/contacts`; POST `/api/payroll/import` `{csv}`; GET `/api/payroll/:id/preview`, `/api/payroll/:id/delivery`; POST `/api/payroll/:id/publish` `{preview_token}`, `/api/payroll/delivery/:id/retry`. All full-session Owner only, Origin protected writes, no-store responses, generic sanitized errors.

Contacts POST `/api/payroll/contacts` `{user_id,email,telegram_user_id,verified:true}` requires Owner direct attestation of recipient identity/private bot chat; syntax validation is not ownership proof. Migration 004 adds verified flags default false; worker blocks unverified contacts. No provider verification flow installed. Credentials remain unset. Nodemailer dependency installed before the priority changed; adapter stays opt-in dormant.

## Required configuration

- `PAYROLL_ENCRYPTION_KEY`: dedicated 64 hex characters (32 random bytes), AES-256-GCM; required by sensitive service operations and worker; template exempt. Never reuse AUTH_TOTP_KEY. Random 12-byte IV, GCM tag, entry ID AAD; all amounts/full detail encrypted in one payload. No monetary plaintext DB columns/outbox/PDF storage. Key kept separately from DB/backups; retain keys for ten-year recovery. Rotation requires explicit decrypt/re-encrypt migration; no key rotation tool included.
- Real SMTP/provider transport injected. Optional parent install: `npm install nodemailer`, configure SMTP host/port/TLS/auth + sender in secret environment, finite connection/socket timeouts. No dependency/package changes here. Missing transport or sender produces PAYROLL_EMAIL_CONFIG blocked.
- `TELEGRAM_BOT_TOKEN` passed explicitly; missing token produces PAYROLL_TELEGRAM_CONFIG blocked. No production sends during tests.
- `companyName` configured legal entity. Dependency-free valid one-page PDF, SiPeKA letterhead, detailed integer IDR amounts, FINAL label, Owner approval line. Helvetica ASCII transliteration; no uploaded logo or cryptographic signature. Unicode font/logo layout upgrade needs parent-selected renderer (e.g. pdfkit); not claimed implemented.

Audit is append-only: template/import preview/preview/publish/status/retry/worker reads, actor IDs and batch IDs only. PostgreSQL trigger prevents entry/audit modifications and published-batch changes. Apply least-privilege DB grants: app/worker must not own tables, disable triggers, delete audit or export all payroll data. Parent owns retention/backup/aggregate reporting and security denied-access audit. Ten-year encrypted storage plus separate key retention required.

## Verification

`node --test tests/payroll.test.js` tests pure CSV, encryption/RBAC, PDF, adapter with injected offline fixtures.

PostgreSQL engine test uses optional PGlite WASM test-only runtime installed outside repo:

```sh
npm install --prefix D:/FamilyAgent/Flora/generated/sipeka-operations/payroll-test-runtime --no-audit --no-fund @electric-sql/pglite
PAYROLL_TEST_PGLITE='D:/FamilyAgent/Flora/generated/sipeka-operations/payroll-test-runtime/node_modules/@electric-sql/pglite' node --test tests/payroll.test.js tests/payroll-integration.test.js
```

Integration executes 001 + 004, true PostgreSQL SQL/constraints/triggers, encrypted storage, transactional rollback, idempotent publish, blocked config retry, single-recipient offline adapter acceptance, uncertain no replay and stale recovery. Not a real network PostgreSQL deployment test; no DATABASE_URL/local server configured. Run service contract against staging node-postgres before production. PGlite test pool serializes transactions, so live multi-connection SKIP LOCKED concurrency verification remains staging acceptance criterion.
