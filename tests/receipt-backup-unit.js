'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nWQAAAAASUVORK5CYII=', 'base64');
const filename = 'evidence-1234567890-abcdef.png';
const snapshot = {
  assets: [{ filename, user_id: 'staff-1', branch_id: 'branch-1', mime: 'image/png', created_at: '2026-10-06T00:00:00' }],
  references: [{ id: 'TEST-TX', user_id: 'staff-1', branch_id: 'branch-1', receipt_key: '/api/receipts/' + filename }]
};
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
module.exports = { PNG, filename, snapshot, hash };

test('missing source receipt fails, never invents or skips bytes', async () => {
  const backup = require('../scripts/backup-receipts');
  await assert.rejects(backup.buildBundle(snapshot, { read: async () => { throw new Error('HTTP 404'); } }), /404/);
});

test('dangling ledger reference fails before any object fetch', async () => {
  const backup = require('../scripts/backup-receipts');
  const invalid = structuredClone(snapshot); invalid.assets = [];
  await assert.rejects(backup.buildBundle(invalid, { read: async () => { throw new Error('must not fetch'); } }), /referenced receipt/);
});

test('ownership, branch, malformed key and duplicate metadata are rejected', () => {
  const backup = require('../scripts/backup-receipts');
  for (const mutate of [s => s.references[0].user_id = 'other', s => s.references[0].branch_id = 'other', s => s.references[0].receipt_key = '/api/receipts/../secret', s => s.assets.push(s.assets[0]), s => s.references.push(s.references[0])]) {
    const invalid = structuredClone(snapshot); mutate(invalid);
    assert.throws(() => backup.validateSnapshot(invalid), /metadata/);
  }
});

test('source hash, MIME, empty and oversize objects are rejected', async () => {
  const backup = require('../scripts/backup-receipts');
  for (const object of [{ bytes: PNG, sha256: '0'.repeat(64) }, { bytes: PNG, mime: 'image/jpeg' }, { bytes: Buffer.alloc(0) }, { bytes: Buffer.alloc(6_000_001) }]) {
    await assert.rejects(backup.buildBundle(snapshot, { read: async () => object }), /mismatch|size/);
  }
});

test('corrupt frame, truncated image, trailing bytes and changed summary fail inspection', async () => {
  const backup = require('../scripts/backup-receipts');
  const bundle = await backup.buildBundle(snapshot, { read: async () => ({ bytes: PNG }) });
  const changed = Buffer.from(bundle.buffer); changed[changed.length - 1] ^= 1;
  for (const bytes of [Buffer.from('no frame'), changed, bundle.buffer.subarray(0, bundle.buffer.length - 1), Buffer.concat([bundle.buffer, Buffer.from('extra')])]) assert.throws(() => backup.inspectBundle(bytes), /bundle|hash|framing|trailing/);
  assert.throws(() => backup.inspectBundle(bundle.buffer, { ...bundle.summary, assetCount: 2 }), /summary/);
});

test('empty database still produces a framed valid bundle', async () => {
  const backup = require('../scripts/backup-receipts');
  const bundle = await backup.buildBundle({ assets: [], references: [] }, { read: async () => { throw new Error('unexpected read'); } });
  assert.equal(backup.inspectBundle(bundle.buffer, bundle.summary).files.length, 0);
});

test('PostgreSQL enumeration uses read-only repeatable snapshot, server JSON timestamps and closes connection', async () => {
  const backup = require('../scripts/backup-receipts');
  const calls = [];
  const client = { connect: async () => calls.push('connect'), end: async () => calls.push('end'), query: async sql => {
    calls.push(sql);
    if (sql.includes('row_to_json(a)')) return { rows: snapshot.assets.map(asset => ({ asset })) };
    if (sql.includes('FROM public.ledger_transactions')) return { rows: snapshot.references };
    return { rows: [] };
  } };
  assert.deepEqual(await backup.readSnapshot({}, { client }), snapshot);
  assert.equal(calls[1], 'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  assert.equal(calls.at(-2), 'COMMIT'); assert.equal(calls.at(-1), 'end');
  client.query = async () => { throw new Error('SQL failure'); };
  await assert.rejects(backup.readSnapshot({}, { client }), /SQL failure/);
  assert.equal(calls.at(-1), 'end');
});

test('framed bundle preserves exact image bytes, receipt ownership, timestamp and transaction ID', async () => {
  const backup = require('../scripts/backup-receipts');
  const reads = [];
  const source = { read: async key => { reads.push(key); return { bytes: PNG, sha256: hash(PNG), mime: 'image/png' }; } };
  const bundle = await backup.buildBundle(snapshot, source);
  const decoded = backup.inspectBundle(bundle.buffer, bundle.summary);
  assert.deepEqual(reads, ['receipts/' + filename]);
  assert.deepEqual(decoded.snapshot, snapshot);
  assert.deepEqual(decoded.files[0].bytes, PNG);
  assert.equal(bundle.summary.assetCount, 1);
  assert.equal(bundle.summary.referenceCount, 1);
  assert.equal(bundle.summary.receiptBytes, PNG.length);
  assert.equal(bundle.summary.bundleSha256, hash(bundle.buffer));
  assert.equal(JSON.stringify(bundle.summary).includes('staff-1'), false);
  assert.equal(JSON.stringify(bundle.summary).includes(filename), false);
});
