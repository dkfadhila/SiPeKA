'use strict';
// Disposable OS process: parent bounds decode + initialization + recognition.
const fs=require('node:fs'),path=require('node:path');
process.once('message',async ({bytes,mime}={})=>{
 let worker;
 try {
  let sharp,createWorker,language;
  try {
   sharp=require('sharp');({createWorker}=require('tesseract.js'));language=require('@tesseract.js-data/eng');
   if(!path.isAbsolute(language.langPath)||!fs.statSync(path.join(language.langPath,'eng.traineddata.gz')).isFile())throw new Error('Missing local language');
  }catch{throw Object.assign(new Error(),{code:'OCR_ENGINE_UNAVAILABLE'});}
  sharp.cache(false);sharp.concurrency(1);
  const opts={limitInputPixels:12000000,failOn:'warning',animated:false};
  const image=sharp(bytes,opts),meta=await image.metadata();
  const formats={'image/png':'png','image/jpeg':'jpeg','image/webp':'webp','image/gif':'gif'};
  if(meta.format!==formats[mime]||!meta.width||!meta.height||meta.width*meta.height>12000000||(meta.pages||1)>1)throw Object.assign(new Error(),{code:'OCR_INVALID_IMAGE'});
  const png=await image.rotate().flatten({background:'#fff'}).resize({width:2200,height:2200,fit:'inside',withoutEnlargement:true}).greyscale().png().toBuffer();
  worker=await createWorker('eng',1,{langPath:language.langPath,gzip:true,cacheMethod:'none',logger:()=>{},errorHandler:()=>{}},{load_system_dawg:'0',load_freq_dawg:'0'});
  await worker.setParameters({tessedit_pageseg_mode:'6'});
  const {data}=await worker.recognize(png,{}, {text:true});
  if(typeof data.text!=='string'||data.text.length>20000)throw Object.assign(new Error(),{code:'OCR_OUTPUT_LIMIT'});
  await worker.terminate();worker=null;
  process.send({text:data.text,confidence:data.confidence},()=>process.exit(0));
 }catch(e){
  if(worker)await worker.terminate().catch(()=>{});
  const code=/^OCR_[A-Z_]+$/.test(e?.code||'')?e.code:'OCR_INVALID_IMAGE';
  process.send({error:code},()=>process.exit(1));
 }
});
