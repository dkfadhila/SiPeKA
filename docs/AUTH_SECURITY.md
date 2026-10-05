# SiPeKA authentication security

## Kebijakan terbaru Tirta
Fitur 2FA Owner dihapus: panel/enrollment/confirmation/verification tidak tersedia; endpoint TOTP mengembalikan404. Login memakai password dan cookie aman tanpa MFA. `REQUIRE_OWNER_2FA=0` dipertahankan di konfigurasi. Cookie Secure/HttpOnly, CSRF, Argon2, idle expiry, pembatasanlogin dan passwordkuat tetap berlaku. Kolom migration002 lama dipertahankan supaya sejarah/schema/data tidak dirusak, tetapi tidak menentukan login. Jangan reset password Owner. Tes TOTP lama merupakan historis, bukan acceptance fitursekarang.

## Release prerequisites (historis, kewajiban 2FA diganti kebijakan di atas)

1. Install locked dependencies (`npm ci`): `@node-rs/argon2`, `otpauth`, existing `pg`.
2. Backup database and encryption keys. Apply `node migrations/runner.js` explicitly against the intended database through the established secret-safe deployment mechanism. Migration `001` is unchanged. New `002_auth_security.sql` adds authentication columns, marks existing Owner accounts for an interactive password change, deletes existing sessions. It never changes existing password hashes. Apply after data import, not before an import that replaces users or sessions. Owner onboarding must remain behind maintenance/private access until completed.
3. Set `NODE_ENV=production`, `PUBLIC_ORIGIN=https://<canonical-host>`, `REQUIRE_OWNER_2FA=1`, `AUTH_TOTP_KEY=<64 hexadecimal characters representing 32 cryptographically random bytes>`. Keep the key in the deployment secret store; back it up encrypted separately from PostgreSQL. Never log it or submit it through chat. Production refuses startup without these gates. Do not use a test environment on the public listener.
4. `SESSION_IDLE_MINUTES=30` default (positive, at most 1440). Absolute lifetime remains `SESSION_TTL_HOURS=12` default, enforced by the DB adapter. Expired/idle sessions are deleted; successful authentication updates persisted `last_seen_at` without extending absolute expiry.
5. Set `TRUSTED_PROXY_IPS` to an explicit comma-separated list of actual socket peer IPs, e.g. `127.0.0.1,::1` only when the local reverse proxy is the sole reachable peer. Firewall the Node listener. Proxy must preserve canonical HTTP Host and overwrite X-Forwarded-For with **one validated client IP**, not append attacker input. Arbitrary XFF / X-Forwarded-Host / X-Forwarded-Proto is never trusted. For chained proxies, normalize the verified client IP at the final trusted hop.
6. Keep `ALLOW_PRIVATE_QA_BEARER` unset/0. It is honored only outside production and only when explicitly `1`; never used by browser frontend. Login otherwise omits token JSON. Private QA login still needs same-origin Origin; established explicit QA Bearer requests can omit Origin.

## Existing Owner coordination

Existing production Owner: username `mafucan`, full_name `Raditya Martanegara`. Parent may update only that existing production/staging user row while public maintenance remains; preserve financial data. No Owner reset, hardcoded password or ordinary-startup seed is performed here. Any temporary password must remain secret-store only and must retain `password_change_required=true`; public release requires the Owner's interactive 12-character-or-longer password change plus confirmed TOTP. If staging migration 002 is already applied or users are imported afterward, parent must explicitly preserve/set this flag on the existing Owner row because migrations do not rerun.

## Passwords

New, changed, reset passwords require 12–1024 characters and are asynchronously hashed with Argon2id: memory 65536 KiB, iterations 3, parallelism 1, output 32 bytes. Existing legacy scrypt salt:hash remains valid; successful password login transparently rehashes the same password to Argon2id, including old passwords shorter than 12. No automatic password reset. Exported DB `hashPassword` and legacy DB verification helpers remain unchanged for import/DB compatibility; server uses `auth-security.js` instead.

Existing Owners are flagged by migration 002. Their authenticated session cannot read ledger/receipts/users or mutate business data until they change their own password. Change and reset revoke all sessions. TOTP-enabled Owners must pass MFA before password change. Owner password reset does not disable TOTP or remove its recovery hashes.

## Sessions and CSRF

