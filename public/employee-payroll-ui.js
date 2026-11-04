(()=>{'use strict';
 const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const api=(...a)=>window.SipekaAuth.api(...a),message=e=>window.SipekaUi.message(e);
 let companyController;
 const amount=v=>v==null?'Lihat PDF':'Rp '+BigInt(v).toLocaleString('id-ID');
 const componentLines=(row,fields)=>fields.filter(([key])=>row[key]!=null).map(([key,label])=>esc(label)+' '+esc(amount(row[key]))).join('<br>');
 const earningsDetail=row=>row.overtime==null?esc(amount(row.allowances)):componentLines(row,[['operational_allowance','Tunjangan operasional'],['health_allowance','Tunjangan kesehatan'],['meal_allowance','Uang makan'],['transport_allowance','Transport'],['ironing_regular','Setrika reguler'],['ironing_express','Setrika express'],['overtime','Lembur'],['bonus','Bonus']])+'<br><strong>Total tambahan '+esc(amount(row.allowances))+'</strong>';
 const deductionsDetail=row=>row.absence_deduction==null?esc(amount(row.deductions)):componentLines(row,[['absence_deduction','Potongan absen'],['late_deduction','Potongan telat'],['violation_deduction','Potongan pelanggaran'],['other_deductions','Potongan lainnya']])+'<br><strong>Total potongan '+esc(amount(row.deductions))+'</strong>';
 function render(){return '<section id="employeePayroll" class="payroll-workspace"><header class="payroll-page-head"><div><span class="payroll-kicker">Finance & Accounting</span><h1>Slip Gaji</h1><p>Siapkan dokumen, periksa penerima bersama Widya, lalu terbitkan dan kirim.</p></div><button class="btn" type="button" data-employee-refresh>Muat ulang status</button></header><div class="payroll-tabs" role="tablist" aria-label="Slip Gaji"><button type="button" role="tab" id="payroll-input-tab" aria-controls="payroll-input-panel" aria-selected="true" tabindex="0" data-employee-tab="input">Input Slip Gaji</button><button type="button" role="tab" id="payroll-history-tab" aria-controls="payroll-history-panel" aria-selected="false" tabindex="-1" data-employee-tab="history">Riwayat Slip</button></div><p data-employee-status class="payroll-status" role="status" aria-live="polite">Memuat kesiapan dan daftar slip…</p><section class="payroll-tab-panel" id="payroll-input-panel" role="tabpanel" aria-labelledby="payroll-input-tab" data-employee-panel="input"><ol class="payroll-steps" aria-label="Tahapan slip gaji"><li><span>1</span><div><strong>Siapkan file</strong><small>Template dan direktori karyawan</small></div></li><li><span>2</span><div><strong>Periksa bersama Widya</strong><small>Identitas, komponen, dan penerima</small></div></li><li><span>3</span><div><strong>Terbitkan & kirim</strong><small>Konfirmasi setiap dokumen</small></div></li></ol><div class="payroll-preparation"><section class="payroll-panel payroll-templates"><div class="payroll-panel-heading"><span class="payroll-section-number">01</span><div><h2>Template gaji</h2><p>Pilih format sesuai unit dan cara pengolahan data.</p></div></div><div class="payroll-template-type"><div><h3>Umum</h3><p>Gaji, tunjangan, lembur, bonus, dan potongan.</p></div><div class="payroll-template-actions"><button class="btn" type="button" data-employee-template="general">CSV untuk impor</button><button class="btn" type="button" data-employee-workbook="general">Excel perhitungan</button><button class="btn" type="button" data-employee-blank="general">Excel kosong</button></div></div><div class="payroll-template-type"><div><h3>Laundry</h3><p>Termasuk makan, transport, serta setrika reguler dan express.</p></div><div class="payroll-template-actions"><button class="btn" type="button" data-employee-template="laundry">CSV untuk impor</button><button class="btn" type="button" data-employee-workbook="laundry">Excel perhitungan</button><button class="btn" type="button" data-employee-blank="laundry">Excel kosong</button></div></div><details class="employee-components"><summary>Komponen dan ketentuan file</summary><p>Slip umum: gaji pokok, tunjangan operasional dan kesehatan, lembur, bonus, potongan absen, telat, pelanggaran, serta PPh21. Laundry menambahkan makan, transport, setrika reguler dan express, serta potongan lainnya.</p><p>Excel memuat Database dan Slip Gaji. Impor dashboard memakai CSV atau PDF. Kolom CSV memakai bahasa Indonesia. Periode: YYYY-MM; nominal rupiah bulat tanpa titik. Nama opsional, tetapi harus cocok dengan direktori bila diisi. Satu baris untuk satu karyawan.</p></details><p class="payroll-directory-note">Pastikan ID, departemen, unit, dan email karyawan sudah sesuai direktori sebelum mengunggah.</p></section><section class="payroll-panel payroll-import"><div class="payroll-panel-heading"><span class="payroll-section-number">02</span><div><h2>Unggah & periksa</h2><p>Draft menunggu hasil LANJUT dan konfirmasi Anda.</p></div></div><form data-employee-import><label>Alamat kop perusahaan<input class="control" name="company_address" maxlength="180" value="Kompleks Roemah Pelangi Ruko No. 3 Jl. Ori II No. 7, Depok, Daerah Istimewa Yogyakarta, Indonesia, 55281"><small>Nama mengikuti profil perusahaan. Kop disimpan bersama draft; dokumen lama tetap memakai identitas saat diterbitkan.</small></label><label class="payroll-file-field">File gaji CSV / PDF<input class="control" type="file" name="csv" accept=".csv,.pdf,text/csv,application/pdf" required><small>CSV maksimal 1 MB. PDF satu slip, satu halaman, maksimal 256 KB.</small></label><label>Periode PDF<input class="control" type="month" name="pdf_period"><small>Wajib untuk PDF dan harus sama dengan periode di dokumen. CSV mengikuti periode pada file.</small></label><div class="payroll-form-action"><button class="btn primary" type="submit" aria-describedby="payrollImportHelp">Periksa File dengan Widya</button></div><p id="payrollImportHelp" data-employee-import-help role="status">CSV maks. 1 MB atau PDF 1 halaman maks. 256 KB. ID karyawan harus aktif; PDF wajib pilih periode.</p></form></section></div><section data-employee-review class="payroll-panel payroll-review" hidden aria-live="polite"></section></section><section class="payroll-register payroll-tab-panel" id="payroll-history-panel" role="tabpanel" aria-labelledby="payroll-history-tab" data-employee-panel="history" hidden><div class="payroll-register-head"><div><span class="payroll-kicker">Dokumen karyawan</span><h2>Draft & riwayat slip</h2><p>Tinjau komponen dan penerima sebelum menerbitkan atau mengirim.</p></div></div><div data-employee-rows></div></section></section>';}

 async function download(path,filename,current){
  const response=await fetch(path,{credentials:'same-origin',cache:'no-store'});
  if(!response.ok){const result=await response.json().catch(()=>({}));throw Error(result.error||'Unduhan belum tersedia');}
  const blob=await response.blob();if(!current())return;
  const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;const supplied=response.headers.get('Content-Disposition')?.match(/filename="([A-Za-z0-9_-]+\.pdf)"/);link.download=supplied?.[1]||filename;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
 }
 function bind(content){
  companyController?.abort();const panel=content.querySelector('#employeePayroll');if(!panel)return;companyController=new AbortController();
  const generation=window.SipekaAuth.generation(),current=()=>panel.isConnected&&generation===window.SipekaAuth.generation()&&window.SipekaCurrentUser?.role==='OWNER';
  function selectTab(name,focus=false){
   const tabs=[...panel.querySelectorAll('[data-employee-tab]')];
   if(!tabs.some(tab=>tab.dataset.employeeTab===name))return;
   for(const tab of tabs){const selected=tab.dataset.employeeTab===name;tab.setAttribute('aria-selected',String(selected));tab.tabIndex=selected?0:-1;if(selected&&focus)tab.focus();}
   panel.querySelectorAll('[data-employee-panel]').forEach(section=>section.hidden=section.dataset.employeePanel!==name);
  }
  panel.querySelector('[role=tablist]').addEventListener('keydown',event=>{
   const tab=event.target.closest('[data-employee-tab]');if(!tab||!current()||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
   event.preventDefault();const tabs=[...panel.querySelectorAll('[data-employee-tab]')],index=tabs.indexOf(tab);
   const next=event.key==='Home'?0:event.key==='End'?tabs.length-1:(index+(event.key==='ArrowRight'?1:-1)+tabs.length)%tabs.length;
   selectTab(tabs[next].dataset.employeeTab,true);
  });
  const status=panel.querySelector('[data-employee-status]'),output=panel.querySelector('[data-employee-rows]'),importButton=panel.querySelector('[data-employee-import] button');
  let entries=[],ready={},loading=0,importing=false,review=null,uploadBody=null,reviewVersion=0,reviewTimer=null,reviewPolling=false,importError="";const busy=new Set(),bulkRuns=new Map(),bulkConfirmations=new Map();const sessionSignal=companyController.signal;
  const notice=e=>{if(current())status.textContent=message(e);};
  const sendReason=e=>e.recipient_valid===false?'Identitas atau email berbeda dari direktori. Periksa ulang sebelum mengirim.':e.email_status==='sent'?'Diterima layanan email; belum berarti sudah masuk inbox.':e.email_status==='sending'?'Sedang diproses layanan email. Muat ulang status; pengiriman ulang diblokir.':e.email_status?'Status kirim perlu diperiksa; pengiriman ulang diblokir.':e.status!=='PUBLISHED'?'Terbitkan slip sebelum mengirim email.':!e.row.email?'Email belum diisi saat impor. Pengiriman belum tersedia.':!ready.email?'Layanan email belum siap.':'Belum dikirim. Periksa slip dan email penerima.';
  const canSend=e=>!!e&&ready.email&&e.status==='PUBLISHED'&&!!e.row.email&&!e.email_status&&e.recipient_valid!==false;
  const importReady=()=>ready.encryption&&!!window.SipekaCompany?.name;
  const bulkEligible=batch=>entries.filter(e=>e.batch_id===batch&&canSend(e)&&!busy.has(e.id));
  const bulkSummary=run=>{
   const remaining=run.total-run.done;
   return (run.running?'Mengirim massal':run.stopped?'Pengiriman massal dihentikan':'Pengiriman massal selesai')+': '+run.sent+' diterima layanan email · '+run.uncertain+' perlu diperiksa · '+run.skipped+' dilewati · '+remaining+' belum diproses.';
  };
  function syncBulkProgress(){
   panel.querySelectorAll('[data-employee-bulk-progress]').forEach(node=>{const run=bulkRuns.get(node.dataset.employeeBulkProgress);node.textContent=run?bulkSummary(run):'';});
   panel.querySelectorAll('[data-employee-bulk-results]').forEach(node=>{const run=bulkRuns.get(node.dataset.employeeBulkResults);node.innerHTML=run?run.results.map(item=>'<li>'+esc(item)+'</li>').join(''):'';});
  }
  async function sendBulk(batch){
   const consent=panel.querySelector('[data-employee-bulk-consent="'+batch+'"]'),frozen=bulkConfirmations.get(batch);
   if(!consent?.checked||!frozen?.length||bulkRuns.get(batch)?.running||!current()||sessionSignal.aborted)return;
   if(frozen.some(item=>busy.has(item.id)))return;
   const run={running:true,total:frozen.length,done:0,sent:0,uncertain:0,skipped:0,results:[]};bulkRuns.set(batch,run);
   for(const item of frozen)busy.add(item.id);
   consent.checked=false;bulkConfirmations.delete(batch);syncButtons();
   try{
    for(const item of frozen){
     if(!current()||sessionSignal.aborted){run.stopped=true;break;}
     const entry=entries.find(e=>e.id===item.id);
     if(!canSend(entry)||entry.batch_id!==batch||entry.row.email!==item.email){run.skipped++;run.done++;run.results.push(item.name+': dilewati karena status atau penerima berubah.');syncBulkProgress();continue;}
     const delivery=panel.querySelector('[data-employee-send="'+item.id+'"]')?.closest('.payroll-entry-actions')?.querySelector('[data-employee-delivery]');
     if(delivery)delivery.textContent='Sedang mengirim ke '+item.email+'…';
     status.textContent='Mengirim '+(run.done+1)+' dari '+run.total+' slip: '+item.name;syncBulkProgress();
     try{
      const result=await api('/api/employee-payroll/entries/'+encodeURIComponent(item.id)+'/send',{method:'POST',body:{email:item.email,confirmed:true}});
      entry.email_status=result.status==='sent'?'sent':(result.status||'uncertain');
      if(result.status==='sent'){run.sent++;run.results.push(item.name+': diterima layanan email.');}
      else{run.uncertain++;run.results.push(item.name+': status belum pasti; periksa status sebelum tindakan berikutnya.');}
     }catch(error){entry.email_status='uncertain';run.uncertain++;run.results.push(item.name+': gagal atau belum pasti — '+message(error)+'. Periksa status; tidak dicoba ulang otomatis.');}
     run.done++;if(current()){if(delivery)delivery.textContent=sendReason(entry);syncButtons();}
    }
   }finally{
    run.running=false;for(const item of frozen)busy.delete(item.id);bulkConfirmations.delete(batch);
    if(current()){
     panel.querySelectorAll('[data-employee-bulk-consent]').forEach(box=>{if(box.dataset.employeeBulkConsent===batch)box.checked=false;});
     syncButtons();status.textContent=bulkSummary(run)+' Status diterima belum menjamin masuk inbox.';
     if(![...bulkRuns.values()].some(item=>item.running)){try{await load();}catch(error){notice(error);}if(current())status.textContent=bulkSummary(run)+' Status diterima belum menjamin masuk inbox.';}
    }
   }
  }

  function syncButtons(){
   panel.querySelectorAll('[data-employee-refresh]').forEach(button=>{button.disabled=[...bulkRuns.values()].some(run=>run.running);});
   importButton.disabled=importing||reviewPolling;
   importButton.textContent=importing||reviewPolling?'Widya sedang memeriksa…':'Periksa File dengan Widya';
   const help=panel.querySelector('[data-employee-import-help]');
   help.textContent=importing||reviewPolling?'Tunggu hasil Widya sebelum menyimpan draft.':importError?importError:!ready.encryption?'Kesiapan penyimpanan belum terkonfirmasi. Klik Periksa untuk mengecek ulang.':!window.SipekaCompany?.name?'Nama perusahaan belum dimuat. Klik Periksa untuk mengecek ulang; atur identitas di Device & Cabang jika kosong.':'CSV maks. 1 MB atau PDF 1 halaman maks. 256 KB. ID karyawan harus aktif; PDF wajib pilih periode.';
   panel.querySelectorAll('[data-employee-send]').forEach(b=>{const e=entries.find(e=>e.id===b.dataset.employeeSend);b.disabled=busy.has(b.dataset.employeeSend)||!canSend(e)||!panel.querySelector('[data-employee-consent="'+b.dataset.employeeSend+'"]').checked;});
   panel.querySelectorAll('[data-employee-consent]').forEach(box=>{const entry=entries.find(item=>item.id===box.dataset.employeeConsent);box.disabled=busy.has(box.dataset.employeeConsent)||!canSend(entry);});
   panel.querySelectorAll('[data-employee-bulk-consent]').forEach(box=>{box.disabled=!!bulkRuns.get(box.dataset.employeeBulkConsent)?.running||!bulkEligible(box.dataset.employeeBulkConsent).length;});
   panel.querySelectorAll('[data-employee-bulk-send]').forEach(button=>{const batch=button.dataset.employeeBulkSend,run=bulkRuns.get(batch),frozen=bulkConfirmations.get(batch);button.disabled=!!run?.running||!panel.querySelector('[data-employee-bulk-consent="'+batch+'"]')?.checked||!frozen?.length||frozen.some(item=>busy.has(item.id));button.textContent=run?.running?'Mengirim massal…':'Kirim Massal';});
   syncBulkProgress();
   panel.querySelectorAll('[data-employee-publish]').forEach(b=>{const bulkRunning=[...bulkRuns.values()].some(run=>run.running);b.disabled=bulkRunning||busy.has(b.dataset.employeePublish)||!panel.querySelector('[data-employee-publish-consent="'+b.dataset.employeePublish+'"]').checked;b.title=bulkRunning?'Tunggu pengiriman massal selesai sebelum menerbitkan batch lain.':'';const help=b.closest('.payroll-publish-footer')?.querySelector('p');if(help)help.textContent=bulkRunning?'Tunggu pengiriman massal selesai sebelum menerbitkan batch lain.':'Centang konfirmasi setelah memeriksa seluruh slip untuk mengaktifkan tombol Terbitkan Slip.';});
  }
  async function load(){
   if([...bulkRuns.values()].some(run=>run.running))return;
   bulkConfirmations.clear();
   const request=++loading,result=await api('/api/employee-payroll');if(!current()||request!==loading||[...bulkRuns.values()].some(run=>run.running))return;
   entries=result.rows;ready=result.readiness||{};syncButtons();
   const groups=new Map();for(const e of entries){if(!groups.has(e.batch_id))groups.set(e.batch_id,[]);groups.get(e.batch_id).push(e);}
   const periodLabel=value=>/^20\d{2}-(0[1-9]|1[0-2])$/.test(value||'')?new Intl.DateTimeFormat('id-ID',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(value+'-01T00:00:00Z')):String(value||'Belum tersedia');
   const renderEntry=e=>{
    const row=e.row,pdf=row.upload_kind==='PDF',id=esc(e.id),sendable=canSend(e);
    const deliveryId='payroll-delivery-'+id;
    const figures=pdf?'<p class="payroll-original-note">PDF unggahan · nominal mengikuti dokumen asli.</p>':'<dl class="payroll-salary-summary"><div><dt>Gaji pokok</dt><dd>'+esc(amount(row.basic_salary))+'</dd></div><div><dt>Tambahan</dt><dd>'+esc(amount(row.allowances))+'</dd></div><div><dt>Potongan</dt><dd>'+esc(amount(row.deductions))+'</dd></div><div><dt>PPh 21</dt><dd>'+esc(amount(row.pph21))+'</dd></div><div class="payroll-net"><dt>Gaji bersih</dt><dd>'+esc(amount(row.net_salary))+'</dd></div></dl><details class="payroll-history-components"><summary>Rincian tambahan & potongan</summary><div class="payroll-component-columns"><section><h5>Tunjangan & tambahan</h5>'+earningsDetail(row)+'</section><section><h5>Potongan</h5>'+deductionsDetail(row)+'</section></div></details>';
    return '<section class="payroll-history-entry"><div class="payroll-entry-main"><header class="payroll-employee-identity"><div><h4>'+esc(row.full_name)+'</h4><p>'+esc(row.department||'Departemen belum diisi')+' · '+esc(row.branch_name||'Unit belum diisi')+'</p></div><span class="payroll-employee-code">No. '+esc(row.employee_code||row.employee_id)+'</span></header><p class="payroll-employment">'+esc(row.job_title||'Jabatan belum diisi')+' · '+esc(row.employment_status||'Status belum diisi')+'</p>'+figures+'</div><aside class="payroll-entry-actions" aria-label="Tindakan slip '+esc(row.full_name)+'"><div class="payroll-action-step"><span>1</span><div><strong>Periksa dokumen</strong><small>Unduh dan cocokkan isi slip.</small></div><button type="button" class="btn" data-employee-pdf="'+id+'">Unduh Slip</button></div><div class="payroll-action-step payroll-email-step"><span>3</span><div><strong>Kirim ke penerima</strong><small class="payroll-recipient">'+esc(row.email||'Email belum diisi saat impor')+'</small></div></div><p id="'+deliveryId+'" class="payroll-delivery-reason" data-employee-delivery>'+esc(sendReason(e))+'</p>'+(e.status==='DRAFT'?'<button class="text-action payroll-publish-jump" type="button" data-employee-focus-publish="'+esc(e.batch_id)+'">Lanjut ke konfirmasi penerbitan</button>':'')+'<label class="payroll-history-consent"><input type="checkbox" data-employee-consent="'+id+'"'+(!sendable?' disabled':'')+'> '+(e.status==='PUBLISHED'?'Saya periksa penerima dan slip ini':'Konfirmasi penerima tersedia setelah terbit')+'</label><button type="button" class="btn" data-employee-send="'+id+'" aria-describedby="'+deliveryId+'" disabled>Kirim Email</button></aside></section>';
   };
   output.innerHTML=entries.length?[...groups.values()].map(rows=>{
    const first=rows[0],draft=first.status==='DRAFT';
    return '<article class="payroll-history-batch"><header class="payroll-batch-head"><div><span class="payroll-kicker">Periode gaji</span><h3>'+esc(periodLabel(first.period))+'</h3><p>'+esc(first.row.company_name)+'</p>'+(first.row.company_address?'<p class="payroll-batch-address">'+esc(first.row.company_address)+'</p>':'')+'</div><div class="payroll-batch-meta"><span class="payroll-batch-status '+(draft?'is-draft':'is-published')+'">'+(draft?'Draft':'Terbit')+'</span><small>'+rows.length+' slip karyawan</small>'+(!draft&&bulkEligible(first.batch_id).length?'<button class="text-action payroll-bulk-jump" type="button" data-employee-focus-bulk="'+esc(first.batch_id)+'">Kirim Massal · '+bulkEligible(first.batch_id).length+' siap</button>':'')+'</div></header><div class="payroll-history-entries">'+rows.map(renderEntry).join('')+'</div>'+(draft?'<footer class="payroll-publish-footer"><div><strong>2. Konfirmasi dan terbitkan</strong><p>Centang konfirmasi setelah memeriksa seluruh slip untuk mengaktifkan tombol Terbitkan Slip.</p><label class="payroll-history-consent"><input type="checkbox" data-employee-publish-consent="'+esc(first.batch_id)+'"> Seluruh komponen dan penempatan karyawan sudah saya periksa</label></div><button type="button" class="btn primary" data-employee-publish="'+esc(first.batch_id)+'" disabled>Terbitkan Slip</button></footer>':'<footer class="payroll-published-footer payroll-bulk-footer"><div><strong>3. Kirim slip dalam batch ini</strong><p>'+bulkEligible(first.batch_id).length+' siap dikirim · '+(rows.length-bulkEligible(first.batch_id).length)+' lainnya sudah diproses atau belum memenuhi syarat.</p><label class="payroll-history-consent"><input type="checkbox" data-employee-bulk-consent="'+esc(first.batch_id)+'"> Saya sudah memeriksa seluruh slip dan email penerima yang siap dikirim dalam batch ini.</label><p class="payroll-bulk-help">Konfirmasi memilih daftar penerima saat dicentang. Slip dikirim satu per satu; setiap penerima tetap diperiksa oleh sistem.</p><p data-employee-bulk-progress="'+esc(first.batch_id)+'" role="status" aria-live="polite"></p><details class="payroll-bulk-results"><summary>Hasil per slip</summary><ul data-employee-bulk-results="'+esc(first.batch_id)+'"></ul></details></div><button type="button" class="btn primary" data-employee-bulk-send="'+esc(first.batch_id)+'" disabled>Kirim Massal</button></footer>')+'</article>';
   }).join(''):'<p class="payroll-history-empty">Belum ada slip gaji karyawan. Unggah CSV atau PDF untuk memeriksa penerima.</p>';
   status.textContent=!ready.encryption?'Penyimpanan gaji belum siap. Hubungi pengelola.':!window.SipekaCompany?.name?'Simpan nama perusahaan pada formulir di atas sebelum mengimpor gaji.':!ready.email?'Slip dapat disiapkan. Layanan email belum siap.':'Periksa preview, terbitkan slip, lalu konfirmasi penerima untuk mengirim email.';
   syncButtons();
  }
  panel.addEventListener('change',e=>{
   if(e.target.matches('[data-employee-bulk-consent]')){const batch=e.target.dataset.employeeBulkConsent;if(e.target.checked)bulkConfirmations.set(batch,bulkEligible(batch).map(entry=>({id:entry.id,email:entry.row.email,name:entry.row.full_name})));else bulkConfirmations.delete(batch);syncButtons();}
   if(e.target.matches('[data-employee-consent],[data-employee-publish-consent]'))syncButtons();
  });
  // Saving the company can make import available without discarding a selected CSV.
  document.addEventListener('sipeka-company-saved',()=>{if(current())load().catch(notice);},{signal:companyController.signal});
  panel.addEventListener('click',async e=>{
   const button=e.target.closest('button');if(!button||button.type==='submit'||button.disabled||!current()||button.closest('[data-employee-review]'))return;if(button.hasAttribute('data-employee-tab')){selectTab(button.dataset.employeeTab);return;}if(button.hasAttribute('data-employee-focus-publish')){panel.querySelector('[data-employee-publish-consent="'+button.dataset.employeeFocusPublish+'"]')?.focus();return;}if(button.hasAttribute('data-employee-focus-bulk')){panel.querySelector('[data-employee-bulk-consent="'+button.dataset.employeeFocusBulk+'"]')?.focus();return;}if(button.hasAttribute('data-employee-bulk-send')){await sendBulk(button.dataset.employeeBulkSend);return;}const previousLabel=button.textContent;button.disabled=true;
   const operation=button.dataset.employeePublish||button.dataset.employeeSend,mutation=!!operation;if(mutation){busy.add(operation);button.textContent=button.dataset.employeePublish?'Menerbitkan…':'Mengirim…';}
   try{
    if(button.dataset.employeeWorkbook)await download('/api/employee-payroll/workbook?type='+button.dataset.employeeWorkbook,'gaji-'+button.dataset.employeeWorkbook+'.xlsx',current);
    if(button.dataset.employeeBlank)await download('/api/employee-payroll/template?type='+button.dataset.employeeBlank+'&format=xlsx','template-gaji-'+button.dataset.employeeBlank+'.xlsx',current);
    if(button.hasAttribute('data-employee-refresh'))await load();
    if(button.hasAttribute('data-employee-template'))await download('/api/employee-payroll/template?type='+button.dataset.employeeTemplate,'template-gaji-'+button.dataset.employeeTemplate+'.csv',current);
    if(button.dataset.employeePdf)await download('/api/employee-payroll/entries/'+button.dataset.employeePdf+'/slip.pdf','slip-gaji-karyawan.pdf',current);
    if(button.dataset.employeePublish){const row=entries.find(x=>x.batch_id===button.dataset.employeePublish);if(!row||!panel.querySelector('[data-employee-publish-consent="'+row.batch_id+'"]').checked)return;await api('/api/employee-payroll/publish',{method:'POST',body:{id:row.batch_id,preview_token:row.preview_token,confirmed:true}});if(current())await load();}
    if(button.dataset.employeeSend){const row=entries.find(x=>x.id===button.dataset.employeeSend);if(!canSend(row)||!panel.querySelector('[data-employee-consent="'+row.id+'"]').checked)return;status.textContent='Memproses pengiriman slip ke '+row.row.email+'…';const result=await api('/api/employee-payroll/entries/'+row.id+'/send',{method:'POST',body:{email:row.row.email,confirmed:true}});row.email_status=result.status==='sent'?'sent':(result.status||'uncertain');if(current()){await load();status.textContent=result.status==='sent'?'Layanan email menerima slip. Status ini belum menjamin masuk inbox.':'Status kirim perlu diperiksa. Muat ulang status sebelum tindakan berikutnya.';}}
   }catch(err){if(button.dataset.employeeSend){const row=entries.find(item=>item.id===button.dataset.employeeSend);if(row)row.email_status='uncertain';}if(mutation&&current())try{await load();}catch{}if(mutation&&current())panel.querySelectorAll('[data-employee-consent],[data-employee-publish-consent]').forEach(c=>c.checked=false);notice(err);}finally{busy.delete(operation);if(current())syncButtons();if(button.isConnected){button.textContent=previousLabel;if(!mutation)button.disabled=false;}}
  });
  const reviewPanel=panel.querySelector('[data-employee-review]');
  const reviewCurrent=stamp=>current()&&stamp===reviewVersion;
  const canSaveReview=()=>review?.status==='completed'&&review.ai?.decision==='LANJUT'&&!!review.review_token&&!(review.blockers||[]).length;
  const stopPoll=()=>{clearTimeout(reviewTimer);reviewTimer=null;reviewPolling=false;};
  companyController.signal.addEventListener('abort',stopPoll,{once:true});
  const invalidate=()=>{importError="";stopPoll();reviewVersion++;review=null;uploadBody=null;reviewPanel.hidden=true;reviewPanel.replaceChildren();if(current())syncButtons();};
  function paintReview(){
   if(!review||!current())return;
   const running=['running','queued','pending'].includes(review.status),allowed=canSaveReview(),failed=review.status==='failed',held=review.ai?.decision==='TAHAN'||(review.blockers||[]).length>0;
   const decision=running?'Sedang diperiksa Widya…':failed?'Pemeriksaan Widya belum berhasil':held?'TAHAN — perlu diperiksa ulang':allowed?'LANJUT — siap ditinjau untuk draft':'Belum dapat dilanjutkan';
   const explanation=running?'Widya sedang membaca file dan mencocokkannya dengan direktori karyawan. Tunggu hasil pemeriksaan sebelum menyimpan draft.':review.ai?.text||message(Error(review.error||'Hasil pemeriksaan belum lengkap. Periksa ulang sebelum melanjutkan.'));
   const persons=review.rows||[],blockers=[...new Set(review.blockers||[])],warnings=[...new Set(review.warnings||[])],duplicate=blockers.includes('PAYROLL_DUPLICATE_PERIOD_STAFF');
   const humanCode=code=>{const text=message(Error(code));return text===code?'Data perlu diperiksa ulang.':text;};
   const readable=String(explanation).replace(/\b(?:PAYROLL|DOCUMENT)_[A-Z_0-9]+\b/g,humanCode);
   const periodLabel=value=>/^20\d{2}-(0[1-9]|1[0-2])$/.test(value||'')?new Intl.DateTimeFormat('id-ID',{month:'long',year:'numeric',timeZone:'UTC'}).format(new Date(value+'-01T00:00:00Z')):String(value||'Belum tersedia');
   const summary=running?'File sedang dicocokkan dengan direktori karyawan.':duplicate?'Slip karyawan untuk periode ini sudah tercatat. Tidak perlu membuat slip kedua.':allowed?'Pemeriksaan selesai. Cocokkan penerima sebelum menyimpan draft.':failed?'Pemeriksaan belum selesai. Coba lagi melalui tombol Periksa File.':blockers.length?'Ada data yang harus diperbaiki sebelum slip dapat dilanjutkan.':'Baca catatan Widya dan perbaiki file sebelum memeriksa ulang.';
   const next=duplicate?'Buka Riwayat Slip untuk melihat atau mengirim slip yang sudah ada. Untuk periode lain, ubah periode pada file lalu periksa ulang.':allowed?'Centang konfirmasi setelah memeriksa data, lalu pilih Simpan Draft.':running?'Tunggu hasil pemeriksaan. Draft belum dapat disimpan.':'Perbaiki data yang disebutkan, unggah kembali file, lalu pilih Periksa File dengan Widya.';
   reviewPanel.dataset.reviewState=running?'running':allowed?'ready':failed?'error':'blocked';
   reviewPanel.innerHTML='<header class="payroll-review-heading"><h3>Hasil Pemeriksaan Widya</h3><p data-employee-ai-decision role="status"><strong>'+esc(decision)+'</strong></p></header><p class="payroll-review-summary">'+esc(summary)+'</p>'+
    (blockers.length?'<section class="payroll-review-alert"><h4>Yang perlu diperbaiki</h4><ul>'+blockers.map(code=>'<li>'+esc(humanCode(code))+'</li>').join('')+'</ul></section>':'')+
    (warnings.length?'<section class="payroll-review-alert"><h4>Perhatian</h4><ul>'+warnings.map(code=>'<li>'+esc(humanCode(code))+'</li>').join('')+'</ul></section>':'')+
    '<section class="payroll-review-people"><h4>Penerima yang dicocokkan ('+persons.length+')</h4><div class="payroll-recipient-list">'+persons.map(row=>'<article class="payroll-recipient"><div><span>Karyawan</span><strong>'+esc(row.full_name)+'</strong></div><div><span>No. karyawan</span><strong>'+esc(row.employee_code||row.employee_id)+'</strong></div><div><span>Periode</span><strong>'+esc(periodLabel(row.period))+'</strong></div><div><span>Email penerima</span><strong>'+esc(row.email||'Email belum tersedia')+'</strong></div></article>').join('')+'</div></section>'+
    '<section class="payroll-review-next"><h4>Langkah berikutnya</h4><p>'+esc(next)+'</p>'+(duplicate?'<button class="btn" type="button" data-employee-open-history>Buka Riwayat Slip</button>':'')+'</section>'+
    '<details class="payroll-review-notes"'+(held&&!blockers.length?' open':'')+'><summary>Catatan lengkap Widya</summary><div data-employee-ai-result>'+readable.split(/\n+|(?<=[.!?])\s+(?=[A-Z])/).map(line=>line.trim()).filter(Boolean).map(line=>{const parts=/^([^:]{1,180}):\s+(.+)$/.exec(line);return parts?'<section class="payroll-note-group"><p><strong>'+esc(parts[1])+':</strong></p><ul class="payroll-note-list">'+parts[2].split(/[,;]\s+/).map(item=>'<li>'+esc(item)+'</li>').join('')+'</ul></section>':'<p>'+esc(line)+'</p>';}).join('')+'</div></details>'+
    (review.review_id&&reviewPolling===false&&running?'<button class="btn" type="button" data-employee-check-review>Periksa Status Widya</button>':'')+
    '<p class="payroll-review-disclaimer">Penerbitan dan pengiriman email tetap memerlukan konfirmasi Anda.</p><label><input type="checkbox" data-employee-review-consent'+(!allowed?' disabled':'')+'> Saya sudah mencocokkan dokumen, identitas, dan email penerima</label><button class="btn primary" type="button" data-employee-save disabled>Simpan Draft</button>'+
    (!allowed?'<p class="payroll-review-locked">Simpan Draft belum tersedia: '+esc(running?'pemeriksaan masih berjalan.':duplicate?'slip periode ini sudah ada.':'hasil pemeriksaan belum LANJUT tanpa kendala.')+'</p>':'');
   reviewPanel.hidden=false;
   status.textContent=running?'Widya sedang memeriksa file. Simpan Draft menunggu hasil LANJUT.':allowed?'Widya memberi hasil LANJUT. Baca hasilnya dan periksa penerima sebelum menyimpan draft.':held?'Widya memberi hasil TAHAN. Perbaiki data atau dokumen, lalu periksa ulang.':failed?'Pemeriksaan Widya gagal. Draft belum disimpan. Coba periksa file kembali.':'Ada data yang belum cocok. Draft dan pengiriman diblokir.';
   syncButtons();
  }
  async function pollReview(stamp,started=Date.now()){
   if(!reviewCurrent(stamp)||!review?.review_id)return;
   reviewPolling=true;syncButtons();
   try{
    const next=await api('/api/employee-payroll/reviews/'+encodeURIComponent(review.review_id));if(!reviewCurrent(stamp))return;
    review={...review,...next,review_id:next.review_id||review.review_id};
    if(['running','queued','pending'].includes(review.status)){
     if(Date.now()-started>=180000){stopPoll();paintReview();status.textContent='Pemeriksaan Widya masih berjalan. Klik Periksa Status Widya untuk melanjutkan pemeriksaan yang sama.';return;}
     paintReview();reviewTimer=setTimeout(()=>pollReview(stamp,started),1500);
    }else{stopPoll();paintReview();}
   }catch(error){if(!reviewCurrent(stamp))return;stopPoll();paintReview();status.textContent='Status Widya belum dapat dimuat. '+message(error)+' Klik Periksa Status Widya untuk memeriksa proses yang sama.';}
  }
  panel.querySelector('[data-employee-import]').addEventListener('input',invalidate);
  panel.querySelector('[data-employee-import]').addEventListener('change',invalidate);
  reviewPanel.addEventListener('change',()=>{const save=reviewPanel.querySelector('[data-employee-save]');if(save)save.disabled=importing||!canSaveReview()||!reviewPanel.querySelector('[data-employee-review-consent]').checked;});
  reviewPanel.addEventListener('click',async event=>{
   const button=event.target.closest('button');if(!button||button.disabled||!current())return;
   if(button.hasAttribute('data-employee-open-history')){selectTab('history',true);return;}
   if(button.hasAttribute('data-employee-check-review')){button.disabled=true;await pollReview(reviewVersion);return;}
   if(!button.hasAttribute('data-employee-save')||!canSaveReview()||!reviewPanel.querySelector('[data-employee-review-consent]').checked||importing)return;
   importing=true;button.disabled=true;syncButtons();
   try{await api('/api/employee-payroll/import',{method:'POST',body:{...uploadBody,review_id:review.review_id,review_token:review.review_token,confirmed:true}});if(current()){invalidate();await load();if(!current())return;selectTab('history',true);status.textContent='Draft tersimpan. Periksa PDF, terbitkan slip, lalu konfirmasi penerima sebelum mengirim.';}}
   catch(error){invalidate();notice(error);}finally{importing=false;if(current())syncButtons();}
  });
  panel.querySelector('[data-employee-import]').onsubmit=async event=>{
   event.preventDefault();if(importing||reviewPolling||!current())return;invalidate();const stamp=reviewVersion;importing=true;syncButtons();
   try{
    if(!importReady()){
     const result=await api('/api/employee-payroll');if(!reviewCurrent(stamp))return;ready=result.readiness||{};
     if(!window.SipekaCompany?.name){const company=await api('/api/company');if(!reviewCurrent(stamp))return;window.SipekaCompany=company;}
     if(!ready.encryption)throw Error('Penyimpanan gaji belum siap. Hubungi pengelola; file belum dikirim ke Widya.');
     if(!window.SipekaCompany?.name)throw Error('Isi nama perusahaan di Device & Cabang sebelum memeriksa file.');
    }
    const file=event.target.elements.csv.files[0],pdf=/\.pdf$/i.test(file?.name||'');if(!file||! /\.(csv|pdf)$/i.test(file.name)||file.size>(pdf?256*1024:1024*1024))throw Error(pdf?'Pilih PDF maksimal 256 KB':'Pilih CSV maksimal 1 MB atau PDF maksimal 256 KB');
    const body={format:pdf?'pdf':'csv',company_address:event.target.elements.company_address.value};
    if(pdf){if(!event.target.elements.pdf_period.value)throw Error('Pilih periode yang sama dengan PDF sebelum memeriksa file.');const bytes=new Uint8Array(await file.arrayBuffer());let encoded='';for(let i=0;i<bytes.length;i+=8192)encoded+=String.fromCharCode(...bytes.subarray(i,i+8192));body.data_base64=btoa(encoded);body.period=event.target.elements.pdf_period.value;}else body.csv=await file.text();
    if(!reviewCurrent(stamp))return;const result=await api('/api/employee-payroll/review',{method:'POST',body});if(!reviewCurrent(stamp))return;uploadBody=body;review=result;
    if(!review.status)review={...review,status:'failed',review_token:null,error:'Hasil pemeriksaan Widya belum tersedia.'};
    const pendingReview=['running','queued','pending'].includes(review.status)&&!!review.review_id;reviewPolling=pendingReview;paintReview();if(pendingReview)reviewTimer=setTimeout(()=>pollReview(stamp),750);
   }catch(error){importError=message(error);notice(error);}finally{importing=false;if(current())syncButtons();}
  };
  syncButtons();load().catch(error=>{if(current())syncButtons();notice(error);});
 }
 window.SipekaEmployeePayroll={render,bind};
})();
