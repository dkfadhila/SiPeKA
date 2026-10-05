'use strict';
// Async DB contract harness backed by the real SQLite schema; not a PostgreSQL substitute.
const fs = require('node:fs');
const path = require('node:path');
if (process.env.SIPEKA_ASYNC_HARNESS === '1') {
  const Module = require('node:module');
  const original = Module._load;
  const { AsyncLocalStorage } = require('node:async_hooks');
  const scope = new AsyncLocalStorage();
  let facade;
  Module._load = function (id, parent, main) {
    if ((id === './db-postgres' || id === './db') && parent.filename.endsWith('server.js')) {
      if (!facade) {
        const real = original.call(this, path.resolve(__dirname, '../db.js'), parent, main);
        const synchronous = process.env.SIPEKA_SYNC_HARNESS === "1";
        if (process.env.SIPEKA_INACTIVE_BRANCH === '1') real.db.prepare("UPDATE business_units SET is_active=0 WHERE id='UNIT_LC'").run();
        const delay = fn => synchronous ? fn : async (...args) => { await new Promise(r => setTimeout(r, 2)); return fn(...args); };
        const q = Object.fromEntries(Object.entries(real.q).map(([name, stmt]) => [name,
          Object.fromEntries(['get', 'all', 'run'].map(method => [method, delay((...args) => {
            if (!synchronous && method === 'run' && name !== 'insertReceipt' && !scope.getStore()) throw new Error('write outside request transaction');
            if (name === 'insertReceipt' && process.env.SIPEKA_FAIL_RECEIPT === '1') throw new Error('fixture insert failure');
            if (name === 'insertTx') process.env.SIPEKA_COMMIT_ARMED = '1';
            if (name === 'insertTx' && process.env.SIPEKA_TX_ERROR) throw Object.assign(new Error('fixture transaction conflict'), { code: Number(process.env.SIPEKA_TX_ERROR) });
            return stmt[method](...args);
          })]))]));
        facade = { ...real, q,
          db: { prepare(sql) { const stmt = real.db.prepare(sql); return { get: delay(() => { if (process.env.SIPEKA_FAIL_READY === '1') throw new Error('fixture unavailable'); return stmt.get(); }) }; } },
          ready: new Promise((resolve, reject) => setTimeout(() => process.env.SIPEKA_FAIL_STARTUP === '1' ? reject(new Error('fixture startup unavailable')) : resolve(), 30)),
          withRequestTransaction: async callback => {
            const result = await scope.run(true, callback);
            if (process.env.SIPEKA_FAIL_COMMIT === '1' && process.env.SIPEKA_COMMIT_ARMED === '1') throw new Error('fixture COMMIT failure');
            return result;
          } };
        facade.ready.catch(() => {});
        for (const name of ['createSession', 'getValidSession', 'revokeUserSessions', 'checkIdempotency', 'atomicApprove']) facade[name] = delay(real[name]);
      }
      return facade;
    }
    if (id === './storage' && parent.filename.endsWith('server.js') && process.env.SIPEKA_STORAGE_FIXTURE === '1') {
      return {
        async saveReceipt(asset) { const target = path.join(process.env.UPLOADS_DIR, asset.filename); fs.writeFileSync(target, asset.buffer); return { ...asset, key: 'receipts/' + asset.filename }; },
        async readReceipt(asset) { return fs.readFileSync(path.join(process.env.UPLOADS_DIR, asset.filename)); },
        async deleteReceipt(asset) { fs.unlinkSync(path.join(process.env.UPLOADS_DIR, asset.filename)); },
      };
    }
    return original.call(this, id, parent, main);
  };
} else {
  const { test } = require('node:test');
  const assert = require('node:assert/strict');
  const { spawn } = require('node:child_process');
  const net = require('node:net');
  const crypto = require('node:crypto');
  const root = path.resolve(__dirname, '..');
  async function start(t, options = {}) {
    const synchronous = process.env.SIPEKA_TEST_SQLITE === '1';
    const scratch = fs.mkdtempSync('D:/FamilyAgent/Flora/generated/sipeka-vps-implementation/server-http-');
    const uploads = path.join(scratch, 'receipts'); fs.mkdirSync(uploads);
    const password = crypto.randomBytes(16).toString('hex');
    const port = await new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
    const child = spawn(process.execPath, ['--require', __filename, path.join(root, 'server.js')], {
      cwd: root, env: { ...process.env, DATABASE_URL: synchronous ? '' : 'contract-harness', SIPEKA_SYNC_HARNESS: synchronous ? '1' : '0', SIPEKA_ASYNC_HARNESS: '1', SIPEKA_STORAGE_FIXTURE: process.env.SIPEKA_TEST_REAL_STORAGE === '1' ? '0' : '1', STORAGE_BACKEND: 'filesystem',
        DB_PATH: path.join(scratch, 'app.db'), UPLOADS_DIR: uploads, SIPEKA_SEED: '1', SIPEKA_OWNER_PASSWORD: password,
        SIPEKA_OWNER_USERNAME: 'testowner', PORT: String(port), HOST: '127.0.0.1', KARA_BASE_URL: '', KARA_API_KEY: '', ...options }
    });
    let logs = ''; child.stdout.on('data', b => logs += b); child.stderr.on('data', b => logs += b);
    t.after(async () => { if (child.exitCode === null) { child.kill(); await new Promise(r => child.once('exit', r)); } fs.rmSync(scratch, { recursive: true, force: true }); });
    const base = `http://127.0.0.1:${port}`;
    for (let i = 0; i < 100; i++) { try { if ((await fetch(base + '/api/health')).ok) break; } catch {} if (child.exitCode !== null) throw new Error(logs); await new Promise(r => setTimeout(r, 30)); }
    async function request(route, token, body) {
      const res = await fetch(base + route, { method: body === undefined ? 'GET' : 'POST', headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const type = res.headers.get('content-type') || '';
      return { status: res.status, body: type.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer()), headers: res.headers };
    }
    const login = await request('/api/login', null, { username: 'testowner', password });
    assert.equal(login.status, 200, JSON.stringify(login.body));
    return { request, owner: login.body.token, uploads, password, logs: () => logs };
  }
  async function staff(request, owner, suffix = 'one') {
    const password = crypto.randomBytes(16).toString('hex');
    const created = await request('/api/users', owner, { username: 'staff' + suffix, full_name: 'Fixture Staff', role: 'STAFF', branch_id: 'UNIT_LP', password });
    assert.equal(created.status, 201, JSON.stringify(created.body));
    const login = await request('/api/login', null, { username: 'staff' + suffix, password });
    assert.equal(login.status, 200); return login.body.token;
  }
  test('staff creation rejects missing or inactive branch; transaction money rejects coercion', async t => {
    const { request, owner, password } = await start(t);
    const inactive = await start(t, { SIPEKA_INACTIVE_BRANCH: '1' });
    assert.equal((await inactive.request('/api/users', inactive.owner, { username: 'inactive', full_name: 'Inactive Branch', role: 'STAFF', password, branch_id: 'UNIT_LC' })).status, 400);
    assert.equal((await request('/api/users', owner, { username: 'unassigned', full_name: 'No Branch', role: 'STAFF', password })).status, 400);
    const token = await staff(request, owner);
    for (const amount of [true, false, null, '', ' ', '1e3', '0x10', [], {}, '1.2', '1xyz']) {
      assert.equal((await request('/api/transactions', token, { amount, tx_type: 'INCOME', coa_id: '4101' })).status, 400, JSON.stringify(amount));
    }
    assert.equal((await request('/api/transactions', token, { amount: '1250', tx_type: 'INCOME', coa_id: '4101', idempotency_key: 'valid-money' })).status, 201);
    assert.equal((await request('/api/transactions', token, { amount: '1250', tx_type: 'INCOME', coa_id: '4101', idempotency_key: 'valid-money', memo: 'changed' })).status, 409);
    assert.equal((await request('/api/closing/summary', token)).body.system_balance, 1250);
  });
  test('closing accepts measured decimals up to three places; money and counters stay integral', async t => {
    const { request, owner } = await start(t); const token = await staff(request, owner);
    for (const [field, value] of [['kg_reguler', 1.2345], ['stock_perfume', '0.0001'], ['physical_cash', null], ['total_nota', 1.5], ['income_qris', true], ['income_cash', '1e3']]) {
      const body = { physical_cash: 0, [field]: value };
      assert.equal((await request('/api/closing', token, body)).status, 400, field);
    }
    const body = { physical_cash: 0, total_nota: 3, kg_reguler: 1.125, kg_express: '2.345', kg_kilat: 0.1, stock_detergent: '0.333', stock_perfume: 1.5, idempotency_key: 'close-decimals' };
    assert.equal((await request('/api/closing', token, body)).status, 201);
    const rows = (await request('/api/closings', token)).body;
    assert.equal(rows.length, 1); assert.equal(rows[0].kg_express, 2.345); assert.equal(rows[0].stock_detergent, 0.333);
    assert.equal((await request('/api/closing', token, body)).body.idempotent, true);
    assert.equal((await request('/api/closing', token, { ...body, kg_reguler: 2 })).status, 409);
  });
  test('async owner unit creation and password reset await writes and revoke sessions', async t => {
    const { request, owner, password } = await start(t);
    const unit = await request('/api/units', owner, { name: 'Fixture New Branch', code: 'NEW', category: 'LAUNDRY' });
    assert.equal(unit.status, 201); assert.ok((await request('/api/units', owner)).body.some(row => row.id === unit.body.id));
    const token = await staff(request, owner);
    const user = (await request('/api/users', owner)).body.find(row => row.username === 'staffone');
    assert.equal((await request('/api/users/reset-password', owner, { user_id: user.id, new_password: password })).status, 200);
    assert.equal((await request('/api/me', token)).status, 401);
    const login = await request('/api/login', null, { username: 'staffone', password }); assert.equal(login.status, 200);
    assert.equal((await request('/api/change-password', login.body.token, { old_password: password, new_password: crypto.randomBytes(16).toString('hex') })).status, 200);
    assert.equal((await request('/api/me', login.body.token)).status, 401);
  });
  test('startup database readiness rejection prevents the server from listening', async t => {
    await assert.rejects(start(t, { SIPEKA_FAIL_STARTUP: '1' }), /Database readiness failed; server not listening/);
  });
  test('PostgreSQL COMMIT failure never sends a premature success response', { skip: process.env.SIPEKA_TEST_SQLITE === '1' }, async t => {
    const { request, owner } = await start(t, { SIPEKA_FAIL_COMMIT: '1' });
    assert.equal((await request('/api/transactions', owner, { amount: 1, branch_id: 'UNIT_LP' })).status, 500);
    assert.equal((await request('/api/me', owner)).status, 200);
  });
  test('typed request errors preserve HTTP status and do not kill the server', async t => {
    const { request, owner } = await start(t, { SIPEKA_TX_ERROR: '409' });
    const result = await request('/api/transactions', owner, { amount: 1, branch_id: 'UNIT_LP' });
    assert.equal(result.status, 409); assert.equal((await request('/api/me', owner)).status, 200);
  });
  test('readiness performs a database round-trip; unavailable DB returns 503', async t => {
    const { request, owner } = await start(t);
    const ready = await request('/api/ready', owner); assert.equal(ready.status, 200); assert.equal(ready.body.ok, true);
    const failed = await start(t, { SIPEKA_FAIL_READY: '1' });
    assert.equal((await failed.request('/api/ready')).status, 503);
  });
  const image = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lZkAAAAASUVORK5CYII=';
  test('manual upload stores private evidence; authenticated read enforces actor scope', async t => {
    const { request, owner, uploads } = await start(t); const token = await staff(request, owner); const other = await staff(request, owner, 'two');
    const upload = await request('/api/receipts/upload', token, { image, branch_id: 'UNIT_LC' });
    assert.equal(upload.status, 201, JSON.stringify(upload.body)); assert.match(upload.body.receipt_key, /^\/api\/receipts\/evidence-/);
    assert.equal(fs.readdirSync(uploads).length, 1);
    assert.equal((await request(upload.body.receipt_key)).status, 401);
    assert.equal((await request(upload.body.receipt_key, other)).status, 403);
    const own = await request(upload.body.receipt_key, token); assert.equal(own.status, 200); assert.deepEqual(own.body, Buffer.from(image, 'base64'));
    assert.equal(own.headers.get('content-type'), 'image/png'); assert.ok(own.headers.get('content-security-policy').includes('blob:'));
    assert.equal((await request(upload.body.receipt_key, owner)).status, 200);
    assert.equal((await request('/uploads/receipts/' + path.basename(upload.body.receipt_key), owner)).status, 404);
    const tx = await request('/api/transactions', token, { amount: 10, receipt_key: upload.body.receipt_key }); assert.equal(tx.status, 201);
    assert.equal((await request('/api/transactions', token)).body.rows[0].receipt_key, upload.body.receipt_key);
    assert.equal((await request('/api/receipts/upload', token, { image: 'iVBORw0KGgo=' })).status, 400);
    const ocr = await request('/api/widya/extract', token, { image });
    assert.equal(ocr.status, 503); assert.match(ocr.body.error, /konfigurasi/i); assert.ok(ocr.body.receipt_key);
  });
  test('failed receipt metadata insertion deletes object before returning error', async t => {
    const { request, owner, uploads } = await start(t, { SIPEKA_FAIL_RECEIPT: '1' });
    const result = await request('/api/receipts/upload', owner, { image, branch_id: 'UNIT_LP' });
    assert.equal(result.status, 500); assert.deepEqual(fs.readdirSync(uploads), []);
  });
  test('async DB login waits for user lookup and session writes; GET arrays resolve', async t => {
    const { request, owner } = await start(t);
    assert.equal((await request('/api/me', owner)).body.role, 'OWNER');
    const units = await request('/api/units', owner); assert.ok(Array.isArray(units.body)); assert.equal(units.body.length, 6);
    const users = await request('/api/users', owner); assert.ok(Array.isArray(users.body)); assert.equal(users.body.length, 1);
    assert.deepEqual((await request('/api/transactions', owner)).body.rows, []);
    assert.deepEqual((await request('/api/closing/summary', owner)).body.closings, []);
    assert.deepEqual((await request('/api/closings', owner)).body, []);
    assert.deepEqual((await request('/api/staff-performance', owner)).body, []);
    assert.equal((await request('/api/logout', owner, {})).status, 200);
    assert.equal((await request('/api/me', owner)).status, 401);
  });
}
