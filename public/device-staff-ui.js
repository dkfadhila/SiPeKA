/* Device identity is authentication; the on-duty person is explicit per-tab attribution. */
(()=>{'use strict';
 let rows=[],choice=null,identity=null,error='';
 const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const api=(...args)=>window.SipekaAuth.api(...args);
 const redraw=()=>window.__sipekaApplyState(window.__sipekaRole,window.__sipekaBranch);
 async function load(user){
  const key=user.id+':'+user.branch_id;if(identity!==key){choice=null;identity=key;}error='';
  try{rows=await api('/api/operational-staff');if(identity!==key)return;
   if(choice&&!rows.some(r=>r.id===choice.id&&r.revision===choice.revision&&r.active)){choice=null;error='Daftar Staff berubah. Pilih ulang sebelum melanjutkan.';}
  }catch(e){rows=[];choice=null;error='Direktori Staff tidak tersedia. Operasi diblokir.';}
 }
 function selector(){if(window.SipekaCurrentUser?.role!=='STAFF')return '';
  return '<section class="card device-staff" aria-label="Staff bertugas"><label for="onDutyStaff">Staff bertugas di unit ini</label><select id="onDutyStaff" class="control" required><option value="">Pilih Staff sebelum transaksi</option>'+rows.filter(r=>r.active).map(r=>'<option value="'+esc(r.id)+'"'+(choice?.id===r.id?' selected':'')+'>'+esc(r.name)+'</option>').join('')+'</select><p role="status">'+esc(error||(!rows.length?'Owner perlu menambahkan Staff aktif untuk unit ini.':choice?'Bertugas: '+choice.name+'. Pilihan hanya berlaku di tab ini.':'Akun ini adalah device unit. Pilih nama Anda; pergantian hanya memengaruhi operasi berikutnya.'))+'</p></section>';
 }
 function branches(selected){return (window.SipekaUnits||[]).map(u=>'<option value="'+esc(u.id)+'"'+(u.id===selected?' selected':'')+'>'+esc(u.name)+'</option>').join('');}
 function form(r){return '<form data-staff-edit="'+esc(r?.id||'')+'" class="device-staff-form"><label>Nama Staff<input name="name" class="control" maxlength="120" required value="'+esc(r?.name||'')+'"></label><label>Unit bisnis<select name="branch_id" class="control" required>'+branches(r?.branch_id)+'</select></label><label>Status<select name="active" class="control"><option value="true">Aktif</option><option value="false"'+(r&&!r.active?' selected':'')+'>Nonaktif</option></select></label><button class="btn" type="submit">'+(r?'Simpan Staff':'Tambah Staff')+'</button></form>';}
 function directory(){if(window.SipekaCurrentUser?.role!=='OWNER')return '';
  return '<section class="card device-staff"><h2>Direktori Staff per Unit Bisnis</h2><p>Staff tidak memiliki akun login. Nama saat operasi disimpan permanen; perubahan dan nonaktif tidak mengubah riwayat.</p>'+form(null)+rows.map(form).join('')+'<p role="status" id="staffDirectoryMessage">'+esc(error)+'</p><h2>Konfigurasi Device</h2><p>Akun lama tetap dapat digunakan sebagai device. Username, password, dan ID tidak berubah.</p>'+(window.SipekaAllUsersList||[]).filter(u=>u.role==='STAFF').map(u=>'<form data-device-edit="'+esc(u.id)+'" class="device-staff-form"><strong>@'+esc(u.username)+'</strong><label>Label device<input class="control" name="name" maxlength="120" required value="'+esc(u.full_name)+'"></label><label>Unit bisnis<select class="control" name="branch_id">'+branches(u.assigned_branch_id)+'</select></label><button class="btn">Simpan Device</button></form>').join('')+'</section>';
 }
 function headers(path,method){if(method!=='POST'||window.SipekaCurrentUser?.role!=='STAFF'||!(/^\/api\/(transactions|closing|approvals|receipts\/upload)$/.test(path)||path.startsWith('/api/advances/')))return {};
  if(!choice)throw Error('Pilih Staff bertugas sebelum mengirim operasi.');
  return {'X-Operational-Staff':choice.id,'X-Operational-Revision':String(choice.revision)};
 }
 document.addEventListener('change',e=>{if(e.target.id!=='onDutyStaff')return;choice=rows.find(r=>r.id===e.target.value)||null;error='';window.SipekaPrivateReceipts?.clearUploads();redraw();});
 document.addEventListener('submit',async e=>{const form=e.target;if(!form.matches('[data-staff-edit],[data-device-edit]'))return;e.preventDefault();const button=form.querySelector('button');button.disabled=true;
  try{const body=Object.fromEntries(new FormData(form));let path='/api/operational-staff';if(form.hasAttribute('data-device-edit')){path='/api/devices/configure';body.device_id=form.dataset.deviceEdit;}else{body.active=body.active==='true';if(form.dataset.staffEdit){body.id=form.dataset.staffEdit;body.revision=rows.find(r=>r.id===body.id)?.revision;}}
   await api(path,{method:'POST',body});await window.SipekaAuth.bootstrap(window.SipekaCurrentUser);redraw();
  }catch(e){document.getElementById('staffDirectoryMessage').textContent=e.message;}finally{button.disabled=false;}
 });
 window.SipekaDeviceStaff={load,selector,directory,headers,reset(){identity=null;choice=null;rows=[];error='';}};
})();
