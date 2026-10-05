# SiPeKA PostgreSQL migration

## Scope and contract

PostgreSQL is the primary operational ledger on the existing VPS. R2 and Supabase Storage are attachment/backup destinations, not live databases. This adapter preserves the current Staff/Owner model and existing UI/data; it does not claim to implement the Addendum's future accrual journals, expanded roles, payroll, tax engine, Argon2 conversion, TOTP or encrypted backup workflow.

Owned artifacts: `db-postgres.js`, `migrations/`, `scripts/import-sqlite.js`, `tests/postgres*.js`, this guide. No commit, push, production import, service restart or deployment performed by this implementation.

- Every `db.js` query name exists in `q`; `get`, `all`, `run` are asynchronous. `get` returns `undefined` for no row; `all` returns an array; mutations return `{changes,lastInsertRowid:null}`.
- Existing helper names remain: `verifyPassword`, `hashPassword`, `uid`, `atomicApprove`, `createSession`, `getValidSession`, `revokeUserSessions`, `checkIdempotency`. Crypto helpers remain synchronous to preserve call sites. Password hashes retain the existing scrypt format without rehashing imports.
- `ready` is a promise. It **only verifies** connection, migration checksums, required columns/types, enabled immutable guards and closing uniqueness. It neither migrates nor seeds nor cleans sessions. It rejects on missing/invalid `DATABASE_URL` or schema. Never catch this failure and start SQLite.
- `withRequestTransaction(callback)` acquires one pooled client, begins READ COMMITTED, acquires the shared global `pg_advisory_xact_lock(1397313611)`, executes all adapter queries on that client via AsyncLocalStorage, commits on success, rolls back on throw, releases the client. All mutations are transaction-scoped even outside a request wrapper.
- Nested operations use savepoints. Sibling savepoints/queries are queued, so `Promise.all` cannot release/roll back another sibling's work. A caught SQL constraint error does not poison the surrounding business request. Await every operation; never detach DB work from the callback.
- Single-row inserts/updates require exactly one affected row. Session deletion explicitly permits zero/multiple rows. Terminal approval states cannot be changed. `atomicApprove` checks pending status and affected rows, inserts audit atomically, checks the creator's closing on the transaction's WIB date, and rolls back both status/log if either fails.
- Global idempotency keys and exact existing scope/fingerprint comparisons remain unchanged, including legacy absent fingerprints. Request routes must run the **read checks and writes together**, checking retries before close rejection. Independent helper calls cannot by themselves serialize an entire business decision.
- Money uses `bigint`; sums use PostgreSQL exact numeric aggregation. Per-pool parsers return safe JS numbers and reject values/aggregates beyond safe integer range instead of rounding. Money bounds are ±9,007,199,254,740,991 (positive-only transaction amounts). Fractional kg/liter measurements retain double precision for SQLite REAL parity; no money uses floating point.
- API timestamps remain UTC `YYYY-MM-DD HH:mm:ss` strings; business dates remain `YYYY-MM-DD`. Timestamp columns are UTC `timestamp(0) without time zone`, preserving SQLite strings, with explicit UTC defaults. Today/date filtering uses Asia/Jakarta / UTC+7 independently of host timezone.
- Ledger financial fields cannot change/delete; only pending-to-approved/rejected status transitions are allowed. Closing rows and approval logs cannot update/delete. Closing uniqueness is `(user_id,branch_id,closing_date)`, not branch/date, allowing independent staff closes.
- Exported `db.prepare(sql, {write:true})` accepts PostgreSQL `$n` syntax, not SQLite SQL. Raw `db.exec`/transaction control are deliberately unavailable. Prefer predefined `q` queries; no server route currently needs raw DB methods. `db.close()` closes the pool.

## Prerequisites and explicit commands

Use a supported Node runtime with `node:sqlite` for import/tests (Node 22.13+); `pg` must be installed. Production routes need only PostgreSQL. Supply secrets through the deployment environment/credential manager, never command arguments, source files, chat or logs. `DATABASE_URL` must address an explicitly selected target; credentials/TLS must be configured for that environment. PostgreSQL is internal/loopback only; use a temporary SSH tunnel for remote testing.

From the project directory:

```sh
node migrations/runner.js
node migrations/runner.js --verify
node scripts/import-sqlite.js /absolute/path/online-backup.sqlite
node --test tests/postgres-contract.js tests/postgres-integration.js tests/postgres-business.js tests/postgres-import.js
```

The migration runner executes all unapplied SQL plus its checksum records in one transaction under the same advisory lock. Re-running is safe; edited applied/unknown migrations fail. Add a new numbered SQL file for future changes; do not edit applied migrations. No down migration is provided for immutable financial records.

`SESSION_TTL_HOURS` defaults to 12; permitted range is greater than 0 through 168. Authentication checks/cleans only the requested expired session; password change/reset must update password and revoke all sessions in the same request transaction.

Application integration (owned by server worker):

```js
const storage = process.env.DATABASE_URL ? require('./db-postgres') : require('./db');
await storage.ready; // Before listen; propagate failure and exit.
// For each mutating business request, include auth, reads, checks and writes:
await storage.withRequestTransaction(async () => {
  // Await q.* and helpers. Send success only AFTER outer commit succeeds.
});
```

Do not send success while the transaction is still pending. A callback that returns an HTTP 4xx without throwing commits any previous successful writes; validate before mutation, and throw when the route must roll back earlier writes. External receipt writes/uploads require cleanup/compensation if DB commit fails; they are not transactional with PostgreSQL.

## Import procedure and preservation

