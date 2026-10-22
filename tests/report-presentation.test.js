'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {make}=require('../report-template'),{compact,columnsAndRows}=require('../report-presentation'),{exportXlsx,unzip}=require('../report-template-xlsx');
const filters={branch:'all',dateFrom:'2026-10-01',dateTo:'2026-10-22'},units=[{id:'a',name:'Unit A'}];
const source={rows:[{branch_id:'a',account_code:'4-1300',income:'900719925474099100',expense:'0'},{branch_id:'a',account_code:'5-1100',income:'0',expense:'750000'},{branch_id:'a',account_code:'6-1200',income:'0',expense:'100'},{branch_id:'a',account_code:'6-1300',income:'0',expense:'200'}]};
const build=(id='profit-loss',rows=source,us=units)=>compact(make(id,rows,{rows:[]},us,filters),id);
test('simple P&L keeps exact account-derived amounts, combines costs and preserves unknown accruals',()=>{
 const layout=build(),row=label=>layout.grid.find(r=>r[0]===label);
 assert.equal(layout.grid[5].length,2);assert.equal(row('Total Pendapatan')[1],'900719925474099100');assert.equal(row('TOTAL LABA KOTOR')[1],'900719925473349100');assert.equal(row('Biaya komisi dan pemasaran')[1],'300');assert.equal(row('Total Harga Pokok Penjualan')[1],'-750000');assert.equal(row('Biaya penyusutan')[1],null);assert.equal(row('LABA/(RUGI) BERSIH')[1],null);
 assert.doesNotMatch(JSON.stringify(layout.grid),/\d-\d{4}|Kode|Margin/);
 assert.equal(source.rows[0].account_code,'4-1300');
});
test('stafel balance presents debit/credit without inventing missing balances',()=>{
 const layout=build('fund-position',{rows:[]});assert.deepEqual(layout.grid[5],['Keterangan','Debet (Rp)','Kredit (Rp)']);
 for(const label of ['AKTIVA','Aktiva Lancar','Aktiva Tetap','PASIVA','Kewajiban','Ekuitas','TOTAL'])assert.ok(layout.grid.some(r=>r[0]===label));
 assert.ok(layout.grid.slice(6).every(r=>r.slice(1).every(v=>v===null||v==='')));assert.match(layout.notes.join(' '),/belum tersedia/);assert.doesNotMatch(JSON.stringify(layout.grid),/SEIMBANG|\d-\d{4}/);assert.deepEqual(layout.grid.find(r=>r[0]==='Kas dan bank').slice(1),[null,'']);assert.deepEqual(layout.grid.find(r=>r[0]==='Modal').slice(1),['',null]);
});
test('comparison CSV includes every unit and total across panels; XLSX contains no account codes or colored templates',()=>{
 const us=Array.from({length:8},(_,i)=>({id:'u'+i,name:'Unit '+i})),rows={rows:us.map(u=>({branch_id:u.id,account_code:'4-1300',income:'100',expense:'0'}))};
 const layout=build('compare-profit-loss',rows,us),data=columnsAndRows(layout);
 assert.equal(layout.continuations.length,1);assert.equal(data.columns.length,10);assert.deepEqual(data.rows.find(r=>r.item==='Total Pendapatan'),Object.fromEntries([['item','Total Pendapatan'],...Array.from({length:8},(_,i)=>['amount_'+(i+1),'100']),['amount_9','800']]));
 const csv=require('../operational-reports').toCsv({templateLayout:layout});assert.match(csv,/800/);assert.doesNotMatch(csv,/account_code|account_name|4-1300/);
 const files=unzip(exportXlsx(layout,'PT Uji & Aman')),xml=files.map(f=>f.data.toString()).join('');assert.match(xml,/PT Uji &amp; Aman/);assert.match(xml,/Unit 7/);assert.doesNotMatch(xml,/4-1300|FF1F3864|FFFFFF99|<f[ >]/);assert.match(xml,/Belum tersedia/);
});
test('historical mapping notice does not expose account identifiers and all embedded scripts parse',()=>{
 const layout=build('profit-loss',{rows:[{account_code:'5101',account_name:'SECRET ACCOUNT',income:'0',expense:'10'}]});assert.doesNotMatch(layout.notes.join(' '),/5101|SECRET ACCOUNT/);assert.match(layout.notes.join(' '),/belum dipetakan/);
 const html=fs.readFileSync('public/financial-dashboard.html','utf8');let count=0;for(const match of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)){if(match[1].trim()){new vm.Script(match[1]);count++;}}assert.ok(count>10);assert.ok(html.includes(fs.readFileSync('public/report-template-pdf.js','utf8').trim()));
});
