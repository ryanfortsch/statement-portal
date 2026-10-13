import {test} from 'node:test';
import assert from 'node:assert/strict';
import {workerHealthStatus,reportWorkerHealth,type WorkerHealth} from '../channex-staging/worker-health.ts';
const now=Date.parse('2026-10-03T02:00:00Z');
const healthy:WorkerHealth={last_attempt:new Date(now).toISOString(),last_success:new Date(now).toISOString(),last_failure:null,consecutive_failures:0,outcome:'success'};
test('missing, failed, stale and invalid heartbeats cannot appear healthy',()=>{
 assert.equal(workerHealthStatus(null,now),'waiting');
 assert.equal(workerHealthStatus(healthy,now),'healthy');
 assert.equal(workerHealthStatus({...healthy,outcome:'failure',consecutive_failures:1},now),'failing');
 assert.equal(workerHealthStatus(healthy,now+300001),'stale');
 assert.equal(workerHealthStatus({...healthy,last_attempt:'invalid'},now),'unknown');
 assert.equal(workerHealthStatus({...healthy,last_attempt:new Date(now+120000).toISOString()},now),'unknown');
});
test('telemetry errors stay separate from booking outcomes',async()=>{
 assert.equal(await reportWorkerHealth(async()=>{throw new Error('secret must not escape');},true),false);
 const outcomes:boolean[]=[];
 assert.equal(await reportWorkerHealth(async value=>{outcomes.push(value);},false),true);
 assert.deepEqual(outcomes,[false]);
});
