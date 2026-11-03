(()=>{'use strict';
 const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const api=(...a)=>window.SipekaAuth.api(...a),message=e=>window.SipekaUi.message(e);
 let companyController;
 const amount=v=>v==null?'Lihat PDF':'Rp '+BigInt(v).toLocaleString('id-ID');
 const componentLines=(row,fields)=>fields.filter(([key])=>row[key]!=null).map(([key,label])=>esc(label)+' '+esc(amount(row[key]))).join('<br>');
 const earningsDetail=row=>row.overtime==null?esc(amount(row.allowances)):componentLines(row,[['operational_allowance','Tunjangan operasional'],['health_allowance','Tunjangan kesehatan'],['meal_allowance','Uang makan'],['transport_allowance','Transport'],['ironing_regular','Setrika reguler'],['ironing_express','Setrika express'],['overtime','Lembur'],['bonus','Bonus']])+'<br><strong>Total tambahan '+esc(amount(row.allowances))+'</strong>';
 const deductionsDetail=row=>row.absence_deduction==null?esc(amount(row.deductions)):componentLines(row,[['absence_deduction','Potongan absen'],['late_deduction','Potongan telat'],['violation_deduction','Potongan pelanggaran'],['other_deductions','Potongan lainnya']])+'<br><strong>Total potongan '+esc(amount(row.deductions))+'</strong>';
 function render(){return '<section id="employeePayroll" class="payroll-workspace"><header class="payroll-page-head"><div><span class="payroll-kicker">Finance & Accounting</span><h1>Slip Gaji</h1><p>Siapkan dokumen, periksa penerima bersama Widya, lalu terbitkan dan kirim.</p></div><button class="btn" type="button" data-employee-refresh>Muat ulang status</button></header><ol class="payroll-steps" aria-label="Tahapan slip gaji"><li><span>1</span><div><strong>Siapkan file</strong><small>Template dan direktori karyawan</small></div></li><li><span>2</span><div><strong>Periksa bersama Widya</strong><small>Identitas, komponen, dan penerima</small></div></li><li><span>3</span><div><strong>Terbitkan & kirim</strong><small>Konfirmasi setiap dokumen</small></div></li></ol><div class="payroll-preparation"><section class="payroll-panel payroll-templates"><div class="payroll-panel-heading"><span class="payroll-section-number">01</span><div><h2>Template gaji</h2><p>Pilih format sesuai unit dan cara pengolahan data.</p></div></div><div class="payroll-template-type"><div><h3>Umum</h3><p>Gaji, tunjangan, lembur, bonus, dan potongan.</p></div><div class="payroll-template-actions"><button class="btn" type="button" data-employee-template="general">CSV untuk impor</button><button class="btn" type="button" data-employee-workbook="general">Excel perhitungan</button><button class="btn" type="button" data-employee-blank="general">Excel kosong</button></div></div><div class="payroll-template-type"><div><h3>Laundry</h3><p>Termasuk makan, transport, serta setrika reguler dan express.</p></div><div class="payroll-template-actions"><button class="btn" type="button" data-employee-template="laundry">CSV untuk impor</button><button class="btn" type="button" data-employee-workbook="laundry">Excel perhitungan</button><button class="btn" type="button" data-employee-blank="laundry">Excel kosong</button></div></div><details class="employee-components"><summary>Komponen dan ketentuan file</summary><p>Slip umum: gaji pokok, tunjangan operasional dan kesehatan, lembur, bonus, potongan absen, telat, pelanggaran, serta PPh21. Laundry menambahkan makan, transport, setrika reguler dan express, serta potongan lainnya.</p><p>Excel memuat Database dan Slip Gaji. Impor dashboard memakai CSV atau PDF. Nominal rupiah bulat tanpa pemisah ribuan; tarif dan jumlah pekerjaan tidak dihitung otomatis.</p></details><p class="payroll-directory-note">Pastikan ID, departemen, unit, dan email karyawan sudah sesuai direktori sebelum mengunggah.</p></section><section class="payroll-panel payroll-import"><div class="payroll-panel-heading"><span class="payroll-section-number">02</span><div><h2>Unggah & periksa</h2><p>Draft menunggu hasil LANJUT dan konfirmasi Anda.</p></div></div><form data-employee-import><label>Alamat kop perusahaan<input class="control" name="company_address" maxlength="180" value="Kompleks Roemah Pelangi Ruko No. 3 Jl. Ori II No. 7, Depok, Daerah Istimewa Yogyakarta, Indonesia, 55281"><small>Nama mengikuti profil perusahaan. Kop disimpan bersama draft; dokumen lama tetap memakai identitas saat diterbitkan.</small></label><label class="payroll-file-field">File gaji CSV / PDF<input class="control" type="file" name="csv" accept=".csv,.pdf,text/csv,application/pdf" required><small>CSV maksimal 1 MB. PDF satu slip, satu halaman, maksimal 256 KB.</small></label><label>Periode PDF<input class="control" type="month" name="pdf_period"><small>Wajib untuk PDF dan harus sama dengan periode di dokumen. CSV mengikuti periode pada file.</small></label><div class="payroll-form-action"><button class="btn primary" disabled>Periksa File dengan Widya</button></div></form></section></div><section data-employee-review class="payroll-panel payroll-review" hidden aria-live="polite"></section><section class="payroll-register"><div class="payroll-register-head"><div><span class="payroll-kicker">Dokumen karyawan</span><h2>Draft & riwayat slip</h2><p>Tinjau komponen dan penerima sebelum menerbitkan atau mengirim.</p></div></div><p data-employee-status class="payroll-status" role="status" aria-live="polite">Memuat kesiapan dan daftar slip…</p><div data-employee-rows></div></section></section>';}

 async function download(path,filename,current){
  const response=await fetch(path,{credentials:'same-origin',cache:'no-store'});
  if(!response.ok){const result=await response.json().catch(()=>({}));throw Error(result.error||'Unduhan belum tersedia');}
  const blob=await response.blob();if(!current())return;
  const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;const supplied=response.headers.get('Content-Disposition')?.match(/filename="([A-Za-z0-9_-]+\.pdf)"/);link.download=supplied?.[1]||filename;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
 }
 function bind(content){
  companyController?.abort();const panel=content.querySelector('#employeePayroll');if(!panel)return;companyController=new AbortController();
  const generation=window.SipekaAuth.generation(),current=()=>panel.isConnected&&generation===window.SipekaAuth.generation()&&window.SipekaCurrentUser?.role==='OWNER';
  const status=panel.querySelector('[data-employee-status]'),output=panel.querySelector('[data-employee-rows]'),importButton=panel.querySelector('[data-employee-import] button');
  let entries=[],ready={},loading=0,importing=false,review=null,uploadBody=null,reviewVersion=0,reviewTimer=null,reviewPolling=false;const busy=new Set();
  const notice=e=>{if(current())status.textContent=message(e);};
  const sendReason=e=>e.recipient_valid===false?'Identitas atau email berbeda dari direktori. Periksa ulang sebelum mengirim.':e.email_status==='sent'?'Diterima layanan email; belum berarti sudah masuk inbox.':e.email_status==='sending'?'Sedang diproses layanan email. Muat ulang status; pengiriman ulang diblokir.':e.email_status?'Status kirim perlu diperiksa; pengiriman ulang diblokir.':e.status!=='PUBLISHED'?'Terbitkan slip sebelum mengirim email.':!e.row.email?'Email belum diisi saat impor. Pengiriman belum tersedia.':!ready.email?'Layanan email belum siap.':'Belum dikirim. Periksa slip dan email penerima.';
  const canSend=e=>!!e&&ready.email&&e.status==='PUBLISHED'&&!!e.row.email&&!e.email_status&&e.recipient_valid!==false;
  const importReady=()=>ready.encryption&&!!window.SipekaCompany?.name;
  function syncButtons(){
   importButton.disabled=importing||reviewPolling||!importReady();
   panel.querySelectorAll('[data-employee-send]').forEach(b=>{const e=entries.find(e=>e.id===b.dataset.employeeSend);b.disabled=busy.has(b.dataset.employeeSend)||!canSend(e)||!panel.querySelector('[data-employee-consent="'+b.dataset.employeeSend+'"]').checked;});
   panel.querySelectorAll('[data-employee-publish]').forEach(b=>{b.disabled=busy.has(b.dataset.employeePublish)||!panel.querySelector('[data-employee-publish-consent="'+b.dataset.employeePublish+'"]').checked;});
  }
  async function load(){
   const request=++loading,result=await api('/api/employee-payroll');if(!current()||request!==loading)return;
   entries=result.rows;ready=result.readiness;
   const groups=new Map();for(const e of entries){if(!groups.has(e.batch_id))groups.set(e.batch_id,[]);groups.get(e.batch_id).push(e);}
   output.innerHTML=entries.length?[...groups.values()].map(rows=>{const first=rows[0];return '<article class="card"><h3>'+esc(first.period)+' · '+esc(first.status==='PUBLISHED'?'Terbit':'Draft — belum dikirim')+'</h3><p>'+esc(first.row.company_name)+'</p>'+(first.row.upload_kind==='PDF'?'<p>PDF unggahan · nominal mengikuti dokumen asli.</p>':'')+(first.row.company_address?'<p>'+esc(first.row.company_address)+'</p>':'')+(first.row.upload_kind==='PDF'?'<div class="employee-documents">'+rows.map(e=>'<section class="employee-document"><h4>'+esc(e.row.full_name)+'</h4><p>ID: '+esc(e.row.employee_id)+' · '+esc(e.row.department)+' · '+esc(e.row.branch_name)+'</p><button type="button" class="btn" data-employee-pdf="'+esc(e.id)+'">Unduh Slip</button><p>'+esc(e.row.email||'Email belum tersedia')+'</p><p data-employee-delivery>'+esc(sendReason(e))+'</p><label><input type="checkbox" data-employee-consent="'+esc(e.id)+'"'+(!canSend(e)?' disabled':'')+'> Saya periksa penerima dan slip ini</label><button type="button" class="btn" data-employee-send="'+esc(e.id)+'" disabled>Kirim Email</button></section>').join('')+'</div>':'<div class="table-wrap"><table><thead><tr><th>Karyawan / Penempatan</th><th>Gaji pokok</th><th>Tunjangan & tambahan</th><th>Potongan</th><th>PPh 21</th><th>Bersih</th><th>Slip & Email</th></tr></thead><tbody>'+rows.map(e=>'<tr><td>'+esc(e.row.full_name)+'<br>'+esc(e.row.department)+' · '+esc(e.row.branch_name)+'<br><small>ID: '+esc(e.row.employee_id)+'</small><br>'+esc(e.row.job_title||'Jabatan belum diisi')+' · '+esc(e.row.employment_status||'Status belum diisi')+'</td>'+['basic_salary','allowances','deductions','pph21','net_salary'].map(k=>'<td>'+(k==='allowances'?e.row.upload_kind==='PDF'?esc(amount(null)):'<details class="payroll-components-detail"><summary>'+esc(amount(e.row.allowances))+'</summary><div>'+earningsDetail(e.row)+'</div></details>':k==='deductions'?e.row.upload_kind==='PDF'?esc(amount(null)):'<details class="payroll-components-detail"><summary>'+esc(amount(e.row.deductions))+'</summary><div>'+deductionsDetail(e.row)+'</div></details>':esc(amount(e.row[k])))+'</td>').join('')+'<td><button type="button" class="btn" data-employee-pdf="'+esc(e.id)+'">Unduh Slip</button><p>'+esc(e.row.email||'Email belum diisi saat impor')+'</p><p data-employee-delivery>'+esc(sendReason(e))+'</p><label><input type="checkbox" data-employee-consent="'+esc(e.id)+'"'+(!canSend(e)?' disabled':'')+'> Saya periksa penerima dan slip ini</label><button type="button" class="btn" data-employee-send="'+esc(e.id)+'" disabled>Kirim Email</button></td></tr>').join('')+'</tbody></table></div>')+(first.status==='DRAFT'?'<label><input type="checkbox" data-employee-publish-consent="'+esc(first.batch_id)+'"> Seluruh komponen dan penempatan karyawan sudah saya periksa</label><button type="button" class="btn primary" data-employee-publish="'+esc(first.batch_id)+'" disabled>Terbitkan Slip</button>':'')+'</article>';}).join(''):'<p>Belum ada slip gaji karyawan. Unggah CSV atau PDF untuk memeriksa penerima.</p>';
   status.textContent=!ready.encryption?'Penyimpanan gaji belum siap. Hubungi pengelola.':!window.SipekaCompany?.name?'Simpan nama perusahaan pada formulir di atas sebelum mengimpor gaji.':!ready.email?'Slip dapat disiapkan. Layanan email belum siap.':'Periksa preview, terbitkan slip, lalu konfirmasi penerima untuk mengirim email.';
   syncButtons();
  }
  panel.addEventListener('change',e=>{if(e.target.matches('[data-employee-consent],[data-employee-publish-consent]'))syncButtons();});
  // Saving the company can make import available without discarding a selected CSV.
  document.addEventListener('sipeka-company-saved',()=>{if(current())load().catch(notice);},{signal:companyController.signal});
  panel.addEventListener('click',async e=>{
   const button=e.target.closest('button');if(!button||button.type==='submit'||button.disabled||!current()||button.closest('[data-employee-review]'))return;button.disabled=true;
   const operation=button.dataset.employeePublish||button.dataset.employeeSend,mutation=!!operation;if(mutation)busy.add(operation);
   try{
    if(button.dataset.employeeWorkbook)await download('/api/employee-payroll/workbook?type='+button.dataset.employeeWorkbook,'gaji-'+button.dataset.employeeWorkbook+'.xlsx',current);
    if(button.dataset.employeeBlank)await download('/api/employee-payroll/template?type='+button.dataset.employeeBlank+'&format=xlsx','template-gaji-'+button.dataset.employeeBlank+'.xlsx',current);
    if(button.hasAttribute('data-employee-refresh'))await load();
    if(button.hasAttribute('data-employee-template'))await download('/api/employee-payroll/template?type='+button.dataset.employeeTemplate,'template-gaji-'+button.dataset.employeeTemplate+'.csv',current);
    if(button.dataset.employeePdf)await download('/api/employee-payroll/entries/'+button.dataset.employeePdf+'/slip.pdf','slip-gaji-karyawan.pdf',current);
    if(button.dataset.employeePublish){const row=entries.find(x=>x.batch_id===button.dataset.employeePublish);if(!row||!panel.querySelector('[data-employee-publish-consent="'+row.batch_id+'"]').checked)return;await api('/api/employee-payroll/publish',{method:'POST',body:{id:row.batch_id,preview_token:row.preview_token,confirmed:true}});if(current())await load();}
    if(button.dataset.employeeSend){const row=entries.find(x=>x.id===button.dataset.employeeSend);if(!canSend(row)||!panel.querySelector('[data-employee-consent="'+row.id+'"]').checked)return;status.textContent='Memproses pengiriman slip ke '+row.row.email+'…';const result=await api('/api/employee-payroll/entries/'+row.id+'/send',{method:'POST',body:{email:row.row.email,confirmed:true}});if(current()){await load();status.textContent=result.status==='sent'?'Layanan email menerima slip. Status ini belum menjamin masuk inbox.':'Status kirim perlu diperiksa. Muat ulang status sebelum tindakan berikutnya.';}}
   }catch(err){if(mutation&&current())try{await load();}catch{}if(mutation&&current())panel.querySelectorAll('[data-employee-consent],[data-employee-publish-consent]').forEach(c=>c.checked=false);notice(err);}finally{busy.delete(operation);if(current())syncButtons();if(button.isConnected&&!mutation)button.disabled=false;}
  });
  const reviewPanel=panel.querySelector('[data-employee-review]');
  const reviewCurrent=stamp=>current()&&stamp===reviewVersion;
  const canSaveReview=()=>review?.status==='completed'&&review.ai?.decision==='LANJUT'&&!!review.review_token&&!(review.blockers||[]).length;
  const stopPoll=()=>{clearTimeout(reviewTimer);reviewTimer=null;reviewPolling=false;};
  companyController.signal.addEventListener('abort',stopPoll,{once:true});
  const invalidate=()=>{stopPoll();reviewVersion++;review=null;uploadBody=null;reviewPanel.hidden=true;reviewPanel.replaceChildren();if(current())syncButtons();};
  function paintReview(){
   if(!review||!current())return;
   const running=['running','queued','pending'].includes(review.status),allowed=canSaveReview(),failed=review.status==='failed',held=review.ai?.decision==='TAHAN';
   const decision=running?'Sedang diperiksa Widya…':failed?'Pemeriksaan Widya belum berhasil':held?'TAHAN — perlu diperiksa ulang':allowed?'LANJUT — siap ditinjau untuk draft':'Belum dapat dilanjutkan';
   const explanation=running?'Widya sedang membaca file dan mencocokkannya dengan direktori karyawan. Tunggu hasil pemeriksaan sebelum menyimpan draft.':review.ai?.text||message(Error(review.error||'Hasil pemeriksaan belum lengkap. Periksa ulang sebelum melanjutkan.'));
   const persons=review.rows||[];
   reviewPanel.innerHTML='<h3>Hasil Pemeriksaan Widya</h3><p data-employee-ai-decision role="status"><strong>'+esc(decision)+'</strong></p><div data-employee-ai-result style="white-space:pre-wrap;overflow-wrap:anywhere">'+esc(explanation)+'</div><details'+(persons.length<=5?' open':'')+'><summary>Penerima yang dicocokkan ('+persons.length+')</summary><ul>'+persons.map(row=>'<li>'+esc(row.full_name)+' · ID '+esc(row.employee_id)+' · '+esc(row.period)+' · '+esc(row.email||'Email belum tersedia')+'</li>').join('')+'</ul></details>'+[...(review.warnings||[]),...(review.blockers||[])].map(code=>'<p role="alert">'+esc(message(Error(code)))+'</p>').join('')+(review.review_id&&reviewPolling===false&&running?'<button class="btn" type="button" data-employee-check-review>Periksa Status Widya</button>':'')+'<p>Hasil AI membantu pemeriksaan. Penerbitan dan pengiriman email tetap memerlukan konfirmasi Anda.</p><label><input type="checkbox" data-employee-review-consent'+(!allowed?' disabled':'')+'> Saya sudah membaca hasil Widya dan mencocokkan dokumen, identitas, serta email penerima</label><button class="btn primary" type="button" data-employee-save disabled>Simpan Draft</button>';
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
   if(button.hasAttribute('data-employee-check-review')){button.disabled=true;await pollReview(reviewVersion);return;}
   if(!button.hasAttribute('data-employee-save')||!canSaveReview()||!reviewPanel.querySelector('[data-employee-review-consent]').checked||importing)return;
   importing=true;button.disabled=true;syncButtons();
   try{await api('/api/employee-payroll/import',{method:'POST',body:{...uploadBody,review_id:review.review_id,review_token:review.review_token,confirmed:true}});if(current()){invalidate();await load();status.textContent='Draft tersimpan. Periksa PDF, terbitkan slip, lalu konfirmasi penerima sebelum mengirim.';}}
   catch(error){invalidate();notice(error);}finally{importing=false;if(current())syncButtons();}
  });
  panel.querySelector('[data-employee-import]').onsubmit=async event=>{
   event.preventDefault();if(importing||reviewPolling||!importReady()||!current())return;invalidate();const stamp=reviewVersion;importing=true;syncButtons();
   try{
    const file=event.target.elements.csv.files[0],pdf=/\.pdf$/i.test(file?.name||'');if(!file||! /\.(csv|pdf)$/i.test(file.name)||file.size>(pdf?256*1024:1024*1024))throw Error(pdf?'Pilih PDF maksimal 256 KB':'Pilih CSV maksimal 1 MB atau PDF maksimal 256 KB');
    const body={format:pdf?'pdf':'csv',company_address:event.target.elements.company_address.value};
    if(pdf){if(!event.target.elements.pdf_period.value)throw Error('Pilih periode yang sama dengan PDF sebelum memeriksa file.');const bytes=new Uint8Array(await file.arrayBuffer());let encoded='';for(let i=0;i<bytes.length;i+=8192)encoded+=String.fromCharCode(...bytes.subarray(i,i+8192));body.data_base64=btoa(encoded);body.period=event.target.elements.pdf_period.value;}else body.csv=await file.text();
    if(!reviewCurrent(stamp))return;const result=await api('/api/employee-payroll/review',{method:'POST',body});if(!reviewCurrent(stamp))return;uploadBody=body;review=result;
    if(!review.status)review={...review,status:'failed',review_token:null,error:'Hasil pemeriksaan Widya belum tersedia.'};
    const pendingReview=['running','queued','pending'].includes(review.status)&&!!review.review_id;reviewPolling=pendingReview;paintReview();if(pendingReview)reviewTimer=setTimeout(()=>pollReview(stamp),750);
   }catch(error){notice(error);}finally{importing=false;if(current())syncButtons();}
  };
  load().catch(notice);
 }
 window.SipekaEmployeePayroll={render,bind};
})();
