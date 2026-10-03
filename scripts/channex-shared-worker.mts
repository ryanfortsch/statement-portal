/** Dedicated staging process. No production routes, cron configuration or calendar publisher. */
import {setTimeout as sleep} from 'node:timers/promises';
import {ChannexStagingClient} from '../src/lib/channex-staging/client.ts';
import {createSharedOwnershipStore} from '../src/lib/channex-staging/shared-ownership-store.ts';
import {createWorkerHealthStore} from '../src/lib/channex-staging/worker-health-store.ts';
import {reportWorkerHealth} from '../src/lib/channex-staging/worker-health.ts';
import {syncSharedRevisions} from '../src/lib/channex-staging/shared-sync.ts';
if(process.env.CHANNEX_WORKER_MODE!=='isolated-staging')throw new Error('Explicit staging worker mode required');
const store=createSharedOwnershipStore(process.env.CHANNEX_STAGING_DB_URL??'',process.env.CHANNEX_STAGING_DB_SERVICE_KEY??'');
const client=new ChannexStagingClient(process.env.CHANNEX_STAGING_API_KEY??'');
const health=createWorkerHealthStore(process.env.CHANNEX_STAGING_DB_URL??'',process.env.CHANNEX_STAGING_DB_SERVICE_KEY??'');
let stopping=false,failures=0,lastSuccess:string|null=null;
const shutdown=new AbortController();
for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,()=>{stopping=true;shutdown.abort();});
while(!stopping){
 try{
  await store.read(); // Never initialize or replace missing history automatically.
  const result=await syncSharedRevisions(store,client);
  failures=0;lastSuccess=new Date().toISOString();
  console.log(JSON.stringify({event:'sync-success',at:lastSuccess,...result}));
 }catch{
  failures++;
  // Do not print credentials, provider payloads or arbitrary exception messages.
  console.error(JSON.stringify({event:'sync-failed',at:new Date().toISOString(),failures,lastSuccess,message:'History retained; ACK may be partial; retry scheduled'}));
 }
 if(!await reportWorkerHealth(health.record,failures===0))console.error(JSON.stringify({event:'health-save-failed',at:new Date().toISOString()}));
 if(process.env.CHANNEX_WORKER_ONCE==='yes')break;
 const delay=Math.min(60000*2**Math.min(failures,4),900000);
 try{await sleep(delay,undefined,{signal:shutdown.signal});}catch{if(!stopping)throw new Error('Worker timer failed');}
}
if(failures)process.exitCode=1;
