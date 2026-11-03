'use strict';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
let adapter, admin, isolated, schema;
const { execFileSync } = require('node:child_process');
test('fresh SQLite operational seed has exactly Laundry active', () => {
  const output = execFileSync(process.execPath, ['-e', "const a=require('./db'); console.log(JSON.stringify(a.q.allUnits.all().map(u=>[u.name,u.category])));a.db.close()"], {
    cwd: require('node:path').join(__dirname, '..'),
    env: { ...process.env, DB_PATH: ':memory:', SIPEKA_SEED: '1', SIPEKA_OWNER_PASSWORD: 'FixtureA-' + randomBytes(24).toString('hex') }, encoding: 'utf8'
  });
  assert.deepEqual(JSON.parse(output.trim().split('\n').at(-1)), [['Laundry','LAUNDRY']]);
});
const postgres = process.env.BRANCH_TEST_PG === '1';
before(async () => {
  if (postgres) {
    assert.ok(process.env.DATABASE_URL, 'Use with-stage-db.py');
    const { Pool } = require('pg');
    admin = new Pool({ connectionString: process.env.DATABASE_URL });
    schema = 'branch_test_' + randomBytes(10).toString('hex');
    await admin.query(`CREATE SCHEMA ${schema}`);
    const url = new URL(process.env.DATABASE_URL);
    url.searchParams.set('options', '-c search_path=' + schema);
    process.env.DATABASE_URL = url.toString();
    isolated = new Pool({ connectionString: process.env.DATABASE_URL });
    assert.equal((await isolated.query('SELECT current_schema() AS s')).rows[0].s, schema);
    await require('../migrations/runner').migrate(isolated);
    adapter = require('../db-postgres');
    await adapter.ready;
  } else {
    process.env.DB_PATH = ':memory:';
    process.env.SIPEKA_SEED = '0';
    adapter = require('../db');
  }
  const { q } = adapter;
  await q.insertBranch.run('keep', 'KEEP', 'Laundry', 'LAUNDRY');
  await q.insertBranch.run('retire', 'RET', 'Villa', 'VILLA');
  await q.insertUser.run('owner', 'owner', 'fixture-not-a-password', 'Owner', 'OWNER', null);
  await q.insertUser.run('staff', 'staff', 'fixture-not-a-password', 'Staff', 'STAFF', 'retire');
});
after(async () => {
  if (adapter) await adapter.db.close();
  if (isolated) await isolated.end();
  if (admin) { if (schema) await admin.query(`DROP SCHEMA ${schema} CASCADE`); await admin.end(); }
});
test('Owner archive requires staff reassignment, revokes sessions, preserves historical unit lookup', async () => {
  const { q, createSession, getValidSession } = adapter;
  assert.equal(typeof q.archiveBranch?.run, 'function');
  await createSession('staff-session', 'staff');
  const coaSql = postgres ? 'INSERT INTO chart_of_accounts VALUES($1,$2,$3,$4)' : 'INSERT INTO chart_of_accounts VALUES(?,?,?,?)';
  await adapter.db.prepare(coaSql, { write: true }).run('coa', '4101', 'Income', 'REVENUE');
  await q.insertTx.run('tx', 'idem', 'retire', 'staff', 'coa', 'INCOME', 12500, 'QRIS', 'historical', null, 'APPROVED', 'SETOR_NOTA', 'staff', 'retire', 'fp');
  await q.insertClosing.run('closing', 'retire', 'staff', 0, 0, 0, '', 0, 0, 0, 0, 0, 0, 0, 0, 0, '', 'close-idem', 'fp');
  await q.insertReceipt.run('fixture.jpg', 'staff', 'retire', 'image/jpeg');
  const txBefore = await q.txById.get('tx');
  const closingBefore = await q.closingTodayByUser.get('staff', 'retire');
  const receiptBefore = await q.receiptByFilename.get('fixture.jpg');
  assert.equal((await q.archiveBranch.run('retire', 'staff', 'keep', 'cleanup')).statusCode, 403);
  assert.equal((await q.archiveBranch.run('retire', 'owner')).statusCode, 409);
  assert.equal((await q.unitByIdActive.get('retire')).id, 'retire');
  assert.equal((await q.archiveBranch.run('retire', 'owner', 'retire')).statusCode, 400);
  const result = await q.archiveBranch.run('retire', 'owner', 'keep', 'Laundry-only cleanup');
  assert.equal(result.ok, true);
  assert.equal(result.action, 'archived');
  assert.equal(result.reassigned_users, 1);
  assert.equal((await q.userById.get('staff')).assigned_branch_id, 'keep');
  assert.equal(await getValidSession('staff-session'), null);
  assert.equal(await q.unitByIdActive.get('retire'), undefined);
  assert.equal((await q.unitById.get('retire')).is_active, 0);
  assert.ok((await q.unitById.get('retire')).archived_at);
  assert.deepEqual((await q.allUnits.all()).map(r => r.id), ['keep']);
  assert.equal((await q.allUnitsIncludingArchived.all()).length, 2);
  assert.equal((await q.archiveBranch.run('keep', 'owner')).statusCode, 409);
  assert.deepEqual(await q.txById.get('tx'), txBefore);
  assert.deepEqual(await q.closingTodayByUser.get('staff', 'retire'), closingBefore);
  assert.deepEqual(await q.receiptByFilename.get('fixture.jpg'), receiptBefore);
  assert.equal((await q.txAll.all())[0].branch_name, 'Villa');
  const audit = await q.branchAuditLogs.all('retire');
  assert.equal(audit.length, 1);
  assert.equal(audit[0].actor_id, 'owner');
  assert.equal((await q.deleteBranch.run('retire', 'owner')).action, 'already_archived');
  assert.equal((await q.branchAuditLogs.all('retire')).length, 1);
  assert.equal((await q.archiveBranch.run('missing', 'owner')).statusCode, 404);
  await assert.rejects(async () => q.insertReceipt.run('blocked.jpg', 'staff', 'retire', 'image/jpeg'), /BRANCH_INACTIVE/);
  await assert.rejects(async () => q.insertUser.run('blocked', 'blocked', 'fixture', 'Blocked', 'STAFF', 'retire'), /BRANCH_INACTIVE/);
  await assert.rejects(async () => q.insertTx.run('blocked-tx', 'blocked-idem', 'retire', 'staff', 'coa', 'INCOME', 100, 'QRIS', '', null, 'APPROVED', 'SETOR_NOTA', 'staff', 'retire', ''), /BRANCH_INACTIVE/);
  await assert.rejects(async () => q.insertClosing.run('blocked-close', 'retire', 'staff', 0, 0, 0, '', 0, 0, 0, 0, 0, 0, 0, 0, 0, '', 'blocked-close', ''), /BRANCH_INACTIVE/);
  const updateAudit = postgres ? 'DELETE FROM branch_audit_logs WHERE branch_id=$1' : 'DELETE FROM branch_audit_logs WHERE branch_id=?';
  await assert.rejects(async () => adapter.db.prepare(updateAudit, { write: true }).run('retire'), /APPEND_ONLY/);
  await q.insertBranch.run('new', 'NEW', 'New business', 'CUSTOM_TYPE');
  assert.equal((await q.unitByIdActive.get('new')).category, 'CUSTOM_TYPE');
  const archiveOnce = await Promise.all([q.archiveBranch.run('new', 'owner'), q.archiveBranch.run('new', 'owner')]);
  assert.deepEqual(archiveOnce.map(r => r.action).sort(), ['already_archived', 'archived']);
  assert.equal((await q.branchAuditLogs.all('new')).length, 1);
});
test('Laundry-only cleanup previews without writes, requires approval, applies only in isolated schema', async () => {
  const { q, db } = adapter;
  await q.insertBranch.run('cleanup', 'CL', 'Cleanup target', 'VILLA');
  const { snapshot } = require('../scripts/branches-laundry-only');
  const before = await snapshot(db, q, 'keep', 'owner');
  assert.deepEqual(before.archive_ids, ['cleanup']);
  assert.equal((await q.unitByIdActive.get('cleanup')).id, 'cleanup');
  if (!postgres) return;
  const fs = require('node:fs');
  const path = require('node:path');
  const { promisify } = require('node:util');
  const exec = promisify(require('node:child_process').execFile);
  const scratch = process.env.TMPDIR;
  assert.ok(scratch, 'Hermes scratch TMPDIR required');
  const preview = path.join(scratch, schema + '.json');
  const evidence = path.join(scratch, schema + '-backup.txt');
  const script = path.join(__dirname, '../scripts/branches-laundry-only.js');
  const args = [script, '--keep-id', 'keep', '--owner-id', 'owner', '--preview-file', preview];
  try {
    const previewRun = await exec(process.execPath, args);
    assert.equal(JSON.parse(previewRun.stdout).mode, 'preview');
    assert.equal((await q.unitByIdActive.get('cleanup')).id, 'cleanup');
    await assert.rejects(exec(process.execPath, [...args, '--apply']));
    fs.writeFileSync(evidence, 'ISOLATED TEST FIXTURE ONLY, NOT PRODUCTION BACKUP');
    const applyArgs = [...args, '--apply', '--backup-evidence', evidence, '--confirm', 'ARCHIVE_NON_LAUNDRY_KEEP_keep'];
    await q.insertBranch.run('stale', 'STALE', 'Stale preview test', 'CUSTOM');
    await assert.rejects(exec(process.execPath, applyArgs));
    assert.equal((await q.unitByIdActive.get('cleanup')).id, 'cleanup');
    fs.unlinkSync(preview);
    await exec(process.execPath, args);
    const applied = await exec(process.execPath, applyArgs);
    assert.equal(JSON.parse(applied.stdout).mode, 'applied');
    assert.deepEqual((await q.allUnits.all()).map(r => r.id), ['keep']);
    assert.deepEqual((await snapshot(db, q, 'keep', 'owner')).counts, before.counts);
  } finally { for (const file of [preview, evidence]) if (fs.existsSync(file)) fs.unlinkSync(file); }
});
