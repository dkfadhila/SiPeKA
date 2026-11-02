'use strict';
// Formulas use visible statement cells only. Missing inputs remain unavailable.
function formulas(layout,col){
 if(!layout)return {};
 const result={},g=layout.grid,source=layout.kind==='pnl'&&!layout.recordedSummary?require('./report-templates/pnl.json').rows:null;
 if(!source){
  if(layout.recordedSummary){
   const inc=g.findIndex(r=>r[0]==='Pendapatan tercatat'),exp=g.findIndex(r=>r[0]==='Beban tercatat'),net=g.findIndex(r=>r[0]==='Selisih Pendapatan dan Beban Tercatat');
   if(inc>=0&&exp>=0&&net>=0)for(let c=1;c<g[5].length-1;c++){if([g[inc][c],g[exp][c]].every(v=>/^[-]?\d{1,15}$/.test(String(v)))){const a=col(c)+(inc+1),b=col(c)+(exp+1);result[col(c)+(net+1)]='IF(COUNT('+a+','+b+')=2,'+a+'-'+b+',"Belum tersedia")';}}return result;
  }
  if(layout.kind!=='cash')return result;
  const originals=require('./report-templates/cash.json').rows;
  const locate=r=>g.findIndex((row,i)=>i>=6&&row[0]===String(originals[r-1][1].value).replace(/\ufffd/g,'–').trim());
  for(const [label,refs]of [['Kas Bersih dari Aktivitas Operasi Terklasifikasi',[8,9,10,11,-12,-13,-14,-15]],['Kas Bersih dari Aktivitas Investasi',[20,21]],['Kas Bersih dari Aktivitas Pendanaan',[25,26,27,28]]]){
   const at=g.findIndex(r=>r[0]===label),ix=refs.map(r=>locate(Math.abs(r)));if(at<0||ix.some(i=>i<0))continue;
   for(let c=1;c<g[5].length;c++){const vals=ix.map(i=>g[i][c]);if(vals.some(v=>v!=null&&v!==''&&/^[-]?\d+$/.test(String(v))&&!/^[-]?\d{1,15}$/.test(String(v))))continue;const cells=ix.map(i=>col(c)+(i+1));result[col(c)+(at+1)]='IF(COUNT('+cells.join(',')+')='+cells.length+','+refs.map((r,i)=>(i?(r<0?'-':'+'):'')+cells[i]).join('')+',"Belum tersedia")';}
  }return result;
 }
 const locate=r=>g.findIndex((row,i)=>i>=6&&row[0]===(source[r-1][1].value||source[r-1][0].value));
 const sums={13:[8,9,10,11,12],21:[16,17,18,19,20],23:[13,-21],38:[27,28,29,30,31,32,33,34,35,36,37],40:[23,-38],46:[44,-45],48:[40,46],50:[48,-49]};
 const ratios={24:23,41:40,51:50};
 for(const [sourceRow,deps] of Object.entries({...sums,...Object.fromEntries(Object.entries(ratios).map(([r,n])=>[r,[n,13]]))})){
  const at=locate(Number(sourceRow)),indices=deps.map(n=>locate(Math.abs(n)));if(at<0||indices.some(i=>i<0))continue;
  for(let c=1;c<g[5].length-1;c++){
   const vals=indices.map(i=>g[i][c]);if(vals.some(v=>v!=null&&v!==''&&typeof v==='string'&&/^[-]?\d+$/.test(v)&&!/^[-]?\d{1,15}$/.test(v)))continue;
   const refs=indices.map(i=>col(c)+(i+1)),guard='COUNT('+refs.join(',')+')='+refs.length;
   const expression=ratios[sourceRow]?refs[0]+'/'+refs[1]:deps.map((n,i)=>(i?(n<0?'-':'+'):(n<0?'-':''))+refs[i]).join('');
   result[col(c)+(at+1)]='IF('+guard+',IFERROR('+expression+',"Belum tersedia"),"Belum tersedia")';
  }
 }
 return result;
}
module.exports={formulas};
