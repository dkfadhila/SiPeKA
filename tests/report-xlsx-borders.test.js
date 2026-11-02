'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {make}=require('../report-template'),{compact,scoped}=require('../report-presentation'),{exportXlsx,unzip}=require('../report-template-xlsx');
const filters={branch:'all',dateFrom:'2026-10-01',dateTo:'2026-10-31'},units=Array.from({length:8},(_,i)=>({id:'u'+i,name:'Unit '+(i+1)}));
function files(layout){return unzip(exportXlsx(layout,'CV Artha Multi Ciptanusa'));}
function styles(entries){const xml=entries.find(f=>f.name==='xl/styles.xml').data.toString();const xfs=xml.match(/<cellXfs[^>]*>([\s\S]*?)<\/cellXfs>/)[1].match(/<xf\b[^>]*(?:\/>|>[\s\S]*?<\/xf>)/g),borders=xml.match(/<borders[^>]*>([\s\S]*?)<\/borders>/)[1].match(/<border\/>|<border>[\s\S]*?<\/border>/g);assert.equal(Number(xml.match(/<cellXfs count="(\d+)"/)[1]),xfs.length);assert.equal(Number(xml.match(/<borders count="(\d+)"/)[1]),borders.length);return {xml,xfs,borders};}
function cell(sheet,ref){const m=sheet.match(new RegExp('<c r="'+ref+'" s="(\\d+)"[^>]*>([\\s\\S]*?)<\\/c>'));assert.ok(m,'cell '+ref);return {style:Number(m[1]),xml:m[0],value:m[2]};}
function boxed(sheet,ref,styleData){const c=cell(sheet,ref),xf=styleData.xfs[c.style],border=styleData.borders[Number(xf.match(/borderId="(\d+)"/)[1])];for(const edge of ['left','right','top','bottom'])assert.match(border,new RegExp('<'+edge+' style="(?:thin|double)"'),'boxed '+ref+' '+edge);return {c,xf,border};}
test('Neraca and continuation panels have full gray table grids, stronger totals and right-aligned unavailable values',()=>{
 const f={...filters,viewMode:'comparison'},layout=scoped(make('fund-position',{rows:[]},null,units,f),'fund-position',{rows:[]},null,units,f),entries=files(layout),styleData=styles(entries);
 const parts=[layout,...layout.continuations];assert.equal(parts.length,3);assert.doesNotMatch(styleData.xml,/FF1F3864|FFFFFF99/);
 for(const [i,part]of parts.entries()){
  const sheet=entries.find(f=>f.name==='xl/worksheets/sheet'+(i+1)+'.xml').data.toString(),width=part.grid[5].length;
  for(let r=5;r<part.grid.length;r++)for(let c=0;c<width;c++)boxed(sheet,require('../report-template').col(c)+(r+1),styleData);
  assert.match(boxed(sheet,'A6',styleData).xf,/horizontal="center"/);
  const detail=part.grid.findIndex(row=>row[0]==='Kas dan bank')+1,subtotal=part.grid.findIndex(row=>row[0]==='Total Aktiva Lancar')+1,total=part.rowTypes.lastIndexOf('total')+1;
  assert.match(boxed(sheet,'A'+detail,styleData).xf,/indent="2"/);assert.match(boxed(sheet,'A'+subtotal,styleData).xf,/indent="1"/);
  const missing=boxed(sheet,'B'+detail,styleData);assert.match(missing.xf,/horizontal="right"/);assert.match(missing.xf,/wrapText="1"/);assert.match(missing.c.value,/Belum tersedia/);
  assert.match(boxed(sheet,'A'+total,styleData).border,/<bottom style="double"/);
  for(const ref of ['A1','A2','A3','A4'])assert.match(styleData.xfs[cell(sheet,ref).style],/borderId="0"/,'unboxed letterhead '+ref);
 }
 const notes=entries.at(-1).data.toString();for(const m of notes.matchAll(/<c r="[A-Z]+\d+" s="(\d+)"/g))assert.match(styleData.xfs[Number(m[1])],/borderId="0"/,'notes stay unboxed');
});
test('full P&L keeps formulas, exact large integers and clean signature borders while styling totals separately',()=>{
 const source={rows:[{branch_id:'u0',account_code:'4-1300',income:'900719925474099100',expense:'0'}]},raw=make('company-profit-loss',source,{filters,rows:[]},units,filters),layout=compact(raw,'company-profit-loss',{excel:true}),entries=files(layout),s=styles(entries),sheet=entries.find(f=>f.name==='xl/worksheets/sheet1.xml').data.toString();
 const detail=layout.grid.findIndex(row=>row[0]==='Pendapatan Jasa')+1;
 const large=[...sheet.matchAll(/<c r="([A-Z]+\d+)" s="(\d+)" t="inlineStr"><is><t xml:space="preserve">900719925474099100<\/t>/g)];assert.ok(large.length);for(const m of large)assert.match(s.xfs[Number(m[2])],/horizontal="right"/);
 assert.match(sheet,/<f>IF\(COUNT/);assert.match(sheet,/Dibuat &amp; Disiapkan Oleh,/);assert.match(sheet,/RADITYA MARTANEGARA/);
 for(const m of sheet.matchAll(/<row r="(\d+)"[^>]*>([\s\S]*?)<\/row>/g))if(Number(m[1])>layout.grid.length){for(const c of m[2].matchAll(/<c\b[^>]*\bs="(\d+)"/g)){const border=Number(s.xfs[Number(c[1])].match(/borderId="(\d+)"/)[1]);assert.ok(border===0||border===2,'signature area has no grid');}}
 assert.ok(detail>=0);
});
test('cash-flow source detail table has a rectangular grid without boxing its notes',()=>{
 const layout=compact(make('cash-flow',{rows:[]},null,units,filters),'cash-flow',{excel:true});layout.supportingRows=[['Unit 1','Pendapatan','123','0']];const entries=files(layout),s=styles(entries),detail=entries.find(f=>f.name==='xl/worksheets/sheet2.xml').data.toString();
 for(const ref of ['A6','B6','C6','D6','A7','B7','C7','D7'])boxed(detail,ref,s);
 assert.match(boxed(detail,'C7',s).xf,/horizontal="right"/);
});
