# Receipt backups and independent restore verification

Receipt bytes are **not** inside `backup-postgres.js` dumps. Successful full backup acceptance requires both the PostgreSQL job and this receipt job. This script uses the existing `encryptFile`, `decryptFile`, `createTargets`, `replicateVerified`, `sha256File` and canonical JSON helpers without changing them.

## Scope and guarantees

- Read-only PostgreSQL `REPEATABLE READ` enumeration of every `public.receipt_assets` row. Server-side JSON preserves exact UTC timestamp strings rather than converting timestamps through host timezone. Capture ledger receipt references with transaction ID, actor ID, branch ID and receipt key in the same transaction.
- Fetch **only** `R2_ATTACHMENT_BUCKET` objects at exact `receipts/<filename>` keys. Never enumerate, write or delete source objects. Missing registered objects, dangling references, actor/branch mismatches, unsafe filenames, duplicate IDs, conflicting source checksum/MIME, empty objects and objects larger than 6,000,000 bytes fail the job.
- Include all registered assets, even uploads not yet attached to a transaction. Unregistered R2 objects are not part of this registry backup. Legacy external receipt URLs fail closed rather than being silently omitted.
- Custom `SIPERC01` framed archive contains full receipt metadata, transaction references and exact image bytes. Each image has size/SHA-256; the metadata set, image inventory and whole bundle have SHA-256. Bound complete archive to 256 MiB and JSON header to 16 MiB; exceeding limits fails, never truncates.
- AES-256-GCM uses the existing PostgreSQL crypto envelope. Public envelope metadata and manifests contain only format, unique backup ID/time, counts, sizes and aggregate hashes. No filenames, actor/branch/transaction IDs, image bytes, database URL or secrets in manifests.
- Unique `sipeka/receipts/v1/<UTC-time>_<UUID>.receipts.enc` plus `.manifest.json` keys. Upload/read-back byte verification for **both** R2 backup bucket and Supabase Storage. Publish a provider's manifest only after its encrypted object verifies. Any provider failure means exit 1, even if the other provider succeeds. No prune/retention/deletion feature; existing PostgreSQL retention namespace is unaffected.
- Independent verify downloads each provider's manifest and encrypted bytes, checks outer size/hash, decrypts/authenticates GCM, checks authenticated manifest fields, parses every frame, verifies every image, validates exact references/ownership and aggregate metadata/image hashes. One corrupt copy does not prevent authenticating the other. Both successful copies must describe the identical authenticated backup.
- Optional database comparison asserts the **complete** metadata/reference snapshot against current PostgreSQL. Useful immediately after backup or against a restored matching DB; later legitimate live changes will fail this exact comparison.

## Environment (existing backend names)

Do not put secrets in commands, source control or test reports. Load the protected VPS environment through its existing service/job mechanism. These utilities do **not** load `.env` automatically.

