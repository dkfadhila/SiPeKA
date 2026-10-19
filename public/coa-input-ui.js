/* Account ids and transaction direction always come from the backend catalog. */
(()=>{'use strict';
 const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 function options(rows,{query='',selected='',expenseOnly=false}={}){
  const groups=new Map(),term=query.trim().toLocaleLowerCase('id-ID');
  for(const r of rows){
   if(!['REVENUE','EXPENSE'].includes(r.account_type)||r.account_code==='6-3000')continue;
   if(r.id!==selected&&term&&!(r.account_code+' '+r.account_name+' '+(r.group||'')).toLocaleLowerCase('id-ID').includes(term))continue;
   const group=r.group||(r.account_type==='REVENUE'?'Pendapatan':'Beban');
   if(!groups.has(group))groups.set(group,[]);groups.get(group).push(r);
  }
  return '<option value="">'+(rows.length?'Pilih kode akun sesuai transaksi':'Daftar akun belum tersedia — muat ulang')+'</option>'+[...groups].map(([label,items])=>'<optgroup label="'+esc(label)+'">'+items.map(r=>'<option value="'+esc(r.id)+'" data-account-type="'+esc(r.account_type)+'"'+(r.id===selected?' selected':'')+(expenseOnly&&r.account_type==='REVENUE'?' disabled':'')+'>'+esc(r.account_code+' · '+r.account_name)+'</option>').join('')+'</optgroup>').join('');
 }
 function field(prefix,rows){return '<div class="field coa-input"><label for="'+prefix+'CoaSearch">3. Kode Akun (COA)</label><input class="control" type="search" id="'+prefix+'CoaSearch" placeholder="Cari kode atau nama akun, misal: deterjen" autocomplete="off" aria-controls="'+prefix+'Coa"><select class="control" id="'+prefix+'Coa" required aria-describedby="'+prefix+'CoaHelp">'+options(rows)+'</select><small id="'+prefix+'CoaHelp" role="status">Pilih akun sesuai isi nota. Jenis pemasukan atau pengeluaran mengikuti akun yang dipilih.</small></div>';}
 function bind(prefix){
  const select=document.getElementById(prefix+'Coa'),search=document.getElementById(prefix+'CoaSearch'),help=document.getElementById(prefix+'CoaHelp'),intent=document.getElementById(prefix+'Intent');if(!select||!search||!help)return;
  const rows=window.SipekaCoa||[];
  const describe=()=>{const row=rows.find(r=>r.id===select.value);help.textContent=row?(row.account_type==='REVENUE'?'Pemasukan':'Pengeluaran')+' · '+row.account_code+' · '+row.account_name+(row.group?' · '+row.group:''):intent?.value==='PENGAJUAN_DANA'?'Pengajuan dana memakai akun beban dan kas laci. Pilih kode akun tujuan penggunaan dana.':rows.length?'Pilih akun sesuai isi nota. Produksi dan operasional umum memakai akun berbeda.':'Daftar COA belum tersedia. Muat ulang halaman sebelum menyimpan transaksi.';};
  const refresh=()=>{const expenseOnly=intent?.value==='PENGAJUAN_DANA',row=rows.find(r=>r.id===select.value),selected=expenseOnly&&row?.account_type==='REVENUE'?'':select.value;select.innerHTML=options(rows,{query:search.value,selected,expenseOnly});describe();};
  search.addEventListener('input',refresh);select.addEventListener('change',describe);intent?.addEventListener('change',refresh);describe();
 }
 window.SipekaCoaInput={options,field,bind};
})();
