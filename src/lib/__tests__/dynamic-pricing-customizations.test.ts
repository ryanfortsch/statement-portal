import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {defaultPricingPolicy,previewPricing,pricingPolicySchema,type PricingSnapshot} from '../dynamic-pricing.ts';
import {defaultPricingCustomizations,matchingPricingSeason,pricingCustomizationSchema,pricingSeasonsSchema,seasonalPricingPolicy,type PricingSeason} from '../dynamic-pricing-customizations.ts';
import {applyPricingDraftOverrides,assignPricingGroup,neutralPricingDraft,pricingDraftsSchema,pricingSeasonConflicts,resolvePricingCustomizations,revisePricingDraftGroups,type PricingDrafts,type PricingOverride} from '../dynamic-pricing-drafts.ts';
import {defaultPricingStayRules,previewPricingStay} from '../dynamic-pricing-stays.ts';
import {createPricingDraftServices} from '../dynamic-pricing-draft-services.ts';
import {shiftIsoDay} from '../sca-quotes-types.ts';
const today='2026-11-11',now=new Date('2026-11-11T16:00:00Z'),policy=neutralPricingDraft(30000,10000,60000);
const snapshot:PricingSnapshot={today,observedAt:now.toISOString(),lastBookedOn:null,market:[],days:Array.from({length:500},(_,i)=>({date:shiftIsoDay(today,i),state:'open',currentCents:30000,minNights:2,protected:false,observedAt:now.toISOString()}))};
const season=(extra:Partial<PricingSeason>={}):PricingSeason=>({id:'winter',name:'Winter',start:'2026-11-11',end:'2026-12-31',repeat:true,kind:'percent',base:10,min:null,max:null,weekdayMin:null,weekendMin:null,...extra});
const custom=(rows:PricingSeason[]=[])=>({...defaultPricingCustomizations(),seasonalPrices:rows});
const row=(date:string,p=policy,c=custom())=>previewPricing(p,snapshot,now,c).days.find(d=>d.date===date)!;
const drafts=():PricingDrafts=>({version:1,homes:{a:{policy,version:1,groupId:'sub',inheritRules:true,ruleCategories:[],overrides:[]}},groups:[{id:'g',name:'Coastal',parentId:null,policy,ruleCategories:[],overrides:[]},{id:'sub',name:'Large',parentId:'g',policy,ruleCategories:[],overrides:[]}],account:{policy,ruleCategories:[],overrides:[]}});