| Name | Role |
| --- | --- |
| `DATABASE_URL` | PostgreSQL enumeration; also verify with `--check-database` |
| `BACKUP_DIR` | Private local backup root, outside release/public/upload directories |
| `BACKUP_ENCRYPTION_KEY` | Existing 64-hex-character AES key; secure separately from backups |
| `R2_ENDPOINT`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY` | Existing HTTPS R2 API configuration |
| `R2_ATTACHMENT_BUCKET` | Source receipt bucket |
| `R2_BACKUP_BUCKET` | Encrypted backup target |
| `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SUPABASE_BUCKET` | Existing private Storage backup target |
| `UPLOADS_DIR` | Optional original local receipt directory; protected from restore writes |
| `TEST_TX_ID` | Optional acceptance transaction; must reference an archived receipt |
| `TEST_RECEIPT_FILENAME` | Optional exact acceptance image filename |
| `TEST_RECEIPT_SHA256` | Optional external expected image SHA-256; requires filename |

Supabase bucket readiness checks `public === false`. R2 S3 readiness **does not prove bucket privacy**: separately check account-side that source and backup buckets have no public `r2.dev` or custom-domain exposure. Do not claim private-provider acceptance from successful uploads alone. Source and backup bucket privacy are deployment gates owned by the parent/account operator.

## Exact commands

Run from the backend directory with dependencies installed. Supported deployment runtime: Node 24; local verification also runs on installed Node 26.

```bash
node --check scripts/backup-receipts.js
node --test tests/receipt-backup*.js
node scripts/backup-receipts.js --help
node scripts/backup-receipts.js backup
```

Use the exact `manifestKey` from the backup JSON result, not a guessed/latest key:

```bash
node scripts/backup-receipts.js verify --manifest-key "$RECEIPT_MANIFEST_KEY"
node scripts/backup-receipts.js verify --manifest-key "$RECEIPT_MANIFEST_KEY" --check-database
node scripts/backup-receipts.js verify --manifest-key "$RECEIPT_MANIFEST_KEY" --check-database --output "$NEW_ISOLATED_RECEIPT_RESTORE_DIR"
```

`RECEIPT_MANIFEST_KEY` and `NEW_ISOLATED_RECEIPT_RESTORE_DIR` above are shell variables supplied by the operator, not additional script environment settings. Output parent directory must exist. Output directory must be new, outside code, `BACKUP_DIR` and original uploads, and on the same filesystem as `BACKUP_DIR` for atomic directory publication. Symlinked paths and original-directory aliases are rejected. CLI exits 0 only on full success; otherwise 1. Errors are deliberately sanitized.

### Real-provider acceptance (parent runs on protected VPS)

1. Create a labeled disposable Staff receipt/transaction through the real application. Independently record its `TEST_TX_ID`, exact `TEST_RECEIPT_FILENAME` and SHA-256 of the original submitted bytes. Load these nonsecret identifiers into the job environment.
2. Pause application writes during paired PostgreSQL/receipt backup acceptance. These separate scripts do not share a PostgreSQL dump snapshot; ongoing uploads or ledger writes can otherwise produce different backup instants.
3. Run PostgreSQL backup and its existing independent restore checks. Then run receipt backup and independent verify above with `--check-database`. For historical PostgreSQL restore comparison, point receipt verify's `DATABASE_URL` at the matching isolated restored database, not the live ledger.
4. Run the opt-in test below. It performs **real remote writes** under unique receipt backup keys, preserves encrypted local artifacts, deletes no source/backup objects and verifies both real downloads. It refuses zero-asset acceptance and requires the independent image SHA-256.

```bash
RECEIPT_BACKUP_INTEGRATION=1 node --test tests/receipt-backup-integration.js
```

The normal local suite skips this test unless explicitly enabled. Unit transport tests use named in-memory R2/database fixtures; one Supabase adapter test uses a loopback HTTP server and a test-only fetch reroute. They are **not** real-provider acceptance. No credentials, `.env` or account state are read by those tests. Test artifacts are created under `D:/FamilyAgent/Flora/generated` and cleaned up.

## Plaintext and restore safety

Local backup job directory is private mode 0700; files mode 0600 on POSIX. Windows requires appropriate filesystem ACLs in addition to mode flags. Backup plaintext bundle is deleted after encryption, with cleanup also attempted on failures. Normal verify uses a private temporary directory under `BACKUP_DIR`; downloaded/decrypted files and staged restores are removed in `finally` on success/failure. Local persistent artifacts: ciphertext, sanitized manifest and sanitized result JSON only. Restore without `--output` retains no plaintext.

`--output` explicitly requests persistent private plaintext for recovery inspection. Only after **both** providers validate does it publish independent `r2/receipts/<filename>` and `supabase/receipts/<filename>` trees, each with `metadata.json`. No database inserts, original overwrite or source upload occurs. The operator is responsible for securely removing that isolated output after inspection. Cleanup cannot run after power loss or SIGKILL; inspect stale private bundle/verification directories before restart and remove them under the same protected job account. Ordinary unlink is not guaranteed forensic secure erasure; use encrypted private disk/storage for the scratch root.

## Acceptance record

- Local RED observed: missing receipt module/API; missing CLI; symlink traversal; corrupt first-provider manifest incorrectly blocking second-provider authentication. Regression fixes verified with real crypto.
- Local tests cover valid PNG bytes, empty inventory, missing assets, missing references, metadata ownership, hash/MIME/size limits, frame corruption, both-target attempts, private Supabase readiness, no-upsert HTTP transport, bad GCM tags/wrong key/forged manifest, external TEST-image hash, isolated restore protection and cleanup.
- Deployment remains gated on account privacy and the real-provider TEST receipt run. A zero-asset backup is valid operationally but not sufficient receipt acceptance.
