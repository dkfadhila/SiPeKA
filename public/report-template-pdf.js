/* Render the Owner's spreadsheet layout; rows/sections/column positions come from source XLSX. */
(()=>{'use strict';
 function simple(report,Ctor,company){
  const layout=report.templateLayout,wide=layout.grid[5].length>4;
  const doc=new Ctor({orientation:wide?'landscape':'portrait',unit:'mm',format:'a4',compress:true});
  const W=doc.internal.pageSize.getWidth(),H=doc.internal.pageSize.getHeight(),M=15;
  const money=v=>String(v).startsWith('-')?'('+String(v).slice(1).replace(/\B(?=(\d{3})+(?!\d))/g,'.')+')':String(v).replace(/\B(?=(\d{3})+(?!\d))/g,'.');
  const title=part=>{
   doc.setTextColor(17,17,17);doc.setFont('helvetica','bold');doc.setFontSize(18);doc.text(part.grid[1][0],W/2,18,{align:'center'});
   doc.setFontSize(11);doc.text(company,W/2,25,{align:'center'});doc.setFont('helvetica','normal');doc.setFontSize(9);
   doc.text((part.kind==='balance'?'Per '+part.period.to:part.period.from+' s.d. '+part.period.to)+' | '+report.branch,W/2,31,{align:'center'});
   if(part.documentCode){doc.setFontSize(8);doc.text('Kode dokumen: '+String(part.documentCode),W/2,36,{align:'center'});}
  };
  for(const [i,part] of [layout,...(layout.continuations||[])].entries()){
   if(i)doc.addPage();title(part);
   const columnStyles={0:{halign:'left',cellWidth:wide?80:part.kind==='balance'?100:125}};
   part.grid[5].slice(1).forEach((_,c)=>{columnStyles[c+1]={halign:'right'};});
   doc.autoTable({head:[part.grid[5]],body:part.grid.slice(6).map((row,r)=>row.map((v,c)=>c?(part.rowTypes[r+6]==='section'?'':v==null?'Belum tersedia':v===''?'':money(v)):v)),startY:part.documentCode?43:39,margin:{left:M,right:M,top:part.documentCode?43:39,bottom:window.SipekaDocumentApproval.height+26},theme:'plain',
    styles:{font:'helvetica',fontSize:9,cellPadding:2,textColor:[17,17,17],lineColor:[220,220,220],lineWidth:{bottom:.15}},
    headStyles:{fillColor:[255,255,255],textColor:[17,17,17],fontStyle:'bold'},columnStyles,rowPageBreak:'avoid',
    didParseCell:data=>{if(data.section==='body'&&data.column?.index===0){const level=Math.min(2,Math.max(0,Number(part.rowLevels?.[data.row.index+6])||0));data.cell.styles.cellPadding={top:2,right:2,bottom:2,left:2+level*4};}if(data.section==='body'&&['section','total'].includes(part.rowTypes[data.row.index+6])){data.cell.styles.fontStyle='bold';if(part.rowTypes[data.row.index+6]==='total')data.cell.styles.fillColor=[245,245,245];}},
    didDrawPage:()=>title(part)});
  }
  let y=doc.lastAutoTable.finalY+7;doc.setFontSize(8);doc.setTextColor(70,70,70);
  for(const note of layout.notes){const lines=doc.splitTextToSize(note,W-2*M);if(y+lines.length*3.8>H-17){doc.addPage();title(layout);doc.setFontSize(8);doc.setTextColor(70,70,70);y=42;}doc.text(lines,M,y);y+=lines.length*3.8+3;}
  if(y+window.SipekaDocumentApproval.height>H-17){doc.addPage();title(layout);y=48;}
  window.SipekaDocumentApproval.draw(doc,{top:Math.max(y+5,H-82),margin:M});
  const count=doc.internal.getNumberOfPages();for(let n=1;n<=count;n++){doc.setPage(n);doc.setFont('helvetica','normal');doc.setFontSize(7);doc.setTextColor(90,90,90);doc.text('SiPeKA',M,H-8);doc.text(n+' / '+count,W-M,H-8,{align:'right'});}
  return doc;
 }
 const navy=[31,56,100],ink=[30,35,43];
 function create(report,Ctor,company){
  const layout=report.templateLayout;if(!layout)throw Error('REPORT_TEMPLATE_REQUIRED');
  if(layout.presentation==='simple')return simple(report,Ctor,company);
  let grid=layout.grid.map(r=>[...r]);grid[0][0]=company;
  const wide=layout.kind==='pnl',doc=new Ctor({orientation:wide?'landscape':'portrait',unit:'mm',format:'a4',compress:true});
  const W=doc.internal.pageSize.getWidth(),H=doc.internal.pageSize.getHeight(),margin=12;
  const widths=wide?[15,69,19,19,19,19,19,19,24,31,20]:[20,100,33,33];
  const scale=(W-margin*2)/widths.reduce((a,b)=>a+b),ws=widths.map(n=>n*scale),xs=[margin];ws.forEach(w=>xs.push(xs.at(-1)+w));
  const money=value=>{const raw=String(value),negative=raw.startsWith('-'),s=raw.replace(/^-/,'').replace(/\B(?=(\d{3})+(?!\d))/g,'.');return negative?'('+s+')':s;};
  const pct=(value)=>new Intl.NumberFormat('id-ID',{style:'percent',minimumFractionDigits:1,maximumFractionDigits:1}).format(value);
  const date=v=>new Date(v+'T00:00:00Z').toLocaleDateString('id-ID',{day:'numeric',month:'long',year:'numeric',timeZone:'UTC'});
  const font=wide?7.3:8.4,lineHeight=wide?3.6:4;
  let y=margin;
  const title=()=>{doc.setFont('helvetica','bold');doc.setFontSize(12);doc.setTextColor(...navy);doc.text(company,margin,14);doc.setFontSize(10);doc.text(String(grid[1][0]||''),margin,20);doc.setFont('helvetica','normal');doc.setFontSize(8);doc.setTextColor(...ink);doc.text((wide||layout.kind==='cash'?'Periode '+date(layout.period.from)+' s.d. '+date(layout.period.to):String(grid[2][0]||'')+' '+date(layout.period.to)),margin,26);doc.text('(Disajikan dalam Rupiah)',margin,31);doc.setFontSize(7);doc.text('Lingkup: '+report.branch+' | '+layout.period.from+' s.d. '+layout.period.to,margin,36);y=40;};
  const header=()=>{doc.setFontSize(font);doc.setFillColor(...navy);const headerHeight=Math.max(wide?12:10,...grid[5].map((v,c)=>doc.splitTextToSize(String(v??''),ws[c]-2).length*(font*.3528*1.15)+3));doc.rect(margin,y,W-2*margin,headerHeight,'F');for(let c=0;c<grid[5].length;c++){let v=grid[5][c]??'';if(typeof v==='string'&&/^\d{4}-\d\d-\d\d$/.test(v))v=date(v);doc.setTextColor(255,255,255);doc.setFontSize(font);doc.setFont('helvetica','bold');const lines=doc.splitTextToSize(String(v),ws[c]-2);doc.text(lines,xs[c]+1,y+3.5);}y+=headerHeight;};
  const page=()=>{doc.addPage();title();header();};title();header();
  for(const [panelIndex,part] of [layout,...(layout.continuations||[])].entries()){
  if(panelIndex){grid=part.grid.map(r=>[...r]);grid[0][0]=company;page();}
  for(let r=6;r<grid.length;r++){
   const row=grid[r],styles=layout.spec.rows[r];if(!row.some(v=>v!=null&&v!=='')){y+=2;continue;}
   const section=typeof row[0]==='string'&&!/^\d-\d{4}$/.test(row[0])&&row.slice(1).every(v=>v==null||v==='');
   const bold=section||styles.some(c=>c.bold),ratio=wide&&[24,41,51].includes(r+1);
   const texts=row.map((v,c)=>{
    if(v==null)return '';if(c>=2&&typeof v==='string'&&/^-?\d+$/.test(v))return money(v);if(typeof v==='number')return ratio||c===10?pct(v):money(v);return String(v);
   });
   doc.setFont('helvetica',bold?'bold':ratio?'italic':'normal');doc.setFontSize(font);
   const lines=texts.map((t,c)=>doc.splitTextToSize(t,c>=8&&/^\(_/.test(t)?W-margin-xs[c]-2:ws[c]-2));
   const height=section?6:Math.max(wide?5.1:6,...lines.map(v=>v.length*lineHeight+1.8));
   // Preserve the source's complete signature block on one page.
   if((wide&&r===53||!wide&&r===grid.length-6)&&y+31>H-17)page();
   if(y+height>H-17)page();
   doc.setFont('helvetica',bold?'bold':ratio?'italic':'normal');doc.setFontSize(font);
   styles.forEach((cell,c)=>{if(!cell.fill||cell.fill==='00000000')return;const hex=cell.fill.slice(-6),rgb=[0,2,4].map(i=>parseInt(hex.slice(i,i+2),16));doc.setFillColor(...rgb);doc.rect(xs[c],y,ws[c],height,'F');});
   doc.setTextColor(...(section?navy:ink));
   if(section)doc.text(texts[0],margin+1,y+4);
   else lines.forEach((text,c)=>{if(!text.length)return;const right=c>=2&&/^[-(\d]/.test(texts[c])&&!/____/.test(texts[c]);doc.text(text,right?xs[c+1]-1:xs[c]+1,y+3.8,{align:right?'right':'left'});});
   y+=height;
  }
  }
  // Coverage notes are an annex, leaving the source statement/signature layout intact.
  const notes=[...layout.notes,'Periode sebelumnya: '+(layout.previousPeriod?layout.previousPeriod.from+' s.d. '+layout.previousPeriod.to:'belum tersedia')];
  if(notes.length){doc.addPage();doc.setFont('helvetica','bold');doc.setFontSize(12);doc.setTextColor(...navy);doc.text(company,margin,16);doc.setFontSize(10);doc.text('Catatan Laporan',margin,23);y=32;doc.setFont('helvetica','normal');doc.setTextColor(...ink);doc.setFontSize(9);for(const note of notes){const lines=doc.splitTextToSize(note,W-margin*2);if(y+lines.length*4.5>H-17){doc.addPage();y=18;}doc.text(lines,margin,y);y+=lines.length*4.5+4;}}
  if(y+window.SipekaDocumentApproval.height>H-17){doc.addPage();doc.setFontSize(11);doc.text(String(grid[1][0]||'Laporan')+' — '+company,margin,18);y=30;}
  window.SipekaDocumentApproval.draw(doc,{top:Math.max(y+5,H-82),margin});
  const pages=doc.internal.getNumberOfPages();for(let n=1;n<=pages;n++){doc.setPage(n);doc.setDrawColor(210,219,232);doc.line(margin,H-12,W-margin,H-12);doc.setTextColor(100,110,125);doc.setFont('helvetica','normal');doc.setFontSize(7);doc.text('SiPeKA',margin,H-7);doc.text(n+' / '+pages,W-margin,H-7,{align:'right'});}return doc;
 }
 window.SipekaTemplatePdf={create};
})();
