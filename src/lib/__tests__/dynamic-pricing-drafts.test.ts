import {test} from 'node:test';
import assert from 'node:assert/strict';
import {previewPricing,type PricingSnapshot} from '../dynamic-pricing.ts';
import {applyPricingDraftOverrides,revisePricingDraftGroups,emptyPricingDrafts,neutralPricingDraft,pricingDraftsSchema,pricingOverridesSchema,resolvePricingDraft,savePricingDraftPolicy,type PricingDrafts,type PricingOverride} from '../dynamic-pricing-drafts.ts';
import {createPricingDraftServices} from '../dynamic-pricing-draft-services.ts';
import {emptyPricingEvidence} from '../dynamic-pricing-evidence.ts';
const policy=neutralPricingDraft(30000,10000,60000),now=new Date('2026-11-11T16:00:00Z');
const snapshot:PricingSnapshot={today:'2026-11-11',observedAt:now.toISOString(),lastBookedOn:null,market:[],days:Array.from({length:6},(_,i)=>({date:`2026-11-${11+i}`,state:'open',currentCents:30000,minNights:2,protected:false,observedAt:now.toISOString()}))};
const home=()=>({policy:structuredClone(policy),version:1,groupId:null,inheritRules:false,overrides:[]});
const state=():PricingDrafts=>({...emptyPricingDrafts(),homes:{a:home(),b:{...home(),policy:{...policy,baseCents:45000}}}});
const override=(extra:Partial<PricingOverride>={}):PricingOverride=>({id:'one',label:'Holiday',start:'2026-11-11',end:'2026-11-16',kind:'fixed',value:35000,minNights:3,weekdays:[0,1,2,3,4,5,6],...extra});
test('neutral draft does not adopt vendor adjustments or market assumptions',()=>{
 assert.equal(policy.lastMinuteDiscountPct,0);assert.equal(policy.farOutPremiumPct,0);assert.equal(policy.occupancyEnabled,false);assert.equal(policy.marketPacingEnabled,false);assert.deepEqual(policy.farMinStays,[]);
});
test('group rules inherit without replacing each home base and bounds',()=>{
 const s=state();s.groups=[{id:'g',name:'Coastal',policy:{...policy,lastMinuteDiscountPct:15},overrides:[]}];s.homes.b={...s.homes.b,groupId:'g',inheritRules:true};
 assert.equal(resolvePricingDraft(s,'b').baseCents,45000);assert.equal(resolvePricingDraft(s,'b').lastMinuteDiscountPct,15);
 s.groups[0].policy.lastMinuteDiscountPct=10;assert.equal(resolvePricingDraft(s,'b').lastMinuteDiscountPct,10);
 const changed=savePricingDraftPolicy(s,'b',{...resolvePricingDraft(s,'b'),lastMinuteDiscountPct:5},1);
 assert.equal(changed.homes.b.inheritRules,false);assert.equal(resolvePricingDraft(changed,'b').lastMinuteDiscountPct,5);
 const baseOnly=savePricingDraftPolicy(s,'b',{...resolvePricingDraft(s,'b'),baseCents:50000},1);assert.equal(baseOnly.homes.b.inheritRules,true);
 assert.throws(()=>savePricingDraftPolicy(baseOnly,'b',policy,1),/changed/);
});
test('date override uses listing precedence, selected weekdays and inclusive dates',()=>{
 const before=previewPricing(policy,snapshot,now),s=JSON.stringify(snapshot);
 const result=applyPricingDraftOverrides(before,policy,snapshot,[override({start:'2026-11-12',end:'2026-11-14',weekdays:[4,5],value:33000})],[override({value:32000})]);
 assert.deepEqual(result.days.map(d=>d.recommendedCents),[32000,33000,33000,32000,32000,32000]);
 assert.equal(result.days[1].minNights,3);assert.equal(result.days[1].steps.at(-1)?.label,'Listing override: Holiday');assert.equal(JSON.stringify(snapshot),s);assert.equal(before.days[0].recommendedCents,30000);
});
test('overrides preserve inventory protection, freshness, floor, ceiling and change limits',()=>{
 const snap=structuredClone(snapshot);snap.days[0].state='booked';snap.days[1].state='blocked';snap.days[2].protected=true;snap.days[3].state='unknown';snap.days[4].observedAt='2026-11-08T00:00:00Z';
 const before=previewPricing(policy,snap,now),after=applyPricingDraftOverrides(before,policy,snap,[override({value:90000})]);
 for(let i=0;i<5;i++)assert.deepEqual(after.days[i],before.days[i]);
 assert.equal(after.days[5].recommendedCents,60000);assert.equal(after.days[5].eligible,false);
 assert.equal(applyPricingDraftOverrides(before,policy,snap,[override({value:100})]).days[5].recommendedCents,10000);
});
test('percentage and minimum-stay only overrides do not compound group prices',()=>{
 const before=previewPricing(policy,snapshot,now);
 assert.equal(applyPricingDraftOverrides(before,policy,snapshot,[override({kind:'percent',value:10})],[override({value:50000})]).days[0].recommendedCents,33000);
 const stay=applyPricingDraftOverrides(before,{...policy,lowestMinNights:2},snapshot,[override({kind:'stay',value:0,minNights:1})]);assert.equal(stay.days[0].recommendedCents,30000);assert.equal(stay.days[0].minNights,2);
});
test('rejects ambiguous same-level overrides, invalid dates and injected storage fields',()=>{
 assert.throws(()=>pricingOverridesSchema.parse([override(),override({id:'two'})]));
 assert.doesNotThrow(()=>pricingOverridesSchema.parse([override({weekdays:[1]}),override({id:'two',weekdays:[2]})]));
 assert.throws(()=>pricingOverridesSchema.parse([override({start:'2026-02-30'})]));
 assert.throws(()=>pricingDraftsSchema.parse({...state(),snapshot}));
 assert.throws(()=>pricingDraftsSchema.parse({...state(),groups:[{id:'g',name:'A',policy,overrides:[]},{id:'g2',name:'a',policy,overrides:[]}]}));
});
function serviceFixture(){let drafts=state(),reads=0;const calendar={home:{id:'a',name:'Test home',city:'Test town',bedrooms:2,authority:'guesty' as const,timezone:'America/New_York'},snapshot:structuredClone(snapshot),source:'Test mirror',sourceObservedAt:snapshot.observedAt};
 const service=createPricingDraftServices(calendar,()=>drafts,next=>{drafts=next;},async()=>{reads++;return {ok:true as const,value:calendar};});return {service,calendar,drafts:()=>drafts,reads:()=>reads};}
