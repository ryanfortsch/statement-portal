/** Dedicated staging process. No production routes or cron configuration. Inventory publishing is separately gated. */
import {setTimeout as sleep} from 'node:timers/promises';
import {ChannexStagingClient} from '../src/lib/channex-staging/client.ts';
import {createSharedOwnershipStore} from '../src/lib/channex-staging/shared-ownership-store.ts';
import {createWorkerHealthStore} from '../src/lib/channex-staging/worker-health-store.ts';
import {reportWorkerHealth} from '../src/lib/channex-staging/worker-health.ts';
import {createMessageStore} from '../src/lib/channex-staging/message-store.ts';
import {syncPilotMessages} from '../src/lib/channex-staging/message-sync.ts';
import {cleanerReceiptsEnabled} from '../src/lib/calderwood-rehearsal/cleaner-receipt-runtime.ts';
import {createCleanerReceiptPageRunner,runCleanerReceiptScheduler} from '../src/lib/calderwood-rehearsal/cleaner-receipt-scheduler.ts';
import {canonicalPollingEnabled,createCanonicalRevisionPageRunner,runCanonicalRevisionScheduler} from '../src/lib/channex-staging/canonical-revision-scheduler.ts';
import {inventoryPollingEnabled,createInventoryCycleRunner,runInventoryScheduler} from '../src/lib/channex-staging/booking-inventory-scheduler.ts';
import {syncSharedRevisions} from '../src/lib/channex-staging/shared-sync.ts';
if(process.env.CHANNEX_WORKER_MODE!=='isolated-staging')throw new Error('Explicit staging worker mode required');
const store=createSharedOwnershipStore(process.env.CHANNEX_STAGING_DB_URL??'',process.env.CHANNEX_STAGING_DB_SERVICE_KEY??'');
const client=new ChannexStagingClient(process.env.CHANNEX_STAGING_API_KEY??'');
const health=createWorkerHealthStore(process.env.CHANNEX_STAGING_DB_URL??'',process.env.CHANNEX_STAGING_DB_SERVICE_KEY??'');
if(process.env.CHANNEX_CLEANER_RECEIPTS_ENABLED==='true'&&!cleanerReceiptsEnabled(process.env,'worker'))throw new Error('Receipt worker configuration rejected');
const receiptPage=cleanerReceiptsEnabled(process.env,'worker')?createCleanerReceiptPageRunner(process.env):null;
if(process.env.CHANNEX_CANONICAL_POLLING_ENABLED==='true'&&!canonicalPollingEnabled(process.env))throw new Error('Canonical polling configuration rejected');
const canonicalPage=canonicalPollingEnabled(process.env)?createCanonicalRevisionPageRunner(process.env):null;
if(process.env.CHANNEX_CALDERWOOD_INVENTORY_ENABLED==='true'&&!inventoryPollingEnabled(process.env))throw new Error('Inventory worker configuration rejected');
const inventoryCycle=inventoryPollingEnabled(process.env)?createInventoryCycleRunner(process.env):null;
let stopping=false,failures=0,lastSuccess:string|null=null;
const shutdown=new AbortController();
for(const signal of ['SIGINT','SIGTERM'] as const)process.on(signal,()=>{stopping=true;shutdown.abort();});
async function bookingLoop(){
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
}
async function messageLoop(){
 const messages=createMessageStore(process.env.CHANNEX_STAGING_DB_URL??'',process.env.CHANNEX_STAGING_DB_SERVICE_KEY??'');
 while(!stopping){
  for(const unit of ['front','back'] as const){
   if(stopping)break;
   try{const result=await syncPilotMessages(messages,client,unit);console.log(JSON.stringify({event:'message-sync-success',unit,...result}));}
   catch{console.error(JSON.stringify({event:'message-sync-failed',unit}));try{await messages.failure(unit);}catch{console.error(JSON.stringify({event:'message-health-save-failed',unit}));}if(process.env.CHANNEX_WORKER_ONCE==='yes')process.exitCode=1;}
  }
  if(process.env.CHANNEX_WORKER_ONCE==='yes')break;
  try{await sleep(60000,undefined,{signal:shutdown.signal});}catch{if(!stopping)throw new Error('Message timer failed');}
 }
}
async function receiptLoop(){
 if(!receiptPage)return;
 const result=await runCleanerReceiptScheduler({drainPage:receiptPage,signal:shutdown.signal,
  once:process.env.CHANNEX_WORKER_ONCE==='yes',log:entry=>console.log(JSON.stringify(entry))});
 if(result.failed&&process.env.CHANNEX_WORKER_ONCE==='yes')process.exitCode=1;
}
async function canonicalLoop(){
 if(!canonicalPage)return;
 const result=await runCanonicalRevisionScheduler({drainPage:canonicalPage,signal:shutdown.signal,
  once:process.env.CHANNEX_WORKER_ONCE==='yes',log:entry=>console.log(JSON.stringify(entry))});
 if(result.failed&&process.env.CHANNEX_WORKER_ONCE==='yes')process.exitCode=1;
}
async function inventoryLoop(){
 if(!inventoryCycle)return;
 const result=await runInventoryScheduler({cycle:inventoryCycle,signal:shutdown.signal,
  once:process.env.CHANNEX_WORKER_ONCE==='yes',log:entry=>console.log(JSON.stringify(entry))});
 if(result.failed&&process.env.CHANNEX_WORKER_ONCE==='yes')process.exitCode=1;
}
await Promise.all([bookingLoop(),messageLoop(),receiptLoop(),canonicalLoop(),inventoryLoop()]);
