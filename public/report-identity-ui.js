/* Embedded in financial-dashboard.html. Document identity lives only for this action. */
(function(host){
'use strict';
let pending=false;
const account=()=>String(host.SipekaCurrentUser?.id||'')+'|'+String(host.SipekaCurrentUser?.role||'');
function validate(value){const name=String(value??'').trim();if(!name||name.length>80||/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(name))throw Error('Isi Nama Perusahaan, 1–80 karakter tanpa karakter kontrol.');return name;}
async function request({branch='all',entryId,lockBranch=false}={}){
 if(pending)throw Error('Selesaikan dialog identitas yang sedang terbuka.');
 pending=true;const who=account(),trigger=host.document.activeElement;
 let dialog;
 try{
  const response=await host.fetch(entryId?'/api/payroll/entries/'+encodeURIComponent(entryId)+'/identity':'/api/units'+(host.SipekaCurrentUser?.role==='OWNER'?'?include_archived=1':''),{credentials:'same-origin',cache:'no-store'});
  if(!response.ok)throw Error('Identitas cabang tidak tersedia (HTTP '+response.status+').');
  const result=await response.json();if(who!==account())throw Error('Akun berubah; unduhan dibatalkan.');
  const units=entryId?[{id:result.branch_id,name:result.branch_name}]:result;
  if(!Array.isArray(units)||!units.length||units.some(u=>typeof u.id!=='string'||!u.id||typeof u.name!=='string'))throw Error('Cabang backend tidak tersedia.');
  if(entryId)branch=result.branch_id;
  const all=!entryId&&host.SipekaCurrentUser?.role==='OWNER';
  if(branch!=='all'&&!units.some(u=>u.id===branch))throw Error('Cabang sudah berubah; muat ulang laporan.');
  dialog=host.document.createElement('dialog');dialog.className='sipeka-document-identity';
  dialog.setAttribute('aria-labelledby','documentIdentityTitle');dialog.setAttribute('aria-describedby','documentIdentityHelp');
  dialog.innerHTML='<form novalidate><h2 id="documentIdentityTitle">Identitas dokumen</h2><p id="documentIdentityHelp">Nama perusahaan mengikuti pengaturan perusahaan. Pilih cakupan dokumen yang diperlukan.</p><label for="documentCompany">Nama Perusahaan</label><input id="documentCompany" name="company" required maxlength="80" autocomplete="off" aria-describedby="documentIdentityError"><label for="documentBranch">Cabang</label><select id="documentBranch" name="branch" required></select><p data-identity-note></p><p id="documentIdentityError" role="alert" aria-live="assertive"></p><div class="document-identity-actions"><button type="button" data-identity-cancel>Batal</button><button type="submit">Unduh dokumen</button></div></form>';
  const form=dialog.querySelector('form'),select=form.elements.branch;
  form.elements.company.value=host.SipekaCompany?.name||'';form.elements.company.readOnly=!!host.SipekaCompany?.name;
  if(all)select.add(new Option('Satu Perusahaan — Seluruh Cabang / Unit','all'));
  units.forEach(u=>select.add(new Option(u.name,u.id)));
  select.value=branch==='all'&&!all?units[0].id:branch;select.disabled=!!entryId||lockBranch;
  dialog.querySelector('[data-identity-note]').textContent=entryId?'Cabang mengikuti Staff penerima dan diperiksa kembali oleh server.':lockBranch?'Cabang mengikuti filter tabel yang sedang diekspor.':'Data laporan akan difilter sesuai cabang yang dipilih.';
  host.document.body.append(dialog);dialog.showModal();form.elements.company.focus();
  return await new Promise(resolve=>{
   const finish=value=>{dialog.close();resolve(value);};
   dialog.addEventListener('cancel',e=>{e.preventDefault();finish(null);});
   dialog.querySelector('[data-identity-cancel]').onclick=()=>finish(null);
   form.onsubmit=e=>{e.preventDefault();try{if(who!==account())throw Error('Akun berubah; batalkan dan muat ulang.');const company_name=validate(form.elements.company.value);form.elements.company.value=company_name;if(!select.value)throw Error('Pilih cabang.');finish({company_name,branch_id:select.value,branch_name:select.selectedOptions[0].textContent,branches:units});}catch(error){form.elements.company.setAttribute('aria-invalid','true');dialog.querySelector('#documentIdentityError').textContent=error.message;form.elements.company.focus();}};
  });
 }finally{dialog?.remove();pending=false;if(trigger?.isConnected)trigger.focus();}
}
host.SipekaDocumentIdentity={request,validate};
})(window);