test('local adapter cannot publish, connect, undo or enable jobs',async()=>{
 const {service,reads}=serviceFixture();
 for(const r of [await service.publish('x'),await service.review('a'),await service.undo('x'),await service.tracking({enabled:true})])assert.equal(r.ok,false);
 assert.equal(reads(),0);await assert.rejects(service.save({propertyId:'a',policy,mode:'helm_direct',version:1}));
 await assert.rejects(service.save({propertyId:'b',policy,mode:'shadow',version:1}));assert.equal((await service.refresh('b')).ok,false);
});
test('draft services keep imported evidence out of persisted settings and validate scope',async()=>{
 const f=serviceFixture(),data=emptyPricingEvidence('a');
 assert.equal((await f.service.evidence({propertyId:'a',data,version:0})).ok,true);
 assert.equal((await f.service.evidence({propertyId:'a',data:emptyPricingEvidence('b'),version:1})).ok,false);
 assert.equal((await f.service.evidence({propertyId:'a',data,version:0})).ok,false);
 const r=await f.service.save({propertyId:'a',policy:{...policy,baseCents:31000},mode:'shadow',version:1});assert.equal(r.ok,true);
 assert.equal(JSON.stringify(f.drafts()).includes('marketObservedAt'),false);assert.equal(f.service.inspect().evidenceVersion,1);
});
test('snapshots record actual current rates and overridden proposals with idempotent capture',async()=>{
 const f=serviceFixture();f.drafts().homes.a.overrides=[override({value:33000})];
 const request={propertyId:'a',requestId:'00000000-0000-4000-8000-000000000001'};
 assert.equal((await f.service.observe(request)).ok,true);await f.service.observe(request);
 const history=f.service.inspect().observations;assert.equal(history.length,1);assert.equal(history[0].data.days[0].currentCents,30000);assert.equal(history[0].data.days[0].recommendedCents,33000);assert.equal(history[0].data.days[0].saleProbability,null);assert.equal(f.reads(),1);
});
test('storage failure does not return a successful save',async()=>{
 const f=serviceFixture(),s=createPricingDraftServices(f.calendar,f.drafts,()=>{throw Error('Storage full');},async()=>({ok:true,value:f.calendar}));
 await assert.rejects(s.save({propertyId:'a',policy,mode:'shadow',version:1}),/Storage full/);assert.equal(f.drafts().homes.a.version,1);
});

