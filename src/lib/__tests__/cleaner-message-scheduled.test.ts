import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cleanerConfig, runScheduledCleanerMessages } from '../cleaner-messaging/scheduled.ts';
const id='00000000-0000-0000-0000-000000000001';
const config={propertyId:'HELMTEST-home',apiKey:'HELMTEST-key'};
test('cleaner runtime requires explicit enable and scoped property with existing Quo key',()=>{
 const env={CLEANER_MESSAGES_PROPERTY_ID:config.propertyId,QUO_API_KEY:config.apiKey};
 for(const flag of [undefined,'false','1','TRUE'])assert.equal(cleanerConfig({...env,CLEANER_MESSAGES_ENABLED:flag}),null);
 assert.deepEqual(cleanerConfig({...env,CLEANER_MESSAGES_ENABLED:'true'}),config);
 assert.throws(()=>cleanerConfig({CLEANER_MESSAGES_ENABLED:'true'}),/configuration incomplete/);
});
test('disabled and wrong property call neither database nor provider',async()=>{
 for(const override of [{config:null},{propertyId:'HELMTEST-other'}]){
  let calls=0;await runScheduledCleanerMessages({config,rpc:async()=>{calls++;throw Error('unexpected');},...override});assert.equal(calls,0);
 }
});
test('dry run loads only bounded candidate IDs',async()=>{
 const names:string[]=[];const result=await runScheduledCleanerMessages({config,dry:true,rpc:async(name)=>{names.push(name);return {data:[id],error:null};}});
 assert.equal(result.candidates,1);assert.deepEqual(names,['automation_cleaner_candidates']);
});
test('malformed and cross-property snapshots fail closed without exposing raw values',async()=>{
 for(const data of [{private:'HELMTEST-secret'},null,{propertyId:'HELMTEST-other'}]){
  const result=await runScheduledCleanerMessages({config,rpc:async(name)=>({data:name==='automation_cleaner_candidates'?[id]:data,error:null}),
   transport:{send:async()=>{throw Error('must not send');},receipt:async()=>{throw Error('must not read');}}});
  assert.equal(result.blocked,1);assert.equal(JSON.stringify(result).includes('HELMTEST-secret'),false);
 }
});
