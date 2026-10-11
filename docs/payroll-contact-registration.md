# Settings contact registration and manual payroll

- OWNER and STAFF bind their own contacts through authenticated cookie/Origin Settings APIs. No client user_id override. Email Bind is canonical unique authenticated-self registration, not mailbox ownership verification; email_verified remains false. No OTP or external email request occurs.
- Telegram Bind records a claimed case-insensitive username under an exact account-bound SHA-256 token, expiring in ten minutes, single use. Dedicated secret-authenticated webhook accepts only private chat.id=from.id and the matching observed username. Routes use positive numeric chat IDs. Existing exact Owner review remains required after Start, including Owner's own contact.
- Payroll CSV matches unique app username/account UUID; names are display-only. Payroll recipients remain STAFF. Publication never queues messages. Owner chooses one channel and confirms current name, app username, period, address and binding key. Backend rechecks confirmation. Changing contacts invalidates previous registration/binding keys and queued delivery. Historical pending jobs without explicit authorization/binding keys remain ignored; sent/uncertain cannot retry.
- Migration 010 is additive only: provenance columns, Telegram claimed username, recipient binding key, canonical email uniqueness and narrow contact-column grants. No seed/backfill/reset/restore.

## Production backup scope

`scripts/backup-postgres.js` deliberately backs up the production `public` schema only. Both pg_dump (`--schema=public`) and databaseEvidence use this same scope. Retained maintenance-owned QA schemas are excluded, not dropped or granted to the runtime/backup user. Result metadata records schemaScope/excludedSchemas. Encryption, authenticated manifests, R2 and Supabase upload/readback/decryption verification remain mandatory. Receipt objects are backed up separately by the existing receipt script. Default backup performs no pruning/deletion.
