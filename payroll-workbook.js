'use strict';
const fs=require('node:fs'),path=require('node:path');
const {zip,unzip}=require('./report-template-xlsx'),{col}=require('./report-template');
const esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const friendly={key:'Kunci otomatis',period:'Periode (YYYY-MM)',employee_id:'ID Karyawan',full_name:'Nama Karyawan',department:'Departemen',branch_name:'Unit / Cabang',company_name:'Nama Perusahaan',company_address:'Alamat Perusahaan',document_code:'Nomor Dokumen',basic_salary:'Gaji Pokok (Rp)',operational_allowance:'Tunjangan Operasional (Rp)',health_allowance:'Tunjangan Kesehatan (Rp)',meal_allowance:'Uang Makan (Rp)',transport_allowance:'Transport (Rp)',ironing_regular:'Setrika Reguler (Rp)',ironing_express:'Setrika Express (Rp)',overtime:'Lembur (Rp)',bonus:'Bonus (Rp)',absence_deduction:'Potongan Absen (Rp)',late_deduction:'Potongan Telat (Rp)',violation_deduction:'Potongan Pelanggaran (Rp)',other_deductions:'Potongan Lainnya (Rp)',pph21:'PPh 21 (Rp)',job_title:'Jabatan',employment_status:'Status Karyawan',payment_method:'Metode Pembayaran'};
function workbook(type,rows=[]){
 if(!['general','laundry'].includes(type)||rows.length>1000)throw Error('PAYROLL_TEMPLATE_TYPE');
 const header=require('./employee-payroll')[type==='laundry'?'FULL_LAUNDRY_HEADER':'FULL_GENERAL_HEADER'];
 const keys=['key','period','employee_id','full_name','department','branch_name','company_name','company_address','document_code',...header.split(',').slice(2)];
 const files=unzip(fs.readFileSync(path.join(__dirname,'report-templates','payroll-'+type+'.xlsx')));
 for(const file of files.filter(f=>f.name.endsWith('.xml'))){let x=file.data.toString();if(x.includes('xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'))x=x.replace('xmlns:x=','xmlns=').replace(/<(\/?)x:/g,'<$1');file.data=Buffer.from(x);}
 const db=files.find(f=>f.name==='xl/worksheets/sheet2.xml');
 if(!db)throw Error('PAYROLL_WORKBOOK_INVALID');
 let xml=db.data.toString();
 const setText=(ref,value)=>{const re=new RegExp('<c\\b([^>]*\\br="'+ref+'"[^>]*)>([\\s\\S]*?)<\\/c>');if(!re.test(xml))throw Error('PAYROLL_WORKBOOK_CELL');xml=xml.replace(re,(_,attrs)=>'<c'+attrs+' t="inlineStr"><is><t xml:space="preserve">'+esc(value)+'</t></is></c>');};
 setText('A1','TEMPLATE INPUT GAJI — '+(type==='laundry'?'LAUNDRY':'UMUM'));
 setText('A2','Satu baris untuk satu karyawan. Isi sel kuning; kolom abu-abu dibuat otomatis. Nominal isi angka rupiah tanpa titik, komponen kosong isi 0.');
 for(let c=0;c<keys.length;c++)setText(col(c)+'4',friendly[keys[c]]||keys[c]);
 const deductionAt=keys.findIndex(k=>/^(absence_deduction|late_deduction|violation_deduction|other_deductions)$/.test(k));
 const pphAt=keys.indexOf('pph21'),salaryAt=keys.indexOf('basic_salary'),lastDetail=keys.length-1;
 const groups=[{start:0,end:0,label:'KUNCI'},{start:1,end:salaryAt-1,label:'IDENTITAS & DOKUMEN'},{start:salaryAt,end:deductionAt-1,label:'PENDAPATAN'},{start:deductionAt,end:pphAt,label:'POTONGAN'},{start:pphAt+1,end:lastDetail,label:'DATA KARYAWAN'}].filter(g=>g.start<=g.end);
 const groupStarts=new Map(groups.map(g=>[g.start,g.label]));
 const row3=keys.map((_,c)=>'<c r="'+col(c)+'3"'+(groupStarts.has(c)?' t="inlineStr"><is><t>'+esc(groupStarts.get(c))+'</t></is></c>':'/>')).join('');
 const merges=groups.filter(g=>g.end>g.start).map(g=>'<mergeCell ref="'+col(g.start)+'3:'+col(g.end)+'3"/>').join('');
 const widths=keys.map((key,i)=>{let width=key==='key'?18:/address|company_name/.test(key)?28:/allowance|deduction|ironing/.test(key)?22:/salary|overtime|bonus|pph21/.test(key)?17:/period|employee_id|status|method/.test(key)?19:/full_name|department|branch|job_title/.test(key)?21:18;return '<col min="'+(i+1)+'" max="'+(i+1)+'" width="'+width+'" customWidth="1"/>';}).join('');
 xml=xml.replace(/<cols>[\s\S]*?<\/cols>/,'<cols>'+widths+'</cols>');
 const sourceStyles=new Map([...xml.matchAll(/<c\b[^>]*\br="([A-Z]+)5"[^>]*\bs="(\d+)"/g)].map(m=>[m[1],m[2]]));
 const headerStyles=new Map([...xml.matchAll(/<c\b[^>]*\br="([A-Z]+)4"[^>]*\bs="(\d+)"/g)].map(m=>[m[1],m[2]]));
 const rowCount=rows.length?rows.length:1000;
 let dataRows='';
 for(let i=0;i<rowCount;i++){
  const row=rows[i]||{},r=i+5;
  const cells=keys.map((key,c)=>{
   const ref=col(c)+r,cell='<c r="'+ref+'" s="'+(sourceStyles.get(col(c))||0)+'"';
   if(key==='key')return cell+'><f>IF(OR(B'+r+'="",C'+r+'=""),"",B'+r+'&amp;"|"&amp;C'+r+')</f><v></v></c>';
   const value=key==='employee_id'?(row.employee_code||row.employee_number||row.employee_id):row[key];if(value==null)return cell+'/>';
   const numeric=/salary|allowance|overtime|bonus|deduction|ironing|pph21/.test(key)&&/^\d{1,15}$/.test(String(value));
   return cell+(numeric?'><v>'+value+'</v>':' t="inlineStr"><is><t xml:space="preserve">'+esc(value)+'</t></is>')+'</c>';
  }).join('');
  dataRows+='<row r="'+r+'">'+cells+'</row>';
 }
 const headerCells=keys.map((key,c)=>'<c r="'+col(c)+'4" s="'+(headerStyles.get(col(c))||23)+'" t="inlineStr"><is><t>'+esc(friendly[key]||key)+'</t></is></c>').join('');
 const row1=keys.map((_,c)=>c===0?'<c r="A1" t="inlineStr"><is><t>'+esc('TEMPLATE INPUT GAJI — '+(type==='laundry'?'LAUNDRY':'UMUM'))+'</t></is></c>':'<c r="'+col(c)+'1"/>').join('');
 const row2=keys.map((_,c)=>c===0?'<c r="A2" t="inlineStr"><is><t>'+esc('Satu baris untuk satu karyawan. Isi sel kuning. Sel abu-abu tidak perlu diisi; data diambil dari direktori/profil saat impor. Nominal isi angka rupiah tanpa titik, komponen kosong isi 0.')+'</t></is></c>':'<c r="'+col(c)+'2"/>').join('');
 const sheetRows='<row r="1" ht="30" customHeight="1">'+row1+'</row><row r="2" ht="32" customHeight="1">'+row2+'</row><row r="3" ht="22" customHeight="1">'+row3+'</row><row r="4" ht="40" customHeight="1">'+headerCells+'</row>'+dataRows;
 xml=xml.replace(/<sheetData>[\s\S]*?<\/sheetData>/,'<sheetData>'+sheetRows+'</sheetData>');
 xml=xml.replace(/<dimension ref="[^"]*"\/>/,'<dimension ref="A1:'+col(keys.length-1)+(rowCount+4)+'"/>');
 const allMerges=['<mergeCell ref="A1:'+col(keys.length-1)+'1"/>','<mergeCell ref="A2:'+col(keys.length-1)+'2"/>',merges].join('');
 xml=xml.replace('</sheetData>','</sheetData><autoFilter ref="A4:'+col(keys.length-1)+(rowCount+4)+'"/><mergeCells count="'+(groups.filter(g=>g.end>g.start).length+2)+'">'+allMerges+'</mergeCells>');
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
