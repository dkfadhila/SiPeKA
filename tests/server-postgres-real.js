'use strict';
// Real PostgreSQL HTTP integration. Dedicated random schema; never resets shared public schema.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const net = require('node:net');
const { spawn } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const image = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/lZkAAAAASUVORK5CYII=';
test('real PostgreSQL HTTP: isolated schema, sessions, private receipt, atomic idempotency, approval, decimal closing', { skip: !process.env.DATABASE_URL, timeout: 90000 }, async t => {
  const { Pool } = require('pg');
  const admin = new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 10000 });
  const schema = 'server_http_' + crypto.randomBytes(8).toString('hex');
  const url = new URL(process.env.DATABASE_URL); url.searchParams.set('options', '-c search_path=' + schema);
  const connectionString = url.toString();
  const pool = new Pool({ connectionString, connectionTimeoutMillis: 10000 });
  let child, logs = '';
  const scratch = fs.mkdtempSync('D:/FamilyAgent/Flora/generated/sipeka-vps-implementation/server-realpg-');
  t.after(async () => {
    if (child && child.exitCode === null) { child.kill(); await new Promise(r => child.once('exit', r)); }
    await pool.end();
    await admin.query('DROP SCHEMA IF EXISTS "' + schema + '" CASCADE');
    assert.equal((await admin.query('SELECT 1 FROM pg_namespace WHERE nspname=$1', [schema])).rowCount, 0);
    await admin.end();
    fs.rmSync(scratch, { recursive: true, force: true });
  });
  await admin.query('CREATE SCHEMA "' + schema + '"');
  await require('../migrations/runner').migrate(pool);
  const password = crypto.randomBytes(16).toString('hex');
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = salt + ':' + crypto.scryptSync(password, salt, 64).toString('hex');
  await pool.query("INSERT INTO business_units(id,code,name,category) VALUES('HTTP_BRANCH','HTTP','HTTP Fixture','LAUNDRY'),('HTTP_OTHER','OTHER','Other Fixture','LAUNDRY')");
  await pool.query("INSERT INTO chart_of_accounts(id,account_code,account_name,account_type) VALUES('4101','4101','Fixture Income','REVENUE'),('5101','5101','Fixture Expense','EXPENSE')");
  await pool.query("INSERT INTO app_users(id,username,password_hash,full_name,role) VALUES('HTTP_OWNER','httpowner',$1,'HTTP Owner','OWNER')", [hash]);
  const port = await new Promise(r => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
  child = spawn(process.execPath, [path.join(root, 'server.js')], { cwd: root, env: { ...process.env, DATABASE_URL: connectionString, STORAGE_BACKEND: 'filesystem', UPLOADS_DIR: path.join(scratch, 'receipts'), PORT: String(port), HOST: '127.0.0.1', SIPEKA_SEED: '0', KARA_BASE_URL: '', KARA_API_KEY: '' } });
  child.stdout.on('data', b => logs += b); child.stderr.on('data', b => logs += b);
  const base = `http://127.0.0.1:${port}`;
  let healthy = false;
  for (let i = 0; i < 200; i++) { try { if ((await fetch(base + '/api/health')).ok) { healthy = true; break; } } catch {} if (child.exitCode !== null) throw new Error('server exited before ready: ' + logs); await new Promise(r => setTimeout(r, 50)); }
  assert.ok(healthy, 'server became healthy');
  async function request(route, token, body) {
    const res = await fetch(base + route, { method: body === undefined ? 'GET' : 'POST', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: res.status, body: res.headers.get('content-type')?.includes('json') ? await res.json() : Buffer.from(await res.arrayBuffer()) };
  }
  const ready = await request('/api/ready'); assert.equal(ready.status, 200); assert.equal(ready.body.database, 'postgresql');
  const login = await request('/api/login', null, { username: 'httpowner', password }); assert.equal(login.status, 200, JSON.stringify(login.body)); const owner = login.body.token;
  const creation = await request('/api/users', owner, { username: 'httpstaff', full_name: 'HTTP Staff', role: 'STAFF', branch_id: 'HTTP_BRANCH', password }); assert.equal(creation.status, 201, JSON.stringify(creation.body));
  const staffLogin = await request('/api/login', null, { username: 'httpstaff', password }); assert.equal(staffLogin.status, 200); const staff = staffLogin.body.token;
  assert.equal((await request('/api/units', staff)).body.length, 1);
  const receipt = await request('/api/receipts/upload', staff, { image }); assert.equal(receipt.status, 201, JSON.stringify(receipt.body));
  assert.equal((await request(receipt.body.receipt_key)).status, 401);
  assert.deepEqual((await request(receipt.body.receipt_key, staff)).body, Buffer.from(image, 'base64'));
  const payload = { amount: 700000, tx_type: 'INCOME', coa_id: '4101', idempotency_key: 'http-parallel', receipt_key: receipt.body.receipt_key };
  const parallel = await Promise.all([request('/api/transactions', staff, payload), request('/api/transactions', staff, payload)]);
  assert.deepEqual(parallel.map(x => x.status).sort(), [200, 201]); assert.equal(parallel[0].body.id, parallel[1].body.id);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM ledger_transactions')).rows[0].n, 1);
  assert.equal((await request('/api/closing/summary', staff)).body.system_balance, 0);
  const txId = parallel[0].body.id;
  const approvals = await Promise.all([request('/api/approvals', owner, { id: txId, action: 'APPROVED' }), request('/api/approvals', owner, { id: txId, action: 'REJECTED' })]);
  assert.deepEqual(approvals.map(x => x.status).sort(), [200, 409]);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM approval_logs')).rows[0].n, 1);
  const balance = (await request('/api/closing/summary', staff)).body.system_balance;
  const closing = { physical_cash: balance, kg_reguler: 1.125, stock_detergent: 0.333, idempotency_key: 'http-close' };
  const closes = await Promise.all([request('/api/closing', staff, closing), request('/api/closing', staff, closing)]);
  assert.deepEqual(closes.map(x => x.status).sort(), [200, 201]); assert.equal((await request('/api/closings', staff)).body[0].kg_reguler, 1.125);
  assert.equal((await request('/api/transactions', staff, { amount: 1 })).status, 409);
  assert.equal((await request('/api/transactions', staff, payload)).body.idempotent, true);
  assert.equal((await request('/api/change-password', staff, { old_password: password, new_password: crypto.randomBytes(16).toString('hex') })).status, 200);
  assert.equal((await request('/api/me', staff)).status, 401);
  assert.ok(!(await request('/api/users', owner)).body.some(row => 'password_hash' in row));
  assert.equal((await request('/api/logout', owner, {})).status, 200); assert.equal((await request('/api/me', owner)).status, 401);
  assert.equal((await request('/api/ready')).status, 200);
});
