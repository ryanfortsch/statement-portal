/** Dedicated opt-in reader. Never launched by the synthetic worker Dockerfile. */
import {setTimeout as sleep} from 'node:timers/promises';
import {requireAirbnbIngestion,ingestAirbnbMessages} from '../src/lib/channex-staging/airbnb-ingestion.ts';
import {ChannexPilotReader} from '../src/lib/channex-staging/pilot-reader.ts';
import {createMessageStore} from '../src/lib/channex-staging/message-store.ts';
requireAirbnbIngestion(process.env);
const reader=new ChannexPilotReader(process.env.CHANNEX_STAGING_API_KEY??'');
const store=createMessageStore(process.env.CHANNEX_STAGING_DB_URL??'',process.env.CHANNEX_STAGING_DB_SERVICE_KEY??'','airbnb');
let stopping=false;const shutdown=new AbortController();
for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,()=>{stopping=true;shutdown.abort();});
while(!stopping){
 for(const unit of ['front','back'] as const){
  if(stopping)break;
  try{const result=await ingestAirbnbMessages(store,reader,unit);console.log(JSON.stringify({event:'airbnb-read-success',unit,...result}));}
  catch{console.error(JSON.stringify({event:'airbnb-read-failed',unit}));try{await store.failure(unit);}catch{console.error(JSON.stringify({event:'airbnb-health-failed',unit}));}if(process.env.CHANNEX_WORKER_ONCE==='yes')process.exitCode=1;}
 }
 if(process.env.CHANNEX_WORKER_ONCE==='yes')break;
 try{await sleep(60000,undefined,{signal:shutdown.signal});}catch{if(!stopping)throw Error('Reader timer failed');}
}
