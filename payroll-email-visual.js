'use strict';
const fs=require('node:fs'),path=require('node:path');
const CID='amc-payroll-header',FILENAME='amc-payroll-header.png',MAX_BYTES=4*1024*1024;
const PNG=Buffer.from([137,80,78,71,13,10,26,10]);
let cached;
function headerAttachment(){
 if(cached===undefined){
  const file=path.join(__dirname,'assets/payroll-email-header.png');
  if(!fs.existsSync(file))cached=null;
  else{
   const stat=fs.lstatSync(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>MAX_BYTES||stat.size<33)throw Error('PAYROLL_EMAIL_VISUAL_INVALID');
   const content=fs.readFileSync(file),width=content.readUInt32BE(16),height=content.readUInt32BE(20);
   if(!content.subarray(0,8).equals(PNG)||content.subarray(12,16).toString()!=='IHDR'||width<1||width>4096||height<1||height>2048)throw Error('PAYROLL_EMAIL_VISUAL_INVALID');
   cached=content;
  }
 }
 return cached?{filename:FILENAME,content:Buffer.from(cached),contentType:'image/png',contentDisposition:'inline',cid:CID}:null;
}
function validHeaderAttachment(value){const trusted=headerAttachment();return !!trusted&&value?.filename===FILENAME&&value.cid===CID&&value.contentType==='image/png'&&value.contentDisposition==='inline'&&Buffer.isBuffer(value.content)&&value.content.length<=MAX_BYTES&&value.content.equals(trusted.content)&&!value.path;}
module.exports={CID,FILENAME,MAX_BYTES,headerAttachment,validHeaderAttachment};
