'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
test('Widya receives actual account mapping and bounded transaction attribution without exposing unrelated data',()=>{
 const data=JSON.parse(require('../widya-account-context').build(Array.from({length:50},(_,i)=>({id:String(i),coa_id:'laundry',account_code:'4-1300',account_name:'Laundry',memo:'untrusted note',password:'private'})),[{id:'laundry',account_code:'4-1300',account_name:'Laundry',account_type:'REVENUE'},{id:'old',account_code:'5101',account_name:'Old',account_type:'EXPENSE'}]));
 assert.equal(data.transactions.length,40);assert.equal(data.transactions[0].account_id,'laundry');assert.equal(data.chart_of_accounts[0].group,'Pendapatan usaha');assert.equal(data.chart_of_accounts[1].legacy,true);assert.equal(data.chart_of_accounts[1].transaction_input_allowed,false);assert.equal(data.account_mapping.mode,'advisory_only');assert.ok(!JSON.stringify(data).includes('private'));
});
