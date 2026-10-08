'use strict';
const fs=require('node:fs/promises');const path=require('node:path');const crypto=require('node:crypto');
const {S3Client,PutObjectCommand,HeadObjectCommand,DeleteObjectCommand}=require('@aws-sdk/client-s3');
const {safeDisplayFilename}=require('./receipt-upload');
const VALID=/^evidence-[0-9]+-[a-f0-9]{6}\.(?:jpg|png|webp|gif)$/;
function nameOf(asset){const name=typeof asset==='string'?asset:asset?.filename;if(!VALID.test(name||''))throw new Error('Invalid receipt filename');return name;}
function backend(){const value=process.env.STORAGE_BACKEND||'filesystem';if(!['r2','filesystem'].includes(value))throw new Error('Unsupported storage backend');return value;}
function localPath(name){const root=path.resolve(process.env.UPLOADS_DIR||path.join(__dirname,'uploads','receipts'));const publicRoot=path.resolve(__dirname,'public');const relative=path.relative(publicRoot,root);if(!relative||(!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative)))throw new Error('Receipt storage must be outside public root');return path.join(root,name);}
function client(){for(const env of ['R2_ENDPOINT','R2_ACCESS_KEY_ID','R2_SECRET_ACCESS_KEY','R2_ATTACHMENT_BUCKET'])if(!process.env[env])throw new Error('Missing R2 configuration: '+env);return new S3Client({endpoint:process.env.R2_ENDPOINT,region:'auto',credentials:{accessKeyId:process.env.R2_ACCESS_KEY_ID,secretAccessKey:process.env.R2_SECRET_ACCESS_KEY},maxAttempts:3});}
async function saveReceipt({filename,buffer,mime,original_filename}){
 const name=nameOf(filename);if(!Buffer.isBuffer(buffer)||!buffer.length||buffer.length>6_000_000)throw new Error('Invalid receipt size');if(!['image/png','image/jpeg','image/webp','image/gif'].includes(mime))throw new Error('Invalid receipt MIME');
 const sha256=crypto.createHash('sha256').update(buffer).digest('hex');
 const display=safeDisplayFilename(original_filename,null);
 if(original_filename&&!display)throw new Error('Invalid receipt display filename');
 if(backend()==='r2'){const s3=client();try{await s3.send(new PutObjectCommand({Bucket:process.env.R2_ATTACHMENT_BUCKET,Key:'receipts/'+name,Body:buffer,ContentType:mime,IfNoneMatch:'*',Metadata:{sha256,...(display?{original_filename:display}:{})}}));}finally{s3.destroy();}}
 else{const destination=localPath(name);await fs.mkdir(path.dirname(destination),{recursive:true,mode:0o700});await fs.writeFile(destination,buffer,{flag:'wx',mode:0o600});if(display){try{await fs.writeFile(destination+'.metadata.json',JSON.stringify({original_filename:display,sha256}),{flag:'wx',mode:0o600});}catch(error){await fs.unlink(destination);throw error;}}}
 return {filename:name,mime,sha256,size:buffer.length};
}
async function readReceipt(asset){const name=nameOf(asset);return require('./receipt-storage-bounded').createBoundedReceiptReader()({filename:name});}
async function receiptDisplayName(asset){
 const name=nameOf(asset);
 if(backend()==='r2'){const s3=client();try{const value=await s3.send(new HeadObjectCommand({Bucket:process.env.R2_ATTACHMENT_BUCKET,Key:'receipts/'+name}),{abortSignal:AbortSignal.timeout(30000)});return safeDisplayFilename(value.Metadata?.original_filename,name);}finally{s3.destroy();}}
 const file=localPath(name)+'.metadata.json';try{const stat=await fs.lstat(file);if(!stat.isFile()||stat.isSymbolicLink()||stat.size>1024)throw new Error('Invalid receipt metadata');return safeDisplayFilename(JSON.parse(await fs.readFile(file,'utf8')).original_filename,name);}catch(error){if(error.code==='ENOENT')return name;throw error;}
}
async function deleteReceipt(asset){const name=nameOf(asset);if(backend()==='r2'){const s3=client();try{await s3.send(new DeleteObjectCommand({Bucket:process.env.R2_ATTACHMENT_BUCKET,Key:'receipts/'+name}));}finally{s3.destroy();}}else{await fs.unlink(localPath(name));await fs.unlink(localPath(name)+'.metadata.json').catch(error=>{if(error.code!=='ENOENT')throw error;});}}
module.exports={saveReceipt,readReceipt,deleteReceipt,receiptDisplayName};
