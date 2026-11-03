'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const migrations=require('../migrations/runner').files();
test('migration checksums preserve SQL integrity across LF and historical CRLF files',()=>{
 const byName=new Map(migrations.map(file=>[file.name,file]));
 for(const name of ['019_document_unit_codes.sql','020_owner_unit_codes.sql','021_document_resolver_owner.sql']){
  const file=byName.get(name);assert.ok(file);
  const normalized=file.sql.replace(/\r\n/g,'\n');
  assert.equal(file.sha256,crypto.createHash('sha256').update(normalized).digest('hex'));
  assert.equal(file.legacySha256,crypto.createHash('sha256').update(normalized.replace(/\n/g,'\r\n')).digest('hex'));
  assert.notEqual(file.legacySha256,crypto.createHash('sha256').update(normalized+'-- changed SQL').digest('hex'));
 }
});
