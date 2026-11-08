import { test } from 'node:test';
import assert from 'node:assert/strict';
import { defaultPricingPolicy, previewPricing, pricingPolicySchema, type PricingSnapshot } from '../dynamic-pricing.ts';
import { shiftIsoDay } from '../sca-quotes-types.ts';
const now=new Date('2026-11-08T12:00:00Z');
const policy=()=>defaultPricingPolicy(44500,22500,120000);
function snapshot():PricingSnapshot { return {today:'2026-11-08',observedAt:now.toISOString(),lastBookedOn:null,market:[],
  days:Array.from({length:100},(_,i)=>({date:shiftIsoDay('2026-11-08',i),state:'open',currentCents:44500,minNights:2,protected:false,observedAt:now.toISOString()}))}; }
test('a stacked discount cannot exceed the explicit combined limit, and the trail explains it',()=>{
  const p=policy();p.occupancyEnabled=true;p.recencyEnabled=true;p.maxChangePct=100;
  const s=snapshot();s.lastBookedOn='2026-09-01';
  const first=previewPricing(p,s,now).days[0];
  assert.equal(first.recommendedCents,31200);
  assert.ok(first.steps.some(s=>s.label==='Combined discount limit'));
  assert.equal(first.eligible,true);
});
test('blocked nights do not dilute occupancy, missing or stale nights do not count as vacancy',()=>{
  const p=policy();p.occupancyEnabled=true;
  const s=snapshot();s.days.slice(0,5).forEach(d=>d.state='booked');s.days.slice(5,10).forEach(d=>d.state='blocked');
  assert.equal(previewPricing(p,s,now).occupancy[0].pct,50);
  s.days[10].state='unknown';
  assert.equal(previewPricing(p,s,now).occupancy[0].pct,null);
  s.days[10].state='open';s.days[10].observedAt='2026-11-01T12:00:00Z';
  assert.equal(previewPricing(p,s,now).occupancy[0].pct,null);
});
test('never offers protected, reserved, closed, unknown, stale, or unpriced nights for publishing',()=>{
  const p=policy();p.maxChangePct=100;const s=snapshot();
  s.days[0].protected=true;s.days[1].state='booked';s.days[2].state='blocked';s.days[3].state='unknown';
  s.days[4].observedAt='2026-11-01T12:00:00Z';s.days[5].currentCents=null;
  assert.ok(previewPricing(p,s,now).days.slice(0,6).every(d=>!d.eligible));
  s.observedAt='2026-11-01T12:00:00Z';assert.ok(previewPricing(p,s,now).days.every(d=>!d.eligible));
});
test('flags a large rate change for review instead of silently publishing it',()=>{
  const s=snapshot();s.days[0].currentCents=10000;
  const d=previewPricing(policy(),s,now).days[0];assert.equal(d.eligible,false);assert.match(d.reasons.join(' '),/review limit/);
});
test('a single-night orphan gets a one-night minimum only with known neighbours',()=>{
  const s=snapshot();s.days[0].state='booked';s.days[2].state='booked';
  assert.equal(previewPricing(policy(),s,now).days[1].minNights,1);
  s.days[0].state='unknown';assert.equal(previewPricing(policy(),s,now).days[1].minNights,2);
  assert.equal(previewPricing(policy(),snapshot(),now).days[0].minNights,2);
});
test('event minimums and bounds win over orphan discounts; rounding cannot cross the floor',()=>{
  const p=policy();p.floorCents=22549;p.monthlyFactors[10]=0.25;
  p.events=[{start:'2026-11-09',end:'2026-11-09',label:'Event',adjustmentPct:20,minNights:3}];
  const s=snapshot();s.days[0].state='booked';s.days[2].state='booked';
  const d=previewPricing(p,s,now).days[1];assert.equal(d.minNights,3);assert.equal(d.recommendedCents,22549);
});
test('validates malformed policy, impossible dates, duplicate inputs and future recency',()=>{
  assert.throws(()=>pricingPolicySchema.parse({...policy(),baseCents:100}));
  const s=snapshot();s.days[0].date='2026-02-31';assert.throws(()=>previewPricing(policy(),s,now));
  s.days[0].date=s.days[1].date;assert.throws(()=>previewPricing(policy(),s,now));
  const s2=snapshot();s2.lastBookedOn='2026-12-01';assert.throws(()=>previewPricing(policy(),s2,now));
});
test('market observations expire, and far-out rules use calendar days across DST',()=>{
  const p=policy(),s=snapshot();s.market=[{date:s.days[10].date,factor:1.5,observedAt:'2026-10-01T00:00:00Z',source:'Test observation'}];
  const r=previewPricing(p,s,now);
  assert.ok(r.days[10].reasons.includes('Stale market observation skipped'));
  assert.equal(r.days[61].minNights,4); // Friday, January 8
  assert.ok(r.days[61].steps.some(s=>s.label==='Far-out premium'));
});