1. Freeze application mutations. Preserve the original SQLite DB/receipts and acquire a consistent **SQLite Online Backup API** snapshot. Do not copy a live WAL DB file, and do not require `db.js` to make the backup (module import migrates/seeds SQLite). Keep snapshot/private receipts outside Git and releases.
2. Explicitly migrate the empty PostgreSQL target with a migration-owner role. Verify schema. Stop all other writers during import.
3. Run the importer against the snapshot. It opens SQLite `readOnly:true`, sets `query_only`, takes a read transaction, checks integrity/foreign keys, hashes DB/WAL before/after, and never writes/migrates/seeds SQLite.
4. Import all units/users/COA/ledger/approval logs/closings/receipt metadata in dependency order in one PostgreSQL transaction. Target tables are locked; **all operational target tables, including sessions, must be empty**. Existing data is never merged/truncated. IDs, hashes, timestamps, NULLs, memo/receipt references, amounts, fingerprints and original fields are retained.
5. Legacy `receipt_assets` may be absent and imports as zero. New optional columns absent in old SQLite use conservative PostgreSQL defaults (nullable idempotency scope/fingerprint, default SETOR_NOTA, zero quantities); original columns are never overwritten/backfilled. Unknown source columns, missing required tables/columns, unsafe integer money, noncanonical timestamps, invalid FK/check constraints or duplicate closes cause whole-import rollback. No automatic data repair.
6. Sessions are intentionally omitted; all users log in again. The importer reads back every imported original field and count before commit. Logs expose only counts and verified/session flags, never credentials, passwords/hashes or business rows. It emits a generic failure and nonzero exit status on any mismatch.
7. Receipt metadata import does not copy image bytes. Preserve original keys, move image files through the separately authorized R2 process, verify each reference/private authorization before cutover. A legacy ledger receipt without asset metadata is retained, not silently discarded or rewritten.
8. Parent performs final count/record reconciliation, HTTP/browser tests and explicit cutover. Retain the original SQLite DB read-only for rollback/audit. Rollback after PostgreSQL writes requires a deliberate reconciliation plan, not automatic SQLite fallback.

The importer is not an encrypted backup system. Before deployment verify separately: encrypted `pg_dump`, R2 and Supabase off-site copies, recovery-key custody outside the VPS, restore into a disposable PostgreSQL DB, retention policy and timed recovery. Prefer pg_dump custom-format for preservation. Restore as a migration/recovery owner, not application role.

## Roles and immutable safety

Migrate/import with a controlled schema owner. Runtime must use a separate non-owner role without DDL, `TRUNCATE`, trigger-disable, superuser or replication privileges. Grant only needed table SELECT/INSERT/UPDATE plus sessions DELETE, with least-privilege column UPDATE for users' password and ledger status. Do not grant DELETE on financial/audit tables. Triggers cannot protect data from a superuser/schema owner or TRUNCATE. Ordinary migrations/backups must not disable immutable guards.

The global lock serializes **adapter** mutations, not arbitrary uncoordinated SQL from other tools. All application writers must use the adapter/shared lock; scheduled workers require the same protocol. Correctness is preferred over throughput for the current small Staff/Owner installation.

## Verification evidence and reproduction

Real PostgreSQL 16 tests ran through the authorized temporary VPS SSH tunnel on port 15432 using environment-only DPAPI wrapper. No pg-mem, mocked SQL or synthesized responses. RED observed for missing adapter/migrations/importer; legacy missing-receipt import, parallel nested-savepoint rollback and missing-column schema verification each reproduced failure before correction.

Windows project commands used (wrapper supplies `DATABASE_URL` without printing it):

```sh
python D:/FamilyAgent/Flora/generated/vps-bootstrap/with-stage-db.py node --test tests/postgres-contract.js tests/postgres-integration.js tests/postgres-business.js tests/postgres-import.js
PG_SQLITE_SNAPSHOT='D:/FamilyAgent/Flora/generated/sipeka-vps-implementation/pre-migration.sqlite' python D:/FamilyAgent/Flora/generated/vps-bootstrap/with-stage-db.py node --test tests/postgres-snapshot.js
```

Integration tests require an authorized **disposable** database with schema-create permission. Business/import/snapshot cases create random schemas and drop only those schemas afterward. Migration integration applies explicit migrations to the selected target's current schema. Never point this suite at production.

`postgres-snapshot.js` is opt-in with `PG_SQLITE_SNAPSHOT`; without it the test is explicitly skipped. Approved online-backup snapshot was imported into an isolated schema and verified: units 6, users 1, COA 8, ledger 0, approval logs 0, closings 0, receipt metadata 0; sessions omitted, source SHA-256 unchanged. That is **not** a production import.

Covered: export/query parity, real SQL migrations/idempotent rerun, schema-drift rejection, exact max-safe money and overflow aggregate rejection, UTC strings/WIB date filtering, atomic status/log rollback, concurrent approval single winner, scoped idempotency, post-close approval rejection, immutable ledger/closing/audit guards, per-user closing uniqueness, fractional measured quantities, expiry/password-session revocation, affected-row enforcement, transaction rollback/error recovery, global lock serialization, parallel nested savepoints, read-only full-field SQLite preservation, legacy optional receipt metadata, nonempty target rejection and rollback of partial import.

Final combined real-PostgreSQL run: **5 tests passed, 0 failed, 0 skipped** (including opt-in original snapshot), no warnings. All **32** existing `q` names matched. Explicit migration CLI and `--verify` both succeeded. Unsafe unmarked raw SQL was reproduced RED then rejected GREEN; raw read wrappers also acquire the shared transaction lock.

Remaining parent acceptance: integrated HTTP/UI role/mutation tests; environment-selected startup without fallback; receipt R2 migration; independent runtime role grants; encrypted backups to both providers; restore/recovery drill; production release only through authorized GitHub-first deployment.