Host-only `sipeka_session` cookie: `Path=/; HttpOnly; SameSite=Strict; Secure` in production, no Domain. Browser API and private receipt fetches use same-origin credentials, never Bearer or session token localStorage. Legacy token/user localStorage entries are removed. Reload restores via `/api/me`; logout revokes DB session, expires cookie, clears private receipt blobs and authenticated state.

All unsafe API methods, including login/logout, require exact canonical Origin and Host; absent/foreign Origin rejected. Foreign Fetch Metadata rejected. No forwarded-host/protocol shortcuts. Production canonical origin must be HTTPS. Approved CORS configuration does not override CSRF policy.

Login permits five attempts per normalized account and per verified client in 15 minutes; sixth rejected. Successful password authentication clears those buckets. MFA uses separate account/client buckets, five attempts/15 minutes, reset after confirmed enrollment/verification. Buckets are bounded, process-local: deploy one Node process; restart resets limits. Multi-process deployment requires a shared limiter or equivalent reverse-proxy throttling before scale-out. Existing DB request advisory lock serializes authentication mutations across processes, including one-use recovery consumption and TOTP counter replay protection.

## Owner TOTP

Only an authenticated OWNER session can enroll. `/api/auth/totp/enroll` POST requires current password; server creates a 20-byte secret, stores AES-256-GCM ciphertext plus 10-minute pending expiry. Returns local `otpauth://` URI and secret only in no-store authenticated response. No external QR endpoint. No password/secret/code/query-value logging.

`/api/auth/totp/confirm` POST requires a current authenticator code. Activates secret, invalidates every prior session, returns eight cryptographically random 128-bit recovery codes **once**. Save offline before leaving Settings. DB stores only SHA-256 recovery hashes; each code consumed transactionally once. TOTP SHA1, six digits, 30-second period, ±1-step drift. Persisted last accepted counter rejects reuse, including replay of enrollment code.

With `REQUIRE_OWNER_2FA=1`, unenrolled Owners receive `setup` cookie purpose only. They can view `/api/me`, logout, change password, enroll, confirm; business routes denied. Enrolled Owners receive `mfa` purpose only: `/api/me`, logout, TOTP verification allowed; password change denied until MFA. `/api/auth/totp/verify` accepts TOTP or `recovery_code`, consumes proof, rotates session token to `setup` when password change still required, otherwise `full`. Settings renders these flows in-page using existing classes. Staff enrollment always denied.

No self-service TOTP disable, recovery-code regeneration, or lost-all-factors administrator reset is implemented. Lost factors plus all recovery codes require a separately reviewed, audited private recovery procedure; do not disable public MFA to work around it. Back up AUTH_TOTP_KEY; key loss prevents decrypting enrolled secrets.

## Verification

Tests use only generated credentials, isolated random PostgreSQL schemas, filesystem receipts in `D:/FamilyAgent/Flora/generated/sipeka-vps-implementation`; teardown drops each exact random schema. Never reads user credentials from chat/.env or writes production DB.

- `node --test tests/auth-security.test.js tests/auth-security-frontend.js`
- `python D:/FamilyAgent/Flora/generated/vps-bootstrap/with-stage-db.py node --test tests/auth-security-postgres.js tests/auth-security-ledger-postgres.js tests/auth-security-migration.js`

The auth PostgreSQL test also drives real headless Chrome through Owner enrollment, one-use recovery verification, forced password change, successful TOTP, cookie restore after reload, logout; browser page errors must remain empty. Browser executable may be overridden with `AUTH_TEST_BROWSER` on other machines. `auth-security-ledger-postgres.js` is the cookie transport equivalent of the pre-existing real-PG ledger suite. Older `server-postgres-real.js` and mock HTTP fixtures still expect Bearer tokens; parent should migrate those consumers to cookies rather than enable public Bearer. `tests/postgres-integration.js` hardcodes one migration and is obsolete after 002; its first assertion currently fails (`2 !== 1`). It also migrates the connection's default schema before creating its own random schema; do not run it against a shared DB. During broader regression execution it applied 002 to staging's default schema; no production DB was accessed. Parent must review staging state; no automatic rollback attempted.

CSS/approved design, reports, money formulas, migration 001, db-postgres.js unchanged. No commit/push/deploy by this task.
