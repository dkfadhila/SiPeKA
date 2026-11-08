'use strict';
// Account-based calculation stays in report-template; this is the public statement.
function compact(layout,id,{excel=false}={}){
 const recorded=id==='recorded-income-expense',old=layout.grid,kind=layout.kind,comparison=kind==='pnl'&&(id==='compare-profit-loss'||layout.scopeMode==='comparison'||excel);
 const unitCols=[2,3,4,5,6,7].filter(c=>old[5][c]);
 const indices=kind==='pnl'?(excel?[...unitCols,8,9]:comparison?[...unitCols,8]:[8]):excel?[2,3]:[2];
 const periodLabel=period=>period?period.from+' s.d. '+period.to:'Belum tersedia';
 const header=kind==='balance'?['Keterangan','Debet (Rp)','Kredit (Rp)']:['Keterangan',...(excel?(kind==='pnl'?[...unitCols.map(c=>old[5][c]),(layout.selectedBranchIds?'Total cabang terpilih (Rp)\n':'Konsolidasi (Rp)\n')+periodLabel(layout.period),'Periode sebelumnya (Rp)\n'+periodLabel(layout.previousPeriod),'Perubahan (%)']:['Periode berjalan (Rp)\n'+periodLabel(layout.period),'Periode sebelumnya (Rp)\n'+periodLabel(layout.previousPeriod)]):comparison?[...unitCols.map(c=>old[5][c]),layout.selectedBranchIds?'Total terpilih (Rp)':'Total (Rp)']:['Nominal (Rp)'])];
 const grid=[['[Nama Perusahaan]'],[recorded?'Pendapatan & Beban Tercatat':kind==='pnl'?'Laporan Laba & Rugi':kind==='balance'?'Laporan Neraca':'Laporan Arus Kas'],[kind==='balance'?layout.period.to:layout.period.from+' s.d. '+layout.period.to],['Disajikan dalam Rupiah · '+(layout.selectedBranchIds?'Cabang terpilih: '+layout.units.map(u=>u.name).join(' vs '):layout.units.length===1?layout.units[0].name:'Seluruh Cabang / Unit')],[],header];
 const types=Array(6).fill('heading'),levels=Array(6).fill(0);
 let balanceCredit=false;
 const add=(label,values=[],type='detail',level=0)=>{
  if(excel&&kind==='pnl'&&type==='detail')level=1;
  if(kind==='balance'&&!values.length&&type!=='section')values=label==='TOTAL'?[null,null]:balanceCredit?['',null]:[null,''];
  if(excel&&kind==='pnl'&&type!=='section'){
   const now=values.at(-2),prior=values.at(-1);
   values=[...values,type==='ratio'||now==null||prior==null||BigInt(prior)===0n?null:Number(BigInt(now)-BigInt(prior))/Math.abs(Number(prior))];
  }
  grid.push([label,...header.slice(1).map((_,i)=>values[i]??null)]);types.push(type);levels.push(level);
 };
 const section=(label,level=0)=>add(label,[],'section',level);
 const take=(label,r,type='detail',negative=false)=>add(label,indices.map(c=>old[r-1][c]==null?null:String(BigInt(old[r-1][c])*(negative?-1n:1n))),type);
 if(recorded){
  const summary=layout.recordedSummary||null;
  const value=(report,key)=>report?.totals?.[key]??null;
  const sourceByColumn=c=>c===8?summary:c===9?layout.recordedPreviousSummary:layout.recordedByBranch?.[layout.units.find(u=>u.name===old[5][c])?.id];
  for(const [label,key] of [['Pendapatan tercatat','income'],['Beban tercatat','expense'],['Selisih Pendapatan dan Beban Tercatat','net']]){
   add(label,indices.map(c=>value(sourceByColumn(c),key)),key==='net'?'total':'detail');
  }
 }else if(kind==='pnl'&&excel){
  for(let r=7;r<=51;r++){
   const original=old[r-1];if(!original[1]&&!original[0])continue;
   const code=typeof original[0]==='string'&&/^\d-\d{4}$/.test(original[0]);
   const label=code?original[1]:original[1]||original[0];
   const ratio=[24,41,51].includes(r),total=[13,21,23,38,40,46,48,50].includes(r);
   if(!code&&!ratio&&!total)section(label);
   else if(ratio)add(label,indices.map(c=>original[c]),'ratio',1);
   else take(label,r,total?'total':'detail');
  }
 }else if(kind==='pnl'){
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
  take('Pajak penghasilan',49,'detail',true);take(recorded?'Selisih Pendapatan dan Beban Tercatat':'LABA/(RUGI) BERSIH',50,'total');
  if(excel)add('Margin laba bersih',indices.map(c=>old[50][c]),'ratio');
 }else if(kind==='balance'){
  // Source has no verified closing balances: preserve unavailable values, never infer equity.
  if(excel){
   const totals=new Set([14,23,25,34,38,40,47,49]),sections=new Set([7,8,16,27,28,36,42]);
   for(let r=7;r<=49;r++){
    const original=old[r-1],code=typeof original[0]==='string'&&/^\d-\d{4}$/.test(original[0]);
    const label=code?original[1]:original[1]||original[0];if(!label)continue;
    if(r===27)balanceCredit=true;
    if(sections.has(r))section(label,[8,16,28,36].includes(r)?1:0);
    else add(label,[],totals.has(r)?'total':'detail',code?2:[14,23,34,38].includes(r)?1:0);
   }
  }else{
  section('AKTIVA');section('Aktiva Lancar',1);
  for(const label of ['Kas dan bank','Piutang','Persediaan','Biaya dibayar di muka'])add(label,[],'detail',2);
  add('Total Aktiva Lancar',[],'total',1);section('Aktiva Tetap',1);
  for(const label of ['Tanah dan bangunan','Peralatan dan inventaris','Kendaraan','Akumulasi penyusutan aset'])add(label,[],'detail',2);
  add('Total Aktiva Tetap',[],'total',1);add('TOTAL AKTIVA',[],'total');
  balanceCredit=true;section('PASIVA');section('Kewajiban',1);
  for(const label of ['Utang usaha','Utang beban dan pajak','Pendapatan diterima di muka','Pinjaman'])add(label,[],'detail',2);
  add('Total Kewajiban',[],'total',1);section('Ekuitas',1);
  for(const label of ['Modal','Laba ditahan','Laba/(rugi) tahun berjalan','Prive'])add(label,[],'detail',2);
  add('Total Ekuitas',[],'total',1);add('TOTAL PASIVA',[],'total');add('TOTAL',[],'total');
  }
 }else{
  const takeCash=(label,r,type='detail',level=1)=>add(label,indices.map(c=>old[r-1][c]),type,level);
  section('ARUS KAS DARI AKTIVITAS OPERASI');
  for(let r=8;r<=16;r++)takeCash(old[r-1][1],r);
  takeCash('Kas Bersih dari Aktivitas Operasi Terklasifikasi',17,'total',0);
  section('ARUS KAS DARI AKTIVITAS INVESTASI');for(const r of [20,21])takeCash(old[r-1][1],r);takeCash(old[21][1],22,'total',0);
  section('ARUS KAS DARI AKTIVITAS PENDANAAN');for(const r of [25,26,27,28])takeCash(old[r-1][1],r);takeCash(old[28][1],29,'total',0);
  section('MUTASI ADVANCE DAN ARUS KAS BELUM DIKELOMPOKKAN');
  for(const [label,key] of [['Penerimaan belum dikelompokkan','unclassifiedIncome'],['Pengeluaran belum dikelompokkan','unclassifiedExpense']])add(label,indices.map(c=>layout.cashUnclassified?.[c-2]?.[key]??null),'detail',1);
  takeCash('KENAIKAN (PENURUNAN) KAS TERCATAT',31,'total',0);takeCash(old[31][1],32);takeCash(old[32][1],33,'total',0);
  section('REKONSILIASI KAS');for(const r of [35,36])takeCash(old[r-1][1],r,r===36?'total':'detail');
  section('REKONSILIASI LABA BERSIH KE KAS OPERASI');for(let r=39;r<=48;r++)takeCash(old[r-1][1],r,[47,48].includes(r)?'total':'detail',[47,48].includes(r)?0:1);
 }

 const notes=(recorded?(layout.recordedSummary?.notices||['Pendapatan dan beban tercatat belum tersedia. Angka kosong bukan pendapatan nol.']):layout.notes).filter(note=>kind!=='balance'||!note.startsWith('Kolom pembanding neraca')).map(note=>/^Akun historis belum/.test(note)?'Sebagian transaksi historis belum dipetakan ke pos laporan; nilainya belum masuk subtotal.':note);
 if(excel&&kind==='balance'){
  const priorDate=layout.previousPeriod?.to||'Belum tersedia';
  grid[5]=['Keterangan','Debet (Rp)\n'+layout.period.to,'Kredit (Rp)\n'+layout.period.to,'Debet (Rp)\n'+priorDate,'Kredit (Rp)\n'+priorDate];
  for(const row of grid.slice(6))row.push(...row.slice(1));
 }
 const spec={rows:grid.map((row,r)=>row.map(value=>({value,bold:['section','total','heading'].includes(types[r]),fill:types[r]==='total'?'FFF5F5F5':null,format:'General'}))),widths:grid[5].map((_,i)=>i?24:70),merges:[]};
 return {...layout,reportId:id,presentation:'simple',excelComplete:excel,grid,spec,cells:{},rowTypes:types,rowLevels:levels,notes,continuations:comparison?(layout.continuations||[]).map(part=>compact({...part,...(recorded?{recordedSummary:layout.recordedSummary,recordedByBranch:layout.recordedByBranch,recordedPreviousSummary:layout.recordedPreviousSummary}: {})},id,{excel})):[]};
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
  const parts=group.map(unit=>compact(require('./report-template').make(id,source,previous,units,{...filters,branch:unit.id,branchIds:undefined,viewMode:'branch'}),id));
  const headers=['Keterangan',...parts.flatMap((part,i)=>part.grid[5].slice(1).map(label=>group[i].name+' · '+label)),...total.grid[5].slice(1).map(label=>(filters.branchIds?'Total terpilih':'Perusahaan')+' · '+label)];
  const grid=total.grid.map((row,r)=>r===5?headers:r<5?[row[0]]:[row[0],...parts.flatMap(part=>part.grid[r].slice(1)),...row.slice(1)]);
  grid[3]=['Perbandingan cabang · '+layout.period.from+' s.d. '+layout.period.to];
  const types=total.rowTypes;
  return {...total,grid,panelUnits:group.map(u=>u.name),scopeMode:'comparison',excelComplete:false,continuations:[],spec:{rows:grid.map((row,r)=>row.map(value=>({value,bold:['section','total','heading'].includes(types[r]),format:'General'}))),widths:headers.map((_,i)=>i?24:65),merges:[]},notes:[...total.notes,filters.branchIds?'Total terpilih hanya mencakup cabang pembanding; total diulang pada panel lanjutan.':'Kolom perusahaan mencakup seluruh cabang; jangan menjumlahkan ulang total perusahaan pada panel lanjutan.']};
 };
 const result=build(panels[0]);result.continuations=panels.slice(1).map(build);return result;
}
module.exports={compact,columnsAndRows,scoped};
