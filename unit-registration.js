'use strict';
const crypto=require('node:crypto');
const fail=(code,status=400)=>Object.assign(new Error(code),{code,status,statusCode:status});
function normalize(body){
 if(!body||typeof body!=='object'||Array.isArray(body)||Object.keys(body).some(k=>!['name','code','category'].includes(k)))throw fail('UNIT_INVALID_REQUEST');
 if(typeof body.name!=='string'||typeof body.code!=='string')throw fail('UNIT_INVALID_REQUEST');
 const name=body.name.trim(),code=body.code.trim().toUpperCase(),category=body.category===undefined?'LAUNDRY':body.category;
 if(!name||name.length>120||/[\x00-\x1f\x7f]/.test(body.name)||typeof category!=='string'||!category.trim()||category.length>64||/[\x00-\x1f\x7f]/.test(category))throw fail('UNIT_INVALID_REQUEST');
 if(!/^[A-Z]{2,4}$/.test(code))throw fail('UNIT_CODE_INVALID');
 if(code==='AMC')throw fail('UNIT_CODE_RESERVED');
 return {name,code,category:category.trim()};
}
async function create(pool,token,body){
 const p={...normalize(body),id:'UNIT_'+crypto.randomBytes(12).toString('hex')};
 try{return (await pool.query('SELECT unit_create($1,$2::jsonb) result',[token,JSON.stringify(p)])).rows[0].result;}
 catch(e){const code=/^UNIT_[A-Z_]+$/.test(e.message||'')?e.message:e.code==='23505'?'UNIT_CODE_DUPLICATE':'UNIT_CREATE_UNAVAILABLE';throw fail(code,e.code==='42501'?403:['UNIT_CODE_DUPLICATE','UNIT_NAME_DUPLICATE'].includes(code)?409:code==='UNIT_CREATE_UNAVAILABLE'?503:400);}
}
module.exports={normalize,create};