function parityFingerprint(evaluate:typeof previewPricing){
  const outputs=[];
  for(let seed=0;seed<12;seed++){
    const p={...defaultPricingPolicy(20000+seed*1000,8000+seed*200,80000),monthlyFactors:Array.from({length:12},(_,m)=>0.7+(m%5)*0.2),weekdayFactors:[0.9,0.85,1,1,1.1,1.3,1.4],lastMinuteDiscountPct:seed*5,farOutPremiumPct:seed*3,occupancyEnabled:seed%2===0,recencyEnabled:true,orphanMaxNights:3,orphanDiscountPct:15,adjacentMinNights:1,lastMinStays:[{withinDays:7,weekday:1,weekend:2}],minimumBookingCents:seed*3000,events:[{start:'2026-12-24',end:'2027-01-02',label:'Synthetic holiday',adjustmentPct:35,minNights:4}]};
    const snap:PricingSnapshot={today:'2026-11-11',observedAt:'2026-11-11T16:00:00Z',lastBookedOn:'2026-10-01',market:[{date:'2026-11-20',factor:1.2,observedAt:'2026-11-11T16:00:00Z',source:'Synthetic'}],days:Array.from({length:500},(_,i)=>({date:shiftIsoDay('2026-11-11',i),state:i%23===5?'unknown':i%13===2?'blocked':i%7===3?'booked':'open',protected:i%17===4,currentCents:i%31===6?null:30000,minNights:2,observedAt:i%29===9?'2026-11-01T00:00:00Z':'2026-11-11T16:00:00Z'}))};
    outputs.push(evaluate(p,snap,new Date('2026-11-11T16:00:00Z')));
  }
  return createHash('sha256').update(JSON.stringify(outputs)).digest('hex');
}
test('existing model is byte-for-byte unchanged across 6,000 synthetic nights without local options',()=>{
  // Frozen against the engine at 93a6288d, before adding optional draft customizations.
  assert.equal(parityFingerprint(previewPricing),'4008a18c5a6b96d1458a3d882f9cc95e0e65719374e7f1a2a656d916e6152f1b');
});
test('neutral local options preserve every legacy nightly result and occupancy calculation',()=>{
  const a=previewPricing(policy,snapshot,now),b=previewPricing(policy,snapshot,now,custom());assert.deepEqual(a.days,b.days);assert.deepEqual(a.occupancy,b.occupancy);assert.deepEqual(a.warnings,b.warnings);
  assert.throws(()=>pricingPolicySchema.parse({...policy,seasonalPrices:[]}));
});
test('seasons repeat by calendar day; one-year seasons replace annual seasons instead of stacking',()=>{
  const annual=season(),dated=season({id:'special',name:'Special',repeat:false,start:'2027-11-11',end:'2027-11-12',base:50});
  assert.equal(matchingPricingSeason([annual,dated],'2027-11-11')?.id,'special');assert.equal(matchingPricingSeason([dated,annual],'2027-11-13')?.id,'winter');
  assert.equal(seasonalPricingPolicy(policy,'2027-11-11',[annual,dated]).policy.baseCents,45000);assert.equal(seasonalPricingPolicy(policy,'2028-11-11',[annual,dated]).policy.baseCents,33000);
  assert.equal(matchingPricingSeason([annual],'2027-01-01'),undefined);
  const leap=season({start:'2028-02-29',end:'2028-03-02'});assert.equal(matchingPricingSeason([leap],'2027-02-28'),undefined);assert.equal(matchingPricingSeason([leap],'2027-03-01')?.id,'winter');
});
test('season validation rejects ambiguous ranges, duplicate names, malformed dates and invalid cents',()=>{
  assert.throws(()=>pricingSeasonsSchema.parse([season(),season({id:'other',name:'Other'})]));
  assert.doesNotThrow(()=>pricingSeasonsSchema.parse([season(),season({id:'one-off',name:'This year',repeat:false})]));
  for(const s of [season({start:'2026-02-30'}),season({end:'2027-01-05'}),season({kind:'fixed',base:1}),season({base:201}),season({kind:'fixed',min:40000,base:30000})])assert.throws(()=>pricingSeasonsSchema.parse([s]));
  assert.throws(()=>pricingCustomizationSchema.parse({...custom(),weekendDays:[5,5]}));
  assert.doesNotThrow(()=>pricingSeasonsSchema.parse([season({repeat:false,start:'2026-12-20',end:'2027-01-05'})]));
});
test('seasonal percentages use normal listing values and blank values retain their original bounds',()=>{
  const s=season({base:20,min:-10,max:50,weekdayMin:4});const p=seasonalPricingPolicy(policy,today,[s]).policy;
  assert.equal(p.baseCents,36000);assert.equal(p.floorCents,9000);assert.equal(p.ceilingCents,90000);assert.equal(p.weekdayMinNights,4);assert.equal(p.weekendMinNights,2);
  const r=row(today,policy,custom([season({base:10})]));assert.equal(r.recommendedCents,33000);assert.ok(r.steps[0].label.includes('Winter'));
  assert.equal(seasonalPricingPolicy(policy,today,[season()]).policy.floorCents,10000);
});
test('invalid inherited seasonal bounds suppress recommendations instead of falling back silently',()=>{
  const c=custom([season({kind:'fixed',base:90000})]),r=row(today,policy,c);assert.equal(r.recommendedCents,null);assert.equal(r.eligible,false);assert.match(r.reasons[0],/seasonal minimum/);
  const d=drafts();d.account!.seasonalPrices=c.seasonalPrices;assert.equal(pricingSeasonConflicts(d).length,1);
});
test('flat last-minute includes its boundary, while gradual fades and far-out begins after the threshold',()=>{
  const p={...policy,lastMinuteDays:5,lastMinuteDiscountPct:20,farOutStart:30,farOutEnd:60,farOutPremiumPct:20};
  const c={...custom(),leadTimeModes:{lastMinute:'flat' as const,farOut:'flat' as const}},out=previewPricing(p,snapshot,now,c);
  assert.equal(out.days[0].recommendedCents,24000);assert.equal(out.days[5].recommendedCents,24000);assert.equal(out.days[6].recommendedCents,30000);
  assert.equal(out.days[30].recommendedCents,30000);assert.equal(out.days[31].recommendedCents,36000);
  const gradual=previewPricing(p,snapshot,now,custom());assert.equal(gradual.days[4].recommendedCents,28800);assert.equal(gradual.days[5].recommendedCents,30000);assert.equal(gradual.days[45].recommendedCents,33000);
});
test('custom weekends govern regular, seasonal and lead-time stay rules',()=>{
  const p={...policy,weekdayMinNights:2,weekendMinNights:5},c={...custom(),weekendDays:[0,4]};
  assert.equal(row('2026-11-12',p,c).minNights,5);assert.equal(row('2026-11-13',p,c).minNights,2);
  const near={...p,lastMinStays:[{withinDays:7,weekday:1,weekend:3}]};assert.equal(row('2026-11-15',near,c).minNights,3);
  const far={...p,farMinStays:[{afterDays:10,weekday:3,weekend:7}]};assert.equal(row('2026-11-22',far,c).minNights,7);
  assert.equal(row('2026-11-12',p,{...c,seasonalPrices:[season({weekendMin:6})]}).minNights,6);
  assert.equal(row('2026-11-12',p,{...c,weekendDays:[]}).minNights,2);
});
test('seasons and flat discounts preserve discount budgets, protection, freshness and hard bounds',()=>{
  const snap=structuredClone(snapshot);snap.days[0].state='booked';snap.days[1].protected=true;snap.days[2].observedAt='2026-11-01T00:00:00Z';
  const c={...custom([season({kind:'fixed',base:40000,min:39000,max:50000})]),leadTimeModes:{lastMinute:'flat' as const,farOut:'flat' as const}};
  const out=previewPricing({...policy,lastMinuteDiscountPct:80,maxCombinedDiscountPct:10},snap,now,c);
  assert.equal(out.days[0].recommendedCents,null);assert.equal(out.days[1].recommendedCents,30000);assert.equal(out.days[1].eligible,false);assert.equal(out.days[2].eligible,false);assert.equal(out.days[3].recommendedCents,39000);
  const capped=previewPricing({...policy,lastMinuteDiscountPct:80,maxCombinedDiscountPct:10},snapshot,now,{...c,seasonalPrices:[]});assert.equal(capped.days[0].recommendedCents,27000);
});
test('date overrides respect seasonal bounds instead of restoring normal listing bounds',()=>{
  const c=custom([season({kind:'fixed',base:45000,min:40000,max:90000})]),base=previewPricing(policy,snapshot,now,c);
  const override:PricingOverride={id:'o',label:'Date',start:today,end:today,kind:'fixed',value:80000,minNights:null,weekdays:[0,1,2,3,4,5,6]};
  assert.equal(applyPricingDraftOverrides(base,policy,snapshot,[override],[],c).days[0].recommendedCents,80000);
  assert.equal(applyPricingDraftOverrides(base,policy,snapshot,[{...override,value:1000}],[],c).days[0].recommendedCents,40000);
});
test('stay totals apply the correct bounds to each night across a season boundary',()=>{
  const c=custom([season({end:today,kind:'fixed',base:40000,min:35000,max:50000})]),p={...policy,maxChangePct:100},preview=previewPricing(p,snapshot,now,c);
  const result=previewPricingStay(snapshot,preview,p,{...defaultPricingStayRules(),lengthOfStay:[{nights:2,adjustmentPct:-50}]},today,'2026-11-13',c);
  assert.equal(result.subtotalCents,70000);assert.equal(result.totalCents,35000+15000);assert.equal(result.limitedNights,1);assert.equal(result.passes,true);
});
test('custom categories inherit independently, explicit empty seasons disable them, bulk reset restores inheritance',()=>{
  const s=drafts();s.account!.seasonalPrices=[season()];s.groups[0].weekendDays=[0];s.groups[1].leadTimeModes={lastMinute:'flat',farOut:'gradual'};
  let r=resolvePricingCustomizations(s,{kind:'listing',id:'a'});assert.equal(r.sources.seasonalPrices,'Account');assert.deepEqual(r.rules.weekendDays,[0]);assert.equal(r.rules.leadTimeModes.lastMinute,'flat');
  s.homes.a.seasonalPrices=[];assert.equal(resolvePricingCustomizations(s,{kind:'listing',id:'a'}).rules.seasonalPrices.length,0);
  r=resolvePricingCustomizations(assignPricingGroup(s,['a'],'sub',true),{kind:'listing',id:'a'});assert.equal(r.rules.seasonalPrices.length,1);
  const loaded=pricingDraftsSchema.parse(JSON.parse(JSON.stringify(s)));assert.deepEqual(resolvePricingCustomizations(loaded,{kind:'listing',id:'a'}),resolvePricingCustomizations(s,{kind:'listing',id:'a'}));
});
test('parent customizations invalidate affected draft versions, while listing overrides shield them',()=>{
  const s=drafts(),next=structuredClone(s);next.account!.weekendDays=[0];assert.equal(revisePricingDraftGroups(s,next).homes.a.version,2);
  s.homes.a.weekendDays=[6];next.homes.a.weekendDays=[6];assert.equal(revisePricingDraftGroups(s,next).homes.a.version,1);
});
test('session observations capture the same customized model used in the calendar',async()=>{
  const s=drafts();s.homes.a.seasonalPrices=[season({base:10})];const calendar={home:{id:'a',name:'Synthetic',city:'Test town',bedrooms:3,authority:'guesty' as const,timezone:'America/New_York'},snapshot,source:'Synthetic',sourceObservedAt:snapshot.observedAt};
  const service=createPricingDraftServices(calendar,()=>s,()=>{throw Error('Unexpected settings write');},async()=>({ok:true,value:calendar}));
  await service.observe({propertyId:'a',requestId:'00000000-0000-4000-8000-000000000001'});const observed=service.inspect().observations[0].data;
  assert.equal(observed.days[0].recommendedCents,33000);assert.equal(observed.modelVersion,'helm-3-local-customizations');assert.equal((await service.publish('anything')).ok,false);
});
