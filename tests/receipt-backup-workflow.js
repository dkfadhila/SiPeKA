'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const backup = require('../scripts/backup-receipts');
const pgBackup = require('../scripts/backup-postgres');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nWQAAAAASUVORK5CYII=', 'base64');
const filename = 'evidence-1234567890-abcdef.png';
const snapshot = { assets: [{ filename, user_id: 'staff-1', branch_id: 'branch-1', mime: 'image/png', created_at: '2026-10-06T00:00:00' }], references: [{ id: 'TEST-TX', user_id: 'staff-1', branch_id: 'branch-1', receipt_key: '/api/receipts/' + filename }] };
function stores() {
  return ['r2','supabase'].map(name => {
    const objects = new Map(); const calls = [];
    return { name, objects, calls, ready: async () => { calls.push('ready'); }, upload: async (key, file) => { assert.ok(key.startsWith(backup.PREFIX)); assert.equal(objects.has(key), false); objects.set(key, await fs.readFile(file)); calls.push('upload:' + key); }, download: async (key, file) => { calls.push('download:' + key); if (!objects.has(key)) throw new Error('missing'); await fs.writeFile(file, objects.get(key), { flag: 'wx' }); }, close: () => {} };
  });
}
async function fixture(t) {
  const root = await fs.mkdtemp(path.join('D:/FamilyAgent/Flora/generated', 'receipt-backup-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const env = { BACKUP_DIR: path.join(root, 'private-backups'), BACKUP_ENCRYPTION_KEY: crypto.randomBytes(32).toString('hex'), TEST_TX_ID: 'TEST-TX', TEST_RECEIPT_FILENAME: filename };
  return { root, env, targets: stores(), source: { read: async () => ({ bytes: PNG, mime: 'image/png' }), close: () => {} } };
}
module.exports = { fixture, snapshot, PNG, filename, stores };

test('one corrupt replica fails backup but still attempts other provider; publishes only verified manifest', async t => {
  const f = await fixture(t);
  const normal = f.targets[0].download;
  f.targets[0].download = async (key, file) => { await normal(key, file); await fs.appendFile(file, 'corrupt'); };
  const result = await backup.runBackup(f.env, { snapshot, source: f.source, targets: f.targets });
  assert.equal(result.ok, false);
  assert.equal(f.targets[0].objects.has(result.manifestKey), false);
  assert.equal(f.targets[1].objects.has(result.manifestKey), true);
  assert.equal((await fs.readdir(result.localDirectory)).includes('receipts.bundle'), false);
});

test('private target readiness failure does not block independent other-provider attempt', async t => {
  const f = await fixture(t);
  f.targets[1].ready = async () => { throw new Error('public bucket'); };
  const result = await backup.runBackup(f.env, { snapshot, source: f.source, targets: f.targets });
  assert.equal(result.ok, false);
  assert.equal(f.targets[0].objects.size, 2); assert.equal(f.targets[1].objects.size, 0);
});

test('corrupt GCM image cannot pass even with recomputed outer checksum; both providers attempted, no partial restore', async t => {
  const f = await fixture(t);
  const result = await backup.runBackup(f.env, { snapshot, source: f.source, targets: f.targets });
  const target = f.targets[0];
  const manifest = JSON.parse(target.objects.get(result.manifestKey));
  const corrupt = Buffer.from(target.objects.get(manifest.encryptedKey)); corrupt[corrupt.length - 1] ^= 1;
  manifest.encryptedSha256 = crypto.createHash('sha256').update(corrupt).digest('hex');
  target.objects.set(manifest.encryptedKey, corrupt);
  target.objects.set(result.manifestKey, Buffer.from(JSON.stringify(manifest)));
  const output = path.join(f.root, 'failed-restore');
  const verified = await backup.runVerify(f.env, result.manifestKey, { targets: f.targets, output });
  assert.equal(verified.ok, false);
  assert.ok(f.targets[1].calls.includes('download:' + result.manifestKey));
  assert.equal(verified.targets[1].ok, true);
  await assert.rejects(fs.stat(output), { code: 'ENOENT' });
  assert.equal((await fs.readdir(f.env.BACKUP_DIR)).some(name => name.startsWith('.verify-')), false);
});

test('wrong key, forged counts and changed live database metadata fail verification', async t => {
  const f = await fixture(t);
  const result = await backup.runBackup(f.env, { snapshot, source: f.source, targets: f.targets });
  const wrong = await backup.runVerify({ ...f.env, BACKUP_ENCRYPTION_KEY: crypto.randomBytes(32).toString('hex') }, result.manifestKey, { targets: f.targets });
  assert.equal(wrong.ok, false);
  const db = structuredClone(snapshot); db.assets[0].created_at = 'changed';
  assert.equal((await backup.runVerify(f.env, result.manifestKey, { targets: f.targets, expectedSnapshot: db })).ok, false);
  for (const target of f.targets) {
    const manifest = JSON.parse(target.objects.get(result.manifestKey)); manifest.assetCount++;
    target.objects.set(result.manifestKey, Buffer.from(JSON.stringify(manifest)));
  }
  assert.equal((await backup.runVerify(f.env, result.manifestKey, { targets: f.targets })).ok, false);
});

test('successful verification matches external TEST receipt SHA256 and transaction association', async t => {
  const f = await fixture(t);
  f.env.TEST_RECEIPT_SHA256 = crypto.createHash('sha256').update(PNG).digest('hex');
  const result = await backup.runBackup(f.env, { snapshot, source: f.source, targets: f.targets });
  assert.equal((await backup.runVerify(f.env, result.manifestKey, { targets: f.targets, expectedSnapshot: snapshot })).ok, true);
  assert.equal((await backup.runVerify({ ...f.env, TEST_RECEIPT_SHA256: '0'.repeat(64) }, result.manifestKey, { targets: f.targets })).ok, false);
});

test('source failure leaves no plaintext; missing TEST receipt fails before uploads', async t => {
  const f = await fixture(t);
  await assert.rejects(backup.runBackup(f.env, { snapshot, source: { read: async () => { throw new Error('404'); } }, targets: f.targets }), /404/);
  await assert.rejects(backup.runBackup({ ...f.env, TEST_TX_ID: 'absent' }, { snapshot, source: f.source, targets: f.targets }), /TEST_TX_ID/);
  assert.equal(f.targets[0].objects.size, 0);
  for (const dir of await fs.readdir(f.env.BACKUP_DIR)) assert.deepEqual(await fs.readdir(path.join(f.env.BACKUP_DIR, dir)), []);
});

test('existing, original, backup and symlinked restore paths are rejected', async t => {
  const f = await fixture(t);
  for (const output of [f.root, f.env.BACKUP_DIR, path.join(__dirname, '..', 'uploads', 'receipts', 'new')]) await assert.rejects(backup.assertRestoreDirectory(output, f.env), /isolated|not exist/);
  const real = path.join(f.root, 'real-parent'); await fs.mkdir(real);
  const link = path.join(f.root, 'linked-parent'); await fs.symlink(real, link, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(backup.assertRestoreDirectory(path.join(link, 'new'), f.env), /symlink/);
  await assert.rejects(backup.runVerify(f.env, 'receipts/user.manifest.json', { targets: f.targets }), /manifest key/);
});

test('rejects newline-suffixed source filename before fetching', async () => {
  let fetched = false;
  const unsafe = structuredClone(snapshot);
  unsafe.assets[0].filename += '\n'; unsafe.references = [];
  await assert.rejects(backup.buildBundle(unsafe, { read: async () => { fetched = true; return { bytes: PNG }; } }), /metadata/);
  assert.equal(fetched, false);
});

test('restore cannot enter actual source directory through a symlinked UPLOADS_DIR alias', async t => {
  const f = await fixture(t);
  const real = path.join(f.root, 'source-real'); await fs.mkdir(real);
  const alias = path.join(f.root, 'source-alias'); await fs.symlink(real, alias, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(backup.assertRestoreDirectory(path.join(real, 'new'), { ...f.env, UPLOADS_DIR: alias }), /isolated/);
});

test('private backup root rejects symlinked ancestors', async t => {
  const f = await fixture(t);
  const real = path.join(f.root, 'real'); await fs.mkdir(real);
  const link = path.join(f.root, 'link');
  await fs.symlink(real, link, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(backup.runBackup({ ...f.env, BACKUP_DIR: path.join(link, 'nested') }, { snapshot, source: f.source, targets: f.targets }), /symlink/);
});

test('CLI help documents backup, verify and isolated restoration', async () => {
  const { promisify } = require('node:util');
  const { execFile } = require('node:child_process');
  const result = await promisify(execFile)(process.execPath, ['scripts/backup-receipts.js', '--help']);
  assert.match(result.stdout, /verify --manifest-key/);
  assert.match(result.stdout, /--output/);
  assert.match(result.stdout, /--check-database/);
});

test('zero-asset database creates authentic encrypted backup and verifies both empty inventories', async t => {
  const f = await fixture(t);
  delete f.env.TEST_TX_ID; delete f.env.TEST_RECEIPT_FILENAME;
  const empty = { assets: [], references: [] };
  const result = await backup.runBackup(f.env, { snapshot: empty, source: { read: async () => { throw new Error('unexpected source fetch'); } }, targets: f.targets });
  assert.equal(result.ok, true); assert.equal(result.assetCount, 0); assert.equal(result.receiptBytes, 0);
  assert.equal((await backup.runVerify(f.env, result.manifestKey, { targets: f.targets, expectedSnapshot: empty })).ok, true);
});

test('backup uses actual AES-GCM, verifies both copies, removes plaintext, then independently verifies both restores', async t => {
  const f = await fixture(t);
  const result = await backup.runBackup(f.env, { snapshot, source: f.source, targets: f.targets });
  assert.equal(result.ok, true);
  assert.ok(result.manifestKey.startsWith('sipeka/receipts/v1/'));
  for (const target of f.targets) assert.equal(target.objects.size, 2);
  const local = await fs.readdir(result.localDirectory);
  assert.deepEqual(local.sort(), ['manifest.json','receipts.enc','result.json']);
  const manifest = JSON.parse(await fs.readFile(path.join(result.localDirectory, 'manifest.json')));
  for (const secret of ['staff-1', filename, 'TEST-TX', f.env.BACKUP_ENCRYPTION_KEY]) assert.equal(JSON.stringify(manifest).includes(secret), false);
  const plain = path.join(f.root, 'manual.plain');
  const metadata = await pgBackup.decryptFile(path.join(result.localDirectory, 'receipts.enc'), plain, f.env.BACKUP_ENCRYPTION_KEY);
  assert.equal(metadata.assetCount, 1);
  assert.deepEqual(backup.inspectBundle(await fs.readFile(plain)).files[0].bytes, PNG);
  await fs.rm(plain);
  const restore = path.join(f.root, 'isolated-restore');
  const verified = await backup.runVerify(f.env, result.manifestKey, { targets: f.targets, output: restore });
  assert.equal(verified.ok, true);
  assert.deepEqual(verified.targets.map(x => x.ok), [true,true]);
  for (const name of ['r2','supabase']) {
    assert.deepEqual(await fs.readFile(path.join(restore, name, 'receipts', filename)), PNG);
    assert.deepEqual(JSON.parse(await fs.readFile(path.join(restore, name, 'metadata.json'))), snapshot);
  }
  assert.equal((await fs.readdir(f.env.BACKUP_DIR)).some(name => name.startsWith('.verify-')), false);
});
