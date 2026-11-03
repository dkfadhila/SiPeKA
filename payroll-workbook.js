'use strict';
const fs=require('node:fs'),path=require('node:path');
const {zip,unzip}=require('./report-template-xlsx'),{col}=require('./report-template');
const esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
function workbook(type,rows=[]){
 if(!['general','laundry'].includes(type)||rows.length>1000)throw Error('PAYROLL_TEMPLATE_TYPE');
 const header=require('./employee-payroll')[type==='laundry'?'FULL_LAUNDRY_HEADER':'FULL_GENERAL_HEADER'];
 const keys=['key','period','employee_id','full_name','department','branch_name','company_name','company_address','document_code',...header.split(',').slice(2)];
 const files=unzip(fs.readFileSync(path.join(__dirname,'report-templates','payroll-'+type+'.xlsx')));
 for(const file of files.filter(f=>f.name.endsWith('.xml'))){let x=file.data.toString();if(x.includes('xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'))x=x.replace('xmlns:x=','xmlns=').replace(/<(\/?)x:/g,'<$1');file.data=Buffer.from(x);}
 const db=files.find(f=>f.name==='xl/worksheets/sheet2.xml');
 if(!db)throw Error('PAYROLL_WORKBOOK_INVALID');
 let xml=db.data.toString();
 const sourceStyles=new Map([...xml.matchAll(/<c\b[^>]*\br="([A-Z]+)5"[^>]*\bs="(\d+)"/g)].map(m=>[m[1],m[2]]));
 for(let i=0;i<rows.length;i++){
  const row=rows[i],r=i+5;
  const cells=keys.map((key,c)=>{
   const ref=col(c)+r,cell='<c r="'+ref+'" s="'+(sourceStyles.get(col(c))||0)+'"';
   if(key==='key')return cell+'><f>IF(OR(B'+r+'="",C'+r+'=""),"",B'+r+'&amp;"|"&amp;C'+r+')</f><v></v></c>';
   const value=key==='employee_id'?(row.employee_code||row.employee_number||row.employee_id):row[key];if(value==null)return cell+'/>';
   const numeric=/salary|allowance|overtime|bonus|deduction|ironing|pph21/.test(key)&&/^\d{1,15}$/.test(String(value));
   return cell+(numeric?'><v>'+value+'</v>':' t="inlineStr"><is><t xml:space="preserve">'+esc(value)+'</t></is>')+'</c>';
  }).join('');
  const regex=new RegExp('<row\\b[^>]*\\br="'+r+'"[^>]*>[\\s\\S]*?<\\/row>');
  if(!regex.test(xml))throw Error('PAYROLL_WORKBOOK_ROWS');xml=xml.replace(regex,'<row r="'+r+'">'+cells+'</row>');
 }
 db.data=Buffer.from(xml.replace(/<pageMargins\b[^>]*\/>|<pageSetup\b[^>]*\/>/g,'').replace('<sheetViews>','<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><sheetViews>').replace('</worksheet>','<pageMargins left="0.3" right="0.3" top="0.3" bottom="0.3" header="0" footer="0"/><pageSetup paperSize="9" orientation="landscape" fitToWidth="1" fitToHeight="0"/></worksheet>'));
 const slip=files.find(f=>f.name==='xl/worksheets/sheet1.xml');
 if(rows.length){let s=slip.data.toString();for(const [ref,value]of [['D6',rows[0].period],['G6',rows[0].employee_code||rows[0].employee_number||rows[0].employee_id]])s=s.replace(new RegExp('<c\\b[^>]*\\br="'+ref+'"[^>]*?(?:\\/>|>[\\s\\S]*?<\\/c>)'),full=>'<c r="'+ref+'" s="'+(/\bs="(\d+)"/.exec(full)?.[1]||8)+'" t="inlineStr"><is><t>'+esc(value)+'</t></is></c>');slip.data=Buffer.from(s);}
 // A small text gutter separates right-hand labels from left-hand amounts.
 let padded=slip.data.toString();
 const rightLabels=['Potongan Absen','Potongan Telat','Potongan Pelanggaran',...(type==='laundry'?['Potongan Lainnya']:[]),'PPh 21'];
 for(const [ref,label]of [...rightLabels.map((label,i)=>['E'+(12+i),label]),['E25','Total Potongan']])padded=padded.replace(new RegExp('<c\\b([^>]*\\br="'+ref+'"[^>]*?)(?:\\/>|>[\\s\\S]*?<\\/c>)'),(_,attrs)=>'<c'+attrs.replace(/\s+t="[^"]*"/g,'')+' t="inlineStr"><is><t xml:space="preserve">  '+label+'</t></is></c>');
 slip.data=Buffer.from(padded);
 // Fit the slip to A4 and keep the full database separate from its print area.
 let sheet=slip.data.toString().replace('<sheetViews>','<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><sheetViews>').replace(/<pageMargins[^>]*\/>|<pageSetup[^>]*\/>/g,'');
 slip.data=Buffer.from(sheet.replace('</worksheet>','<pageMargins left="0.35" right="0.35" top="0.35" bottom="0.35" header="0" footer="0"/><pageSetup paperSize="9" orientation="portrait" fitToWidth="1" fitToHeight="1"/></worksheet>'));
 // Transparent stationery frame is an embedded workbook asset, never a remote URL.
 const relns='http://schemas.openxmlformats.org/officeDocument/2006/relationships';
 const drawing='http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing';
 const pic='<xdr:wsDr xmlns:xdr="'+drawing+'" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="'+relns+'"><xdr:twoCellAnchor><xdr:from><xdr:col>0</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>0</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:from><xdr:to><xdr:col>8</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>46</xdr:row><xdr:rowOff>0</xdr:rowOff></xdr:to><xdr:pic><xdr:nvPicPr><xdr:cNvPr id="1" name="Frame"/><xdr:cNvPicPr/></xdr:nvPicPr><xdr:blipFill><a:blip r:embed="rIdFrame"/><a:stretch><a:fillRect/></a:stretch></xdr:blipFill><xdr:spPr><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></xdr:spPr></xdr:pic><xdr:clientData/></xdr:twoCellAnchor></xdr:wsDr>';
 files.push({name:'xl/drawings/frame.xml',data:Buffer.from(pic)},{name:'xl/drawings/_rels/frame.xml.rels',data:Buffer.from('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdFrame" Type="'+relns+'/image" Target="../media/payroll-frame.png"/></Relationships>')},{name:'xl/media/payroll-frame.png',data:fs.readFileSync(path.join(__dirname,'assets/payroll-frame.png'))});
 const sheetrels=files.find(f=>f.name==='xl/worksheets/_rels/sheet1.xml.rels');const link='<Relationship Id="rIdFrame" Type="'+relns+'/drawing" Target="../drawings/frame.xml"/>';
 if(sheetrels)sheetrels.data=Buffer.from(sheetrels.data.toString().replace('</Relationships>',link+'</Relationships>'));else files.push({name:'xl/worksheets/_rels/sheet1.xml.rels',data:Buffer.from('<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'+link+'</Relationships>')});
 slip.data=Buffer.from(slip.data.toString().replace('<worksheet ','<worksheet xmlns:r="'+relns+'" ').replace('</worksheet>','<drawing r:id="rIdFrame"/></worksheet>'));
 const types=files.find(f=>f.name==='[Content_Types].xml');let tx=types.data.toString();if(!/Extension="png"/.test(tx))tx=tx.replace('</Types>','<Default Extension="png" ContentType="image/png"/></Types>');types.data=Buffer.from(tx.replace('</Types>','<Override PartName="/xl/drawings/frame.xml" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>'));
 const book=files.find(f=>f.name==='xl/workbook.xml');let bx=book.data.toString().replace(/<definedNames>[\s\S]*?<\/definedNames>/g,'');bx=bx.replace('</workbook>','<definedNames><definedName name="_xlnm.Print_Area" localSheetId="0">&apos;Slip Gaji&apos;!$A$1:$H$46</definedName><definedName name="_xlnm.Print_Area" localSheetId="1">Database!$A$1:$'+col(keys.length-1)+'$'+Math.max(5,rows.length+4)+'</definedName></definedNames></workbook>');book.data=Buffer.from(bx.replace(/<calcPr\b[^>]*\/>/g,'').replace('</workbook>','<calcPr fullCalcOnLoad="1" forceFullCalc="1"/></workbook>'));
 require('./document-approval-xlsx').payroll(files);
 require('./payroll-xlsx-style').apply(files,{keys,type,rows});
 return zip(files);
}
module.exports={workbook};
