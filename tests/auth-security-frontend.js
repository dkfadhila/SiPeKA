'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
test('frontend auth uses cookies, no token storage/Bearer, restricted in-page settings and TOTP', () => {
  const html = fs.readFileSync(require('node:path').join(__dirname, '../public/financial-dashboard.html'), 'utf8');
  assert.ok(!/localStorage\.(getItem|setItem)\((?:TOK|'sipeka_token'|"sipeka_token")/.test(html), 'never reads or stores session token');
  assert.ok(!/Authorization:\s*'Bearer /.test(html), 'no browser Bearer headers');
  assert.match(html, /credentials:'same-origin'/);
  assert.match(html, /\/api\/auth\/totp\/enroll/);
  assert.match(html, /\/api\/auth\/totp\/confirm/);
  assert.match(html, /\/api\/auth\/totp\/verify/);
  assert.match(html, /session_purpose/);
  for (const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) new vm.Script(match[1]);
});
