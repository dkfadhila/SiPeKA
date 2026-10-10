# Payroll delivery

Owner imports header-only CSV template, validates preview, explicitly publishes using the preview token. Staff cannot preview/publish. Amounts/names are AES-256-GCM ciphertext bound to entry ID. A dedicated stable 64-hex PAYROLL_ENCRYPTION_KEY is required; preserve it privately with backups, never rotate blindly against stored ciphertext.

Publication transaction creates exactly one email and one Telegram job per entry. Delivery reads trusted staff master contacts, not CSV contacts. Owner must attest contacts; duplicate/shared contacts block. Each email contains only the employee's own PDF. Telegram permits positive private user IDs only, protects content, contains period/net pay only, never claims email success.

## Configuration and activation

Integrate generated server.integration.patch before enabling anything. PAYROLL_TELEGRAM_BOT_TOKEN deliberately does not fall back to Hermes TELEGRAM_BOT_TOKEN. Owner must choose dedicated bot or explicitly authorize reuse of existing Widya bot. Reuse does not authorize gateway/cron/monitor activation.

SMTP needs explicit PAYROLL_SMTP_HOST, PAYROLL_SMTP_PORT, PAYROLL_SMTP_USER, PAYROLL_SMTP_PASSWORD, PAYROLL_EMAIL_FROM. No guessed account, host, port, sender, anonymous fallback. Port 465 uses implicit TLS; other configured ports require STARTTLS. Transport disables file/URL attachment fetching. Readiness means configuration presence/format only, not authenticated provider verification.

PAYROLL_DELIVERY_ENABLED absent/0 disables application scheduling. Publish remains pending, attempts=0. Only Owner authorization permits setting it to 1: this can send existing queued published payroll. Review queue, contacts, provider readiness first. Never use production payroll/test messages as a configuration probe without explicit authorization.

## Status semantics

Separate status per employee/channel: pending, processing, sending, sent, blocked, failed, uncertain. `sent` means SMTP/Telegram accepted, not inbox/device delivery or read receipt. SMTP Message-ID is correlation, not provider idempotency.

Record sending before network access. Attempt-fenced transition rejects stale workers. Preflight failures block without sending. Timeout/error/unknown provider acceptance quarantines uncertain; no automatic retries. Stale sending becomes uncertain; stale processing returns pending. Owner retry permits blocked/failed only, never sent/uncertain. Audit stores metadata only; raw provider exceptions never enter DB/logs.

## Verification

Run with external test-only PGlite installation:

`PAYROLL_TEST_PGLITE='D:/FamilyAgent/Flora/generated/sipeka-operations/payroll-test-runtime/node_modules/@electric-sql/pglite' node --test tests/payroll.test.js tests/payroll-delivery-completion.test.js tests/payroll-integration.test.js`

This executes PostgreSQL WASM migrations/triggers with injected offline transports; not live PostgreSQL multi-connection/HTTP acceptance. Do not run payroll-http-real.test.js against production: its existing teardown deletes its fixture schema. Parent owns isolated runtime HTTP/server integration proof.
