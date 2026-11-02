'use strict';
// One disposable, memory/time-limited process per untrusted PDF. Never execute PDF actions.
const {pathToFileURL}=require('node:url'),path=require('node:path');
process.once('message',async encoded=>{
 let document;
 try{
  const packagePath=require.resolve('pdfjs-dist/package.json');
  const pdfjs=await import(pathToFileURL(path.join(path.dirname(packagePath),'legacy/build/pdf.mjs')).href);
  const task=pdfjs.getDocument({data:new Uint8Array(Buffer.from(encoded,'base64')),isEvalSupported:false,useSystemFonts:false,disableFontFace:true,useWorkerFetch:false,verbosity:0,stopAtErrors:true});
  document=await task.promise;
  if(document.numPages!==1)throw Error('PAYROLL_PDF_SINGLE_SLIP');
  if((await document.getJSActions())||Object.keys(await document.getAttachments()||{}).length)throw Error('PAYROLL_PDF_ACTIVE_CONTENT');
  const page=await document.getPage(1);if(await page.getJSActions())throw Error('PAYROLL_PDF_ACTIVE_CONTENT');
  const annotations=await page.getAnnotations({intent:'any'});
  if(annotations.some(a=>a.actions&&Object.keys(a.actions).length||a.attachment||a.file||a.unsafeUrl&&/^(?:javascript|data|file):/i.test(a.unsafeUrl)))throw Error('PAYROLL_PDF_ACTIVE_CONTENT');
  const content=await page.getTextContent();let text='',lastY=null;
  for(const item of content.items){if(typeof item.str!=='string')continue;const y=item.transform?.[5];if(lastY!==null&&Math.abs(lastY-y)>3)text+='\n';text+=item.str+(item.hasEOL?'\n':' ');lastY=y;if(text.length>30000)throw Error('PAYROLL_PDF_TEXT_LIMIT');}
  if(text.trim().length<30)throw Error('PAYROLL_PDF_TEXT_REQUIRED');
  process.send({text},()=>process.exit(0));
 }catch(e){process.send({error:/^PAYROLL_PDF_[A-Z_]+$/.test(e.message)?e.message:'PAYROLL_PDF_INVALID'},()=>process.exit(0));}
});
