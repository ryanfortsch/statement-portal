import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalPollingEnabled, createCanonicalRevisionPageRunner, runCanonicalRevisionScheduler } from '../channex-staging/canonical-revision-scheduler.ts';
const env = { CHANNEX_CANONICAL_POLLING_ENABLED: 'true', CHANNEX_WORKER_MODE: 'isolated-staging',
  CHANNEX_STAGING_DB_PROJECT_REF: 'jgkblfozftcvymvwhhii', CHANNEX_STAGING_DB_URL: 'https://jgkblfozftcvymvwhhii.supabase.co',
  CHANNEX_STAGING_API_KEY: 'synthetic-key', CHANNEX_STAGING_DB_SERVICE_KEY: 'synthetic-key' };
const page = (received=0) => ({ received, applied: received, stale: 0, acknowledged: received, completeCoverage: false as const, canSend: false as const });
test('canonical polling rejects wrong environment, storage and missing credentials before any request', () => {
  assert.equal(canonicalPollingEnabled(env), true);
  for (const key of Object.keys(env)) {
    const bad = { ...env, [key]: '' };
    assert.throws(() => createCanonicalRevisionPageRunner(bad));
  }
  assert.throws(() => createCanonicalRevisionPageRunner({ ...env, VERCEL_ENV: 'production' }));
  assert.throws(() => createCanonicalRevisionPageRunner({ ...env, CHANNEX_INVENTORY_HELM_PROPERTY: 'HELMTEST-other' }));
  assert.throws(() => createCanonicalRevisionPageRunner({ ...env, CHANNEX_STAGING_DB_URL: 'https://other.supabase.co' }));
});
test('startup catches up sequentially, then idle polling waits fifteen minutes without logging payload fields', async () => {
  const controller = new AbortController(), delays: number[] = [], logs: unknown[] = [];
  let calls=0, active=0;
  const result = await runCanonicalRevisionScheduler({ signal: controller.signal, now: () => 0,
    drainPage: async signal => { assert.equal(signal.aborted, false); assert.equal(++active, 1); await Promise.resolve(); active--; return page(++calls===1?100:0); },
    log: entry => logs.push(entry), wait: async ms => { delays.push(ms); if (delays.length===2) controller.abort(); } });
  assert.deepEqual(delays, [5000,900000]); assert.equal(calls,2); assert.equal(result.canSend,false);
  assert.deepEqual(logs, [
    {event:'canonical-revision-cycle',at:'1970-01-01T00:00:00.000Z',outcome:'success',failures:0,received:100,applied:100,stale:0,acknowledged:100},
    {event:'canonical-revision-cycle',at:'1970-01-01T00:00:00.000Z',outcome:'success',failures:0,received:0,applied:0,stale:0,acknowledged:0},
  ]);
});
test('failed pages use bounded retries and successful recovery resets backoff; private exception text is omitted', async () => {
  const controller = new AbortController(), delays: number[] = [], logs: unknown[] = []; let calls=0;
  const result = await runCanonicalRevisionScheduler({ signal:controller.signal,
    drainPage:async()=>{if(++calls<=6)throw Error('SECRET provider payload'); return page();}, log:e=>logs.push(e),
    wait:async ms=>{delays.push(ms);if(delays.length===7)controller.abort();} });
  assert.deepEqual(delays,[60000,120000,240000,480000,900000,900000,900000]);
  assert.equal(result.failed,false); assert.doesNotMatch(JSON.stringify(logs),/SECRET/);
});
test('shutdown aborts active work and never begins another page; once mode reports failure', async () => {
  const controller=new AbortController(); let calls=0;
  const result=await runCanonicalRevisionScheduler({signal:controller.signal,
    drainPage:async signal=>{calls++;controller.abort();signal.throwIfAborted();return page();},
    log:()=>assert.fail('shutdown should not log failure'),wait:async()=>assert.fail('no wait')});
  assert.equal(calls,1);assert.equal(result.cycles,0);
  const once=await runCanonicalRevisionScheduler({signal:new AbortController().signal,once:true,
    drainPage:async()=>{throw Error('no connection');},log:()=>{throw Error('telemetry down');},wait:async()=>assert.fail('once never sleeps')});
  assert.deepEqual(once,{cycles:1,failed:true,canSend:false});
});
test('page transport propagates cancellation into mapping lookup before contacting the provider', async () => {
  const controller=new AbortController(); let calls=0;
  const run=createCanonicalRevisionPageRunner(env, async (input,init)=>{
    calls++;assert.equal(String(input),'https://jgkblfozftcvymvwhhii.supabase.co/rest/v1/rpc/helm_pilot_revision_route');
    assert.equal(init?.signal?.aborted,false);controller.abort();assert.equal(init?.signal?.aborted,true);
    init?.signal?.throwIfAborted(); throw Error('unreachable');
  });
  await assert.rejects(run(controller.signal));assert.equal(calls,1);
  await assert.rejects(run(controller.signal));assert.equal(calls,1);
});
