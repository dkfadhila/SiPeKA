'use strict';
// Preserve the Owner's original OOXML workbook, including styles, widths and merges.
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib');
const {col}=require('./report-template');
function unzip(buffer){
 let end=buffer.length-22;while(end>=Math.max(0,buffer.length-65557)&&buffer.readUInt32LE(end)!==0x06054b50)end--;
 if(end<0)throw Error('XLSX_INVALID_ZIP');let at=buffer.readUInt32LE(end+16);const files=[];
 for(let i=0;i<buffer.readUInt16LE(end+10);i++){
  if(buffer.readUInt32LE(at)!==0x02014b50)throw Error('XLSX_INVALID_DIRECTORY');
  const method=buffer.readUInt16LE(at+10),size=buffer.readUInt32LE(at+20),n=buffer.readUInt16LE(at+28),extra=buffer.readUInt16LE(at+30),comment=buffer.readUInt16LE(at+32),offset=buffer.readUInt32LE(at+42),name=buffer.subarray(at+46,at+46+n).toString();
  const start=offset+30+buffer.readUInt16LE(offset+26)+buffer.readUInt16LE(offset+28),raw=buffer.subarray(start,start+size);
  if(method!==0&&method!==8)throw Error('XLSX_COMPRESSION_UNSUPPORTED');
  files.push({name,data:method===8?zlib.inflateRawSync(raw):Buffer.from(raw)});at+=46+n+extra+comment;
 }return files;
}
const table=Array.from({length:256},(_,n)=>{for(let i=0;i<8;i++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
function crc(buffer){let n=0xffffffff;for(const byte of buffer)n=table[(n^byte)&255]^(n>>>8);return(n^0xffffffff)>>>0;}
function zip(files){const parts=[],central=[];let offset=0;for(const file of files){const name=Buffer.from(file.name),data=zlib.deflateRawSync(file.data),sum=crc(file.data),head=Buffer.alloc(30);head.writeUInt32LE(0x04034b50);head.writeUInt16LE(20,4);head.writeUInt16LE(8,8);head.writeUInt32LE(sum,14);head.writeUInt32LE(data.length,18);head.writeUInt32LE(file.data.length,22);head.writeUInt16LE(name.length,26);parts.push(head,name,data);const c=Buffer.alloc(46);c.writeUInt32LE(0x02014b50);c.writeUInt16LE(20,4);c.writeUInt16LE(20,6);c.writeUInt16LE(8,10);c.writeUInt32LE(sum,16);c.writeUInt32LE(data.length,20);c.writeUInt32LE(file.data.length,24);c.writeUInt16LE(name.length,28);c.writeUInt32LE(offset,42);central.push(c,name);offset+=head.length+name.length+data.length;}const directory=Buffer.concat(central),end=Buffer.alloc(22);end.writeUInt32LE(0x06054b50);end.writeUInt16LE(files.length,8);end.writeUInt16LE(files.length,10);end.writeUInt32LE(directory.length,12);end.writeUInt32LE(offset,16);return Buffer.concat([...parts,directory,end]);}
const escape=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
function exportXlsx(layout,company){
 require('./report-identity').companyName(company);
 if(layout.presentation==='simple')return require('./report-simple-xlsx').create(layout.excelLayout||layout,company,{zip,escape,col});
 const files=unzip(fs.readFileSync(path.join(__dirname,'report-templates',layout.kind+'.xlsx')));
 const sheet=files.find(f=>f.name==='xl/worksheets/sheet1.xml');let xml=sheet.data.toString();
 const values={};layout.grid.forEach((row,r)=>row.forEach((v,c)=>{values[col(c)+(r+1)]=v;}));values.A1=company;
 // Store cached values, with no live formula that could turn missing data into zero.
 // Report is an exported snapshot; retain template formulas only in the original source files.
 xml=xml.replace(/<c\b([^>]*?\br="([A-Z]+\d+)"[^>]*?)(?:\s*\/>|>[\s\S]*?<\/c>)/g,(full,attrs,ref)=>{
  if(!Object.hasOwn(values,ref))return full;const value=values[ref];attrs=attrs.replace(/\s+t="[^"]*"/g,'').replace(/\/$/,'');
  if(value==null)return '<c'+attrs+'/>';
  const numeric=typeof value==='number'||typeof value==='string'&&/^-?\d+$/.test(value);
  return '<c'+attrs+(numeric?'><v>'+escape(value)+'</v>':' t="inlineStr"><is><t xml:space="preserve">'+escape(value)+'</t></is>')+'</c>';
 });
 // Period labels can span several lines; preserve readable headers in Excel.
 xml=xml.replace(/<row\b([^>]*\br="6"[^>]*)>/,(_,attrs)=>'<row'+attrs.replace(/\s+(?:ht|customHeight)="[^"]*"/g,'')+' ht="52" customHeight="1">');
 xml=xml.replace(/<headerFooter[\s\S]*?<\/headerFooter>/g,'');
 const footer='<headerFooter><oddFooter>&amp;LSiPeKA&amp;RHalaman &amp;P / &amp;N</oddFooter></headerFooter>';
 xml=xml.replace('</worksheet>',footer+'</worksheet>');sheet.data=Buffer.from(xml);
 const styles=files.find(f=>f.name==='xl/styles.xml');if(styles)styles.data=Buffer.from(styles.data.toString().replace(/FF(?:[0-9A-F]{6})/g,color=>{const r=parseInt(color.slice(2,4),16),g=parseInt(color.slice(4,6),16),b=parseInt(color.slice(6,8),16);return(g>r*1.1&&g>b*1.05)?'FF1F3864':color;}));
 // Retain source notes sheet and add the scope/coverage notes as ordinary cells.
 const notes=files.find(f=>f.name==='xl/worksheets/sheet2.xml');if(notes){let text=notes.data.toString();const extra=layout.notes.map((v,i)=>'<row r="'+(30+i)+'"><c r="A'+(30+i)+'" t="inlineStr"><is><t>'+escape(v)+'</t></is></c></row>').join('');text=text.replace('</sheetData>',extra+'</sheetData>');notes.data=Buffer.from(text);}
 // Continue the original six-unit layout on additional worksheets when needed.
 for(const [index,part] of (layout.continuations||[]).entries()){
  const child=unzip(exportXlsx({...part,continuations:[]},company)).find(f=>f.name==='xl/worksheets/sheet1.xml');
  const number=index+3,rid='rIdSipeka'+number;
  files.push({name:'xl/worksheets/sheet'+number+'.xml',data:child.data});
  const workbook=files.find(f=>f.name==='xl/workbook.xml');workbook.data=Buffer.from(workbook.data.toString().replace('</sheets>','<sheet name="Unit '+(index*6+7)+'-'+(index*6+12)+'" sheetId="'+number+'" r:id="'+rid+'"/></sheets>'));
  const rels=files.find(f=>f.name==='xl/_rels/workbook.xml.rels');rels.data=Buffer.from(rels.data.toString().replace('</Relationships>','<Relationship Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet'+number+'.xml" Id="'+rid+'"/></Relationships>'));
  const types=files.find(f=>f.name==='[Content_Types].xml');types.data=Buffer.from(types.data.toString().replace('</Types>','<Override PartName="/xl/worksheets/sheet'+number+'.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>'));
 }
 return zip(files);
}
module.exports={exportXlsx,unzip,zip};
