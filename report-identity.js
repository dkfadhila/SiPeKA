'use strict';
// Request-only document metadata; never written to business_units or payroll payloads.
function companyName(value) {
  if (typeof value !== 'string') throw invalid();
  const name = value.trim();
  if (!name || name.length > 80 || /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(name)) throw invalid();
  return name;
}
function invalid() { return Object.assign(new Error('PAYROLL_DOCUMENT_COMPANY_INVALID'), {code:'PAYROLL_DOCUMENT_COMPANY_INVALID',status:400}); }
function documentQuery(params) {
  if (params.getAll('company_name').length !== 1 || params.getAll('branch_id').length !== 1 || [...params.keys()].some(k=>!['company_name','branch_id'].includes(k))) throw invalid();
  const company_name = companyName(params.get('company_name'));
  const branch_id = params.get('branch_id');
  if (!branch_id || branch_id.length > 128 || branch_id === 'all') throw Object.assign(new Error('PAYROLL_DOCUMENT_BRANCH_INVALID'),{code:'PAYROLL_DOCUMENT_BRANCH_INVALID',status:400});
  return {company_name,branch_id};
}
module.exports={companyName,documentQuery};