test('shared group edits invalidate every member version without double increments',()=>{
 const before=state();before.groups=[{id:'g',name:'Shared',policy,overrides:[]}];for(const h of Object.values(before.homes)){h.groupId='g';h.inheritRules=true;}
 const next=structuredClone(before);next.groups[0].policy.lastMinuteDiscountPct=10;next.homes.a.version=2;
 const revised=revisePricingDraftGroups(before,next);assert.equal(revised.homes.a.version,2);assert.equal(revised.homes.b.version,2);
});

function hierarchy(){const s=state();s.account={policy:{...policy,lastMinuteDiscountPct:10,farOutPremiumPct:12,weekdayMinNights:5},ruleCategories:['lastMinute','farOut','minimumStay'],overrides:[]};s.groups=[{id:'g',name:'Coastal',parentId:null,policy:{...policy,lastMinuteDiscountPct:15},ruleCategories:['lastMinute'],overrides:[]},{id:'sg',name:'Large homes',parentId:'g',policy:{...policy,farOutPremiumPct:20,weekdayMinNights:3},ruleCategories:['farOut','minimumStay'],overrides:[]}];s.homes.a={...s.homes.a,groupId:'sg',inheritRules:true,ruleCategories:[]};return s;}
import {assignPricingGroup,pricingInheritedOverrides,pricingRuleSources,pricingRuleCategories,PRICING_RULE_CATEGORIES,resolvePricingStayRules,pricingInGroup} from '../dynamic-pricing-drafts.ts';
test('every policy rule belongs to exactly one inheritance category; prices stay local',()=>{
 const keys=Object.values(PRICING_RULE_CATEGORIES).flatMap(c=>c.fields);assert.equal(new Set(keys).size,keys.length);
 assert.deepEqual([...keys].sort(),Object.keys(policy).filter(k=>!['version','currency','baseCents','floorCents','ceilingCents'].includes(k)).sort());assert.equal(pricingRuleCategories.length,10);
});
test('account, group, subgroup and listing resolve per category and minimum stays remain atomic',()=>{
 let s=hierarchy();const before=resolvePricingDraft(s,'a');assert.equal(before.lastMinuteDiscountPct,15);assert.equal(before.farOutPremiumPct,20);assert.equal(before.weekdayMinNights,3);assert.equal(before.weekendMinNights,2);
 s=savePricingDraftPolicy(s,'a',{...before,lastMinuteDiscountPct:8},1);assert.deepEqual(s.homes.a.ruleCategories,['lastMinute']);
 s.groups[1].policy.farOutPremiumPct=25;assert.equal(resolvePricingDraft(s,'a').farOutPremiumPct,25);assert.equal(resolvePricingDraft(s,'a').lastMinuteDiscountPct,8);
 assert.equal(pricingRuleSources(s,{kind:'listing',id:'a'}).sources.lastMinute,'This listing');assert.equal(pricingRuleSources(s,{kind:'listing',id:'a'}).sources.farOut,'Large homes');
 s.homes.a.ruleCategories=[];assert.equal(resolvePricingDraft(s,'a').lastMinuteDiscountPct,15);
});
test('legacy drafts retain exact listing and group behavior when loaded',()=>{
 const s=state();s.groups=[{id:'g',name:'Legacy',policy:{...policy,lastMinuteDiscountPct:14},overrides:[]}];s.homes.a.groupId='g';s.homes.a.inheritRules=true;
 const loaded=pricingDraftsSchema.parse(JSON.parse(JSON.stringify(s)));assert.equal(resolvePricingDraft(loaded,'a').lastMinuteDiscountPct,14);assert.equal(resolvePricingDraft(loaded,'b').baseCents,45000);assert.equal(resolvePricingDraft(loaded,'b').lastMinuteDiscountPct,0);
});
test('rejects cycles, missing parents and nesting beyond subgroups',()=>{
 const s=hierarchy();s.groups[0].parentId='sg';assert.throws(()=>pricingDraftsSchema.parse(s));s.groups[0].parentId=null;s.groups.push({...s.groups[1],id:'third',name:'Third',parentId:'sg'});assert.throws(()=>pricingDraftsSchema.parse(s));s.groups[2].parentId='missing';assert.throws(()=>pricingDraftsSchema.parse(s));
});
test('bulk assignment supports 26 homes without inventing prices, retaining existing local overrides',()=>{
 const s=hierarchy();const ids=Array.from({length:26},(_,i)=>i===0?'a':i===1?'b':`home-${i}`);const next=assignPricingGroup(s,ids,'sg',false);
 assert.equal(Object.keys(next.homes).length,2);assert.equal(Object.keys(next.assignments??{}).length,24);assert.equal(resolvePricingDraft(next,'b').baseCents,45000);assert.equal(resolvePricingDraft(next,'b').lastMinuteDiscountPct,0);assert.equal(pricingInGroup(next,'home-25','g'),true);
 const inherited=assignPricingGroup(next,['b'],'sg',true);assert.equal(resolvePricingDraft(inherited,'b').baseCents,45000);assert.equal(resolvePricingDraft(inherited,'b').lastMinuteDiscountPct,15);assert.throws(()=>assignPricingGroup(s,ids,'missing',false));
});
test('date precedence is listing then subgroup then group then account without stacking',()=>{
 const s=hierarchy();s.account!.overrides=[override({value:31000})];s.groups[0].overrides=[override({start:'2026-11-12',value:32000})];s.groups[1].overrides=[override({start:'2026-11-13',value:33000})];s.homes.a.overrides=[override({start:'2026-11-14',value:34000})];
 const p=resolvePricingDraft(s,'a'),result=applyPricingDraftOverrides(previewPricing(p,snapshot,now),p,snapshot,s.homes.a.overrides,pricingInheritedOverrides(s,'a'));
 assert.deepEqual(result.days.map(d=>d.recommendedCents),[31000,32000,33000,34000,34000,34000]);assert.equal(result.days[0].steps.at(-1)?.label,'Account override: Holiday');assert.equal(result.days[2].steps.at(-1)?.label,'Subgroup override: Holiday');
});
test('parent and account edits invalidate only affected effective rules and date versions',()=>{
 const s=hierarchy(),next=structuredClone(s);next.account!.policy.farOutPremiumPct=30;assert.equal(revisePricingDraftGroups(s,next).homes.a.version,1);
 next.account!.overrides=[override()];assert.equal(revisePricingDraftGroups(s,next).homes.a.version,2);assert.equal(revisePricingDraftGroups(s,next).homes.b.version,2);
 const parent=structuredClone(s);parent.groups[0].policy.lastMinuteDiscountPct=20;assert.equal(revisePricingDraftGroups(s,parent).homes.a.version,2);assert.equal(revisePricingDraftGroups(s,parent).homes.b.version,1);
});
test('stay-length and arrival rules inherit independently; reset bulk uses parent rules',()=>{
 const s=hierarchy();s.account!.lengthOfStay=[{nights:7,adjustmentPct:-10}];s.groups[0].arrivalDeparture={arrival:[5],departure:[0]};s.homes.a.lengthOfStay=[{nights:28,adjustmentPct:-20}];
 let r=resolvePricingStayRules(s,{kind:'listing',id:'a'});assert.equal(r.rules.lengthOfStay[0].nights,28);assert.deepEqual(r.rules.arrivalDeparture.arrival,[5]);assert.equal(r.sources.arrivalDeparture,'Coastal');
 const next=assignPricingGroup(s,['a'],'sg',true);r=resolvePricingStayRules(next,{kind:'listing',id:'a'});assert.equal(r.rules.lengthOfStay[0].nights,7);
 const after=structuredClone(s);after.account!.lengthOfStay![0].adjustmentPct=-15;assert.equal(revisePricingDraftGroups(s,after).homes.a.version,1);assert.equal(revisePricingDraftGroups(s,after).homes.b.version,2);
});
