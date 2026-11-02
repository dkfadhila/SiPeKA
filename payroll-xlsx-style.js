'use strict';
// Add real printable table lines after data injection. Clone cell styles so
// formulas, ID text formats, selectors, spacing and the signature block survive.
function apply(files,{keys,type,rows=[]}={}){
 const styles=files.find(f=>f.name==='xl/styles.xml');let xml=styles.data.toString();
 const borderBlock=/<borders\b[^>]*>([\s\S]*?)<\/borders>/.exec(xml),xfBlock=/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(xml);
 if(!borderBlock||!xfBlock)throw Error('PAYROLL_WORKBOOK_STYLES');
 const borders=[...borderBlock[1].matchAll(/<border\b[^>]*\/>|<border\b[^>]*>[\s\S]*?<\/border>/g)].map(m=>m[0]);
 const xfs=[...xfBlock[1].matchAll(/<xf\b[^>]*\/>|<xf\b[^>]*>[\s\S]*?<\/xf>/g)].map(m=>m[0]),borderCache=new Map(),styleCache=new Map();
 const edge=(name,weight)=>'<'+name+(weight?' style="'+weight+'"><color rgb="'+(weight==='thin'?'FFD2D2D2':'FF888888')+'"/></'+name+'>':'/>');
 const border=spec=>{const key=JSON.stringify(spec);if(borderCache.has(key))return borderCache.get(key);const id=borders.length;borders.push('<border>'+['left','right','top','bottom'].map(n=>edge(n,spec[n])).join('')+'<diagonal/></border>');borderCache.set(key,id);return id;};
 const attr=(s,name,value)=>new RegExp('\\b'+name+'="[^"]*"').test(s)?s.replace(new RegExp('\\b'+name+'="[^"]*"'),name+'="'+value+'"'):s.replace('<xf ','<xf '+name+'="'+value+'" ');
 const style=(base,spec,numeric=false,header=false,wrap=false)=>{const id=border(spec),key=[base,id,numeric,header,wrap].join(':');if(styleCache.has(key))return styleCache.get(key);let xf=xfs[base];if(!xf)throw Error('PAYROLL_WORKBOOK_STYLE_REFERENCE');xf=attr(attr(xf,'borderId',id),'applyBorder',1);if(numeric)xf=attr(attr(xf,'numFmtId',3),'applyNumberFormat',1);if(header||wrap){const alignment='<alignment horizontal="'+(header?'center':'left')+'" vertical="center" wrapText="1"/>';xf=xf.replace(/<alignment\b[^>]*\/>/g,'');xf=xf.endsWith('/>')?xf.slice(0,-2)+'>'+alignment+'</xf>':xf.replace('</xf>',alignment+'</xf>');xf=attr(xf,'applyAlignment',1);}const next=xfs.length;xfs.push(xf);styleCache.set(key,next);return next;};
 const patch=(sheet,choose)=>{sheet.data=Buffer.from(sheet.data.toString().replace(/<c\b([^>]*?\br="([A-Z]+)(\d+)"[^>]*?)(\/>|>[\s\S]*?<\/c>)/g,(full,attrs,letters,row,content)=>{let column=0;for(const c of letters)column=column*26+c.charCodeAt(0)-64;const config=choose(Number(row),column-1);if(!config)return full;const base=Number(/\bs="(\d+)"/.exec(attrs)?.[1]||0),id=style(base,config.border,config.numeric,config.header,config.wrap);attrs=/\bs="\d+"/.test(attrs)?attrs.replace(/\bs="\d+"/,'s="'+id+'"'):attrs+' s="'+id+'"';return '<c'+attrs+content;}));};
 const slip=files.find(f=>f.name==='xl/worksheets/sheet1.xml'),db=files.find(f=>f.name==='xl/worksheets/sheet2.xml'),lastDetail=type==='laundry'?20:16;
 patch(slip,(r,c)=>{
  if(c<1||c>6)return null;
  if(r>=7&&r<=9&&(c===3||c===6))return {border:{},wrap:true};
  if(r===11)return {border:{left:c===1||c===4?'medium':null,right:c===3||c===6?'medium':null,top:'medium',bottom:'thin'}};
  if(r>=12&&r<=25){const total=r===25;return {border:{left:c===1?'thin':c===4?'medium':null,right:c===2||c===5||c===6?'thin':c===3?'medium':null,top:total?'medium':null,bottom:total?'double':r<=lastDetail?'thin':null}};}
  if(r>=27&&r<=29)return {border:{left:c===1?'thin':null,right:c===6?'thin':null,top:r===27?'medium':null,bottom:r===29?'medium':null}};
  return null;
 });
 for(const [r,fields]of [[7,['full_name','job_title']],[8,['department','employment_status']],[9,['branch_name']]]){
  const lines=Math.max(r===7?2:1,...rows.flatMap(row=>fields.map(key=>Math.ceil(String(row[key]||'').length/18))));
  slip.data=Buffer.from(slip.data.toString().replace(new RegExp('<row\\b([^>]*\\br="'+r+'"[^>]*)>'),(_,attrs)=>'<row'+attrs.replace(/\s+(?:ht|customHeight)="[^"]*"/g,'')+' ht="'+Math.max(20,lines*14+4)+'" customHeight="1">'));
 }
 patch(db,(r,c)=>r>=4&&c<keys.length?{border:{left:'thin',right:'thin',top:r===4?'medium':'thin',bottom:r===4?'medium':'thin'},numeric:r>4&&/salary|allowance|overtime|bonus|deduction|ironing|pph21/.test(keys[c]),header:r===4}:null);
 // Keep the header readable when long variable names wrap into two lines.
 db.data=Buffer.from(db.data.toString().replace(/<row\b([^>]*\br="4"[^>]*)>/,(_,attrs)=>'<row'+attrs.replace(/\s+(?:ht|customHeight)="[^"]*"/g,'')+' ht="36" customHeight="1">'));
 xml=xml.replace(borderBlock[0],'<borders count="'+borders.length+'">'+borders.join('')+'</borders>').replace(xfBlock[0],'<cellXfs count="'+xfs.length+'">'+xfs.join('')+'</cellXfs>');styles.data=Buffer.from(xml);
}
module.exports={apply};
