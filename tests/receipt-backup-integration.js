'use strict';
// Opt-in REAL PostgreSQL/R2/Supabase. Never imports backend bootstrapping or creates source assets.
const test = require('node:test');
const assert = require('node:assert/strict');
const { runBackup, runVerify } = require('../scripts/backup-receipts');

test('REAL providers: TEST receipt encrypted, uploaded, downloaded and independently authenticated from both stores', { skip: process.env.RECEIPT_BACKUP_INTEGRATION !== '1' }, async () => {
  for (const name of ['DATABASE_URL','BACKUP_DIR','BACKUP_ENCRYPTION_KEY','R2_ENDPOINT','R2_ACCESS_KEY_ID','R2_SECRET_ACCESS_KEY','R2_ATTACHMENT_BUCKET','R2_BACKUP_BUCKET','SUPABASE_URL','SUPABASE_SECRET_KEY','SUPABASE_BUCKET','TEST_TX_ID','TEST_RECEIPT_FILENAME','TEST_RECEIPT_SHA256']) assert.ok(process.env[name], 'Missing ' + name);
  const result = await runBackup();
  assert.equal(result.ok, true);
  assert.ok(result.assetCount > 0, 'Zero assets is not receipt acceptance');
  const verified = await runVerify(process.env, result.manifestKey, { checkDatabase: true });
  assert.equal(verified.ok, true);
  assert.deepEqual(verified.targets.map(target => target.target).sort(), ['r2','supabase']);
  for (const target of verified.targets) {
    assert.equal(target.ok, true);
    assert.equal(target.bundleSha256, result.bundleSha256);
    assert.equal(target.metadataSha256, result.metadataSha256);
    assert.equal(target.imagesSha256, result.imagesSha256);
  }
});
