const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('fs'),vm=require('vm');
test('Both manual and scanned transaction bridges can resolve selected COA type across script scopes',()=>{
 const html=fs.readFileSync('public/financial-dashboard.html','utf8'),catalog=fs.readFileSync('public/coa-input-ui.js','utf8');
 for(const source of [catalog,[...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]).find(s=>s.includes('window.SipekaCoaInput={options,field,bind,selectedType}'))]){
  assert.ok(source);let selection={value:'income',selectedOptions:[{dataset:{accountType:'REVENUE'}}]};const ctx={window:{},document:{getElementById:()=>selection}};vm.runInNewContext(source,ctx);assert.equal(ctx.window.SipekaCoaInput.selectedType('mn'),'INCOME');selection.selectedOptions[0].dataset.accountType='EXPENSE';assert.equal(ctx.window.SipekaCoaInput.selectedType('sc'),'EXPENSE');selection.value='';assert.throws(()=>ctx.window.SipekaCoaInput.selectedType('mn'),/Pilih kode akun/);
 }
 assert.match(html,/txType=window\.SipekaCoaInput\.selectedType\('mn'\)/);assert.match(html,/txType=window\.SipekaCoaInput\.selectedType\('sc'\)/);
});
