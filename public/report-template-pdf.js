/* Render the Owner's spreadsheet layout; rows/sections/column positions come from source XLSX. */
(()=>{'use strict';
 const navy=[31,56,100],ink=[30,35,43];
 function create(report,Ctor,company){
  const layout=report.templateLayout;if(!layout)throw Error('REPORT_TEMPLATE_REQUIRED');
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
  const pages=doc.internal.getNumberOfPages();for(let n=1;n<=pages;n++){doc.setPage(n);doc.setDrawColor(210,219,232);doc.line(margin,H-12,W-margin,H-12);doc.setTextColor(100,110,125);doc.setFont('helvetica','normal');doc.setFontSize(7);doc.text('SiPeKA',margin,H-7);doc.text(n+' / '+pages,W-margin,H-7,{align:'right'});}return doc;
 }
 window.SipekaTemplatePdf={create};
})();
