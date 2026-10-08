# Receipt backup storage metadata contract

New bundle headers use `sipeka-receipts-backup-v2`; framing (`SIPERC01`), receipt keys and image bytes are unchanged. Readers accept original `sipeka-receipts-backup-v1` bundles. The manifest/encryption envelope and object prefix remain v1 for compatibility; the authenticated bundle checksum binds the versioned header and storage metadata.

Each v2 file optionally includes `metadata` with exactly `original_filename` and `sha256`. Friendly names must match the complete ASCII allowlist `^[A-Za-z0-9._-]{1,120}\.jpeg$`; metadata SHA256 must equal the receipt bytes. Invalid present metadata fails backup/inspection, rather than silently dropping names. Metadata-free receipts remain valid. `imagesSha256` now authenticates file descriptors including optional storage metadata; `metadataSha256` retains the database snapshot meaning.

`STORAGE_BACKEND=filesystem` reads private `UPLOADS_DIR` receipt bytes and `.metadata.json` sidecars. Sidecars are bounded to 1024 bytes, reject symlinks, checked against the opened descriptor and exact receipt digest. `STORAGE_BACKEND=r2` (or unset, preserving this script's historical default) retains `Metadata.original_filename` from the exact attachment object.

`verify --output <NEW_ISOLATED_FOLDER>` remains an isolated restore only: no automatic database or provider writes. Both verified replicas contain:

- `metadata.json`: original receipt asset/reference snapshot.
- `receipts/<canonical filename>`: unchanged image bytes.
- `receipts/<canonical filename>.metadata.json`: friendly-name/hash sidecar, only when present in the bundle.
- `storage-metadata.json`: keyed by `receipts/<canonical filename>`, each entry containing explicit `ContentType` and `Metadata` (`sha256`, optional `original_filename`). This is the R2 re-upload contract for separately authorized restoration; upload each image with its exact corresponding object metadata. It is not an executable restore or permission to overwrite objects.

Legacy v1 restores omit friendly sidecars and preserve canonical download fallback. They also emit the additive `storage-metadata.json` descriptor with the verified digest and original MIME.
