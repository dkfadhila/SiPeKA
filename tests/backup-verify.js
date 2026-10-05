'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const backup = require('../scripts/backup-postgres');
const verify = require('../scripts/verify-backup');

test('restore rejects source database even with different username', () => {
  assert.throws(() => verify.assertStaging({ DATABASE_URL: 'postgres://a:pass@localhost/live', RESTORE_DATABASE_URL: 'postgres://b:pass@localhost/live', BACKUP_RESTORE_CONFIRM: 'EMPTY_STAGING' }), /source database/);
  assert.throws(() => verify.assertStaging({ DATABASE_URL: 'postgres://a:pass@localhost/live', RESTORE_DATABASE_URL: 'postgres://a:pass@localhost/staging' }), /EMPTY_STAGING/);
});

test('restored row counts and selected transaction hashes must match exactly', () => {
  const expected = { rowCounts: [{ schema: 'public', table: 'ledger_transactions', count: '20' }], transactionHash: 'a'.repeat(64) };
  assert.doesNotThrow(() => verify.compareEvidence(expected, expected, true));
  assert.throws(() => verify.compareEvidence(expected, { ...expected, rowCounts: [] }, true), /Row counts/);
  assert.throws(() => verify.compareEvidence(expected, { ...expected, transactionHash: 'b'.repeat(64) }, true), /transaction/);
  assert.throws(() => verify.compareEvidence({ ...expected, transactionHash: null }, expected, true), /transaction/);
});

test('downloads both encrypted artifacts and authenticates dump/metadata; corrupt target fails', async () => {
  const dir = await fs.mkdtemp(path.join(process.env.TMPDIR || process.env.TEMP, 'backup-verify-'));
  const key = 'ab'.repeat(32);
  try {
    const source = path.join(dir, 'source.dump');
    const encrypted = path.join(dir, 'source.enc');
    const id = '2026-10-06T00-00-00-000Z_' + crypto.randomUUID();
    const manifestKey = backup.PREFIX + 'daily/' + id + '.manifest.json';
    await fs.writeFile(source, 'PGDMP test fixture');
    const metadata = { format: 'sipeka-postgres-backup-v1', id, createdAt: '2026-10-06T00:00:00.000Z', dumpSha256: await backup.sha256File(source), rowCounts: [], transactionHash: null, receipts: 'not-included' };
    await backup.encryptFile(source, encrypted, key, metadata);
    const manifest = { ...metadata, retention: 'daily', encryptedKey: manifestKey.replace('.manifest.json', '.postgres.enc'), encryptedSha256: await backup.sha256File(encrypted), encryptedBytes: (await fs.stat(encrypted)).size };
    const targets = ['r2', 'supabase'].map(name => ({ name, ready: async () => {}, download: async (object, file) => object === manifestKey ? fs.writeFile(file, JSON.stringify(manifest)) : fs.copyFile(encrypted, file) }));
    const result = await verify.verifyDownloads(targets, manifestKey, dir, key);
    assert.equal(result.ok, true);
    assert.equal(await backup.sha256File(result.dump), metadata.dumpSha256);
    targets[1].download = async (object, file) => object === manifestKey ? fs.writeFile(file, JSON.stringify(manifest)) : fs.writeFile(file, 'corrupt');
    const failed = await verify.verifyDownloads(targets, manifestKey, dir, key);
    assert.equal(failed.ok, false);
    assert.equal(failed.targets[1].ok, false);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
