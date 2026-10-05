'use strict';
const fs = require('node:fs/promises');
const { createReadStream, createWriteStream } = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { pipeline } = require('node:stream/promises');
const MAGIC = Buffer.from('SIPEKAB1');

function parseKey(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/i.test(value)) throw new Error('BACKUP_ENCRYPTION_KEY must be 64 hex characters');
  return Buffer.from(value, 'hex');
}
async function sha256File(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
async function encryptFile(source, destination, key, metadata = {}) {
  const encoded = Buffer.from(JSON.stringify(metadata));
  if (encoded.length > 16 * 1024 * 1024) throw new Error('Encrypted metadata too large');
  const length = Buffer.alloc(4); length.writeUInt32BE(encoded.length);
  const iv = crypto.randomBytes(12);
  const header = Buffer.concat([MAGIC, length, encoded, iv]);
  const cipher = crypto.createCipheriv('aes-256-gcm', parseKey(key), iv);
  cipher.setAAD(header);
  const partial = destination + '.' + crypto.randomUUID() + '.partial';
  try {
    await fs.writeFile(partial, header, { mode: 0o600, flag: 'wx' });
    await pipeline(createReadStream(source), cipher, createWriteStream(partial, { flags: 'a', mode: 0o600 }));
    await fs.appendFile(partial, cipher.getAuthTag());
    await fs.rename(partial, destination);
  } catch (error) { await fs.rm(partial, { force: true }); throw error; }
}
async function decryptFile(source, destination, key) {
  const parsed = parseKey(key);
  // Never leave a previously verified dump after a failed verification attempt.
  await fs.rm(destination, { force: true });
  const partial = destination + '.' + crypto.randomUUID() + '.partial';
  const handle = await fs.open(source, 'r');
  let metadata;
  try {
    const size = (await handle.stat()).size;
    const first = Buffer.alloc(12);
    if ((await handle.read(first, 0, 12, 0)).bytesRead !== 12 || !first.subarray(0, 8).equals(MAGIC)) throw new Error('Invalid encrypted backup header');
    const length = first.readUInt32BE(8);
    const offset = 12 + length + 12;
    if (length > 16 * 1024 * 1024 || size <= offset + 16) throw new Error('Invalid encrypted backup length');
    const header = Buffer.alloc(offset); await handle.read(header, 0, offset, 0);
    const tag = Buffer.alloc(16); await handle.read(tag, 0, 16, size - 16);
    const decipher = crypto.createDecipheriv('aes-256-gcm', parsed, header.subarray(offset - 12));
    decipher.setAAD(header); decipher.setAuthTag(tag);
    await pipeline(createReadStream(source, { start: offset, end: size - 17 }), decipher, createWriteStream(partial, { flags: 'wx', mode: 0o600 }));
    metadata = JSON.parse(header.subarray(12, offset - 12).toString('utf8'));
    await fs.rename(partial, destination);
    return metadata;
  } catch (error) {
    await fs.rm(partial, { force: true });
    throw new Error('Backup authentication or format verification failed');
  } finally { await handle.close(); }
}

const { spawn } = require('node:child_process');
const { Client } = require('pg');
const {
  S3Client, PutObjectCommand, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, DeleteObjectCommand
} = require('@aws-sdk/client-s3');
const PREFIX = 'sipeka/postgres/v1/';
const ID_PATTERN = '\\d{4}-\\d{2}-\\d{2}T\\d{2}-\\d{2}-\\d{2}-\\d{3}Z_[0-9a-f-]{36}';

function required(env, name) {
  if (!env[name]) throw new Error('Missing ' + name);
  return env[name];
}
function pgEnvironment(url, inherited = process.env) {
  let parsed;
  try { parsed = new URL(url); } catch { throw new Error('Invalid PostgreSQL URL'); }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol) || !parsed.hostname || !parsed.pathname.slice(1)) throw new Error('Invalid PostgreSQL URL');
  const env = { ...inherited };
  for (const name of Object.keys(env)) if (name.startsWith('PG') || /(?:KEY|SECRET|TOKEN|PASSWORD|DATABASE_URL)$/i.test(name)) delete env[name];
  env.PGHOST = parsed.hostname.replace(/^\[|\]$/g, '');
  env.PGPORT = parsed.port || '5432';
  env.PGUSER = decodeURIComponent(parsed.username);
  env.PGPASSWORD = decodeURIComponent(parsed.password);
  env.PGDATABASE = decodeURIComponent(parsed.pathname.slice(1));
  env.PGCONNECT_TIMEOUT = '15';
  const permitted = { sslmode: 'PGSSLMODE', sslrootcert: 'PGSSLROOTCERT', sslcert: 'PGSSLCERT', sslkey: 'PGSSLKEY' };
  for (const [param, name] of Object.entries(permitted)) if (parsed.searchParams.has(param)) env[name] = parsed.searchParams.get(param);
  return env;
}
function runPg(binary, args, url, extraEnv = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(binary, args, { env: { ...pgEnvironment(url), ...extraEnv }, stdio: ['ignore', 'ignore', 'pipe'], shell: false });
    // PostgreSQL stderr may contain credentials/SQL/financial values. Never print or retain it.
    child.stderr.resume();
    child.on('error', () => reject(new Error(path.basename(binary) + ' could not start')));
    child.on('close', code => code === 0 ? resolve() : reject(new Error(path.basename(binary) + ' failed (exit ' + code + ')')));
  });
}
function quoteIdentifier(value) { return '"' + value.replaceAll('"', '""') + '"'; }
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
async function databaseEvidence(client, transactionId) {
  const tables = await client.query(`SELECT n.nspname AS schema, c.relname AS name
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE c.relkind IN ('r','p') AND n.nspname NOT IN ('pg_catalog','information_schema')
    AND n.nspname NOT LIKE 'pg_toast%' AND n.nspname NOT LIKE 'pg_temp%'
    ORDER BY n.nspname,c.relname`);
  const rowCounts = [];
  for (const table of tables.rows) {
    const result = await client.query('SELECT count(*)::text AS count FROM ' + quoteIdentifier(table.schema) + '.' + quoteIdentifier(table.name));
    rowCounts.push({ schema: table.schema, table: table.name, count: result.rows[0].count });
  }
  let transactionHash = null;
  if (transactionId) {
    const result = await client.query('SELECT to_jsonb(t)::text AS record FROM public.ledger_transactions t WHERE id=$1', [transactionId]);
    if (result.rows.length !== 1) throw new Error('TEST_TX_ID not found exactly once');
    transactionHash = crypto.createHash('sha256').update(result.rows[0].record).digest('hex');
  }
  return { rowCounts, transactionHash };
}
async function replicateVerified(file, key, targets, dir) {
  const expected = await sha256File(file);
  const expectedSize = (await fs.stat(file)).size;
  const results = [];
  for (const target of targets) {
    const download = path.join(dir, crypto.randomUUID() + '.download');
    try {
      await target.upload(key, file);
      await target.download(key, download);
      if ((await fs.stat(download)).size !== expectedSize || await sha256File(download) !== expected) throw new Error('Downloaded bytes differ');
      results.push({ target: target.name, ok: true });
    } catch { results.push({ target: target.name, ok: false }); }
    finally { await fs.rm(download, { force: true }); }
  }
  return { ok: results.every(result => result.ok), targets: results };
}
function secureEndpoint(value, name) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Invalid ' + name); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error(name + ' must be HTTPS without credentials/query/fragment');
  return url.href.replace(/\/$/, '');
}
function createTargets(env = process.env) {
  const r2 = new S3Client({
    region: 'auto', endpoint: secureEndpoint(required(env, 'R2_ENDPOINT'), 'R2_ENDPOINT'),
    credentials: { accessKeyId: required(env, 'R2_ACCESS_KEY_ID'), secretAccessKey: required(env, 'R2_SECRET_ACCESS_KEY') },
    requestHandler: { requestTimeout: 300000, connectionTimeout: 15000 }, maxAttempts: 3
  });
  const r2Bucket = required(env, 'R2_BACKUP_BUCKET');
  const supabase = secureEndpoint(required(env, 'SUPABASE_URL'), 'SUPABASE_URL');
  const secret = required(env, 'SUPABASE_SECRET_KEY');
  const bucket = required(env, 'SUPABASE_BUCKET');
  const encodePath = key => key.split('/').map(encodeURIComponent).join('/');
  async function request(route, options = {}) {
    const response = await fetch(supabase + '/storage/v1/' + route, {
      ...options, headers: { apikey: secret, ...options.headers }, signal: AbortSignal.timeout(300000)
    });
    if (!response.ok) { await response.body?.cancel(); throw new Error('Supabase Storage request failed (HTTP ' + response.status + ')'); }
    return response;
  }
  const r2Target = {
    name: 'r2',
    ready: async () => {},
    upload: async (key, file) => r2.send(new PutObjectCommand({ Bucket: r2Bucket, Key: key, Body: createReadStream(file), ContentLength: (await fs.stat(file)).size, ContentType: 'application/octet-stream', CacheControl: 'no-store', IfNoneMatch: '*' })),
    download: async (key, file) => {
      const response = await r2.send(new GetObjectCommand({ Bucket: r2Bucket, Key: key }));
      await pipeline(response.Body, createWriteStream(file, { flags: 'wx', mode: 0o600 }));
    },
    list: async prefix => {
      const objects = []; let token;
      do {
        const response = await r2.send(new ListObjectsV2Command({ Bucket: r2Bucket, Prefix: prefix, ContinuationToken: token }));
        objects.push(...(response.Contents || []).map(object => object.Key));
        token = response.IsTruncated ? response.NextContinuationToken : undefined;
        if (response.IsTruncated && !token) throw new Error('R2 listing truncated without cursor');
      } while (token);
      return objects;
    },
    exists: async key => {
      try { await r2.send(new HeadObjectCommand({ Bucket: r2Bucket, Key: key })); return true; }
      catch (error) { if (error.$metadata?.httpStatusCode === 404) return false; throw error; }
    },
    remove: key => r2.send(new DeleteObjectCommand({ Bucket: r2Bucket, Key: key })),
    close: () => r2.destroy()
  };
  const supabaseTarget = {
    name: 'supabase',
    ready: async () => {
      const info = await (await request('bucket/' + encodeURIComponent(bucket))).json();
      if (info.public !== false) throw new Error('Supabase backup bucket must be private');
    },
    upload: async (key, file) => {
      const response = await request('object/' + encodeURIComponent(bucket) + '/' + encodePath(key), {
        method: 'POST', body: createReadStream(file), duplex: 'half',
        headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String((await fs.stat(file)).size), 'x-upsert': 'false', 'Cache-Control': 'no-store' }
      });
      await response.body?.cancel();
    },
    download: async (key, file) => {
      const response = await request('object/' + encodeURIComponent(bucket) + '/' + encodePath(key));
      await pipeline(response.body, createWriteStream(file, { flags: 'wx', mode: 0o600 }));
    },
    list: async prefix => {
      const objects = [];
      // All managed files are immediate children of each retention directory.
      for (const mode of ['daily', 'monthly']) {
        let offset = 0;
        while (true) {
          const rows = await (await request('object/list/' + encodeURIComponent(bucket), {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prefix: prefix + mode + '/', limit: 100, offset, sortBy: { column: 'name', order: 'asc' } })
          })).json();
          if (!Array.isArray(rows)) throw new Error('Invalid Supabase listing');
          objects.push(...rows.filter(row => row.id).map(row => prefix + mode + '/' + row.name));
          if (rows.length < 100) break;
          offset += rows.length;
        }
      }
      return objects;
    },
    exists: async key => {
      const parts = key.split('/'); const name = parts.pop();
      const rows = await (await request('object/list/' + encodeURIComponent(bucket), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prefix: parts.join('/'), search: name, limit: 100, offset: 0 }) })).json();
      if (!Array.isArray(rows)) throw new Error('Invalid Supabase existence check');
      return rows.some(row => row.name === name && row.id);
    },
    remove: async key => {
      const response = await request('object/' + encodeURIComponent(bucket), { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prefixes: [key] }) });
      await response.body?.cancel();
    },
    close: () => {}
  };
  return [r2Target, supabaseTarget];
}
function retentionExpired(key, now = new Date()) {
  const match = new RegExp('^' + PREFIX + '(daily|monthly)/(' + ID_PATTERN + ')\\.manifest\\.json$').exec(key);
  if (!match) return false;
  const created = new Date(match[2].slice(0, 10) + 'T' + match[2].slice(11, 23).replace(/-/g, ':').replace(/:(\d{3})$/, '.$1') + 'Z');
  return Number.isFinite(created.getTime()) && now - created > (match[1] === 'daily' ? 30 : 365) * 86400000;
}
function validateManifest(manifest, key) {
  const match = new RegExp('^' + PREFIX + '(daily|monthly)/(' + ID_PATTERN + ')\\.manifest\\.json$').exec(key);
  if (!match || manifest.format !== 'sipeka-postgres-backup-v1' || manifest.id !== match[2] || manifest.retention !== match[1] || manifest.encryptedKey !== key.replace(/\.manifest\.json$/, '.postgres.enc') || !/^[a-f0-9]{64}$/.test(manifest.encryptedSha256) || !/^[a-f0-9]{64}$/.test(manifest.dumpSha256) || !Array.isArray(manifest.rowCounts)) throw new Error('Invalid backup manifest');
  return manifest;
}
async function pruneTargets(targets, dir, now = new Date(), encryptionKey = process.env.BACKUP_ENCRYPTION_KEY) {
  parseKey(encryptionKey);
  const results = [];
  for (const target of targets) {
    let deleted = 0;
    try {
      await target.ready();
      const candidates = (await target.list(PREFIX)).filter(key => retentionExpired(key, now));
      for (const key of candidates) {
        const file = path.join(dir, crypto.randomUUID() + '.prune-manifest');
        try {
          await target.download(key, file);
          const manifest = validateManifest(JSON.parse(await fs.readFile(file, 'utf8')), key);
          const encrypted = file + '.enc';
          const dump = file + '.dump';
          try {
            await target.download(manifest.encryptedKey, encrypted);
            if (await sha256File(encrypted) !== manifest.encryptedSha256) throw new Error('Prune artifact checksum mismatch');
            const metadata = await decryptFile(encrypted, dump, encryptionKey);
            const fields = ['format', 'id', 'createdAt', 'dumpSha256', 'rowCounts', 'transactionHash', 'receipts'];
            const expected = Object.fromEntries(fields.map(field => [field, manifest[field]]));
            if (canonical(metadata) !== canonical(expected) || await sha256File(dump) !== manifest.dumpSha256) throw new Error('Prune artifact authentication mismatch');
            // Delete only the authenticated exact program-owned pair; never receipts/user objects.
            await target.remove(manifest.encryptedKey);
            if (await target.exists(manifest.encryptedKey)) throw new Error('Prune data deletion not confirmed');
            await target.remove(key);
            if (await target.exists(key)) throw new Error('Prune manifest deletion not confirmed');
            deleted++;
          } finally { await fs.rm(encrypted, { force: true }); await fs.rm(dump, { force: true }); }
        } finally { await fs.rm(file, { force: true }); }
      }
      results.push({ target: target.name, ok: true, deleted });
    } catch { results.push({ target: target.name, ok: false, deleted }); }
  }
  return { ok: results.every(result => result.ok), targets: results };
}
async function runBackup(env = process.env, options = {}) {
  parseKey(required(env, 'BACKUP_ENCRYPTION_KEY'));
  const url = required(env, 'DATABASE_URL'); pgEnvironment(url);
  const directory = path.resolve(required(env, 'BACKUP_DIR'));
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  const createdAt = new Date().toISOString();
  const id = createdAt.replace(/[:.]/g, '-') + '_' + crypto.randomUUID();
  const dir = path.join(directory, id);
  await fs.mkdir(dir, { mode: 0o700 });
  const dump = path.join(dir, 'postgres.dump');
  const encrypted = path.join(dir, 'postgres.enc');
  const client = new Client({ connectionString: url, connectionTimeoutMillis: 15000 });
  let evidence;
  try {
    await client.connect();
    await client.query("SET TIME ZONE 'UTC'");
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const snapshot = (await client.query('SELECT pg_export_snapshot() AS snapshot')).rows[0].snapshot;
    await fs.writeFile(dump, '', { flag: 'wx', mode: 0o600 });
    await runPg(env.PG_DUMP_BIN || 'pg_dump', ['--format=custom', '--no-password', '--snapshot=' + snapshot, '--file=' + dump], url);
    evidence = await databaseEvidence(client, env.TEST_TX_ID);
    await client.query('COMMIT');
  } finally { await client.end(); }
  const dumpSha256 = await sha256File(dump);
  const metadata = { format: 'sipeka-postgres-backup-v1', id, createdAt, dumpSha256, ...evidence, receipts: 'not-included' };
  await encryptFile(dump, encrypted, env.BACKUP_ENCRYPTION_KEY, metadata);
  // Preserve local encrypted artifact, not an unnecessary plaintext financial dump.
  await fs.rm(dump);
  const encryptedSha256 = await sha256File(encrypted);
  const targets = createTargets(env);
  const ready = [];
  try {
    for (const target of targets) {
      try { await target.ready(); ready.push(target); }
      catch { ready.push({ name: target.name, upload: async () => { throw new Error('Target unavailable or not private'); } }); }
    }
    const wibDate = new Date(Date.now() + 7 * 3600000);
    const modes = ['daily'];
    if (options.monthly || wibDate.getUTCDate() === 1) modes.push('monthly');
    const backups = [];
    for (const retention of modes) {
      const base = PREFIX + retention + '/' + id;
      const manifest = { ...metadata, retention, retentionDays: retention === 'daily' ? 30 : 365, encryptedKey: base + '.postgres.enc', encryptedSha256, encryptedBytes: (await fs.stat(encrypted)).size };
      const manifestFile = path.join(dir, retention + '.manifest.json');
      await fs.writeFile(manifestFile, JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600, flag: 'wx' });
      const dataResult = await replicateVerified(encrypted, manifest.encryptedKey, ready, dir);
      // Publish manifest only on the target where encrypted data passed verification.
      const manifestTargets = ready.map(target => dataResult.targets.find(result => result.target === target.name).ok ? target : { name: target.name, upload: async () => { throw new Error('Data verification failed'); } });
      const manifestResult = await replicateVerified(manifestFile, base + '.manifest.json', manifestTargets, dir);
      backups.push({ retention, manifestKey: base + '.manifest.json', data: dataResult, manifest: manifestResult });
    }
    const result = { ok: backups.every(item => item.data.ok && item.manifest.ok), localDirectory: dir, backups, receipts: 'not-included' };
    if (options.prune && result.ok) { result.prune = await pruneTargets(targets, dir, new Date(), env.BACKUP_ENCRYPTION_KEY); result.ok = result.prune.ok; }
    await fs.writeFile(path.join(dir, 'result.json'), JSON.stringify(result, null, 2) + '\n', { mode: 0o600 });
    return result;
  } finally { for (const target of targets) target.close(); }
}

module.exports = { encryptFile, decryptFile, sha256File, parseKey, pgEnvironment, runPg, databaseEvidence, canonical, replicateVerified, createTargets, retentionExpired, validateManifest, pruneTargets, runBackup, PREFIX };
if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log('node scripts/backup-postgres.js [--monthly] [--prune]\nRequires DATABASE_URL, BACKUP_DIR, BACKUP_ENCRYPTION_KEY, R2 and Supabase Storage environment. Default: no deletion.');
  } else if (args.some(arg => !['--monthly', '--prune'].includes(arg))) {
    console.error('Unknown argument'); process.exitCode = 1;
  } else {
    runBackup(process.env, { monthly: args.includes('--monthly'), prune: args.includes('--prune') })
      .then(result => { console.log(JSON.stringify(result)); process.exitCode = result.ok ? 0 : 1; })
      .catch(() => { console.error('PostgreSQL backup failed; local artifacts preserved. Check configuration, PostgreSQL tools and private storage access. Provider/SQL errors suppressed to protect secrets.'); process.exitCode = 1; });
  }
}
