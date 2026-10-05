'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const html = fs.readFileSync(path.resolve(__dirname, '../public/financial-dashboard.html'), 'utf8');
test('production closing measurement parser accepts bounded decimal inputs', () => {
  const start = html.indexOf('const parseNonNegFloat=');
  const end = html.indexOf('const totalNota=', start);
  const parser = html.slice(start, end);
  function parse(value) { return vm.runInNewContext(parser + ';parseNonNegFloat("measure");', { parseNonNegInt: () => null, document: { getElementById: () => ({ value }) } }); }
  assert.equal(parse('1.125'), 1.125); assert.equal(parse('0.333'), 0.333); assert.equal(parse(''), 0);
  for (const value of ['1.1234', '1e3', '-1', '0x10', 'abc']) assert.equal(parse(value), null, value);
  for (const id of ['clsKgReguler', 'clsKgExpress', 'clsKgKilat', 'clsStockDetergent', 'clsStockPerfume']) assert.match(html, new RegExp('id="'+id+'" type="number" step="0\\.001"'));
});
test('manual upload handler bypasses OCR; scan handler retains extraction', () => {
  const manual = html.slice(html.indexOf('// ---- handler upload bukti di form manual'), html.indexOf('// ---- handler form MANUAL'));
  assert.ok(manual.includes("api('/api/receipts/upload'")); assert.ok(!manual.includes("api('/api/widya/extract'"));
  assert.ok(html.includes("api('/api/widya/extract'"));
});
