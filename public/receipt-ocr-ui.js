'use strict';
(function(){
 function createReview({container,currentIdentity,apply}){
  if(!container||typeof currentIdentity!=='function'||typeof apply!=='function')throw new TypeError('Review identity and explicit field application required');
  const panel=document.createElement('section'),title=document.createElement('p'),fields=document.createElement('pre'),warnings=document.createElement('p'),check=document.createElement('input'),label=document.createElement('label'),button=document.createElement('button');
  title.textContent='Usulan OCR lokal — wajib periksa foto dan konfirmasi';check.type='checkbox';label.textContent='Saya sudah memeriksa nominal, tanggal, dan toko pada foto';button.type='button';button.tag='apply';button.textContent='Terapkan usulan ke kolom editable';button.disabled=true;panel.append(title,fields,warnings,check,label,button);container.append(panel);let proposal=null,binding=null,confirmed=false;
  function reset(){proposal=null;binding=null;confirmed=false;check.checked=false;button.disabled=true;fields.textContent='';warnings.textContent='';}
  check.addEventListener('change',()=>{confirmed=false;button.disabled=!check.checked;});
  button.addEventListener('click',()=>{if(binding!==currentIdentity()){reset();return;}if(!proposal||!check.checked)return;confirmed=true;apply({...proposal});});
  return Object.freeze({reset,show(result,identity){reset();if(typeof identity!=='string'||!identity||identity!==currentIdentity())return;binding=identity;proposal={amount:result?.suggestions?.amount??null,date:result?.suggestions?.date??null,merchant:result?.suggestions?.merchant??null};fields.textContent=['Nominal: '+(proposal.amount??'Perlu input manual'),'Tanggal: '+(proposal.date??'Perlu input manual'),'Toko: '+(proposal.merchant??'Perlu input manual')].join('\n');warnings.textContent=(Array.isArray(result?.warnings)?result.warnings:[]).map(String).join(', ');},isConfirmed(){return confirmed&&check.checked&&binding===currentIdentity();}});
 }
 window.SipekaReceiptOCR=Object.freeze({createReview});
})();
