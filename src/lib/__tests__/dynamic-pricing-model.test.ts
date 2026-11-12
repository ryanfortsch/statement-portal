import {test} from 'node:test';
import assert from 'node:assert/strict';
import {emptyPricingEvidence,importPriceLabsMarket,importPricingHistory,pricingEvidenceSchema,type HistoricalNight,type MarketNight} from '../dynamic-pricing-evidence.ts';
import {analyzePricingEvidence,backtestOccupancy,forecastNight,historicalPickup,historicalSafetyFloor,learnPriceShape,marketForecast,marketPaceAdjustment,priceResponseScenario} from '../dynamic-pricing-model.ts';
import {defaultPricingPolicy,previewPricing,type PricingSnapshot} from '../dynamic-pricing.ts';
import {shiftIsoDay} from '../sca-quotes-types.ts';
const now=new Date('2026-11-08T12:00:00Z'),today='2026-11-08';
function market(date=today):MarketNight {return {date,occupancyPct:40,sameTimeLastYearPct:30,lastYearFinalPct:70,pickup7Pct:10,lastYearPickup7Pct:5,p25Cents:20000,p50Cents:30000,p75Cents:40000,p90Cents:60000,bookedMedianCents:31000,bookings:15,vendorCents:32000,event:'',lastYearAdrCents:null};}
function history():HistoricalNight[] {return Array.from({length:900},(_,i)=>{const date=shiftIsoDay(today,i-900);return {date,state:i%3===0?'open':'booked',bookedOn:i%3===0?null:shiftIsoDay(date,-(i%4===0?60:3)),rentCents:i%3===0?null:30000+Number(date.slice(5,7))*500};});}
function snapshot():PricingSnapshot {return {today,observedAt:now.toISOString(),lastBookedOn:null,market:[],evidence:{...emptyPricingEvidence('test'),marketSource:'synthetic',marketObservedAt:now.toISOString(),market:Array.from({length:360},(_,i)=>market(shiftIsoDay(today,i)))},days:Array.from({length:180},(_,i)=>({date:shiftIsoDay(today,i),state:'open',currentCents:30000,minNights:2,protected:false,observedAt:now.toISOString()}))};}
test('daily vendor import preserves zero occupancy, missing prices, percent units and cents',()=>{
  const [m]=importPriceLabsMarket('Date,Market Occupancy,Market 50th Percentile Price,Market occupancy (last year final),Holiday/Event\n2026-11-08,0,330.50,75,"Festival, downtown"');
  assert.equal(m.occupancyPct,0);assert.equal(m.p50Cents,33050);assert.equal(m.p25Cents,null);assert.equal(m.event,'Festival, downtown');assert.equal(m.lastYearFinalPct,75);
});
test('rejects monthly totals, invalid dates, unordered quantiles, malformed CSV and duplicate evidence',()=>{
  assert.throws(()=>importPriceLabsMarket('Month,Market Occupancy\n2026-11,50'));
  assert.throws(()=>importPriceLabsMarket('Date,Market Occupancy,Market 50th Percentile Price\n2026-02-31,50,300'));
  assert.throws(()=>importPriceLabsMarket('Date,Market Occupancy,Market 50th Percentile Price,Market 25th Percentile Price\n2026-11-08,50,300,400'));
  assert.throws(()=>importPricingHistory('date,state,booked_on,rent_cents\n2026-01-01,booked,2026-01-02,30000'));
  assert.throws(()=>pricingEvidenceSchema.parse({...emptyPricingEvidence('test'),marketSource:'test',marketObservedAt:now.toISOString(),market:[market(),market()]}));
});
test('missing historical inventory is not manufactured as vacant; unknown booking dates are excluded',()=>{
  assert.equal(historicalPickup([],today,today).probability,null);
  const h=history().map(n=>({...n,state:'blocked' as const,bookedOn:null,rentCents:null}));
  assert.equal(historicalPickup(h,today,today).probability,null);
  assert.equal(historicalPickup(history().map(n=>({...n,state:'booked' as const,bookedOn:null})),today,today).probability,null);
});
test('learning requires coverage and excludes future or blocked ADR; shrinkage is bounded',()=>{
  assert.equal(learnPriceShape(history().slice(0,60),today).baseCents,null);
  const baseline=learnPriceShape(history(),today);assert.ok(baseline.qualified);
  const poisoned=[...history(),{date:'2027-01-01',state:'booked' as const,bookedOn:today,rentCents:9000000}];
  assert.deepEqual(learnPriceShape(poisoned,today),baseline);
  assert.ok(baseline.monthlyFactors.every(n=>n>=0.5&&n<=2));assert.ok(baseline.weekdayFactors.every(n=>n>=0.7&&n<=1.4));
});
test('conditional pickup excludes stays already sold at the decision cutoff',()=>{
  const h=history(),f=historicalPickup(h,shiftIsoDay(today,30),today);
  assert.ok(f.samples>=20);assert.ok(f.probability!>0&&f.probability!<1);assert.ok(f.low!<=f.probability!&&f.high!>=f.probability!);
  const altered=h.map(n=>n.state==='booked'?{...n,bookedOn:shiftIsoDay(n.date,-400)}:n);
  assert.ok(historicalPickup(altered,shiftIsoDay(today,30),today).probability!<0.1);
});
test('market final projection uses remaining inventory, never total occupancy as sale chance',()=>{
  const f=marketForecast(market()); // final .70 + half(.40-.30) = .75; remaining .35/.60
  assert.ok(Math.abs(f.probability!-0.35/0.6)<1e-12);
  assert.equal(marketForecast({...market(),occupancyPct:100}).probability,null);
  assert.equal(marketForecast({...market(),lastYearFinalPct:20}).probability,null);
  assert.equal(marketPaceAdjustment({...market(),occupancyPct:100,sameTimeLastYearPct:0,pickup7Pct:100}),15);
});
test('freshness gates market forecast and shape; stale evidence falls back only to qualified history',()=>{
  const e=snapshot().evidence!;assert.match(forecastNight(e,today,today,now).basis,/market/);
  e.marketObservedAt='2026-11-01T00:00:00Z';assert.equal(forecastNight(e,today,today,now).probability,null);
  e.history=history();e.historySource='verified';e.historyObservedAt=now.toISOString();assert.match(forecastNight(e,today,today,now).basis,/weekday/);
  assert.equal(analyzePricingEvidence(e,today,now).marketFresh,false);
  assert.throws(()=>analyzePricingEvidence({...e,marketObservedAt:'2027-01-01T00:00:00Z'},today,now));
});
test('walk-forward test never trains on its target or future outcomes',()=>{
  const h=history(),cutoff=shiftIsoDay(today,-40),target=shiftIsoDay(cutoff,30);
  const a=historicalPickup(h,target,cutoff),poison=h.map(n=>n.date>=cutoff?{...n,state:'booked' as const,bookedOn:shiftIsoDay(n.date,-1)}:n);
  assert.deepEqual(historicalPickup(poison,target,cutoff),a);
  const b=backtestOccupancy(h,today);assert.ok(b.every(r=>r.count>0&&r.brier!>=0&&r.brier!<=1));
  assert.deepEqual(backtestOccupancy([],today).map(r=>r.brier),[null,null,null]);
});
test('historical safety minimum requires two same-weekday sold nights and excludes future evidence',()=>{
  const e=emptyPricingEvidence('test'),date='2027-05-01',anchor=shiftIsoDay(date,-364);
  e.history=[{date:anchor,state:'booked',bookedOn:shiftIsoDay(anchor,-4),rentCents:40000}];
  assert.equal(historicalSafetyFloor(e,date,today),null);
  e.history.push({...e.history[0],date:shiftIsoDay(anchor,-7),rentCents:20000});
  assert.equal(historicalSafetyFloor(e,date,today),33000);
  assert.equal(historicalSafetyFloor(e,date,'2025-01-01'),null);
});
test('elasticity sandbox bounds prices and responds to sensitivity without claiming a fit',()=>{
  const a=priceResponseScenario(30000,0.5,1,10000,60000),b=priceResponseScenario(30000,0.5,6,10000,60000);
  assert.ok(a.best.cents>b.best.cents);assert.ok(b.points.every(p=>p.probability>0&&p.probability<1&&p.cents>=10000&&p.cents<=60000));
  assert.throws(()=>priceResponseScenario(0,0.5,2,100,300));
});
test('market shape and pace feed real price recommendations and fail closed after expiry',()=>{
  const p=defaultPricingPolicy(30000,10000,90000);p.priceShape='market';p.marketPacingEnabled=true;p.maxChangePct=100;
  const s=snapshot();const r=previewPricing(p,s,now);assert.ok(r.days[0].steps.some(s=>s.label==='Market booking pace and pickup'));assert.ok(r.days[0].eligible);
  s.evidence!.marketObservedAt='2026-11-01T00:00:00Z';assert.ok(previewPricing(p,s,now).days.every(d=>!d.eligible));
});
test('minimum-stay hierarchy supports last-minute, booking-value, adjacent, event, orphan and hard floor',()=>{
  const p=defaultPricingPolicy(30000,10000,90000),s=snapshot();p.lastMinStays=[{withinDays:7,weekday:1,weekend:1}];p.lowestMinNights=2;
  assert.equal(previewPricing(p,s,now).days[1].minNights,2);
  p.lowestMinNights=1;p.minimumBookingCents=90000;assert.equal(previewPricing(p,s,now).days[1].minNights,4);
  s.days[0].state='booked';p.adjacentMinNights=1;assert.equal(previewPricing(p,s,now).days[1].minNights,1);
  s.days[2].state='booked';p.events=[{start:s.days[1].date,end:s.days[1].date,label:'Event',adjustmentPct:0,minNights:3}];
  assert.equal(previewPricing(p,s,now).days[1].eligible,false);
  p.orphanPreservesEvents=false;assert.equal(previewPricing(p,s,now).days[1].minNights,1);
});

