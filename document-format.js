'use strict';
const ROMAN=['I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII'];
function departmentCode(department){const value=String(department||'').trim().toUpperCase();if(/^(OPERASIONAL|OPERATIONAL|OPERASI|OPERATIONS?|OPS)$/.test(value))return 'OPS';if(/^(HEAD\s*OFFICE|KANTOR\s*PUSAT|HO)$/.test(value))return 'HO';const letters=value.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^A-Z]/g,'');return letters.length>=2?letters.slice(0,3):'UMUM';}
function unitCode(unit){
 const name=String(unit.name||unit.branch_name||'').toUpperCase(),code=String(unit.code||unit.unit_code||'').trim().toUpperCase();
 // Frozen payroll snapshots already contain the authoritative unit code.
 // Only technical legacy UNIT_ codes need name-based compatibility mapping.
 if(code){if(code==='AMC'&&/HEAD\s*OFFICE|KANTOR\s*PUSAT/.test(name))return 'AMC';return require('./document-numbering').unitCode({id:unit.id,code,name});}
 // Compatibility for standalone/retired slip rendering without a unit object.
 if(name.includes('REDDOORZ'))return 'RD';if(/HEAD\s*OFFICE|KANTOR\s*PUSAT/.test(name))return 'AMC';
 const letters=name.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^A-Z]/g,'');return letters.length>=2?letters.slice(0,3):'AMC';
}
function slipCode(row){if(row.document_code)return row.document_code;const match=/^(\d{4})-(0[1-9]|1[0-2])$/.exec(String(row.period));if(!match)return null;const id=String(row.employee_code||row.employee_number||row.employee_id||row.user_id||row.username||'').trim();if(!/^[A-Za-z0-9_-]{1,128}$/.test(id)||/^[a-f0-9]{32}$/i.test(id)||/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(id))return null;const reg=/^\d+$/.test(id)?id.padStart(3,'0'):id,department=row.department_code||departmentCode(row.department);if(!/^[A-Z]{2,4}$/.test(department))throw Object.assign(Error('DOCUMENT_INVALID_DEPARTMENT'),{code:'DOCUMENT_INVALID_DEPARTMENT',status:400});return 'SLIP/'+unitCode(row)+'-'+department+'/'+ROMAN[Number(match[2])-1]+'/'+match[1]+'/'+reg;}
const filename=code=>String(code).replace(/[^A-Za-z0-9_-]/g,'-');
module.exports={slipCode,unitCode,departmentCode,filename};
