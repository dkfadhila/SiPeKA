'use strict';
// Explicit local HTTP transport tests, not real cloud-provider acceptance.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const backup = require('../scripts/backup-receipts');
const { createTargets } = require('../scripts/backup-postgres');
const filename = 'evidence-1234567890-abcdef.png';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nWQAAAAASUVORK5CYII=', 'base64');

test('R2 source adapter uses exact attachment bucket/key, bounded stream and provider hash', async () => {
  let destroyed = false;
  const source = backup.createSource({ R2_ENDPOINT: 'https://unit.invalid', R2_ATTACHMENT_BUCKET: 'private-attachments' }, { client: {
    send: async command => {
      assert.equal(command.constructor.name, 'GetObjectCommand');
      assert.deepEqual(command.input, { Bucket: 'private-attachments', Key: 'receipts/' + filename });
      return { Body: Readable.from([PNG.subarray(0, 8), PNG.subarray(8)]), ContentType: 'image/png', Metadata: { sha256: crypto.createHash('sha256').update(PNG).digest('hex') } };
    }, destroy: () => { destroyed = true; }
  } });
  assert.deepEqual((await source.read('receipts/' + filename)).bytes, PNG);
  await assert.rejects(source.read('receipts/../private'), /source receipt key/);
  source.close(); assert.equal(destroyed, true);
});

test('production Supabase adapter uploads without upsert over local HTTP, reads private bucket and restores byte-identical ciphertext', async t => {
  const root = await fs.mkdtemp(path.join('D:/FamilyAgent/Flora/generated', 'receipt-http-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const objects = new Map(); let isPublic = false; const calls = [];
  const server = http.createServer(async (req, res) => {
    const route = req.url;
    calls.push(req.method + ' ' + route);
    if (route === '/storage/v1/bucket/private-backups') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ public: isPublic })); return; }
    const objectPrefix = '/storage/v1/object/private-backups/';
    if (!route.startsWith(objectPrefix)) { res.writeHead(404); res.end(); return; }
    const key = route.slice(objectPrefix.length);
    if (req.method === 'POST') {
      assert.equal(req.headers['x-upsert'], 'false');
      assert.equal(req.headers['cache-control'], 'no-store');
      assert.ok(key.startsWith('sipeka/receipts/v1/'));
      if (objects.has(key)) { res.writeHead(409); res.end(); return; }
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      objects.set(key, Buffer.concat(chunks)); res.end('{}'); return;
    }
    if (!objects.has(key)) { res.writeHead(404); res.end(); return; }
    res.end(objects.get(key));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const originalFetch = global.fetch;
  // Endpoint stays HTTPS in production adapter; only this test reroutes to loopback.
  global.fetch = (url, options) => originalFetch('http://127.0.0.1:' + server.address().port + new URL(url).pathname, options);
  t.after(() => { global.fetch = originalFetch; });
  const env = { BACKUP_DIR: path.join(root, 'backups'), BACKUP_ENCRYPTION_KEY: crypto.randomBytes(32).toString('hex'), R2_ENDPOINT: 'https://r2.unit.invalid', R2_ACCESS_KEY_ID: 'fixture-only', R2_SECRET_ACCESS_KEY: 'fixture-only', R2_BACKUP_BUCKET: 'backup-fixture', SUPABASE_URL: 'https://supabase.unit.invalid', SUPABASE_SECRET_KEY: 'fixture-only', SUPABASE_BUCKET: 'private-backups' };
  const production = createTargets(env); t.after(() => production.forEach(target => target.close()));
  const r2Objects = new Map();
  const r2 = { name: 'r2', ready: async () => {}, upload: async (key, file) => r2Objects.set(key, await fs.readFile(file)), download: async (key, file) => fs.writeFile(file, r2Objects.get(key), { flag: 'wx' }), close: () => {} };
  const targets = [r2, production[1]];
  const snapshot = { assets: [{ filename, user_id: 'U', branch_id: 'B', mime: 'image/png', created_at: '2026-10-06T00:00:00' }], references: [{ id: 'T', user_id: 'U', branch_id: 'B', receipt_key: '/api/receipts/' + filename }] };
  const result = await backup.runBackup(env, { snapshot, source: { read: async () => ({ bytes: PNG }) }, targets });
  assert.equal(result.ok, true); assert.equal(objects.size, 2);
  assert.equal((await backup.runVerify(env, result.manifestKey, { targets, expectedSnapshot: snapshot })).ok, true);
  assert.ok(calls.some(call => call.startsWith('POST '))); assert.ok(calls.some(call => call.startsWith('GET /storage/v1/object/')));
  isPublic = true;
  assert.equal((await backup.runVerify(env, result.manifestKey, { targets })).ok, false);
  await assert.rejects(production[1].upload(result.manifestKey, path.join(result.localDirectory, 'manifest.json')), /409/);
});
