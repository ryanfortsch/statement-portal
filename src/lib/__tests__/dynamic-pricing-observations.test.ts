import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {makePricingObservation,comparePricingObservations,pricingObservationSchema,capturePricingBatch} from '../dynamic-pricing-observations.ts';
import {createPricingDemo,createPricingDemoServices} from '../dynamic-pricing-demo.ts';
const now=new Date('2026-11-10T12:00:00Z');
const observation=()=>{const f=createPricingDemo(now);return makePricingObservation('demo_home','helm',f.policy,f.snapshot,1,0);};

test('captures original conditional forecasts and source timestamps without mutating evidence or attaching booking identities',()=>{
  const f=createPricingDemo(now),before=JSON.stringify(f),o=makePricingObservation('demo_home','helm',f.policy,f.snapshot,1,3);
  assert.equal(JSON.stringify(f),before);assert.equal(o.days.length,180);assert.equal(o.evidenceVersion,3);
  assert.equal(o.days[0].saleProbability,null);assert.ok(o.days[1].saleProbability!>0);
  const original=o.days[1].saleProbability;
  f.snapshot.evidence!.market[1].lastYearFinalPct=100;
  assert.equal(o.days[1].saleProbability,original);
  assert.equal(o.days[1].sourceObservedAt,now.toISOString());
  assert.equal(pricingObservationSchema.safeParse({...o,guestName:'not permitted'}).success,false);
  assert.equal(pricingObservationSchema.safeParse({...o,days:[o.days[0],o.days[0]]}).success,false);
});

test('expired and future-dated source observations remain unknown and cannot imply pickup',()=>{
  const f=createPricingDemo(now);
  f.snapshot.days[1].observedAt='2026-11-01T12:00:00Z';f.snapshot.days[2].observedAt='2026-11-11T12:00:00Z';
  const o=makePricingObservation('demo_home','guesty',f.policy,f.snapshot,1,0);
  for(const d of o.days.slice(1,3)){assert.equal(d.state,'unknown');assert.equal(d.saleProbability,null);assert.equal(d.eligible,false);}
});

test('compares only overlapping nights and distinguishes new bookings, reopenings, blocks and price changes',()=>{
  const before=observation(),after=structuredClone(before);after.capturedAt='2026-11-11T12:00:00Z';after.asOf='2026-11-11';after.days=after.days.slice(1);
  before.days[1].state='open';after.days[0].state='booked';
  before.days[2].state='booked';after.days[1].state='open';
  before.days[3].state='open';after.days[2].state='blocked';
  before.days[4].state='unknown';after.days[3].state='booked';
  after.days[4].currentCents=50000;
  const diff=comparePricingObservations(before,after);
  assert.equal(diff.common,179);assert.equal(diff.newlyBooked,1);assert.equal(diff.reopened,1);
  assert.equal(diff.availabilityChanged,1);assert.equal(diff.unknown,1);assert.equal(diff.rateChanges,1);
  assert.throws(()=>comparePricingObservations(after,before));
  assert.throws(()=>comparePricingObservations(before,{...after,propertyId:'other'}));
  const cutover=comparePricingObservations(before,{...after,authority:'guesty'});
  assert.equal(cutover.comparableAuthority,false);assert.equal(cutover.unknown,179);assert.equal(cutover.newlyBooked,0);
});

test('observation comparisons identify policy and evidence changes rather than calling price differences performance',()=>{
  const a=observation(),b={...observation(),capturedAt:'2026-11-10T13:00:00Z',policyVersion:2,evidenceVersion:1};
  const result=comparePricingObservations(a,b);
  assert.equal(result.policyChanged,true);assert.equal(result.evidenceChanged,true);assert.equal(result.newlyBooked,0);
});

test('daily capture is disabled by default, isolates failures, and stops starting work at its deadline',async()=>{
  let calls=0;
  assert.deepEqual(await capturePricingBatch(false,['a'],async()=>{calls++;}),{enabled:false,captured:0,failed:0,deferred:0});assert.equal(calls,0);
  const mixed=await capturePricingBatch(true,['a','b','c'],async id=>{if(id==='b')throw Error('sensitive provider response');},()=>0);
  assert.deepEqual(mixed,{enabled:true,captured:2,failed:1,deferred:0});
  let clock=0;
  const bounded=await capturePricingBatch(true,['a','b'],async()=>{clock=90001;},()=>clock);
  assert.deepEqual(bounded,{enabled:true,captured:1,failed:0,deferred:1});
  await assert.rejects(()=>capturePricingBatch(true,['a','a'],async()=>{}));
});

test('demo capture is idempotent and tracking preferences do not publish rates',async()=>{
  const f=createPricingDemo(),services=createPricingDemoServices(f),original=structuredClone(f.snapshot.days);
  assert.equal((await services.observe({propertyId:'demo_home',requestId:crypto.randomUUID()})).ok,false);
  await services.save({propertyId:'demo_home',policy:f.policy,mode:'shadow',version:0});
  const input={propertyId:'demo_home',requestId:crypto.randomUUID()},a=await services.observe(input),b=await services.observe(input);
  assert.ok(a.ok&&b.ok);if(!a.ok||!b.ok)return;
  assert.equal(a.value.observations[0].id,b.value.observations[0].id);assert.equal(b.value.observations.length,3);
  const tracked=await services.tracking({propertyId:'demo_home',enabled:true,version:0});assert.ok(tracked.ok);
  assert.equal((await services.tracking({propertyId:'demo_home',enabled:false,version:0})).ok,false);
  const w=await services.refresh();assert.deepEqual(w.value.snapshot.days,original);assert.equal(w.value.runs.length,0);assert.equal(w.value.scheduledCaptureEnabled,false);
});

test('observation server and cron cannot call rate publishing; cron requires both production and the explicit gate',()=>{
  const server=readFileSync('src/lib/dynamic-pricing-observations-server.ts','utf8'),route=readFileSync('src/app/api/cron/pricing-comparisons/route.ts','utf8');
  assert.doesNotMatch(server+route,/helm_apply_pricing_run|helm_revert_pricing_run|\.from\(['"]property_rate_days/);
  assert.match(route,/authorizeCron\(request\)/);assert.match(route,/isOwnerSession\(\)/);
  assert.match(route,/HELM_PRICING_CAPTURE_ENABLED==='true'&&process\.env\.VERCEL_ENV==='production'/);
  const actions=readFileSync('src/app/channels/pricing/actions.ts','utf8');
  for(const name of ['capturePricingObservationAction','setPricingTrackingAction'])assert.match(actions,new RegExp(`function ${name}[\\s\\S]*?requireOwnerEmail\\(\\)`));
});
