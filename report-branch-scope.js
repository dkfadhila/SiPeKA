"use strict";
function normalize(value){
 if(!Array.isArray(value)||value.length<2||value.length>100||value.some(v=>typeof v!=="string"||!v||v==="all"||v.length>120||/[\x00-\x1f\x7f]/.test(v))||new Set(value).size!==value.length)throw Error("REPORT_COMPARISON_BRANCHES_REQUIRED");
 return [...value].sort();
}
function includes(filters,id){return filters.branchIds?filters.branchIds.includes(String(id)):filters.branch==="all"||String(id)===filters.branch;}
function validate(filters,units){if(filters.branchIds&&filters.branchIds.some(id=>!units.some(u=>String(u.id)===id)))throw Object.assign(Error("REPORT_BRANCH_NOT_FOUND"),{statusCode:404});}
module.exports={normalize,includes,validate};
