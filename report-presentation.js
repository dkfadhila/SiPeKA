'use strict';
// Account-based calculation stays in report-template; this is the public statement.
function compact(layout,id){
 const old=layout.grid,comparison=id==='compare-profit-loss',kind=layout.kind;
 const unitCols=[2,3,4,5,6,7].filter(c=>old[5][c]);
 const indices=kind==='pnl'?(comparison?[...unitCols,8]:[8]):[2];
 const header=kind==='balance'?['Keterangan','Debet (Rp)','Kredit (Rp)']:['Keterangan',...(comparison?[...unitCols.map(c=>old[5][c]),'Total (Rp)']:['Nominal (Rp)'])];
 const grid=[['[Nama Perusahaan]'],[kind==='pnl'?'Laporan Laba & Rugi':kind==='balance'?'Laporan Neraca':'Laporan Arus Kas'],[kind==='balance'?layout.period.to:layout.period.from+' s.d. '+layout.period.to],['Disajikan dalam Rupiah · '+(layout.units.length===1?layout.units[0].name:'Seluruh Cabang / Unit')],[],header];
 const types=Array(6).fill('heading');
 let balanceCredit=false;
 const add=(label,values=[],type='detail')=>{
  if(kind==='balance'&&!values.length&&type!=='section')values=label==='TOTAL'?[null,null]:balanceCredit?['',null]:[null,''];
  grid.push([label,...header.slice(1).map((_,i)=>values[i]??null)]);types.push(type);
 };
 const section=label=>add(label,[],'section');
 const take=(label,r,type='detail',negative=false)=>add(label,indices.map(c=>old[r-1][c]==null?null:String(BigInt(old[r-1][c])*(negative?-1n:1n))),type);
 if(kind==='pnl'){
  section('Pendapatan');take('Pendapatan usaha',13);take('Total Pendapatan',13,'total');
  section('Harga Pokok Penjualan');take('Harga pokok penjualan',21);take('Total Harga Pokok Penjualan',21,'total',true);take('TOTAL LABA KOTOR',23,'total');
  section('Beban Operasional');
  for(const [label,r] of [['Biaya gaji',27],['Biaya komisi dan pemasaran',null],['Biaya listrik, air dan internet',30],['Biaya perawatan',31],['Biaya sewa',32],['Biaya transportasi',33],['Biaya pajak dan perizinan',34],['Biaya administrasi',35],['Biaya operasional lainnya',36],['Biaya penyusutan',37]]){
   if(r)take(label,r);else add(label,indices.map(c=>String(BigInt(old[27][c])+BigInt(old[28][c]))));
  }
  take('Total Beban Operasional',38,'total',true);take('LABA BERSIH OPERASIONAL',40,'total');
  section('Pendapatan & Beban Lainnya');take('Pendapatan lainnya',44);take('Beban lainnya',45,'detail',true);take('Total Pendapatan & Beban Lainnya',46,'total');
  take('Pajak penghasilan',49,'detail',true);take('LABA/(RUGI) BERSIH',50,'total');
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
   add(label,[row[2]],layout.spec.rows[r].some(c=>c.bold)?'total':'detail');
  }
 }
 const notes=layout.notes.filter(note=>kind!=='balance'||!note.startsWith('Kolom pembanding neraca')).map(note=>/^Akun historis belum/.test(note)?'Sebagian transaksi historis belum dipetakan ke pos laporan; nilainya belum masuk subtotal.':note);
 const spec={rows:grid.map((row,r)=>row.map(value=>({value,bold:['section','total','heading'].includes(types[r]),fill:types[r]==='total'?'FFF5F5F5':null,format:'General'}))),widths:header.map((_,i)=>i?24:70),merges:[]};
 return {...layout,presentation:'simple',grid,spec,cells:{},rowTypes:types,notes,continuations:comparison?(layout.continuations||[]).map(part=>compact(part,id)):[]};
}
function columnsAndRows(layout){
 const parts=[layout,...(layout.continuations||[])];
 const headers=parts.length>1?['Keterangan',...parts.flatMap(p=>p.grid[5].slice(1,-1)),'Total (Rp)']:layout.grid[5];
 const columns=headers.map((label,i)=>({key:i?'amount_'+i:'item',label,type:i?'currency':'text'}));
 const rows=layout.grid.slice(6).map((row,r)=>{
  const values=parts.length>1?[row[0],...parts.flatMap(p=>p.grid[r+6].slice(1,-1)),row.at(-1)]:row;
  return Object.fromEntries(columns.map((c,i)=>[c.key,values[i]??null]));
 });
 return {columns,rows};
}
module.exports={compact,columnsAndRows};
