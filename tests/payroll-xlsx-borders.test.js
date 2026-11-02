'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {workbook}=require('../payroll-workbook'),{unzip}=require('../report-template-xlsx');
function view(data){
 const files=unzip(data),styles=files.find(f=>f.name==='xl/styles.xml').data.toString(),xfs=[.../<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles)[1].matchAll(/<xf\b[^>]*\/>|<xf\b[^>]*>[\s\S]*?<\/xf>/g)].map(m=>m[0]),borders=[.../<borders\b[^>]*>([\s\S]*?)<\/borders>/.exec(styles)[1].matchAll(/<border\b[^>]*\/>|<border\b[^>]*>[\s\S]*?<\/border>/g)].map(m=>m[0]);
 const sheet=n=>files.find(f=>f.name==='xl/worksheets/sheet'+n+'.xml').data.toString();
 const cell=(n,ref)=>{const raw=new RegExp('<c\\b[^>]*\\br="'+ref+'"[^>]*(?:\\/>|>[\\s\\S]*?<\\/c>)').exec(sheet(n))?.[0];assert.ok(raw,ref);const id=Number(/\bs="(\d+)"/.exec(raw)?.[1]||0),xf=xfs[id];assert.ok(xf,ref+' style reference');return {raw,xf,border:borders[Number(/\bborderId="(\d+)"/.exec(xf)?.[1]||0)]};};
 assert.equal(Number(/<cellXfs count="(\d+)"/.exec(styles)[1]),xfs.length);assert.equal(Number(/<borders count="(\d+)"/.exec(styles)[1]),borders.length);
 for(const n of [1,2])for(const m of sheet(n).matchAll(/<c\b[^>]*\bs="(\d+)"/g))assert.ok(xfs[Number(m[1])],'every used style exists');
 return {sheet,cell};
}
test('general and laundry workbook table borders survive injected data without boxing letterhead or signature area',()=>{
 for(const type of ['general','laundry'])for(const rows of [[],[{period:'2026-10',employee_id:'002',full_name:'Karyawan Contoh',department:'Operasional',branch_name:'RedDoorz',document_code:'SLIP/RD-OPS/X/2026/002',basic_salary:3000000}]]){
  const v=view(workbook(type,rows));
  assert.match(v.cell(1,'B11').border,/<top style="medium"/);assert.match(v.cell(1,'G11').border,/<right style="medium"/);
  assert.match(v.cell(1,'B12').border,/<left style="thin"/);assert.doesNotMatch(v.cell(1,'B12').border,/<right style=/,'merged label has no interior divider');assert.match(v.cell(1,'C12').border,/<right style="thin"/);assert.match(v.cell(1,'D12').border,/<right style="medium"/);assert.match(v.cell(1,'G12').border,/<bottom style="thin"/);
  assert.match(v.cell(1,'D25').border,/<bottom style="double"/);assert.match(v.cell(1,'B27').border,/<top style="medium"/);assert.match(v.cell(1,'G29').border,/<bottom style="medium"/);
  assert.doesNotMatch(v.cell(1,'B2').border,/style="/);assert.doesNotMatch(v.cell(1,'B35').border,/style="/);
  assert.match(v.cell(1,'D7').xf,/wrapText="1"/);assert.match(v.sheet(1),/<row[^>]*r="7"[^>]*ht="32"/);
  assert.match(v.cell(1,'D12').raw,/<f>/);assert.match(v.cell(1,'B28').raw,/<f>/);assert.match(v.sheet(1),/ref="B12:C12"/);assert.match(v.sheet(1),/RADITYA MARTANEGARA/);
  for(const ref of ['A4','B5','J5','J6'])for(const edge of ['left','right','top','bottom'])assert.match(v.cell(2,ref).border,new RegExp('<'+edge+' style="'));
  assert.match(v.cell(2,'J5').xf,/numFmtId="3"/);assert.match(v.cell(2,'B5').xf,/numFmtId="200"/);assert.match(v.cell(2,'A4').xf,/horizontal="center"/);assert.match(v.cell(2,'A4').xf,/wrapText="1"/);
  if(rows.length){assert.match(v.cell(2,'J5').raw,/<v>3000000<\/v>/);assert.match(v.cell(2,'C5').raw,/<t[^>]*>002<\/t>/);assert.match(v.cell(2,'I5').raw,/SLIP\/RD-OPS\/X\/2026\/002/);assert.match(v.cell(2,'C5').xf,/fontId="6"/,'data injection preserves source font');}
 }
});
