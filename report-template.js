'use strict';
const fs=require('node:fs'),path=require('node:path');
const kinds={'company-profit-loss':'pnl','compare-profit-loss':'pnl','profit-loss':'pnl','recorded-income-expense':'pnl','fund-position':'balance','cash-flow':'cash'};
const clean=v=>typeof v==='string'?v.replace(/\ufffd/g,'–').trim():v;
const col=n=>{let s='';for(n++;n;n=Math.floor((n-1)/26))s=String.fromCharCode(65+(n-1)%26)+s;return s;};
function make(id,source,previous,units,filters,panelIndex=null){
 const kind=kinds[id];if(!kind)return null;
 const spec=JSON.parse(fs.readFileSync(path.join(__dirname,'report-templates',kind+'.json'),'utf8'));
 const grid=spec.rows.map(row=>row.map(c=>clean(c.value)));
 // Keep the uploaded template's six unit slots. Extra units continue in another panel.
 const selected=units.filter(u=>require('./report-branch-scope').includes(filters,u.id));
 const panels=kind==='pnl'?Array.from({length:Math.max(1,Math.ceil(selected.length/6))},(_,i)=>selected.slice(i*6,i*6+6)):[[]];
 const currentPeriod={from:filters.dateFrom,to:filters.dateTo};
 let previousPeriod=previous?.filters?{from:previous.filters.dateFrom,to:previous.filters.dateTo}:null;
 const periodLabel=p=>p.from+' s.d. '+p.to;
 const notes=['Angka hanya mencakup transaksi/realisasi tercatat. Data akrual dan saldo yang belum tersedia ditandai kosong.'];
 if(kind==='pnl'&&id!=='recorded-income-expense')notes.push('Biaya penyusutan belum tersedia; lengkapi daftar aset dan perhitungan penyusutan agar total beban operasional dan laba bersih dapat dihitung.');
 const panel=panels[panelIndex??0];
 const cells={};
 const set=(r,c,v)=>{grid[r-1][c]=v;cells[col(c)+r]=v;};
 const codes=new Set(grid.map(r=>r[0]).filter(v=>typeof v==='string'&&/^\d-\d{4}$/.test(v)));
 const canonical=rows=>rows.filter(r=>codes.has(r.account_code));
 const sum=(rows,code,unit)=>rows.filter(r=>r.account_code===code&&(!unit||r.branch_id===unit)).reduce((n,r)=>n+BigInt(r.income||0)-BigInt(r.expense||0),0n);
 const signed=(rows,code,unit)=>{const n=sum(rows,code,unit);return String(/^[568]-|^7-2/.test(code)?-n:n);};
 const pnlRows={13:[8,9,10,11,12],21:[16,17,18,19,20],23:[13,-21],38:[27,28,29,30,31,32,33,34,35,36,37],40:[23,-38],46:[44,-45],48:[40,46],50:[48,-49]};
 const ratios={24:23,41:40,51:50};
 const sourceRows=source?.rows||[],priorRows=previous?.rows||[];
 const legacy=kind==='pnl'?sourceRows.filter(r=>r.account_code&&!codes.has(r.account_code)):[];
 if(legacy.length)notes.push('Akun historis belum dipetakan: '+[...new Set(legacy.map(r=>r.account_code+' '+r.account_name))].join('; ')+'. Nilainya tetap di register operasional dan belum dimasukkan ke subtotal akun template.');
 const priorLegacy=kind==='pnl'?priorRows.filter(r=>r.account_code&&!codes.has(r.account_code)):[];
 if(priorLegacy.length)notes.push('Periode sebelumnya juga memiliki akun historis yang belum dipetakan.');
 if(kind==='pnl'){
  for(let c=2;c<=7;c++)set(6,c,panel[c-2]?.name||'');
  set(6,8,'Konsolidasi\n'+periodLabel(currentPeriod));
  set(6,9,'Periode Sebelumnya\n'+(previousPeriod?periodLabel(previousPeriod):'Belum tersedia'));
  for(let r=7;r<=51;r++){
   if(codes.has(grid[r-1][0])){
    const code=grid[r-1][0];for(let c=2;c<=7;c++)set(r,c,panel[c-2]?code==='6-3000'?null:signed(canonical(sourceRows),code,panel[c-2].id):null);
    set(r,8,code==='6-3000'?null:signed(canonical(sourceRows),code));set(r,9,!previousPeriod||code==='6-3000'?null:signed(canonical(priorRows),code));
   }else if(pnlRows[r])for(let c=2;c<=9;c++){
    const values=pnlRows[r].map(n=>grid[Math.abs(n)-1][c]);set(r,c,c<8&&!panel[c-2]||values.some(v=>v==null)?null:String(pnlRows[r].reduce((n,v)=>n+(v<0?-1n:1n)*BigInt(grid[Math.abs(v)-1][c]),0n)));
   }else if(ratios[r])for(let c=2;c<=9;c++){const rev=grid[12][c],v=grid[ratios[r]-1][c];set(r,c,rev==null||v==null||BigInt(rev)===0n?null:Number(v)/Number(rev));}
   if(codes.has(grid[r-1][0])||pnlRows[r]){const now=grid[r-1][8],old=grid[r-1][9];set(r,10,now==null||old==null||BigInt(old)===0n?'-':Number(BigInt(now)-BigInt(old))/Math.abs(Number(old)));}
  }
 }else{
  for(let r=7;r<=grid.length;r++)for(let c=2;c<=3;c++)if(typeof grid[r-1][c]==='number'||String(grid[r-1][c]||'').startsWith('='))set(r,c,null);
  if(kind==='balance'){const end=(Number(filters.dateTo.slice(0,4))-1)+'-12-31';previousPeriod={from:end,to:end};set(6,2,filters.dateTo);set(6,3,(Number(filters.dateTo.slice(0,4))-1)+'-12-31');notes.push('Kolom pembanding neraca adalah 31 Desember tahun sebelumnya, mengikuti tahun tanggal posisi yang dipilih.');notes.push('Saldo kas, bank, aset, utang, dan ekuitas belum tersedia; status neraca tidak dinyatakan seimbang.');}
  if(kind==='cash'){set(6,2,'Periode Berjalan\n'+periodLabel(currentPeriod));set(6,3,'Periode Sebelumnya\n'+(previousPeriod?periodLabel(previousPeriod):'Belum tersedia'));}
  if(kind==='cash'){
   for(const [c,data] of [[2,source],[3,previous]]){const classified=require('./cashflow-classification').classify(data,filters.branch);if(classified)for(const [r,value] of Object.entries(classified.values))set(Number(r),c,value);}
   notes.push('Arus kas memakai transaksi kas tercatat. Subtotal operasi hanya mencakup pos yang sudah terklasifikasi; mutasi advance dan transaksi yang belum dapat dikelompokkan disajikan terpisah. Saldo awal/akhir, aktivitas investasi/pendanaan dan rekonsiliasi belum tersedia.');
  }
 }
 set(1,0,'[Nama Perusahaan]');set(3,2,kind==='balance'?filters.dateTo:periodLabel(currentPeriod));
 for(let r=0;r<grid.length;r++)for(let c=0;c<grid[r].length;c++)if(typeof grid[r][c]==='string'&&grid[r][c].startsWith('='))grid[r][c]=null;
 const continuations=kind==='pnl'&&panelIndex===null?panels.slice(1).map((_,i)=>make(id,source,previous,units,filters,i+1)):[];
 return {kind,grid,cells,spec,...(kind==='cash'?{cashUnclassified:[source,previous].map(data=>require('./cashflow-classification').classify(data,filters.branch))}:{}),panels,continuations,units:selected,scopeMode:filters.viewMode,selectedBranchIds:filters.branchIds,notes,period:currentPeriod,previousPeriod,legacyTotal:legacy.reduce((n,r)=>n+BigInt(r.income||0)-BigInt(r.expense||0),0n).toString()};
}
module.exports={make,kinds,col};
