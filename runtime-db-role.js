'use strict';
// Staging has its own credential and database. Never share the production login.
function permitted(metadata,env=process.env){
 if(env.SIPEKA_ENVIRONMENT==='staging')return metadata?.role==='sipeka_stage_runtime'&&metadata.database==='sipeka_stage';
 return metadata?.role==='sipeka_runtime';
}
module.exports={permitted};
