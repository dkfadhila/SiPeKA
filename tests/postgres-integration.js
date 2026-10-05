'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { Pool } = require('pg');

test('explicit migration creates durable PostgreSQL ledger and immutable constraints', async () => {
  assert.ok(process.env.DATABASE_URL, 'DATABASE_URL must point to disposable staging');
  assert.ok(fs.existsSync(path.resolve(__dirname, '../migrations/runner.js')), 'Explicit PostgreSQL migration runner must exist');
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  const { migrate, verifySchema } = require('../migrations/runner');
  try {
    await migrate(pool);
    await migrate(pool);
    await verifySchema(pool);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM schema_migrations')).rows[0].n, 1);
    const triggers = await pool.query("SELECT tgname FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE NOT tgisinternal AND tgname LIKE 'sipeka_%' AND n.nspname=current_schema()");
    assert.equal(triggers.rowCount, 5);
    const {randomBytes}=require('node:crypto');
    const schema='pgverify_'+randomBytes(8).toString('hex');
    await pool.query(`CREATE SCHEMA ${schema}`);
    const isolated=new Pool({connectionString:process.env.DATABASE_URL,options:`-c search_path=${schema}`});
    try {
      await migrate(isolated);
      await isolated.query('ALTER TABLE business_units DROP COLUMN category');
      await assert.rejects(verifySchema(isolated),/column|schema/i);
    } finally {await isolated.end();await pool.query(`DROP SCHEMA ${schema} CASCADE`);}
  } finally { await pool.end(); }
});
