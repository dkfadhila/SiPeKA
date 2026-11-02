'use strict';
const {wording:w}=require('./public/document-approval');
const esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const col=n=>{let s='';for(n++;n;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s;return s;};
function block({start,width,left=0,split,style=12,boldStyle=style,noteStyle=style,responsibilityStyle=noteStyle}={}){
 const mid=split??left+Math.ceil((width-left)/2),last=width-1,merges=[];
 const cell=(c,r,value,s=style)=>'<c r="'+col(c)+r+'" s="'+s+'" t="inlineStr"><is><t xml:space="preserve">'+esc(value)+'</t></is></c>';
 const cells=(r,value,s=style)=>Array.from({length:width-left},(_,i)=>cell(left+i,r,typeof value==='function'?value(left+i):i?'':value,s)).join('');
 const pair=(r,a,b,height=22,bold=false)=>{if(mid-left>1){merges.push(col(left)+r+':'+col(mid-1)+r);}if(last>mid)merges.push(col(mid)+r+':'+col(last)+r);return '<row r="'+r+'" ht="'+height+'" customHeight="1">'+cells(r,c=>c===left?a:c===mid?b:'',bold?boldStyle:style)+'</row>';};
 let rows=pair(start,w.prepared,w.approved,24,true)+pair(start+1,w.department,w.company,24);
 rows+='<row r="'+(start+2)+'" ht="48" customHeight="1">'+cells(start+2,'')+'</row>';
 rows+=pair(start+3,'( '+w.preparer+' )','( '+w.approver+' )',24,true)+pair(start+4,w.preparerRole,w.approverRole,30);
 for(const [offset,value]of [[5,w.note],[6,w.responsibility]]){const r=start+offset;merges.push(col(left)+r+':'+col(last)+r);rows+='<row r="'+r+'" ht="30" customHeight="1">'+cells(r,value,offset===5?noteStyle:responsibilityStyle)+'</row>';}
 return {rows,merges,end:start+6};
}
function payroll(files){
 const styles=files.find(f=>f.name==='xl/styles.xml');let s=styles.data.toString();
 const fonts=/<fonts\b[^>]*>([\s\S]*?)<\/fonts>/.exec(s),fontCount=(fonts[1].match(/<font>/g)||[]).length;
 s=s.replace(fonts[0],'<fonts count="'+(fontCount+2)+'">'+fonts[1]+'<font><sz val="10"/><name val="Arial"/></font><font><b/><sz val="10"/><name val="Arial"/></font></fonts>');
 const xfs=/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(s),count=(xfs[1].match(/<xf\b/g)||[]).length;
 const borders=/<borders\b[^>]*>([\s\S]*?)<\/borders>/.exec(s),borderCount=(borders[1].match(/<border\b/g)||[]).length;
 s=s.replace(borders[0],'<borders count="'+(borderCount+1)+'">'+borders[1]+'<border><top style="thin"><color rgb="FF999999"/></top></border></borders>');
 const xf=(font,border=0,align='center')=>'<xf fontId="'+font+'" fillId="0" borderId="'+border+'" numFmtId="0" applyAlignment="1"><alignment horizontal="'+align+'" vertical="center" wrapText="1"/></xf>';
 s=s.replace(xfs[0],'<cellXfs count="'+(count+4)+'">'+xfs[1]+xf(fontCount)+xf(fontCount+1)+xf(fontCount,borderCount,'left')+xf(fontCount,0,'left')+'</cellXfs>');styles.data=Buffer.from(s);
 const sheet=files.find(f=>f.name==='xl/worksheets/sheet1.xml');let xml=sheet.data.toString();const footer=block({start:35,width:7,left:1,style:count,boldStyle:count+1,noteStyle:count+2,responsibilityStyle:count+3});
 xml=xml.replace(/<row\b[^>]*\br="(?:3[5-9]|4[0-6])"[^>]*(?:\/>|>[\s\S]*?<\/row>)/g,'').replace('</sheetData>',footer.rows+'</sheetData>');
 const existing=/<mergeCells\b[^>]*>([\s\S]*?)<\/mergeCells>/.exec(xml);
 const keep=[...existing[1].matchAll(/<mergeCell\b[^>]*ref="([^"]+)"[^>]*\/>/g)].filter(m=>Number(m[1].match(/\d+/)[0])<35).map(m=>m[0]);
 xml=xml.replace(existing[0],'<mergeCells count="'+(keep.length+footer.merges.length)+'">'+keep.join('')+footer.merges.map(ref=>'<mergeCell ref="'+ref+'"/>').join('')+'</mergeCells>');sheet.data=Buffer.from(xml);
}
module.exports={block,payroll};
