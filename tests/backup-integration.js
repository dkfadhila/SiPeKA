'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { runBackup } = require('../scripts/backup-postgres');
const { runVerification, assertStaging } = require('../scripts/verify-backup');

// Opt-in only: real private-provider writes, real restore into explicitly approved empty staging.
// No substitutes, mocked services or generated success results.
test('real PostgreSQL backup, R2+Supabase download verification, actual staging restore', {
  skip: process.env.RUN_BACKUP_INTEGRATION !== '1', timeout: 30 * 60 * 1000
}, async () => {
  assertStaging(process.env);
  assert.ok(process.env.TEST_TX_ID, 'Set TEST_TX_ID to an existing transaction in the source PostgreSQL');
  const backup = await runBackup(process.env, { monthly: true, prune: false });
  assert.equal(backup.ok, true, 'Every provider must pass encrypted data and manifest download verification');
  const monthly = backup.backups.find(item => item.retention === 'monthly');
  assert.ok(monthly);
  const verified = await runVerification({ ...process.env, BACKUP_MANIFEST_KEY: monthly.manifestKey }, { restore: true });
  assert.equal(verified.ok, true);
  assert.equal(verified.restored, true);
  assert.equal(verified.restore.selectedTransactionValidated, true);
  assert.ok(verified.restore.tablesValidated > 0);
});
