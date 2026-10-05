'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { Client } = require('pg');
const {
  decryptFile, sha256File, parseKey, pgEnvironment, runPg, databaseEvidence,
  canonical, createTargets, validateManifest
} = require('./backup-postgres');

function assertStaging(env) {
  if (env.BACKUP_RESTORE_CONFIRM !== 'EMPTY_STAGING') throw new Error('Set BACKUP_RESTORE_CONFIRM=EMPTY_STAGING only for a disposable empty staging database');
  if (!env.DATABASE_URL || !env.RESTORE_DATABASE_URL) throw new Error('Both source and restore database URLs required');
  const source = pgEnvironment(env.DATABASE_URL, {});
  const restore = pgEnvironment(env.RESTORE_DATABASE_URL, {});
  if (source.PGHOST.toLowerCase() === restore.PGHOST.toLowerCase() && source.PGPORT === restore.PGPORT && source.PGDATABASE === restore.PGDATABASE) throw new Error('Restore target must not be source database');
  return restore;
}
function compareEvidence(expected, actual, selectedTransaction) {
  if (canonical(expected.rowCounts) !== canonical(actual.rowCounts)) throw new Error('Row counts differ after restore');
  if (selectedTransaction && (!expected.transactionHash || expected.transactionHash !== actual.transactionHash)) throw new Error('Selected transaction differs or was not recorded at backup time');
}
function authenticatedMetadata(manifest) {
  return Object.fromEntries(['format', 'id', 'createdAt', 'dumpSha256', 'rowCounts', 'transactionHash', 'receipts'].map(key => [key, manifest[key]]));
}
async function verifyDownloads(targets, manifestKey, dir, encryptionKey) {
  parseKey(encryptionKey);
  let expectedManifest;
  let verifiedDump;
  const results = [];
  for (const target of targets) {
    const token = crypto.randomUUID();
    const manifestFile = path.join(dir, token + '.manifest.json');
    const encryptedFile = path.join(dir, token + '.enc');
    const dump = path.join(dir, token + '.dump');
    try {
      await target.ready();
      await target.download(manifestKey, manifestFile);
      const manifest = validateManifest(JSON.parse(await fs.readFile(manifestFile, 'utf8')), manifestKey);
      if (expectedManifest && canonical(expectedManifest) !== canonical(manifest)) throw new Error('Target manifests differ');
      await target.download(manifest.encryptedKey, encryptedFile);
      if ((await fs.stat(encryptedFile)).size !== manifest.encryptedBytes || await sha256File(encryptedFile) !== manifest.encryptedSha256) throw new Error('Encrypted bytes differ');
      const metadata = await decryptFile(encryptedFile, dump, encryptionKey);
      if (canonical(metadata) !== canonical(authenticatedMetadata(manifest))) throw new Error('Manifest differs from authenticated metadata');
      if (await sha256File(dump) !== manifest.dumpSha256) throw new Error('Decrypted dump differs');
      expectedManifest = manifest;
      if (!verifiedDump) verifiedDump = dump;
      else await fs.rm(dump);
      results.push({ target: target.name, ok: true, encryptedSha256: manifest.encryptedSha256, dumpSha256: manifest.dumpSha256 });
    } catch {
      await fs.rm(dump, { force: true });
      results.push({ target: target.name, ok: false });
    }
    // Retain local encrypted downloads/manifests for recovery and diagnosis; no secrets.
  }
  const ok = targets.length === 2 && results.every(result => result.ok);
  if (!ok && verifiedDump) { await fs.rm(verifiedDump, { force: true }); verifiedDump = undefined; }
  return { ok, targets: results, dump: verifiedDump, manifest: expectedManifest };
}
async function restoreAndValidate(dump, manifest, env = process.env) {
  const restore = assertStaging(env);
  const client = new Client({ connectionString: env.RESTORE_DATABASE_URL, connectionTimeoutMillis: 15000 });
  try {
    await client.connect();
    await client.query("SET TIME ZONE 'UTC'");
    const existing = await client.query(`SELECT count(*)::text AS count FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
      WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp%'
      AND c.relkind IN ('r','p','v','m','S','f')`);
    if (existing.rows[0].count !== '0') throw new Error('Restore target is not empty; no data removed');
    if (env.TEST_TX_ID && !manifest.transactionHash) throw new Error('Selected transaction was not captured; rerun backup with TEST_TX_ID');
    await runPg(env.PG_RESTORE_BIN || 'pg_restore', [
      '--no-password', '--exit-on-error', '--single-transaction', '--no-owner', '--no-privileges', '--dbname=' + restore.PGDATABASE, dump
    ], env.RESTORE_DATABASE_URL);
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const actual = await databaseEvidence(client, env.TEST_TX_ID);
    compareEvidence(manifest, actual, Boolean(env.TEST_TX_ID));
    await client.query('COMMIT');
    return { ok: true, restored: true, tablesValidated: actual.rowCounts.length, selectedTransactionValidated: Boolean(env.TEST_TX_ID) };
  } finally { await client.end(); }
}
async function runVerification(env = process.env, options = {}) {
  if (!env.BACKUP_DIR || !env.BACKUP_MANIFEST_KEY) throw new Error('BACKUP_DIR and BACKUP_MANIFEST_KEY required');
  parseKey(env.BACKUP_ENCRYPTION_KEY);
  if (options.restore) assertStaging(env);
  const dir = path.join(path.resolve(env.BACKUP_DIR), 'verify-' + crypto.randomUUID());
  await fs.mkdir(dir, { recursive: true, mode: 0o700 });
  const targets = createTargets(env);
  let downloads;
  let result;
  try {
    downloads = await verifyDownloads(targets, env.BACKUP_MANIFEST_KEY, dir, env.BACKUP_ENCRYPTION_KEY);
    result = { ok: downloads.ok, restored: false, localDirectory: dir, targets: downloads.targets, receipts: 'not-included' };
    if (downloads.ok && env.VERIFY_REFERENCE_DUMP) {
      result.referenceDumpMatched = await sha256File(env.VERIFY_REFERENCE_DUMP) === downloads.manifest.dumpSha256;
      if (!result.referenceDumpMatched) result.ok = false;
    }
    if (options.restore && result.ok) {
      try { result.restore = await restoreAndValidate(downloads.dump, downloads.manifest, env); result.restored = true; }
      catch { result.ok = false; result.restore = { ok: false, restored: false }; }
    }
    await fs.writeFile(path.join(dir, 'verification.json'), JSON.stringify(result, null, 2) + '\n', { mode: 0o600 });
    return result;
  } finally {
    if (downloads?.dump) await fs.rm(downloads.dump, { force: true });
    for (const target of targets) target.close();
  }
}
module.exports = { assertStaging, compareEvidence, verifyDownloads, restoreAndValidate, runVerification };
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log('node scripts/verify-backup.js [--restore]\nBACKUP_MANIFEST_KEY selects exact remote manifest. --restore requires RESTORE_DATABASE_URL and BACKUP_RESTORE_CONFIRM=EMPTY_STAGING. TEST_TX_ID must be used at backup and verification.');
  } else if (args.some(arg => arg !== '--restore')) {
    console.error('Unknown argument'); process.exitCode = 1;
  } else {
    runVerification(process.env, { restore: args.includes('--restore') })
      .then(result => { console.log(JSON.stringify(result)); process.exitCode = result.ok ? 0 : 1; })
      .catch(() => { console.error('Backup verification failed. Check environment, exact manifest key, private storage access and empty staging database. Provider/SQL errors suppressed to protect secrets.'); process.exitCode = 1; });
  }
}
