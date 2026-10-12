'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const security=require('../auth-security');
test('six letters with uppercase need no digit or symbol',async()=>{
 const hash=await security.hashNewPassword('Abcdef');
 assert.match(hash,/^\$argon2id\$/);
 assert.deepEqual(await security.checkPassword('Abcdef',hash),{valid:true,rehash:false});
});
test('password without ASCII uppercase is rejected',async()=>{
 await assert.rejects(security.hashNewPassword('abcdef'),{code:400});
});
test('UI password policy covers create, settings, forced setup and reset',()=>{
 const html=fs.readFileSync(path.join(__dirname,'../public/financial-dashboard.html'),'utf8');
 assert.ok(!/minimal 12 karakter|minlength=.?12/i.test(html));
 assert.match(html,/minlength=.?6/);
 assert.match(html,/\[A-Z\]/);
 assert.match(html,/angka dan simbol tidak wajib/);
});
for(const value of ['', 'Abcde','abcdef','123456','éééééé','Äbcdef',null,undefined,123456,{},'A'.repeat(1025)])test('reject invalid candidate '+String(JSON.stringify(value)).slice(0,24),async()=>{
 assert.throws(()=>security.validateNewPassword(value),{code:400});
 await assert.rejects(security.hashNewPassword(value),{code:400});
});
for(const value of ['ABCDEF','ABCdefgh','A'.repeat(1024),'A bcde','Abc!12'])test('accept valid candidate length '+value.length,()=>security.validateNewPassword(value));

