'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('PostgreSQL adapter supplies every existing SQLite query and helper without SQLite fallback', async () => {
  const root = path.resolve(__dirname, '..');
  assert.ok(fs.existsSync(path.join(root, 'db-postgres.js')), 'PostgreSQL adapter must exist');
  const source = fs.readFileSync(path.join(root, 'db.js'), 'utf8');
  const names = [...source.slice(source.indexOf('const q = {')).matchAll(/^\s*(\w+): db\.prepare/gm)].map(m => m[1]).sort();
  const adapterSource = fs.readFileSync(path.join(root, 'db-postgres.js'), 'utf8');
  assert.ok(!/require\(['"](?:\.\/db|node:sqlite)['"]\)/.test(adapterSource));
  const original = process.env.DATABASE_URL;
  delete process.env.DATABASE_URL;
  const adapter = require('../db-postgres');
  await assert.rejects(adapter.ready, /DATABASE_URL/);
  assert.deepEqual(Object.keys(adapter.q).sort(), names);
  for (const name of names) for (const op of ['get', 'all', 'run']) assert.equal(typeof adapter.q[name][op], 'function');
  for (const name of ['verifyPassword', 'hashPassword', 'uid', 'atomicApprove', 'createSession', 'getValidSession', 'revokeUserSessions', 'checkIdempotency', 'withRequestTransaction']) assert.equal(typeof adapter[name], 'function', name);
  assert.equal(adapter.verifyPassword('fixture-password', adapter.hashPassword('fixture-password', 'fixture-salt')), true);
  assert.equal(adapter.verifyPassword('wrong', 'malformed'), false);
  await adapter.db.close();
  if (original !== undefined) process.env.DATABASE_URL = original;
});
