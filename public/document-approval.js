/* Shared, Owner-approved document wording. This is a signature area, not an autograph. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.SipekaDocumentApproval=api;})(typeof window==='object'?window:globalThis,function(){
 'use strict';
 const wording=Object.freeze({
  prepared:'Dibuat & Disiapkan Oleh,',approved:'Disetujui & Disahkan Oleh,',
  department:'Finance & Accounting Department',company:'CV Artha Multi Ciptanusa',
  preparer:'WIDYA',approver:'RADITYA MARTANEGARA',
  preparerRole:'Head of Finance & Accounting (AI System)',approverRole:'Direktur',
  note:'*Dokumen ini disusun & diverifikasi secara otomatis oleh Sistem Akuntansi Widya AI (AMC Financial Ops).',
  responsibility:'Tanggung jawab hukum dan pengesahan dokumen berada sepenuhnya pada Direktur.'
 });
 function draw(doc,{top,margin=15}={}){
  const W=doc.internal.pageSize.getWidth(),H=doc.internal.pageSize.getHeight(),width=W-2*margin;
  const y=top??H-75,left=margin+width/4,right=margin+width*3/4;
  doc.setTextColor(30,30,30);doc.setFont('helvetica','bold');doc.setFontSize(10);
  doc.text(wording.prepared,left,y,{align:'center'});doc.text(wording.approved,right,y,{align:'center'});
  doc.setFont('helvetica','normal');doc.setFontSize(10);
  doc.text(wording.department,left,y+6,{align:'center'});doc.text(wording.company,right,y+6,{align:'center'});
  doc.setFont('helvetica','bold');doc.text('( '+wording.preparer+' )',left,y+32,{align:'center'});doc.text('( '+wording.approver+' )',right,y+32,{align:'center'});
  doc.setFont('helvetica','normal');doc.setFontSize(10);
  const role=doc.splitTextToSize(wording.preparerRole,width/2-8);doc.text(role,left,y+38,{align:'center',lineHeightFactor:1.15});doc.text(wording.approverRole,right,y+38,{align:'center'});
  const lineY=y+39+role.length*4;doc.setDrawColor(125,125,125);doc.setLineWidth(.2);doc.line(margin,lineY,W-margin,lineY);
  doc.setFontSize(10);let noteY=lineY+5;
  for(const sentence of [wording.note,wording.responsibility]){const lines=doc.splitTextToSize(sentence,width);doc.text(lines,margin,noteY,{lineHeightFactor:1.15});noteY+=lines.length*4.1;}
  return noteY;
 }
 return Object.freeze({wording,draw,height:67});
});
