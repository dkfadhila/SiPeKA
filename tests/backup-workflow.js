'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const backup = require('../scripts/backup-postgres');

test('libpq credentials use environment only; inherited credentials cleared', () => {
  const env = backup.pgEnvironment('postgresql://testuser:p%40ss@localhost:5433/staging?sslmode=require', { PGHOSTADDR: 'bad', PGPASSFILE: 'bad' });
  assert.equal(env.PGHOST, 'localhost');
  assert.equal(env.PGPORT, '5433');
  assert.equal(env.PGUSER, 'testuser');
  assert.equal(env.PGPASSWORD, 'p@ss');
  assert.equal(env.PGDATABASE, 'staging');
  assert.equal(env.PGSSLMODE, 'require');
  assert.equal(env.PGHOSTADDR, undefined);
  assert.equal(env.PGPASSFILE, undefined);
});

test('selected transaction fingerprint preserves PostgreSQL bigint precision', async () => {
  const record = '{"amount": 9007199254740993, "id": "selected"}';
  const client = { query: async (sql, params) => {
    if (sql.includes('FROM pg_class')) return { rows: [] };
    assert.deepEqual(params, ['selected']);
    return { rows: [{ record }] };
  } };
  const result = await backup.databaseEvidence(client, 'selected');
  assert.equal(result.transactionHash, require('node:crypto').createHash('sha256').update(record).digest('hex'));
});

test('both private targets verified; one failure fails job while preserving local file', async () => {
  const dir = await fs.mkdtemp(path.join(process.env.TMPDIR || process.env.TEMP, 'backup-targets-'));
  try {
    const file = path.join(dir, 'postgres.enc');
    await fs.writeFile(file, 'ciphertext fixture');
    let secondAttempted = false;
    const targets = [
      { name: 'r2', upload: async () => {}, download: async (_, output) => fs.writeFile(output, 'corrupt') },
      { name: 'supabase', upload: async () => { secondAttempted = true; }, download: async (_, output) => fs.copyFile(file, output) }
    ];
    const result = await backup.replicateVerified(file, 'safe/key', targets, dir);
    assert.equal(result.ok, false);
    assert.equal(secondAttempted, true);
    assert.deepEqual(result.targets, [{ target: 'r2', ok: false }, { target: 'supabase', ok: true }]);
    assert.equal(await fs.readFile(file, 'utf8'), 'ciphertext fixture');
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('prune authenticates managed backup; deletes only expired pair and reads deletion back', async () => {
  const dir = await fs.mkdtemp(path.join(process.env.TMPDIR || process.env.TEMP, 'backup-prune-'));
  const encryptionKey = 'ab'.repeat(32);
  try {
    const source = path.join(dir, 'source.dump');
    const encrypted = path.join(dir, 'encrypted');
    await fs.writeFile(source, 'PGDMP fixture');
    const id = '2026-08-01T00-00-00-000Z_00000000-0000-4000-8000-000000000000';
    const manifestKey = backup.PREFIX + 'daily/' + id + '.manifest.json';
    const metadata = { format: 'sipeka-postgres-backup-v1', id, createdAt: '2026-08-01T00:00:00.000Z', dumpSha256: await backup.sha256File(source), rowCounts: [], transactionHash: null, receipts: 'not-included' };
    await backup.encryptFile(source, encrypted, encryptionKey, metadata);
    const manifest = { ...metadata, retention: 'daily', encryptedKey: manifestKey.replace('.manifest.json', '.postgres.enc'), encryptedSha256: await backup.sha256File(encrypted), encryptedBytes: (await fs.stat(encrypted)).size };
    const objects = new Map([[manifestKey, Buffer.from(JSON.stringify(manifest))], [manifest.encryptedKey, await fs.readFile(encrypted)], ['receipts/old.jpg', Buffer.from('receipt')]]);
    const reads = [];
    const target = { name: 'r2', ready: async () => {}, list: async () => [...objects.keys()], download: async (key, file) => fs.writeFile(file, objects.get(key)), remove: async key => objects.delete(key), exists: async key => { reads.push(key); return objects.has(key); } };
    const result = await backup.pruneTargets([target], dir, new Date('2026-10-06T00:00:00Z'), encryptionKey);
    assert.equal(result.ok, true);
    assert.equal(result.targets[0].deleted, 1);
    assert.deepEqual([...objects.keys()], ['receipts/old.jpg']);
    assert.deepEqual(reads.sort(), [manifestKey, manifest.encryptedKey].sort());
    objects.set(manifestKey, Buffer.from(JSON.stringify(manifest)));
    objects.set(manifest.encryptedKey, Buffer.from('not authenticated'));
    const invalid = await backup.pruneTargets([target], dir, new Date('2026-10-06T00:00:00Z'), encryptionKey);
    assert.equal(invalid.ok, false);
    assert.equal(objects.has(manifestKey), true);
    assert.equal(objects.has(manifest.encryptedKey), true);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('retention restricts namespace and exact managed names; daily30 monthly365', () => {
  const now = new Date('2026-10-06T00:00:00Z');
  const id = '2026-08-01T00-00-00-000Z_00000000-0000-4000-8000-000000000000';
  assert.equal(backup.retentionExpired('sipeka/postgres/v1/daily/' + id + '.manifest.json', now), true);
  assert.equal(backup.retentionExpired('sipeka/postgres/v1/monthly/' + id + '.manifest.json', now), false);
  for (const key of ['receipts/old.jpg', 'daily/old.enc', 'sipeka/postgres/v1/daily/user.json', 'sipeka/postgres/v1/daily/' + id + '.postgres.enc']) {
    assert.equal(backup.retentionExpired(key, now), false);
  }
});
