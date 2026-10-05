'use strict';
const crypto = require('node:crypto');
const { canonical } = require('./backup-postgres');
const MAGIC = Buffer.from('SIPERC01');
const PREFIX = 'sipeka/receipts/v1/';
const FORMAT = 'sipeka-receipts-backup-v1';
const MAX_BUNDLE = 256 * 1024 * 1024;
const MAX_IMAGE = 6_000_000;
const FILENAME = /^evidence-[0-9]+-[a-f0-9]{6}\.(?:jpg|png|webp|gif)$/;
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function validateSnapshot(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.assets) || !Array.isArray(snapshot.references)) throw new Error('Invalid receipt snapshot');
  const assets = new Map();
  for (const asset of snapshot.assets) {
    if (!FILENAME.test(asset.filename || '') || assets.has(asset.filename) || typeof asset.user_id !== 'string' || !asset.user_id || !(asset.branch_id === null || typeof asset.branch_id === 'string') || !['image/png','image/jpeg','image/webp','image/gif'].includes(asset.mime) || typeof asset.created_at !== 'string') throw new Error('Invalid receipt asset metadata');
    assets.set(asset.filename, asset);
  }
  const ids = new Set();
  for (const ref of snapshot.references) {
    const filename = typeof ref.receipt_key === 'string' && ref.receipt_key.startsWith('/api/receipts/') ? ref.receipt_key.slice(14) : '';
    const asset = assets.get(filename);
    if (!asset || typeof ref.id !== 'string' || !ref.id || ids.has(ref.id) || asset.user_id !== ref.user_id || asset.branch_id !== ref.branch_id) throw new Error('Missing or inconsistent referenced receipt metadata');
    ids.add(ref.id);
  }
  return snapshot;
}
function summaryFor(buffer, header) {
  return { assetCount: header.snapshot.assets.length, referenceCount: header.snapshot.references.length, receiptBytes: header.files.reduce((n, file) => n + file.size, 0), metadataSha256: hash(Buffer.from(canonical(header.snapshot))), imagesSha256: hash(Buffer.from(canonical(header.files))), bundleSha256: hash(buffer) };
}
async function buildBundle(snapshot, source) {
  validateSnapshot(snapshot);
  const files = []; const chunks = []; let total = 0;
  for (const asset of snapshot.assets) {
    const object = await source.read('receipts/' + asset.filename);
    const bytes = object.bytes;
    if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > MAX_IMAGE || total + bytes.length > MAX_BUNDLE) throw new Error('Invalid receipt object size');
    const sha256 = hash(bytes);
    if (object.sha256 && object.sha256 !== sha256) throw new Error('Receipt source hash mismatch');
    if (object.mime && object.mime !== asset.mime) throw new Error('Receipt source MIME mismatch');
    files.push({ filename: asset.filename, size: bytes.length, sha256 }); chunks.push(bytes); total += bytes.length;
  }
  const header = { format: FORMAT, snapshot, files };
  const encoded = Buffer.from(canonical(header));
  if (encoded.length > 16 * 1024 * 1024 || total + encoded.length + 12 > MAX_BUNDLE) throw new Error('Receipt bundle too large');
  const length = Buffer.alloc(4); length.writeUInt32BE(encoded.length);
  const buffer = Buffer.concat([MAGIC, length, encoded, ...chunks]);
  return { buffer, summary: summaryFor(buffer, header) };
}
function inspectBundle(buffer, expected) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12 || buffer.length > MAX_BUNDLE || !buffer.subarray(0, 8).equals(MAGIC)) throw new Error('Invalid receipt bundle');
  const length = buffer.readUInt32BE(8);
  if (!length || length > 16 * 1024 * 1024 || 12 + length > buffer.length) throw new Error('Invalid receipt bundle framing');
  const header = JSON.parse(buffer.subarray(12, 12 + length).toString('utf8'));
  if (header.format !== FORMAT || !Array.isArray(header.files)) throw new Error('Invalid receipt bundle header');
  validateSnapshot(header.snapshot);
  if (header.files.length !== header.snapshot.assets.length) throw new Error('Receipt file count mismatch');
  let offset = 12 + length; const files = [];
  header.files.forEach((file, i) => {
    if (file.filename !== header.snapshot.assets[i].filename || !Number.isSafeInteger(file.size) || file.size <= 0 || file.size > MAX_IMAGE || offset + file.size > buffer.length || !/^[a-f0-9]{64}$/.test(file.sha256)) throw new Error('Invalid receipt file framing');
    const bytes = buffer.subarray(offset, offset + file.size); offset += file.size;
    if (hash(bytes) !== file.sha256) throw new Error('Receipt image hash mismatch');
    files.push({ ...file, bytes });
  });
  if (offset !== buffer.length) throw new Error('Unexpected trailing receipt bytes');
  const summary = summaryFor(buffer, header);
  if (expected && canonical(summary) !== canonical(expected)) throw new Error('Receipt bundle summary mismatch');
  return { snapshot: header.snapshot, files, summary };
}
const fs = require('node:fs/promises');
const path = require('node:path');
const { Client } = require('pg');
const { S3Client, GetObjectCommand } = require('@aws-sdk/client-s3');
const { encryptFile, decryptFile, sha256File, parseKey, createTargets, replicateVerified } = require('./backup-postgres');
const ID_PATTERN = '\\d{4}-\\d{2}-\\d{2}T\\d{2}-\\d{2}-\\d{2}-\\d{3}Z_[0-9a-f-]{36}';
const MANIFEST_PATTERN = new RegExp('^' + PREFIX + '(' + ID_PATTERN + ')\\.manifest\\.json$');
const SUMMARY_FIELDS = ['assetCount','referenceCount','receiptBytes','metadataSha256','imagesSha256','bundleSha256'];
const AUTH_FIELDS = ['format','id','createdAt', ...SUMMARY_FIELDS];
function required(env, name) {
  if (!env[name]) throw new Error('Missing ' + name);
  return env[name];
}
function ensureTargets(targets) {
  if (targets.length !== 2 || canonical(targets.map(t => t.name).sort()) !== canonical(['r2','supabase'])) throw new Error('Both R2 and Supabase targets required');
  return targets;
}
function createSource(env = process.env, options = {}) {
  const endpoint = new URL(required(env, 'R2_ENDPOINT'));
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new Error('Invalid R2 endpoint');
  const bucket = required(env, 'R2_ATTACHMENT_BUCKET');
  const client = options.client || new S3Client({ region: 'auto', endpoint: endpoint.href, credentials: { accessKeyId: required(env, 'R2_ACCESS_KEY_ID'), secretAccessKey: required(env, 'R2_SECRET_ACCESS_KEY') }, requestHandler: { requestTimeout: 300000, connectionTimeout: 15000 }, maxAttempts: 3 });
  return {
    read: async key => {
      if (!key.startsWith('receipts/') || !FILENAME.test(key.slice(9))) throw new Error('Invalid source receipt key');
      const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      if (!response.Body) throw new Error('Missing receipt body');
      const chunks = []; let size = 0;
      try {
        for await (const chunk of response.Body) {
          size += chunk.length;
          if (size > MAX_IMAGE) throw new Error('Receipt source exceeds size limit');
          chunks.push(Buffer.from(chunk));
        }
      } finally { response.Body.destroy?.(); }
      return { bytes: Buffer.concat(chunks), sha256: response.Metadata?.sha256, mime: response.ContentType };
    },
    close: () => client.destroy()
  };
}
async function readSnapshot(env = process.env, options = {}) {
  const client = options.client || new Client({ connectionString: required(env, 'DATABASE_URL'), connectionTimeoutMillis: 15000 });
  try {
    await client.connect();
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const assets = (await client.query('SELECT row_to_json(a) AS asset FROM public.receipt_assets a ORDER BY filename')).rows.map(row => row.asset);
    const references = (await client.query("SELECT id,user_id,branch_id,receipt_key FROM public.ledger_transactions WHERE receipt_key IS NOT NULL ORDER BY id")).rows;
    const snapshot = validateSnapshot({ assets, references });
    await client.query('COMMIT');
    return snapshot;
  } finally { await client.end(); }
}
function checkTestEvidence(decoded, env) {
  if (env.TEST_TX_ID && !decoded.snapshot.references.some(ref => ref.id === env.TEST_TX_ID)) throw new Error('TEST_TX_ID has no receipt reference');
  if (env.TEST_RECEIPT_SHA256 && !/^[a-f0-9]{64}$/.test(env.TEST_RECEIPT_SHA256)) throw new Error('Invalid TEST_RECEIPT_SHA256');
  if (env.TEST_RECEIPT_SHA256 && !env.TEST_RECEIPT_FILENAME) throw new Error('TEST_RECEIPT_FILENAME required for image checksum');
  if (env.TEST_RECEIPT_FILENAME) {
    const file = decoded.files.find(file => file.filename === env.TEST_RECEIPT_FILENAME);
    if (!file || (env.TEST_RECEIPT_SHA256 && file.sha256 !== env.TEST_RECEIPT_SHA256)) throw new Error('TEST receipt bytes missing or mismatched');
    if (env.TEST_TX_ID && !decoded.snapshot.references.some(ref => ref.id === env.TEST_TX_ID && ref.receipt_key === '/api/receipts/' + file.filename)) throw new Error('TEST transaction references different receipt');
  }
}
function validateManifest(manifest, key) {
  const match = MANIFEST_PATTERN.exec(key);
  if (!match || !manifest || manifest.format !== FORMAT || manifest.id !== match[1] || manifest.createdAt?.replace(/[:.]/g, '-') !== match[1].split('_')[0] || manifest.encryptedKey !== key.replace(/\.manifest\.json$/, '.receipts.enc') || !/^[a-f0-9]{64}$/.test(manifest.encryptedSha256) || !Number.isSafeInteger(manifest.encryptedBytes) || manifest.encryptedBytes <= 0) throw new Error('Invalid receipt manifest');
  for (const field of SUMMARY_FIELDS) {
    if (field.endsWith('Sha256') ? !/^[a-f0-9]{64}$/.test(manifest[field]) : !Number.isSafeInteger(manifest[field]) || manifest[field] < 0) throw new Error('Invalid receipt manifest summary');
  }
  if (canonical(Object.keys(manifest).sort()) !== canonical([...AUTH_FIELDS,'encryptedKey','encryptedSha256','encryptedBytes'].sort())) throw new Error('Unexpected receipt manifest fields');
  return manifest;
}
const authenticated = manifest => Object.fromEntries(AUTH_FIELDS.map(field => [field, manifest[field]]));
const summary = manifest => Object.fromEntries(SUMMARY_FIELDS.map(field => [field, manifest[field]]));
async function readyTargets(targets) {
  const ready = [];
  for (const target of targets) {
    try { await target.ready(); ready.push(target); }
    catch { ready.push({ name: target.name, upload: async () => { throw new Error('Unavailable private target'); } }); }
  }
  return ready;
}
async function privateRoot(env) {
  const root = path.resolve(required(env, 'BACKUP_DIR'));
  for (let ancestor = root; ; ancestor = path.dirname(ancestor)) {
    try { if ((await fs.lstat(ancestor)).isSymbolicLink()) throw new Error('Backup path must not traverse symlinks'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (path.dirname(ancestor) === ancestor) break;
  }
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  const stat = await fs.lstat(root);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error('Backup directory must be a private real directory');
  await fs.chmod(root, 0o700);
  return root;
}
async function runBackup(env = process.env, options = {}) {
  parseKey(required(env, 'BACKUP_ENCRYPTION_KEY'));
  const root = await privateRoot(env);
  const createdAt = new Date().toISOString();
  const id = createdAt.replace(/[:.]/g, '-') + '_' + crypto.randomUUID();
  const dir = path.join(root, 'receipts-' + id);
  await fs.mkdir(dir, { mode: 0o700 });
  const plain = path.join(dir, 'receipts.bundle');
  const encrypted = path.join(dir, 'receipts.enc');
  let source; let targets = [];
  try {
    targets = ensureTargets(options.targets || createTargets(env));
    source = options.source || createSource(env);
    const snapshot = options.snapshot || await readSnapshot(env);
    const bundle = await buildBundle(snapshot, source);
    checkTestEvidence(inspectBundle(bundle.buffer, bundle.summary), env);
    await fs.writeFile(plain, bundle.buffer, { flag: 'wx', mode: 0o600 });
    const metadata = { format: FORMAT, id, createdAt, ...bundle.summary };
    await encryptFile(plain, encrypted, env.BACKUP_ENCRYPTION_KEY, metadata);
    await fs.rm(plain);
    const base = PREFIX + id;
    const manifestKey = base + '.manifest.json';
    const manifest = { ...metadata, encryptedKey: base + '.receipts.enc', encryptedSha256: await sha256File(encrypted), encryptedBytes: (await fs.stat(encrypted)).size };
    const manifestFile = path.join(dir, 'manifest.json');
    await fs.writeFile(manifestFile, JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    const ready = await readyTargets(targets);
    const data = await replicateVerified(encrypted, manifest.encryptedKey, ready, dir);
    const publish = ready.map(target => data.targets.find(result => result.target === target.name).ok ? target : { name: target.name, upload: async () => { throw new Error('Data not verified'); } });
    const manifests = await replicateVerified(manifestFile, manifestKey, publish, dir);
    const result = { ok: data.ok && manifests.ok, localDirectory: dir, manifestKey, ...bundle.summary, data, manifest: manifests };
    await fs.writeFile(path.join(dir, 'result.json'), JSON.stringify(result, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
    return result;
  } finally {
    await fs.rm(plain, { force: true });
    for (const name of await fs.readdir(dir)) if (name.startsWith('receipts.enc.') && name.endsWith('.partial')) await fs.rm(path.join(dir, name), { force: true });
    source?.close?.();
    for (const target of targets) target.close?.();
  }
}
function overlaps(a, b) {
  const rel = path.relative(a, b);
  return !rel || (!rel.startsWith('..' + path.sep) && rel !== '..' && !path.isAbsolute(rel));
}
async function assertRestoreDirectory(output, env) {
  const destination = path.resolve(output);
  for (const original of [env.UPLOADS_DIR || path.join(__dirname, '..', 'uploads', 'receipts'), env.BACKUP_DIR, path.join(__dirname, '..')]) {
    const protectedRoots = [path.resolve(original)];
    try { protectedRoots.push(path.resolve(await fs.realpath(original))); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    for (const protectedRoot of protectedRoots) if (overlaps(protectedRoot, destination) || overlaps(destination, protectedRoot)) throw new Error('Restore must be isolated from original storage, code and backups');
  }
  try { await fs.lstat(destination); throw new Error('Restore directory must not exist'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const parent = path.dirname(destination);
  if (path.resolve(await fs.realpath(parent)).toLowerCase() !== parent.toLowerCase()) throw new Error('Restore parent must not traverse symlinks');
  return destination;
}
async function runVerify(env = process.env, manifestKey, options = {}) {
  parseKey(required(env, 'BACKUP_ENCRYPTION_KEY'));
  if (!MANIFEST_PATTERN.test(manifestKey)) throw new Error('Invalid receipt manifest key');
  const root = await privateRoot(env);
  const output = options.output ? await assertRestoreDirectory(options.output, env) : null;
  const dir = await fs.mkdtemp(path.join(root, '.verify-receipts-'));
  await fs.chmod(dir, 0o700);
  let targets = []; const results = []; let firstManifest;
  try {
    targets = ensureTargets(options.targets || createTargets(env));
    const expectedSnapshot = options.expectedSnapshot || (options.checkDatabase ? await readSnapshot(env) : null);
    for (const target of targets) {
      const targetDir = path.join(dir, target.name);
      await fs.mkdir(targetDir, { mode: 0o700 });
      try {
        await target.ready();
        const manifestFile = path.join(targetDir, 'manifest.json');
        const encrypted = path.join(targetDir, 'receipts.enc');
        const plain = path.join(targetDir, 'receipts.bundle');
        await target.download(manifestKey, manifestFile);
        if ((await fs.stat(manifestFile)).size > 65536) throw new Error('Receipt manifest too large');
        const manifest = validateManifest(JSON.parse(await fs.readFile(manifestFile, 'utf8')), manifestKey);
        await target.download(manifest.encryptedKey, encrypted);
        if ((await fs.stat(encrypted)).size !== manifest.encryptedBytes || await sha256File(encrypted) !== manifest.encryptedSha256) throw new Error('Encrypted receipt copy checksum mismatch');
        const metadata = await decryptFile(encrypted, plain, env.BACKUP_ENCRYPTION_KEY);
        if (canonical(metadata) !== canonical(authenticated(manifest))) throw new Error('Receipt authenticated metadata mismatch');
        if ((await fs.stat(plain)).size > MAX_BUNDLE) throw new Error('Receipt bundle exceeds limit');
        const decoded = inspectBundle(await fs.readFile(plain), summary(manifest));
        checkTestEvidence(decoded, env);
        if (expectedSnapshot && canonical(decoded.snapshot) !== canonical(expectedSnapshot)) throw new Error('Receipt database metadata mismatch');
        if (firstManifest && canonical(firstManifest) !== canonical(manifest)) throw new Error('Authenticated backup target manifests disagree');
        firstManifest = manifest;
        if (output) {
          const restore = path.join(dir, 'restore', target.name);
          await fs.mkdir(path.join(restore, 'receipts'), { recursive: true, mode: 0o700 });
          await fs.writeFile(path.join(restore, 'metadata.json'), JSON.stringify(decoded.snapshot, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
          for (const file of decoded.files) await fs.writeFile(path.join(restore, 'receipts', file.filename), file.bytes, { flag: 'wx', mode: 0o600 });
        }
        results.push({ target: target.name, ok: true, ...decoded.summary });
      } catch { results.push({ target: target.name, ok: false }); }
    }
    const ok = results.length === 2 && results.every(result => result.ok);
    if (ok && output) {
      // Reserve a fresh destination; never overwrite a folder appearing during verification.
      await fs.mkdir(output, { mode: 0o700 });
      try {
        for (const target of targets) await fs.rename(path.join(dir, 'restore', target.name), path.join(output, target.name));
      } catch (error) { await fs.rm(output, { recursive: true, force: true }); throw error; }
    }
    return { ok, manifestKey, targets: results, ...(ok && output ? { restoreDirectory: output } : {}) };
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
    for (const target of targets) target.close?.();
  }
}
module.exports = { buildBundle, inspectBundle, validateSnapshot, createSource, readSnapshot, validateManifest, runBackup, runVerify, assertRestoreDirectory, PREFIX, FORMAT };
if (require.main === module) {
  const args = process.argv.slice(2);
  const help = 'node scripts/backup-receipts.js backup\nnode scripts/backup-receipts.js verify --manifest-key <sipeka/receipts/v1/...manifest.json> [--check-database] [--output <NEW_ISOLATED_FOLDER>]\nUses existing private backend environment. Default: no deletion, no persistent plaintext. --output explicitly retains private restored bytes from BOTH providers.';
  if (args.length === 1 && args[0] === '--help') console.log(help);
  else {
    async function main() {
      if (!args.length || (args.length === 1 && args[0] === 'backup')) return runBackup();
      if (args[0] !== 'verify') throw new Error('Unknown command');
      const values = {}; let checkDatabase = false;
      for (let i = 1; i < args.length; i++) {
        if (args[i] === '--check-database' && !checkDatabase) checkDatabase = true;
        else if (['--manifest-key','--output'].includes(args[i]) && !values[args[i]] && args[i + 1] && !args[i + 1].startsWith('--')) { values[args[i]] = args[++i]; }
        else throw new Error('Unknown or duplicate argument');
      }
      if (!values['--manifest-key']) throw new Error('Manifest key required');
      return runVerify(process.env, values['--manifest-key'], { output: values['--output'], checkDatabase });
    }
    main().then(result => { console.log(JSON.stringify(result)); process.exitCode = result.ok ? 0 : 1; })
      .catch(() => { console.error('Receipt backup/verification failed. Check configuration, referenced assets, private storage and isolated restore path. Provider/SQL errors suppressed to protect secrets.'); process.exitCode = 1; });
  }
}
