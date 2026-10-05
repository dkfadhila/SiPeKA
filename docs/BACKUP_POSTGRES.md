# PostgreSQL encrypted backup and restore verification

## Topology and policy

PostgreSQL on VPS is the single primary ledger. Cloudflare R2 is the private attachment store and primary offsite backup. Supabase **Storage** is the secondary backup; this does not create three live SQL databases.

Canonical Addendum: nightly 02:00 Asia/Jakarta (WIB), RPO 24 hours, RTO 4 hours, rolling daily retention 30 days, monthly retention 365 days, actual restore drill monthly. These scripts alone do not install a scheduler or prove RPO/RTO. Financial-record retention 10 years is a separate application/archive obligation; backup rotation must never remove ledger rows.

## Environment (no credentials in source, arguments or output)

Provide a protected service environment, outside Git/code releases. Do not paste credentials into command lines or logs. Disable shell tracing. Set local backup directory permissions to owner-only (0700 directory, 0600 files on Linux); use an appropriate restricted ACL on Windows.

Required:

- `DATABASE_URL`: primary PostgreSQL URL. Percent-encode special characters in username/password. `pg_dump` receives parsed `PGHOST`, `PGPORT`, `PGUSER`, `PGDATABASE`, `PGPASSWORD`; URL/password never passed as command arguments. URL `sslmode`, `sslrootcert`, `sslcert`, `sslkey` are mapped to libpq variables. Inherited `PG*` variables are cleared to prevent connecting to another database.
- `BACKUP_ENCRYPTION_KEY`: exactly 64 hexadecimal characters, representing 32 random bytes. Escrow outside the server and outside backup objects. Losing this key loses recoverability. Pruning older backups requires their original key; key rotation needs a separate retention procedure.
- `BACKUP_DIR`: absolute persistent writable location outside repository/releases/public directories. Local encrypted backup and safe JSON evidence remain after provider failures.
- `R2_ENDPOINT`: HTTPS S3 API endpoint, not a public delivery domain.
- `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BACKUP_BUCKET`.
- `SUPABASE_URL`: HTTPS project URL.
- `SUPABASE_SECRET_KEY`: server-side secret key, sent only as `apikey` header. No invented Bearer JWT. Never expose this key to browsers.
- `SUPABASE_BUCKET`: private Storage bucket, normally `sipeka-backups`. Privacy is checked through the real bucket API before upload/download.

Optional:

- `PG_DUMP_BIN`, `PG_RESTORE_BIN`: PostgreSQL 16 executable paths on the VPS; defaults `pg_dump`, `pg_restore` from PATH. Use versions compatible with the server and dump. Node dependencies `pg`, `@aws-sdk/client-s3` already installed.
- `TEST_TX_ID`: existing `public.ledger_transactions.id`. Use the same value for backup and restore drill. A SHA-256 fingerprint of PostgreSQL's canonical JSONB text is recorded, not the transaction record/ID. Integer financial values never pass through JavaScript numeric conversion.
- `BACKUP_MANIFEST_KEY`: exact object key printed by a successful backup.
- `VERIFY_REFERENCE_DUMP`: optional known plaintext custom-format dump path for an additional hash comparison. Must represent the same snapshot; a later live dump is not equivalent.
- `RESTORE_DATABASE_URL`: explicitly disposable empty staging database, never the primary.
- `BACKUP_RESTORE_CONFIRM=EMPTY_STAGING`: required explicit restore authorization.
- `RUN_BACKUP_INTEGRATION=1`: enables the opt-in real-provider/real-restore test.

R2 must have public access/custom public domains disabled by infrastructure provisioning. S3 does not expose a reliable R2 bucket-public-state query; this script does not pretend to verify that account setting. Encrypted backup objects have no public URL/ACL. Provide narrowly scoped backup-bucket credentials. Supabase bucket must be private, even though its contents are encrypted.

## Backup

With the protected environment already loaded:

```sh
node scripts/backup-postgres.js
node scripts/backup-postgres.js --monthly
```

The job opens a read-only repeatable-read PostgreSQL transaction, exports its snapshot, invokes `pg_dump --format=custom --no-password --snapshot=... --file=...`, and counts every non-system ordinary/partitioned table against that same snapshot. This prevents writes during backup from falsifying the restore baseline. It also captures `TEST_TX_ID` when configured. No application database module, migration or seed is imported.

Dump streams through authenticated AES-256-GCM: random 96-bit IV, authenticated format/header/metadata, encrypted custom dump, 128-bit authentication tag. SHA-256 fingerprints record plaintext and encrypted bytes. GCM authentication completes before any plaintext output is accepted. Wrong keys, changed ciphertext or changed authenticated metadata fail verification and remove partial plaintext.

Once encryption succeeds, the unnecessary local plaintext dump is removed. If dump/encryption itself fails, a partial plaintext dump can remain owner-only for recovery; operators must remove it securely after investigating. Ordinary upload failures leave the encrypted artifact and manifests intact.

Managed namespace:

```text
sipeka/postgres/v1/daily/<UTC-time>_<UUID>.postgres.enc
sipeka/postgres/v1/daily/<UTC-time>_<UUID>.manifest.json
sipeka/postgres/v1/monthly/<UTC-time>_<UUID>.postgres.enc
sipeka/postgres/v1/monthly/<UTC-time>_<UUID>.manifest.json
```

