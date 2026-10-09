import type { StagingSnapshot } from '../channex-staging/client.ts';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runRecoveryDrill } from '../channex-staging/recovery-drill.ts';
import { runClosure, type ClosureState } from '../channex-staging/closure-worker.ts';
import { nights, TEST_START, TEST_END } from '../channex-staging/core.ts';
function fixture() {
 let state: ClosureState = {version:2,operation:{id:'preview-closure-20270201',dates:['2027-02-01'],status:'observed-closed',ownershipVerified:false}};
 const history: ClosureState[]=[];
 const store={read:async()=>structuredClone(state),replace:async(v:number,op:ClosureState['operation'])=>{if(v!==state.version)return false;state={version:v+1,operation:structuredClone(op)};history.push(structuredClone(state));return true;}};
 const client={readSnapshot:async():Promise<StagingSnapshot>=>({mappings:[],bookings:[],inventory:(['front','back'] as const).flatMap(unit=>nights(TEST_START,TEST_END).map(date=>({unit,date,inventory:0,stopSell:true,minStay:20})))})};
 return {store,client,history};
}
test('completion-save drill retains durable intent and reconciles without publishing',async()=>{
 const f=fixture(); const result=await runRecoveryDrill(f.store,f.client);
 assert.equal(result.faultInjected,true);assert.equal(result.result.status,'in-flight');
 assert.deepEqual(f.history.map(s=>s.operation.status),['pending','in-flight']);
 let writes=0;const client={...f.client,publishStoppedInventory:async()=>{writes++;throw new Error('must not publish')}};
 await assert.rejects(runClosure(f.store,client),/reconciliation/);
 assert.equal((await runClosure(f.store,client,true)).status,'observed-closed');
 await assert.rejects(runRecoveryDrill(f.store,f.client),/already started/);
 await runClosure(f.store,client,true);
 assert.equal(writes,0);assert.equal(f.history.length,3);
});
test('unsafe preflight leaves baseline unchanged',async()=>{
 const f=fixture(); const client={readSnapshot:async()=>{const s=await f.client.readSnapshot();s.inventory[0].stopSell=false;return s;}};
 await assert.rejects(runRecoveryDrill(f.store,client),/Unsafe/);assert.equal(f.history.length,0);
});
test('simultaneous drills cannot both acquire the baseline',async()=>{
 const f=fixture();const results=await Promise.allSettled([runRecoveryDrill(f.store,f.client),runRecoveryDrill(f.store,f.client)]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(f.history.length,2);
});
test('provider read failure is not reported as a successful injected fault',async()=>{
 const f=fixture();let reads=0;const client={readSnapshot:async()=>{if(++reads>1)throw new Error('offline');return f.client.readSnapshot();}};
 await assert.rejects(runRecoveryDrill(f.store,client),/incomplete/);
 assert.equal((await f.store.read()).operation.status,'in-flight');
});