test('dynamic programming retains future booking value and never underperforms a fixed-price scenario on its own assumptions',async()=>{
  const {optimizeRatePath}=await import('../dynamic-pricing-model.ts');
  const windows=[60,30,0].map(leadDays=>({leadDays,probability:0.2,elasticity:2}));
  const result=optimizeRatePath(30000,10000,60000,windows);
  const fixed=priceResponseScenario(30000,0.2,2,10000,60000).points.map(p=>p.cents*(1-(1-p.probability)**3));
  assert.ok(result.expectedCents>=Math.round(Math.max(...fixed))-1);
  assert.ok(result.path[0].cents>=result.path[2].cents);
  assert.throws(()=>optimizeRatePath(30000,10000,60000,[windows[0],windows[0]]));
});

test('poor timestamp and calendar coverage suppress pickup rather than biasing toward vacancy',()=>{
  const h=history().map(n=>n.state==='booked'?{...n,bookedOn:null}:n);
  assert.equal(historicalPickup(h,shiftIsoDay(today,30),today).probability,null);
  const sparse=history().filter((_,i)=>i%2===0);
  assert.equal(historicalPickup(sparse,shiftIsoDay(today,30),today).probability,null);
  assert.ok(priceResponseScenario(30000,0,2,10000,60000).points.every(p=>p.probability===0&&p.expectedCents===0));
});

