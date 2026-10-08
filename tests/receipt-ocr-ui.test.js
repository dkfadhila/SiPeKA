'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
test('UI only renders proposals; explicit photo confirmation applies; changed identity blocks stale review',()=>{
 const window={};const document={createElement:()=>({children:[],append(...children){this.children.push(...children);},addEventListener(event,fn){this[event]=fn;},textContent:'',checked:false,disabled:false})};
 vm.runInNewContext(fs.readFileSync(require.resolve('../public/receipt-ocr-ui.js'),'utf8'),{window,document});
 const container=document.createElement('div');let identity='session:staff:b:key:1',applied=0;const panel=window.SipekaReceiptOCR.createReview({container,currentIdentity:()=>identity,apply:values=>{applied++;assert.equal(values.amount,'125000');}});
 panel.show({suggestions:{amount:'125000',date:null,merchant:'<script>evil</script>'},warnings:['DATE_NOT_FOUND']},identity);
 assert.equal(applied,0);const checkbox=container.children[0].children.find(el=>el.type==='checkbox');const button=container.children[0].children.find(el=>el.tag==='apply');
 button.click();assert.equal(applied,0);checkbox.checked=true;button.click();assert.equal(applied,1);
 panel.show({suggestions:{amount:'125000'},warnings:[]},identity);checkbox.checked=true;identity='session:staff:other:key:2';button.click();assert.equal(applied,1);
});
