'use strict';
const zlib=require('node:zlib');
const {fault}=require('./payroll');
const {labels}=require('./payroll-csv');
const MAX_FILE=1024*1024,MAX_ENTRY=4*1024*1024,MAX_TOTAL=8*1024*1024,MAX_ENTRIES=64;
const xmlSafe=text=>{if(/<!DOCTYPE|<!ENTITY/i.test(text))throw fault('PAYROLL_XLSX_INVALID');return text.replace(/<\/?[A-Za-z_][\w.-]*:/g,'<').replace(/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);)/gi,'&amp;');};
const decode=value=>value.replace(/&(?:amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);/gi,entity=>{const map={'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'"};if(map[entity])return map[entity];const hex=/^&#x([\da-f]+);$/i.exec(entity),dec=/^&#(\d+);$/.exec(entity),code=hex?parseInt(hex[1],16):dec?Number(dec[1]):NaN;if(!Number.isSafeInteger(code)||code<1||code>0x10ffff||code>=0xd800&&code<=0xdfff)throw fault('PAYROLL_XLSX_INVALID');return String.fromCodePoint(code);});
function attr(source,name){const hit=new RegExp('(?:^|\\s)'+name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'="([^"]*)"').exec(source);return hit?decode(hit[1]):null;}
function zipParts(buffer){
 if(!Buffer.isBuffer(buffer)||buffer.length<22||buffer.length>MAX_FILE)throw fault(buffer?.length>MAX_FILE?'PAYROLL_XLSX_LIMIT':'PAYROLL_XLSX_INVALID');
 let end=-1;for(let i=buffer.length-22;i>=Math.max(0,buffer.length-65557);i--)if(buffer.readUInt32LE(i)===0x06054b50){end=i;break;}if(end<0)throw fault('PAYROLL_XLSX_INVALID');
 const disk=buffer.readUInt16LE(end+4),cdDisk=buffer.readUInt16LE(end+6),diskCount=buffer.readUInt16LE(end+8),count=buffer.readUInt16LE(end+10),cdSize=buffer.readUInt32LE(end+12),cdOffset=buffer.readUInt32LE(end+16),comment=buffer.readUInt16LE(end+20);
 if(disk||cdDisk||diskCount!==count||count<1||count>MAX_ENTRIES||end+22+comment!==buffer.length||cdOffset+cdSize!==end)throw fault('PAYROLL_XLSX_INVALID');
 const files=new Map();let at=cdOffset,total=0;
 for(let i=0;i<count;i++){
  if(at+46> end||buffer.readUInt32LE(at)!==0x02014b50)throw fault('PAYROLL_XLSX_INVALID');
  const flags=buffer.readUInt16LE(at+8),method=buffer.readUInt16LE(at+10),compressed=buffer.readUInt32LE(at+20),size=buffer.readUInt32LE(at+24),nameLen=buffer.readUInt16LE(at+28),extra=buffer.readUInt16LE(at+30),commentLen=buffer.readUInt16LE(at+32),local=buffer.readUInt32LE(at+42);
  if(flags&1||![0,8].includes(method)||compressed===0xffffffff||size===0xffffffff||size>MAX_ENTRY||compressed>MAX_FILE||total+size>MAX_TOTAL||at+46+nameLen+extra+commentLen>end)throw fault('PAYROLL_XLSX_INVALID');
  const name=buffer.subarray(at+46,at+46+nameLen).toString('utf8');if(!name||name.includes('\\')||name.startsWith('/')||name.split('/').includes('..')||files.has(name)||/vbaProject|externalLinks/i.test(name))throw fault('PAYROLL_XLSX_INVALID');
  if(local+30>cdOffset||buffer.readUInt32LE(local)!==0x04034b50)throw fault('PAYROLL_XLSX_INVALID');
  const localName=buffer.readUInt16LE(local+26),localExtra=buffer.readUInt16LE(local+28),dataAt=local+30+localName+localExtra;
  if(dataAt+compressed>cdOffset||buffer.subarray(local+30,local+30+localName).toString('utf8')!==name||buffer.readUInt16LE(local+8)!==method)throw fault('PAYROLL_XLSX_INVALID');
  if(/^(?:xl\/workbook\.xml|xl\/_rels\/workbook\.xml\.rels|xl\/sharedStrings\.xml|xl\/worksheets\/[^/]+\.xml)$/.test(name)){
   const raw=buffer.subarray(dataAt,dataAt+compressed);let data;try{data=method===0?Buffer.from(raw):zlib.inflateRawSync(raw,{maxOutputLength:MAX_ENTRY});}catch{throw fault('PAYROLL_XLSX_INVALID');}if(data.length!==size)throw fault('PAYROLL_XLSX_INVALID');files.set(name,xmlSafe(data.toString('utf8')));
  }
  total+=size;at+=46+nameLen+extra+commentLen;
 }
 if(at!==end)throw fault('PAYROLL_XLSX_INVALID');return files;
}
function elements(xml,name){const tag=name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');return [...xml.matchAll(new RegExp('<'+tag+'\\b([^>]*)>([\\s\\S]*?)<\\/'+tag+'\\s*>|<'+tag+'\\b([^>]*)\\/>','g'))].map(m=>({attrs:m[1]??m[3]??'',body:m[2]??''}));}
function textNodes(xml){return elements(xml,'t').map(v=>decode(v.body.replace(/<[^>]*>/g,''))).join('');}
const norm=value=>String(value??'').normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase('id-ID');
const aliases=new Map([...Object.entries(labels).flatMap(([key,label])=>[[norm(key),key],[norm(label),key]]),...[
 ['key','key'],['kunci otomatis','key'],['periode (yyyy-mm)','period'],['department','department'],['departemen','department'],['id karyawan','employee_id'],['no. karyawan','employee_id'],['branch_name','branch_name'],['unit / cabang','branch_name'],['company_name','company_name'],['nama perusahaan','company_name'],['company_address','company_address'],['alamat perusahaan','company_address'],['document_code','document_code'],['nomor dokumen','document_code']
].map(([a,b])=>[norm(a),b])]);
function read(encoded){
 if(typeof encoded!=='string'||encoded.length>Math.ceil(MAX_FILE/3)*4||encoded.length%4||!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))throw fault('PAYROLL_XLSX_INVALID');
 const buffer=Buffer.from(encoded,'base64');if(buffer.toString('base64')!==encoded)throw fault('PAYROLL_XLSX_INVALID');const files=zipParts(buffer),book=files.get('xl/workbook.xml'),rels=files.get('xl/_rels/workbook.xml.rels');if(!book||!rels)throw fault('PAYROLL_XLSX_INVALID');
 const database=elements(book,'sheet').find(s=>attr(s.attrs,'name')==='Database');if(!database)throw fault('PAYROLL_XLSX_SHEET_REQUIRED');const rid=attr(database.attrs,'r:id');
 const relation=elements(rels,'Relationship').find(r=>attr(r.attrs,'Id')===rid);if(!relation)throw fault('PAYROLL_XLSX_INVALID');const target=attr(relation.attrs,'Target');const sheetPath=target?.startsWith('/')?target.slice(1):'xl/'+target;if(!/^xl\/worksheets\/[A-Za-z0-9_.-]+\.xml$/.test(sheetPath))throw fault('PAYROLL_XLSX_INVALID');const sheet=files.get(sheetPath);if(!sheet)throw fault('PAYROLL_XLSX_INVALID');
 let shared=[];const strings=files.get('xl/sharedStrings.xml');if(strings)shared=elements(strings,'si').map(si=>textNodes(si.body));
 const rows=elements(sheet,'row').map(row=>{const number=Number(attr(row.attrs,'r'));if(!Number.isInteger(number)||number<1||number>1005)throw fault('PAYROLL_XLSX_INVALID');const cells=new Map();for(const c of elements(row.body,'c')){const ref=attr(c.attrs,'r'),match=/^([A-Z]{1,3})(\d+)$/.exec(ref||'');if(!match||Number(match[2])!==number)throw fault('PAYROLL_XLSX_INVALID');let column=0;for(const letter of match[1])column=column*26+letter.charCodeAt(0)-64;if(cells.has(column))throw fault('PAYROLL_XLSX_INVALID');const type=attr(c.attrs,'t'),formula=elements(c.body,'f').length>0;let value='';if(type==='inlineStr')value=textNodes(c.body);else{const val=elements(c.body,'v')[0]?.body||'';value=decode(val);if(type==='s'){const index=Number(value);if(!Number.isInteger(index)||index<0||index>=shared.length)throw fault('PAYROLL_XLSX_INVALID');value=shared[index];}else if(type&&type!=='str'&&type!=='n')throw fault('PAYROLL_XLSX_INVALID');}cells.set(column,{value,formula});}return {number,cells};});
 const headerRow=rows.find(row=>{const names=[...row.cells.values()].map(cell=>aliases.get(norm(cell.value)));return names.includes('period')&&names.includes('employee_id')&&names.includes('basic_salary');});if(!headerRow)throw fault('PAYROLL_XLSX_HEADER');
 const fields=new Map();for(const [column,cell]of headerRow.cells){const field=aliases.get(norm(cell.value));if(field){if(fields.has(field))throw fault('PAYROLL_XLSX_HEADER');fields.set(field,column);}else if(String(cell.value).trim())throw fault('PAYROLL_XLSX_HEADER');}
 const laundry=fields.has('meal_allowance');const source=require('./employee-payroll')[laundry?'FULL_LAUNDRY_HEADER':'FULL_GENERAL_HEADER'].split(',');const wanted=['period','employee_id','full_name',...source.slice(2)];if(wanted.some(field=>!fields.has(field)))throw fault('PAYROLL_XLSX_HEADER');
 const allowed=new Set([...wanted,'key','department','branch_name','company_name','company_address','document_code','email']);for(const field of fields.keys())if(!allowed.has(field))throw fault('PAYROLL_XLSX_HEADER');
 const outputFields=fields.has('email')?[...wanted,'email']:wanted,quote=v=>'"'+String(v??'').replace(/"/g,'""')+'"',table=[outputFields],metadata=[];let recordCount=0;
 for(const row of rows.filter(r=>r.number>headerRow.number)){
  const get=field=>{const cell=row.cells.get(fields.get(field));if(cell?.formula&&field!=='key')throw fault('PAYROLL_XLSX_FORMULA');return cell?.value??'';};
  if([...fields.keys()].some(field=>field!=='key'&&String(get(field)).trim())){
   recordCount++;if(recordCount>1000)throw fault('PAYROLL_XLSX_ROWS');
   for(const [field,column]of fields){const cell=row.cells.get(column);if(field!=='key'&&cell?.formula)throw fault('PAYROLL_XLSX_FORMULA');}
   for(const [column,cell]of row.cells){if(![...fields.values()].includes(column)&&String(cell.value).trim())throw fault('PAYROLL_XLSX_HEADER');}
   table.push(outputFields.map(get));metadata.push({department:get('department'),branch_name:get('branch_name'),company_name:get('company_name')});
  }
 }
 if(!recordCount)throw fault('PAYROLL_XLSX_ROWS');const csv='\uFEFF'+table.map(row=>row.map(quote).join(',')).join('\r\n');return {csv,type:laundry?'laundry':'general',row_count:recordCount,metadata};
}
module.exports={read,MAX_FILE};