test('interactive demo services save, publish and undo only their isolated memory',async()=>{
  const {createPricingDemo,createPricingDemoServices}=await import('../dynamic-pricing-demo.ts');
  const fixture=createPricingDemo(),original=JSON.stringify(fixture),services=createPricingDemoServices(fixture);
  assert.equal((await services.publish('missing')).ok,false);
  const saved=await services.save({propertyId:'demo_home',policy:fixture.policy,mode:'helm_direct',version:0});assert.equal(saved.ok,true);
  const review=await services.review();assert.ok(review.ok);if(!review.ok)return;
  const published=await services.publish(review.value.id);assert.ok(published.ok);if(!published.ok)return;assert.ok(published.value>0);
  const changed=await services.refresh();assert.notDeepEqual(changed.value.snapshot.days,fixture.snapshot.days);
  const undone=await services.undo(review.value.id);assert.ok(undone.ok);if(undone.ok)assert.equal(undone.value,published.value);
  assert.deepEqual((await services.refresh()).value.snapshot.days,fixture.snapshot.days);
  assert.equal(JSON.stringify(fixture),original);
});
test('evidence changes invalidate a demo review without touching original fixture or rates',async()=>{
  const {createPricingDemo,createPricingDemoServices}=await import('../dynamic-pricing-demo.ts');
  const fixture=createPricingDemo(),services=createPricingDemoServices(fixture);
  await services.save({propertyId:'demo_home',policy:fixture.policy,mode:'helm_direct',version:0});
  const review=await services.review();assert.ok(review.ok);if(!review.ok)return;
  await services.evidence({propertyId:'demo_home',data:{...fixture.snapshot.evidence!,marketSource:'Replacement synthetic source'},version:0});
  assert.equal((await services.publish(review.value.id)).ok,false);
  assert.deepEqual((await services.refresh()).value.snapshot.days,fixture.snapshot.days);
});

test('demo imports can be observed after the page opened without becoming future-dated evidence',async()=>{
  const {createPricingDemo,createPricingDemoServices}=await import('../dynamic-pricing-demo.ts');
  const fixture=createPricingDemo(new Date(Date.now()-3600000)),services=createPricingDemoServices(fixture);
  const data={...fixture.snapshot.evidence!,marketObservedAt:new Date().toISOString()};
  const result=await services.evidence({propertyId:'demo_home',data,version:0});assert.ok(result.ok);if(!result.ok)return;
  const s=result.value.snapshot;
  assert.doesNotThrow(()=>analyzePricingEvidence(s.evidence!,s.today,new Date(s.observedAt)));
  assert.equal((await services.evidence({propertyId:'demo_home',data:{...data,marketObservedAt:new Date(Date.now()+3600000).toISOString()},version:1})).ok,false);
});
