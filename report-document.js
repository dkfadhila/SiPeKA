'use strict';
function attach(report,document){const code=document.code;const clone=structuredClone(report);clone.documentCode=code;clone.document_id=document.id;clone.documentIdentity={...(clone.documentIdentity||{}),document_code:code,document_id:document.id};
 const apply=layout=>{if(!layout)return;layout.documentCode=code;layout.grid[4]=['Kode dokumen: '+code];if(layout.spec?.rows)layout.spec.rows[4]=[{value:'Kode dokumen: '+code,bold:false,format:'General'}];for(const child of layout.continuations||[])apply(child);apply(layout.excelLayout);};apply(clone.templateLayout);return clone;}
module.exports={attach};
