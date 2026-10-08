'use strict';
const sharp=require('sharp');
const MAX_BYTES=6000000,MAX_PIXELS=20000000,OUTPUT_BYTES=800000;
const failure=code=>Object.assign(new Error(code),{status:400});
// ASCII allowlist avoids path/control/bidi characters and unsafe header encoding.
function component(value,fallback){return String(value||'').normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^A-Za-z0-9.-]+/g,'_').replace(/^[_.-]+|[_.-]+$/g,'').slice(0,48)||fallback;}
function friendlyFilename(username,unit,now=new Date()){
 const parts=new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Jakarta',day:'2-digit',month:'2-digit',year:'2-digit'}).formatToParts(now);
 const value=key=>parts.find(p=>p.type===key).value;
 return `${component(username,'user')}_${component(unit,'unit')}_${value('day')}${value('month')}${value('year')}.jpeg`;
}
function safeDisplayFilename(value,fallback){return typeof value==='string'&&/^[A-Za-z0-9._-]{1,120}\.jpeg$/.test(value)?value:fallback;}
let active=0;
async function normalizeReceipt(buffer){
 if(!Buffer.isBuffer(buffer)||!buffer.length||buffer.length>MAX_BYTES)throw failure('RECEIPT_INVALID_SIZE');
 if(active>=2)throw Object.assign(new Error('RECEIPT_PROCESSING_BUSY'),{status:429});
 active++;
 const options={limitInputPixels:MAX_PIXELS,failOn:'warning',animated:true};
 try{
  const metadata=await sharp(buffer,options).timeout({seconds:10}).metadata();
  if(!['jpeg','png','webp','gif'].includes(metadata.format)||!metadata.width||!metadata.height||metadata.width*metadata.height>MAX_PIXELS||(metadata.pages||1)!==1)throw failure('RECEIPT_INVALID_IMAGE');
  // Auto-orient, strip EXIF/GPS, flatten transparency; never relabel source bytes.
  for(const [width,quality] of [[2400,85],[2000,75],[1600,65],[1200,55],[1000,40]]){
   const output=await sharp(buffer,options).timeout({seconds:10}).rotate().resize({width,height:width,fit:'inside',withoutEnlargement:true}).flatten({background:'#ffffff'}).jpeg({quality,mozjpeg:false}).toBuffer();
   if(output.length<=OUTPUT_BYTES)return output;
  }
  throw failure('RECEIPT_COMPRESSION_LIMIT');
 }catch(error){if(error.status)throw error;throw failure('RECEIPT_INVALID_IMAGE');}
 finally{active--;}
}
module.exports={friendlyFilename,safeDisplayFilename,normalizeReceipt,MAX_PIXELS,OUTPUT_BYTES};
