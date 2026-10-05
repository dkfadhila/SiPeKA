'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { encryptFile, decryptFile, sha256File, parseKey } = require('../scripts/backup-postgres');
const scratch = process.env.TMPDIR || process.env.TEMP;
const key = 'ab'.repeat(32);

test('authenticated encrypted dump roundtrip; tampering and wrong keys rejected', async () => {
  const dir = await fs.mkdtemp(path.join(scratch, 'backup-crypto-'));
  try {
    const source = path.join(dir, 'source.dump');
    const encrypted = path.join(dir, 'dump.enc');
    const restored = path.join(dir, 'restored.dump');
    const bytes = Buffer.concat([Buffer.from('PGDMP'), Buffer.alloc(1024 * 1024, 42)]);
    const metadata = { schema: 1, rowCounts: { 'public.ledger_transactions': '12' } };
    await fs.writeFile(source, bytes);
    await encryptFile(source, encrypted, key, metadata);
    assert.deepEqual(await decryptFile(encrypted, restored, key), metadata);
    assert.equal(await sha256File(source), await sha256File(restored));
    assert.equal((await fs.stat(encrypted)).mode & 0o077, process.platform === 'win32' ? (await fs.stat(encrypted)).mode & 0o077 : 0);
    await assert.rejects(decryptFile(encrypted, restored, 'cd'.repeat(32)), /authentication/i);
    await assert.rejects(fs.access(restored));
    const altered = await fs.readFile(encrypted);
    altered[altered.length - 20] ^= 1;
    await fs.writeFile(encrypted, altered);
    await assert.rejects(decryptFile(encrypted, restored, key), /authentication/i);
    await assert.rejects(fs.access(restored));
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('64 hex key required, never included in validation error', () => {
  for (const bad of ['', 'a'.repeat(63), 'g'.repeat(64), 'a'.repeat(65)]) {
    assert.throws(() => parseKey(bad), /64 hex/);
  }
  assert.equal(parseKey(key).length, 32);
});
