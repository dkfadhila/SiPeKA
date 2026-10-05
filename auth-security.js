'use strict';
const crypto = require('node:crypto');
const argon2 = require('@node-rs/argon2');
const argonOptions = { algorithm: argon2.Algorithm.Argon2id, memoryCost: 65536, timeCost: 3, parallelism: 1, outputLen: 32 };
async function hashVerifiedPassword(password) { return argon2.hash(password, argonOptions); }
async function hashNewPassword(password) {
  if (typeof password !== 'string' || password.length < 12 || password.length > 1024)
    throw Object.assign(new Error('Password baru minimal 12 karakter, maksimal 1024'), { code: 400 });
  return hashVerifiedPassword(password);
}
async function checkPassword(password, stored) {
  if (typeof password !== 'string' || password.length > 1024 || typeof stored !== 'string') return { valid: false, rehash: false };
  try {
    if (stored.startsWith('$argon2id$')) return { valid: await argon2.verify(stored, password), rehash: false };
    if (!/^[a-f0-9]{32}:[a-f0-9]{128}$/i.test(stored)) return { valid: false, rehash: false };
    const [salt, hash] = stored.split(':');
    const actual = await new Promise((resolve, reject) => crypto.scrypt(password, salt, 64, (error, value) => error ? reject(error) : resolve(value)));
    const valid = crypto.timingSafeEqual(actual, Buffer.from(hash, 'hex'));
    return { valid, rehash: valid };
  } catch { return { valid: false, rehash: false }; }
}
function config(env = process.env) {
  const production = env.NODE_ENV === 'production';
  if (production && !['0','1'].includes(env.REQUIRE_OWNER_2FA)) throw new Error('REQUIRE_OWNER_2FA harus eksplisit 0 atau 1 untuk production');
  const origin = env.PUBLIC_ORIGIN ? new URL(env.PUBLIC_ORIGIN).origin : null;
  if (production && (!origin || !origin.startsWith('https://'))) throw new Error('PUBLIC_ORIGIN HTTPS wajib untuk production');
  const idleMinutes = Number(env.SESSION_IDLE_MINUTES || 30);
  if (!Number.isFinite(idleMinutes) || idleMinutes <= 0 || idleMinutes > 1440) throw new Error('SESSION_IDLE_MINUTES tidak valid');
  return { production, origin, idleMS: idleMinutes * 60000, requireOwner2FA: env.REQUIRE_OWNER_2FA === '1',
    bearer: !production && env.ALLOW_PRIVATE_QA_BEARER === '1',
    proxies: (env.TRUSTED_PROXY_IPS || '').split(',').map(x => x.trim().replace(/^::ffff:/, '')).filter(Boolean) };
}
function cookie(token, cfg) {
  return `sipeka_session=${token}; Path=/; HttpOnly; SameSite=Strict${cfg.production ? '; Secure' : ''}${token ? '' : '; Max-Age=0'}`;
}
function cookieToken(req) {
  const values = (req.headers.cookie || '').split(';').map(x => x.trim()).filter(x => x.startsWith('sipeka_session='));
  if (values.length !== 1) return null;
  const value = values[0].slice('sipeka_session='.length);
  return /^[a-zA-Z0-9_-]{1,128}$/.test(value) ? value : null;
}
function sessionToken(req, cfg) {
  return cookieToken(req) || (cfg.bearer && /^Bearer [a-zA-Z0-9_-]{1,128}$/.test(req.headers.authorization || '') ? req.headers.authorization.slice(7) : null);
}
function clientIP(req, cfg) {
  const peer = (req.socket?.remoteAddress || 'unknown').replace(/^::ffff:/, '');
  const forwarded = req.headers['x-forwarded-for'];
  // The trusted proxy must overwrite XFF with one IP, never append untrusted client input.
  return cfg.proxies.includes(peer) && typeof forwarded === 'string' && require('node:net').isIP(forwarded.trim()) ? forwarded.trim() : peer;
}
function validOrigin(req, cfg) {
  if (cfg.bearer && !cookieToken(req) && /^Bearer /.test(req.headers.authorization || '')) return true;
  const host = req.headers.host;
  if (typeof host !== 'string' || !/^[a-zA-Z0-9.:[\]-]+$/.test(host)) return false;
  const expected = cfg.origin || `${req.socket?.encrypted ? 'https' : 'http'}://${host}`;
  try { return new URL(expected).host === host && req.headers.origin === expected && !['cross-site', 'none'].includes(req.headers['sec-fetch-site']); }
  catch { return false; }
}
function createLimiter(windowMS = 15 * 60000) {
  const entries = new Map();
  return { reset(account, client) { entries.delete('account:' + account); entries.delete('client:' + client); }, blocked(account, client, now = Date.now()) {
    for (const [key, row] of entries) if (now >= row.until) entries.delete(key);
    // Bound memory. Fail closed when an attacker fills all buckets.
    if (entries.size >= 20000) return true;
    const keys = ['account:' + account, 'client:' + client];
    if (keys.some(k => (entries.get(k)?.count || 0) >= 5)) return true;
    for (const key of keys) { const row = entries.get(key) || { count: 0, until: now + windowMS }; row.count++; entries.set(key, row); }
    return false;
  } };
}
const OTPAuth = require('otpauth');
function encryptionKey(key) {
  if (!/^[a-f0-9]{64}$/i.test(key || '')) throw new Error('AUTH_TOTP_KEY harus 32 byte hex');
  return Buffer.from(key, 'hex');
}
function encryptSecret(secret, key) {
  const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(key), iv);
  const data = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map(b => b.toString('base64url')).join('.');
}
function decryptSecret(value, key) {
  const [iv, tag, data] = value.split('.').map(x => Buffer.from(x, 'base64url'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(key), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
}
function totp(secret, username) {
  return new OTPAuth.TOTP({ issuer: 'SiPeKA', label: username || 'Owner', algorithm: 'SHA1', digits: 6, period: 30, secret: OTPAuth.Secret.fromBase32(secret) });
}
function newEnrollment(username, key) {
  const secret = new OTPAuth.Secret({ size: 20 }).base32;
  return { secret, uri: totp(secret, username).toString(), cipher: encryptSecret(secret, key) };
}
function verifyTotp(cipher, key, code, lastCounter, now = Date.now()) {
  if (typeof code !== 'string' || !/^\d{6}$/.test(code)) return null;
  const delta = totp(decryptSecret(cipher, key)).validate({ token: code, timestamp: now, window: 1 });
  const counter = Math.floor(now / 30000) + delta;
  return delta !== null && counter > Number(lastCounter) ? counter : null;
}
function recoveryHash(code) { return crypto.createHash('sha256').update('sipeka-recovery:' + code).digest('hex'); }
function newRecoveryCodes() {
  const codes = Array.from({ length: 8 }, () => crypto.randomBytes(16).toString('hex'));
  return { codes, hashes: codes.map(recoveryHash) };
}
module.exports = { hashNewPassword, hashVerifiedPassword, checkPassword, config, cookie, cookieToken, sessionToken, clientIP, validOrigin, createLimiter,
  encryptionKey, newEnrollment, decryptSecret, totp, verifyTotp, recoveryHash, newRecoveryCodes };
