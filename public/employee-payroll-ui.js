(()=>{'use strict';
 const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const api=(...a)=>window.SipekaAuth.api(...a),message=e=>window.SipekaUi.message(e);
 let companyController;
 const amount=v=>'Rp '+BigInt(v).toLocaleString('id-ID');
 function render(){return '<section id="employeePayroll" class="card device-staff"><h2>Gaji Karyawan & Slip Email</h2><p>1. Lengkapi perusahaan dan direktori karyawan. 2. Impor dan periksa komponen gaji. 3. Terbitkan slip, lalu kirim email per karyawan.</p><p>Gaji pokok + lembur + bonus − potongan absen, telat, pelanggaran, dan PPh 21. Isi nominal yang sudah dihitung dan diperiksa.</p><div class="employee-tools"><button class="btn" type="button" data-employee-template>Unduh template CSV</button><button class="btn" type="button" data-employee-refresh>Muat Ulang Status</button></div><form data-employee-import><label>File gaji CSV<input class="control" type="file" name="csv" accept=".csv,text/csv" required></label><p>Gunakan ID karyawan dari direktori di bawah. Satu file untuk satu periode; nominal rupiah bulat tanpa pemisah ribuan.</p><button class="btn primary" disabled>Impor & Preview</button></form><p data-employee-status role="status" aria-live="polite">Memuat kesiapan dan daftar slip…</p><div data-employee-rows></div></section>';}
 async function download(path,filename,current){
  const response=await fetch(path,{credentials:'same-origin',cache:'no-store'});
  if(!response.ok){const result=await response.json().catch(()=>({}));throw Error(result.error||'Unduhan belum tersedia');}
  const blob=await response.blob();if(!current())return;
  const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=filename;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
 }
 function bind(content){
  companyController?.abort();const panel=content.querySelector('#employeePayroll');if(!panel)return;companyController=new AbortController();
  const generation=window.SipekaAuth.generation(),current=()=>panel.isConnected&&generation===window.SipekaAuth.generation()&&window.SipekaCurrentUser?.role==='OWNER';
  const status=panel.querySelector('[data-employee-status]'),output=panel.querySelector('[data-employee-rows]'),importButton=panel.querySelector('[data-employee-import] button');
  let entries=[],ready={},loading=0,importing=false;const busy=new Set();
  const notice=e=>{if(current())status.textContent=message(e);};
  const sendReason=e=>e.email_status==='sent'?'Diterima layanan email; belum berarti sudah masuk inbox.':e.email_status==='sending'?'Sedang diproses layanan email. Muat ulang status; pengiriman ulang diblokir.':e.email_status?'Status kirim perlu diperiksa; pengiriman ulang diblokir.':e.status!=='PUBLISHED'?'Terbitkan slip sebelum mengirim email.':!e.row.email?'Email belum diisi saat impor. Pengiriman belum tersedia.':!ready.email?'Layanan email belum siap.':'Belum dikirim. Periksa slip dan email penerima.';
  const canSend=e=>!!e&&ready.email&&e.status==='PUBLISHED'&&!!e.row.email&&!e.email_status;
  const importReady=()=>ready.encryption&&!!window.SipekaCompany?.name;
  function syncButtons(){
   importButton.disabled=importing||!importReady();
   panel.querySelectorAll('[data-employee-send]').forEach(b=>{const e=entries.find(e=>e.id===b.dataset.employeeSend);b.disabled=busy.has(b.dataset.employeeSend)||!canSend(e)||!panel.querySelector('[data-employee-consent="'+b.dataset.employeeSend+'"]').checked;});
   panel.querySelectorAll('[data-employee-publish]').forEach(b=>{b.disabled=busy.has(b.dataset.employeePublish)||!panel.querySelector('[data-employee-publish-consent="'+b.dataset.employeePublish+'"]').checked;});
  }
  async function load(){
   const request=++loading,result=await api('/api/employee-payroll');if(!current()||request!==loading)return;
   entries=result.rows;ready=result.readiness;
   const groups=new Map();for(const e of entries){if(!groups.has(e.batch_id))groups.set(e.batch_id,[]);groups.get(e.batch_id).push(e);}
   output.innerHTML=entries.length?[...groups.values()].map(rows=>{const first=rows[0];return '<article class="card"><h3>'+esc(first.period)+' · '+esc(first.status==='PUBLISHED'?'Terbit':'Draft — belum dikirim')+'</h3><p>'+esc(first.row.company_name)+'</p><div class="table-wrap"><table><thead><tr><th>Karyawan / Penempatan</th><th>Gaji pokok</th><th>Lembur / Bonus</th><th>Potongan</th><th>PPh 21</th><th>Bersih</th><th>Slip & Email</th></tr></thead><tbody>'+rows.map(e=>'<tr><td>'+esc(e.row.full_name)+'<br>'+esc(e.row.department)+' · '+esc(e.row.branch_name)+'<br><small>ID: '+esc(e.row.employee_id)+'</small></td>'+['basic_salary','allowances','deductions','pph21','net_salary'].map(k=>'<td>'+(e.row.overtime!=null&&k==='allowances'?'Lembur '+esc(amount(e.row.overtime))+'<br>Bonus '+esc(amount(e.row.bonus)):e.row.overtime!=null&&k==='deductions'?'Absen '+esc(amount(e.row.absence_deduction))+'<br>Telat '+esc(amount(e.row.late_deduction))+'<br>Pelanggaran '+esc(amount(e.row.violation_deduction)):esc(amount(e.row[k])))+'</td>').join('')+'<td><button type="button" class="btn" data-employee-pdf="'+esc(e.id)+'">Unduh Slip</button><p>'+esc(e.row.email||'Email belum diisi saat impor')+'</p><p data-employee-delivery>'+esc(sendReason(e))+'</p><label><input type="checkbox" data-employee-consent="'+esc(e.id)+'"'+(!canSend(e)?' disabled':'')+'> Saya periksa penerima dan slip ini</label><button type="button" class="btn" data-employee-send="'+esc(e.id)+'" disabled>Kirim Email</button></td></tr>').join('')+'</tbody></table></div>'+(first.status==='DRAFT'?'<label><input type="checkbox" data-employee-publish-consent="'+esc(first.batch_id)+'"> Seluruh komponen dan penempatan karyawan sudah saya periksa</label><button type="button" class="btn primary" data-employee-publish="'+esc(first.batch_id)+'" disabled>Terbitkan Slip</button>':'')+'</article>';}).join(''):'<p>Belum ada slip gaji karyawan. Impor CSV untuk membuat draft.</p>';
   status.textContent=!ready.encryption?'Penyimpanan gaji belum siap. Hubungi pengelola.':!window.SipekaCompany?.name?'Simpan nama perusahaan pada formulir di atas sebelum mengimpor gaji.':!ready.email?'Slip dapat disiapkan. Layanan email belum siap.':'Periksa preview, terbitkan slip, lalu konfirmasi penerima untuk mengirim email.';
   syncButtons();
  }
  panel.addEventListener('change',e=>{if(e.target.matches('[data-employee-consent],[data-employee-publish-consent]'))syncButtons();});
  // Saving the company can make import available without discarding a selected CSV.
  document.addEventListener('sipeka-company-saved',()=>{if(current())load().catch(notice);},{signal:companyController.signal});
  panel.addEventListener('click',async e=>{
   const button=e.target.closest('button');if(!button||button.type==='submit'||button.disabled||!current())return;button.disabled=true;
   const operation=button.dataset.employeePublish||button.dataset.employeeSend,mutation=!!operation;if(mutation)busy.add(operation);
   try{
    if(button.hasAttribute('data-employee-refresh'))await load();
    if(button.hasAttribute('data-employee-template'))await download('/api/employee-payroll/template','template-gaji-karyawan.csv',current);
    if(button.dataset.employeePdf)await download('/api/employee-payroll/entries/'+button.dataset.employeePdf+'/slip.pdf','slip-gaji-karyawan.pdf',current);
    if(button.dataset.employeePublish){const row=entries.find(x=>x.batch_id===button.dataset.employeePublish);if(!row||!panel.querySelector('[data-employee-publish-consent="'+row.batch_id+'"]').checked)return;await api('/api/employee-payroll/publish',{method:'POST',body:{id:row.batch_id,preview_token:row.preview_token,confirmed:true}});if(current())await load();}
    if(button.dataset.employeeSend){const row=entries.find(x=>x.id===button.dataset.employeeSend);if(!canSend(row)||!panel.querySelector('[data-employee-consent="'+row.id+'"]').checked)return;status.textContent='Memproses pengiriman slip ke '+row.row.email+'…';const result=await api('/api/employee-payroll/entries/'+row.id+'/send',{method:'POST',body:{email:row.row.email,confirmed:true}});if(current()){await load();status.textContent=result.status==='sent'?'Layanan email menerima slip. Status ini belum menjamin masuk inbox.':'Status kirim perlu diperiksa. Muat ulang status sebelum tindakan berikutnya.';}}
   }catch(err){if(mutation&&current())try{await load();}catch{}if(mutation&&current())panel.querySelectorAll('[data-employee-consent],[data-employee-publish-consent]').forEach(c=>c.checked=false);notice(err);}finally{busy.delete(operation);if(current())syncButtons();if(button.isConnected&&!mutation)button.disabled=false;}
  });
  panel.querySelector('[data-employee-import]').onsubmit=async e=>{
   e.preventDefault();if(importing||!importReady()||!current())return;importing=true;syncButtons();
   try{const file=e.target.elements.csv.files[0];if(!file||file.size>1024*1024)throw Error('Pilih CSV maksimal 1 MB');const csv=await file.text();if(!current())return;await api('/api/employee-payroll/import',{method:'POST',body:{csv}});if(current()){await load();status.textContent='Draft tersimpan. Periksa seluruh komponen dan penempatan sebelum menerbitkan.';e.target.reset();}}catch(err){notice(err);}finally{importing=false;if(current())syncButtons();}
  };
  load().catch(notice);
 }
 window.SipekaEmployeePayroll={render,bind};
})();
