#!/usr/bin/env node
'use strict';
// Invoked only by the root-owned private launcher, as the dedicated peer-auth DB role.
async function main(raw=process.argv.slice(2)){
 if(raw.length!==1||raw[0].length>4096)throw Error('WIDYA_READER_INVALID_REQUEST');
 const input=JSON.parse(raw[0]),reader=require('../widya-dashboard-reader');reader.validate(input);
 const {Client}=require('pg'),client=new Client({host:'/var/run/postgresql',database:'sipeka',user:'widya_reader',connectionTimeoutMillis:5000,query_timeout:10000});
 await client.connect();try{
  const identity=(await client.query('SELECT current_user role')).rows[0];if(identity.role!=='widya_reader')throw Error('WIDYA_READER_ROLE_REQUIRED');
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');await client.query("SET LOCAL statement_timeout='5s'");await client.query("SET LOCAL idle_in_transaction_session_timeout='10s'");await client.query("SET LOCAL TIME ZONE 'UTC'");
  const result=await reader.read(client,input);await client.query('COMMIT');process.stdout.write(JSON.stringify(result)+'\n');
 }catch(e){await client.query('ROLLBACK').catch(()=>{});throw e;}finally{await client.end();}
}
if(require.main===module)main().catch(e=>{const code=/^(WIDYA_READER_|REPORT_)[A-Z_]+$/.test(e.code||e.message||'')?(e.code||e.message):'WIDYA_READER_UNAVAILABLE';process.stderr.write(JSON.stringify({error:code})+'\n');process.exitCode=1;});
module.exports={main};