Daily always; monthly automatically on day 1 WIB, or explicitly with `--monthly`. Unique names prevent overwriting prior backups. R2 conditional create and Supabase `x-upsert: false` enforce no replacement. Manifest records format, timestamps, hashes, byte size, row counts, selected-transaction fingerprint, retention class and receipt coverage; no URLs, passwords, tokens or connection credentials.

For **each** target: upload encrypted artifact, download it, compare byte length/SHA-256, then upload/download/verify its manifest. Failure in one target does not prevent attempting the other. A manifest is published only where the corresponding artifact passed download verification. Exit 0 only when both targets verify every requested class. Exit 1 otherwise. JSON result records independent target success; `result.json` remains in the local job directory. Provider/SQL error text is deliberately suppressed because it can contain secrets or financial records.

## Retention: opt-in deletion only

```sh
node scripts/backup-postgres.js --prune
```

**This command deletes expired managed backup pairs. Enable only after provider/restore acceptance and approval of the retention policy.** Default has no deletion. Prune runs only after the new backup verifies on both targets. It lists only `sipeka/postgres/v1/`, accepts only exact generated manifest names, applies daily 30/monthly 365 days, validates the paired key, downloads and authenticates the encrypted dump/metadata before deleting the exact pair, then reads back object absence. Invalid/orphaned/unreadable backups fail closed; no bucket-wide lifecycle rule is installed. Other prefixes, `receipts/`, unknown filenames and existing user objects are untouched. Local backups are not automatically pruned.

## Download and cryptographic verification (not a restore)

Load `BACKUP_MANIFEST_KEY` from `backups[].manifestKey` in the backup result into the protected environment:

```sh
node scripts/verify-backup.js
```

Both real targets are downloaded independently. Encrypted size/hash, manifest agreement, GCM authentication, authenticated metadata and decrypted dump hash must agree. Optional `VERIFY_REFERENCE_DUMP` also compares the known dump. Downloaded encrypted files/manifests remain local. Plaintext verification files are removed when verification finishes. `verification.json` records results.

**A successful download-only run reports `restored: false`. It proves byte recovery, not PostgreSQL restorability.**

## Actual monthly restore drill

Provision a separate empty staging database; never point restore credentials at production. No `--clean`, `DROP DATABASE`, schema drop or application seed is used. The script refuses a same-host/port/database URL and refuses a staging database containing non-system tables, views, sequences, materialized views or foreign tables. DNS/host aliases can hide equivalence; use a distinct staging database name and least-privilege credentials that cannot write production.

Set source URL, protected staging URL, `BACKUP_RESTORE_CONFIRM=EMPTY_STAGING`, same `TEST_TX_ID` used during backup, and exact manifest key. Run:

```sh
node scripts/verify-backup.js --restore
```

The job actually invokes `pg_restore --no-password --exit-on-error --single-transaction --no-owner --no-privileges --dbname=<staging-name> <authenticated-dump>`. Credentials are environment-only. It then queries the restored PostgreSQL with `pg`, comparing complete table identities/counts to the authenticated snapshot baseline and checking the selected transaction's exact JSONB fingerprint. Missing transaction baseline fails; it is never synthesized. Restore errors fail the job; no simulated success. Schema/data restore executes atomically; post-restore validation failure leaves staging available for diagnosis. Staging remains populated, so a subsequent drill needs a separately provisioned new empty database.

Application writes must remain disabled in staging during the drill. PostgreSQL logical dumps can execute SQL; accept only authenticated backups made with the escrowed key. Logical backup excludes cluster globals/role provisioning. `--no-owner --no-privileges` intentionally avoids restoring production grants to staging.

## Tests and acceptance

```sh
node --test tests/backup*.js
RUN_BACKUP_INTEGRATION=1 node --test tests/backup-integration.js
```

Unit tests use explicit synthetic dump bytes and transport adapters; they do **not** represent provider or PostgreSQL verification. The opt-in integration test calls real `pg_dump`, uploads/downloads R2 and Supabase, then calls real `pg_restore` against explicitly approved empty staging, checking all table counts and `TEST_TX_ID`. No credentials are written. Failure exits nonzero. Local environment lacking PostgreSQL tools/provider env must report this as unverified, not fabricate output.

Deployment acceptance:

- [ ] Verify PostgreSQL 16 dump/restore tools and least-privilege backup account.
- [ ] Verify private R2 bucket and private Supabase bucket/access permissions.
- [ ] Run real integration test against production snapshot + disposable staging.
- [ ] Schedule 02:00 WIB daily with overlap prevention (`flock`/service lock).
- [ ] Alert on nonzero exit, missing backup/manifest or age exceeding RPO 24h.
- [ ] Escrow key and time actual restore against RTO 4h; repeat monthly.
- [ ] Approve prefix-only pruning; never reuse the policy for ledger records.
- [ ] Implement/verify private receipt-asset backup coverage before claiming complete disaster recovery.

## Receipt assets: explicitly deferred phase

This version backs up PostgreSQL, including receipt-reference/ownership rows, but **does not copy R2 `receipts/` binary assets**. Every manifest/result declares `receipts: not-included`. No claim of complete attachment recovery is made. Source bucket name/version policy and expected object volume were not supplied; large receipt copying would add cost and operational scope.

Next phase must enumerate private source `receipts/` with pagination, preserve each exact key and byte content in an encrypted backup inventory/archive (never public objects), include metadata/hash/reference reconciliation, replicate/download-verify both destinations, and restore into an isolated private bucket without overwriting originals. Keep attachment retention separate from managed DB backup prefix rotation. No existing receipt object is deleted by these scripts.
