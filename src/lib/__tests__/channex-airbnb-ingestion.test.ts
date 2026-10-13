import {test} from 'node:test';
import assert from 'node:assert/strict';
import {requireAirbnbIngestion,ingestAirbnbMessages} from '../channex-staging/airbnb-ingestion.ts';
import {createMessageStore} from '../channex-staging/message-store.ts';
import {emptyMessageArchive} from '../channex-staging/message-sync.ts';
test('Airbnb reader cannot start under synthetic or incomplete activation',()=>{
 for(const env of [{},{CHANNEX_WORKER_MODE:'isolated-staging'},{CHANNEX_WORKER_MODE:'airbnb-read-only'}])assert.throws(()=>requireAirbnbIngestion(env),/activation/);
 assert.doesNotThrow(()=>requireAirbnbIngestion({CHANNEX_WORKER_MODE:'airbnb-read-only',CHANNEX_AIRBNB_MAPPING_VERIFIED:'17-beach-front-back'}));
});
test('message store chooses disjoint tables and RPCs for each source',async()=>{
 const original=globalThis.fetch;const urls:string[]=[];
 globalThis.fetch=async(input)=>{const url=String(input);urls.push(url);return Response.json(url.includes('/rpc/')?true:{version:0,archive:emptyMessageArchive(),last_attempt:null});};
 try{
  for(const source of ['synthetic','airbnb'] as const){
   const store=createMessageStore('https://jgkblfozftcvymvwhhii.supabase.co','synthetic-test-key',source);
   await store.read('front');await store.save('front',0,emptyMessageArchive());await store.failure('front');
  }
  assert.match(urls[0],/helm_pilot_message_state/);assert.match(urls[1],/helm_pilot_save_messages/);assert.match(urls[2],/helm_pilot_message_failure/);
  assert.match(urls[3],/helm_airbnb_message_state/);assert.match(urls[4],/helm_airbnb_save_messages/);assert.match(urls[5],/helm_airbnb_message_failure/);
 }finally{globalThis.fetch=original;}
});
test('Airbnb ingestion saves through supplied isolated store and retains failure atomicity',async()=>{
 let writes=0;const store={read:async()=>({version:0,archive:emptyMessageArchive()}),save:async()=>{writes++;return true;}};
 await ingestAirbnbMessages(store,{readMessages:async()=>({threads:[],messages:[],selectedThread:null})},'back');assert.equal(writes,1);
 await assert.rejects(()=>ingestAirbnbMessages(store,{readMessages:async()=>{throw Error('unavailable');}},'back'));assert.equal(writes,1);
});
