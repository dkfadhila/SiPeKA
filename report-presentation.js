'use strict';
// Account-based calculation stays in report-template; this is the public statement.
function compact(layout,id,{excel=false}={}){
 const old=layout.grid,kind=layout.kind,comparison=kind==='pnl'&&(id==='compare-profit-loss'||layout.scopeMode==='comparison'||excel);
 const unitCols=[2,3,4,5,6,7].filter(c=>old[5][c]);
 const indices=kind==='pnl'?(excel?[...unitCols,8,9]:comparison?[...unitCols,8]:[8]):excel?[2,3]:[2];
 const periodLabel=period=>period?period.from+' s.d. '+period.to:'Belum tersedia';
 const header=kind==='balance'?['Keterangan','Debet (Rp)','Kredit (Rp)']:['Keterangan',...(excel?(kind==='pnl'?[...unitCols.map(c=>old[5][c]),'Konsolidasi (Rp)\n'+periodLabel(layout.period),'Periode sebelumnya (Rp)\n'+periodLabel(layout.previousPeriod),'Perubahan (%)']:['Periode berjalan (Rp)\n'+periodLabel(layout.period),'Periode sebelumnya (Rp)\n'+periodLabel(layout.previousPeriod)]):comparison?[...unitCols.map(c=>old[5][c]),'Total (Rp)']:['Nominal (Rp)'])];
 const grid=[['[Nama Perusahaan]'],[kind==='pnl'?'Laporan Laba & Rugi':kind==='balance'?'Laporan Neraca':'Laporan Arus Kas'],[kind==='balance'?layout.period.to:layout.period.from+' s.d. '+layout.period.to],['Disajikan dalam Rupiah · '+(layout.units.length===1?layout.units[0].name:'Seluruh Cabang / Unit')],[],header];
 const types=Array(6).fill('heading');
 let balanceCredit=false;
 const add=(label,values=[],type='detail')=>{
  if(kind==='balance'&&!values.length&&type!=='section')values=label==='TOTAL'?[null,null]:balanceCredit?['',null]:[null,''];
  if(excel&&kind==='pnl'&&type!=='section'){
   const now=values.at(-2),prior=values.at(-1);
   values=[...values,type==='ratio'||now==null||prior==null||BigInt(prior)===0n?null:Number(BigInt(now)-BigInt(prior))/Math.abs(Number(prior))];
  }
  grid.push([label,...header.slice(1).map((_,i)=>values[i]??null)]);types.push(type);
 };
 const section=label=>add(label,[],'section');
 const take=(label,r,type='detail',negative=false)=>add(label,indices.map(c=>old[r-1][c]==null?null:String(BigInt(old[r-1][c])*(negative?-1n:1n))),type);
 if(kind==='pnl'){
  section('Pendapatan');take('Pendapatan usaha',13);take('Total Pendapatan',13,'total');
  section('Harga Pokok Penjualan');take('Harga pokok penjualan',21);take('Total Harga Pokok Penjualan',21,'total',true);take('TOTAL LABA KOTOR',23,'total');
  if(excel)add('Margin laba kotor',indices.map(c=>old[23][c]),'ratio');
  section('Beban Operasional');
  for(const [label,r] of [['Biaya gaji',27],['Biaya komisi dan pemasaran',null],['Biaya listrik, air dan internet',30],['Biaya perawatan',31],['Biaya sewa',32],['Biaya transportasi',33],['Biaya pajak dan perizinan',34],['Biaya administrasi',35],['Biaya operasional lainnya',36],['Biaya penyusutan',37]]){
   if(r)take(label,r);else add(label,indices.map(c=>String(BigInt(old[27][c])+BigInt(old[28][c]))));
  }
  take('Total Beban Operasional',38,'total',true);take('LABA BERSIH OPERASIONAL',40,'total');
  if(excel)add('Margin laba operasional',indices.map(c=>old[40][c]),'ratio');
  section('Pendapatan & Beban Lainnya');take('Pendapatan lainnya',44);take('Beban lainnya',45,'detail',true);take('Total Pendapatan & Beban Lainnya',46,'total');
  take('Pajak penghasilan',49,'detail',true);take('LABA/(RUGI) BERSIH',50,'total');
  if(excel)add('Margin laba bersih',indices.map(c=>old[50][c]),'ratio');
 }else if(kind==='balance'){
  // Source has no verified closing balances: preserve unavailable values, never infer equity.
  section('AKTIVA');section('Aktiva Lancar');
  for(const label of ['Kas dan bank','Piutang','Persediaan','Biaya dibayar di muka'])add(label);
  add('Total Aktiva Lancar',[],'total');section('Aktiva Tetap');
  for(const label of ['Tanah dan bangunan','Peralatan dan inventaris','Kendaraan','Akumulasi penyusutan aset'])add(label);
  add('Total Aktiva Tetap',[],'total');add('TOTAL AKTIVA',[],'total');
  balanceCredit=true;section('PASIVA');section('Kewajiban');
  for(const label of ['Utang usaha','Utang beban dan pajak','Pendapatan diterima di muka','Pinjaman'])add(label);
  add('Total Kewajiban',[],'total');section('Ekuitas');
  for(const label of ['Modal','Laba ditahan','Laba/(rugi) tahun berjalan','Prive'])add(label);
  add('Total Ekuitas',[],'total');add('TOTAL PASIVA',[],'total');add('TOTAL',[],'total');
 }else{
  for(let r=6;r<old.length;r++){
   const row=old[r],label=row[1]||row[0];if(!label||/Disusun|Disetujui|____|Nama \/ Jabatan/.test(label))continue;
   add(label,indices.map(c=>row[c]),layout.spec.rows[r].some(c=>c.bold)?'total':'detail');
  }
 }
 const notes=layout.notes.filter(note=>kind!=='balance'||!note.startsWith('Kolom pembanding neraca')).map(note=>/^Akun historis belum/.test(note)?'Sebagian transaksi historis belum dipetakan ke pos laporan; nilainya belum masuk subtotal.':note);
 if(excel&&kind==='balance'){
  const priorDate=layout.previousPeriod?.to||'Belum tersedia';
  grid[5]=['Keterangan','Debet (Rp)\n'+layout.period.to,'Kredit (Rp)\n'+layout.period.to,'Debet (Rp)\n'+priorDate,'Kredit (Rp)\n'+priorDate];
  for(const row of grid.slice(6))row.push(...row.slice(1));
 }
 const spec={rows:grid.map((row,r)=>row.map(value=>({value,bold:['section','total','heading'].includes(types[r]),fill:types[r]==='total'?'FFF5F5F5':null,format:'General'}))),widths:grid[5].map((_,i)=>i?24:70),merges:[]};
 return {...layout,presentation:'simple',excelComplete:excel,grid,spec,cells:{},rowTypes:types,notes,continuations:comparison?(layout.continuations||[]).map(part=>compact(part,id,{excel})):[]};
}
function columnsAndRows(layout){
 const parts=[layout,...(layout.continuations||[])];
 const totalWidth=layout.scopeMode==='comparison'&&layout.kind==='balance'?2:1;
 const headers=parts.length>1?['Keterangan',...parts.flatMap(p=>p.grid[5].slice(1,-totalWidth)),...layout.grid[5].slice(-totalWidth)]:layout.grid[5];
 const columns=headers.map((label,i)=>({key:i?'amount_'+i:'item',label,type:i?'currency':'text'}));
 const rows=layout.grid.slice(6).map((row,r)=>{
  const values=parts.length>1?[row[0],...parts.flatMap(p=>p.grid[r+6].slice(1,-totalWidth)),...row.slice(-totalWidth)]:row;
  return Object.fromEntries(columns.map((c,i)=>[c.key,values[i]??null]));
 });
 return {columns,rows};
}
// Comparison panels use the same scoped calculation; unavailable source positions stay unavailable.
function scoped(layout,id,source,previous,units,filters,options={}){
 if(filters.viewMode!=='comparison'||layout.kind==='pnl')return compact(layout,id,options);
 const total=compact(layout,id),selected=layout.units,size=layout.kind==='balance'?3:6;
 const panels=Array.from({length:Math.max(1,Math.ceil(selected.length/size))},(_,i)=>selected.slice(i*size,(i+1)*size));
 const build=group=>{
  const parts=group.map(unit=>compact(require('./report-template').make(id,source,previous,units,{...filters,branch:unit.id,viewMode:'branch'}),id));
  const headers=['Keterangan',...parts.flatMap((part,i)=>part.grid[5].slice(1).map(label=>group[i].name+' · '+label)),...total.grid[5].slice(1).map(label=>'Perusahaan · '+label)];
  const grid=total.grid.map((row,r)=>r===5?headers:r<5?[row[0]]:[row[0],...parts.flatMap(part=>part.grid[r].slice(1)),...row.slice(1)]);
  grid[3]=['Perbandingan cabang · '+layout.period.from+' s.d. '+layout.period.to];
  const types=total.rowTypes;
  return {...total,grid,scopeMode:'comparison',excelComplete:false,continuations:[],spec:{rows:grid.map((row,r)=>row.map(value=>({value,bold:['section','total','heading'].includes(types[r]),format:'General'}))),widths:headers.map((_,i)=>i?24:65),merges:[]},notes:[...total.notes,'Kolom perusahaan mencakup seluruh cabang; jangan menjumlahkan ulang total perusahaan pada panel lanjutan.']};
 };
 const result=build(panels[0]);result.continuations=panels.slice(1).map(build);return result;
}
module.exports={compact,columnsAndRows,scoped};
