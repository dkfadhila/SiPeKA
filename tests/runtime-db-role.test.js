'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{permitted}=require('../runtime-db-role');
test('production retains exact runtime role; staging requires its dedicated role and exact separate DB',()=>{
 assert.equal(permitted({role:'sipeka_runtime',database:'sipeka'},{}),true);
 for(const role of ['postgres','sipeka_test','sipeka_stage_runtime'])assert.equal(permitted({role,database:'sipeka'},{}),false);
 const env={SIPEKA_ENVIRONMENT:'staging'};assert.equal(permitted({role:'sipeka_stage_runtime',database:'sipeka_stage'},env),true);
 for(const row of [{role:'sipeka_runtime',database:'sipeka_stage'},{role:'sipeka_stage_runtime',database:'sipeka'},{role:'sipeka_stage_runtime'},{role:'sipeka_test',database:'sipeka_stage'}])assert.equal(permitted(row,env),false);
 assert.equal(permitted({role:'sipeka_stage_runtime',database:'sipeka_stage'},{SIPEKA_ENVIRONMENT:'production'}),false);
});
