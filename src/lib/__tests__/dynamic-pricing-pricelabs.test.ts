import test from 'node:test';
import assert from 'node:assert/strict';
import Papa from 'papaparse';
import {importPriceLabsSettings,parsePriceLabsMinimumStay,type PriceLabsExports} from '../dynamic-pricing-pricelabs.ts';
import {emptyPricingDrafts,resolvePricingDraft,resolvePricingCustomizations,resolvePricingStayRules,applyPricingDraftOverrides,pricingDraftsSchema,savePricingDraftPolicy} from '../dynamic-pricing-drafts.ts';
import {importedPricingBound} from '../dynamic-pricing-import-source.ts';
import {previewPricing,type PricingSnapshot} from '../dynamic-pricing.ts';
import {shiftIsoDay} from '../sca-quotes-types.ts';
const stamp=new Date('2026-11-12T15:00:00Z');
const groupStay='ACTIVE MINSTAY PROFILE : Example profile Default : Fixed Weekday: 2 nights | Weekend: 2 nights Far Out : Weekday: 2 nights | Weekend: 2 nights beyond 7 nights Weekday: 2 nights | Weekend: 3 nights beyond 15 nights Weekday: 3 nights | Weekend: 3 nights beyond 25 nights Weekday: 4 nights | Weekend: 4 nights beyond 50 nights Weekday: 5 nights | Weekend: 5 nights beyond 180 nights';
const group={'Group Name':'Example group','Min Stay':groupStay,'Last Minute Prices':'25% discount within 20 days (Gradual)','Far Out Prices':'After 65 days, gradual premium of 40.0% over 300 days','Weekend Days':'Thu, Fri, Sat','Weekly Discounts':'Weekly Discounts: 10%','Monthly Discounts':'Monthly Discounts: 15%','Occupancy Based Adjustments':'No occupancy based adjustment','Booking Recency Factor':'No Booking Recency Factor','Orphan Day Prices':'No Discount'};
const home={id:'internal-home',name:'Internal name',guestyListingId:'external-home'};
const listing={'Listing ID':'external-home','Listing Name':'Public name','PMS Name':'guesty','Base Price':'400','Min Price':'150','Max Price':'','Customization Group':'Example group','Customization Sub Group':''};
const rules={'Listing ID':'external-home','Listing Name':'Public name','Min Stay':`Group Level: ${groupStay}`,'Last Minute Prices':'60% discount within 30 days (Gradual)','Far Out Prices':`Group Level: ${group['Far Out Prices']}`,'Weekend Days':'Group Level: Thu, Fri, Sat','Weekly Discounts':'Group Level: Weekly Discounts: 10%','Monthly Discounts':'Group Level: Monthly Discounts: 15%','Occupancy Based Adjustments':'Group Level: No occupancy based adjustment','Booking Recency Factor':'Group Level: No Booking Recency Factor','Safety Minimum Price':'Set Safety Minimum Price to 110% of last-year-same-day ADR for nights beyond 180 days from today.','Orphan Day Prices':'Group Level: No Discount'};
const csv=(rows:Record<string,string>[])=>Papa.unparse(rows);
function files(l={},r={},g={}):PriceLabsExports{return {listings:csv([{...listing,...l}]),rules:csv([{...rules,...r}]),groups:csv([{...group,...g}]),overrides:'Listing Id,PMS Name,Start Date,End Date,Minimum Stay\n'};}
const imported=(f=files())=>importPriceLabsSettings(f,[home],emptyPricingDrafts(),stamp);
function snapshot():PricingSnapshot{return {today:'2026-11-12',observedAt:stamp.toISOString(),lastBookedOn:null,market:[],days:Array.from({length:400},(_,i)=>({date:shiftIsoDay('2026-11-12',i),state:'open',currentCents:40000,minNights:2,protected:false,observedAt:stamp.toISOString()}))};}

test('exact external ID maps to internal name; unset max is preserved through storage',()=>{
  const result=imported(),draft=result.drafts.homes[home.id];
  assert.equal(result.rows[0].name,home.name);assert.equal(draft.policy.baseCents,40000);assert.equal(draft.policy.floorCents,15000);
  assert.equal(draft.importSource?.maxCents,null);assert.equal(importedPricingBound(draft.policy,draft.importSource,'max'),null);
  assert.deepEqual(pricingDraftsSchema.parse(JSON.parse(JSON.stringify(result.drafts))),result.drafts);
  assert.equal(importedPricingBound({...draft.policy,ceilingCents:90000},draft.importSource,'max'),90000);
});

test('a matching public name never substitutes for a missing or ambiguous external ID',()=>{
  assert.throws(()=>importPriceLabsSettings(files(),[{...home,guestyListingId:'wrong'}]),/No configured listings matched/);
  assert.throws(()=>importPriceLabsSettings(files(),[home,{...home,id:'other'}]),/No configured listings matched/);
  assert.throws(()=>importPriceLabsSettings(files({'PMS Name':'another-pms'}),[home]),/No configured listings matched/);
});

test('missing base is skipped and a missing minimum remains unset',()=>{
  const f=files({'Min Price':''});const rows=Papa.parse<Record<string,string>>(f.listings,{header:true}).data;
  f.listings=csv([...rows,{...listing,'Listing ID':'inactive','Base Price':''}]);
  const result=importPriceLabsSettings(f,[home,{id:'inactive-internal',name:'Inactive',guestyListingId:'inactive'}],emptyPricingDrafts(),stamp);
  assert.equal(result.rows.length,1);assert.match(result.skipped[0].reason,/No base price/);
  const h=result.drafts.homes[home.id];assert.equal(importedPricingBound(h.policy,h.importSource,'min'),null);
});

test('invalid bounds, duplicate exports and stale group snapshots fail atomically',()=>{
  const state=emptyPricingDrafts(),before=JSON.stringify(state);
  assert.throws(()=>importPriceLabsSettings(files({'Min Price':'500'}),[home],state),/Minimum/);
  const duplicate=files();duplicate.listings=csv([listing,listing]);assert.throws(()=>imported(duplicate),/duplicate Listing ID/);
  assert.throws(()=>imported(files({}, {'Weekend Days':'Group Level: Fri, Sat'})),/exports disagree/);
  assert.equal(JSON.stringify(state),before);
});

test('group minimum stays inherit while listing discount is an override',()=>{
  const s=imported().drafts,h=s.homes[home.id];
  assert.ok(!h.ruleCategories?.includes('minimumStay'));assert.ok(h.ruleCategories?.includes('lastMinute'));
  assert.equal(resolvePricingDraft(s,home.id).lastMinuteDiscountPct,60);
  s.groups[0].policy.weekdayMinNights=4;
  assert.equal(resolvePricingDraft(s,home.id).weekdayMinNights,4);
  const stays=resolvePricingStayRules(s,{kind:'listing',id:home.id});
  assert.deepEqual(stays.rules.lengthOfStay,[{nights:7,adjustmentPct:-10},{nights:28,adjustmentPct:-15}]);
  assert.deepEqual(resolvePricingCustomizations(s,{kind:'listing',id:home.id}).rules.weekendDays,[4,5,6]);
});

test('group far-out duration is added to start, and imported discounts are not clipped at old 30% default',()=>{
  const s=imported(files({'Min Price':''})).drafts,p=resolvePricingDraft(s,home.id),custom=resolvePricingCustomizations(s,{kind:'listing',id:home.id}).rules;
  assert.deepEqual([p.farOutStart,p.farOutEnd,p.farOutPremiumPct],[65,365,40]);
  const preview=previewPricing(p,snapshot(),stamp,custom);
  assert.equal(preview.days[0].recommendedCents,16000);
  assert.equal(preview.days[365].recommendedCents,56000);
});

test('Master-style stays respect exclusive far-out thresholds and Thursday weekends',()=>{
  const s=imported().drafts,p=resolvePricingDraft(s,home.id),custom=resolvePricingCustomizations(s,{kind:'listing',id:home.id}).rules;
  const result=previewPricing(p,snapshot(),stamp,custom);
  assert.equal(result.days[14].minNights,2); // Thu before >15 tier
  assert.equal(result.days[21].minNights,3); // Thu is a configured weekend
  assert.equal(result.days[25].minNights,2); // Mon at exactly 25: prior tier
  assert.equal(result.days[26].minNights,3);
  assert.equal(result.days[50].minNights,3);assert.equal(result.days[51].minNights,4);
  assert.equal(result.days[180].minNights,4);assert.equal(result.days[181].minNights,5);
});

test('four last-minute tiers through 180 days are retained and evaluated most specifically',()=>{
  const text='Default : Fixed Weekday: 3 nights | Weekend: 3 nights Last Minute : Weekday: 3 nights | Weekend: 3 nights within 45 nights Weekday: 3 nights | Weekend: 4 nights within 90 nights Weekday: 4 nights | Weekend: 4 nights within 120 nights Weekday: 5 nights | Weekend: 5 nights within 180 nights';
  const s=imported(files({}, {'Min Stay':text})).drafts,p=resolvePricingDraft(s,home.id);
  assert.equal(p.lastMinStays.length,4);assert.equal(p.farMinStays.length,0);
  const result=previewPricing(p,snapshot(),stamp,resolvePricingCustomizations(s,{kind:'listing',id:home.id}).rules);
  assert.equal(result.days[0].minNights,3);assert.equal(result.days[91].minNights,4);assert.equal(result.days[121].minNights,5);assert.equal(result.days[181].minNights,3);
});

test('one-night gap minimum applies only to bounded, fresh inventory and not every open date',()=>{
  const s=imported(files({}, {'Min Stay':'Default : Fixed Weekday: 2 nights | Weekend: 2 nights Orphan Gaps : Weekday: Gap Length nights | Weekend: Gap Length nights for gaps between 1 and 1 night'})).drafts,p=resolvePricingDraft(s,home.id),snap=snapshot();
  snap.days[9].state='booked';snap.days[11].state='blocked';
  const result=previewPricing(p,snap,stamp);
  assert.equal(result.days[10].minNights,1);assert.equal(result.days[8].minNights,2);assert.equal(result.days[11].eligible,false);
});

test('unknown stay grammar or duplicate tiers never silently becomes a two-night default',()=>{
  assert.throws(()=>parsePriceLabsMinimumStay('Default : Fixed Weekday: 2 nights | Weekend: 2 nights Unsupported Seasonal Rule'),/not yet supported/);
  assert.throws(()=>imported(files({}, {'Min Stay':''})),/no exported minimum-stay/);
  assert.throws(()=>parsePriceLabsMinimumStay(groupStay+' Weekday: 6 nights | Weekend: 6 nights beyond 180 nights'));
});

test('date minimum overrides persist and protect booked nights',()=>{
  const f=files();f.overrides=csv([{'Listing Id':'external-home','PMS Name':'guesty','Start Date':'2026-12-10','End Date':'2026-12-11','Minimum Stay':'1','Price':'','Currency':'USD'}]);
  const s=imported(f).drafts,p=resolvePricingDraft(s,home.id),snap=snapshot();snap.days[29].state='booked';
  const preview=applyPricingDraftOverrides(previewPricing(p,snap,stamp),p,snap,s.homes[home.id].overrides);
  assert.equal(preview.days[28].minNights,1);assert.equal(preview.days[29].minNights,2);assert.equal(preview.days[29].eligible,false);
});

test('unsupported date restrictions stop the import rather than dropping part of a rule',()=>{
  const f=files();f.overrides=csv([{'Listing Id':'external-home','PMS Name':'guesty','Start Date':'2026-12-10','End Date':'2026-12-11','Minimum Stay':'1','Minimum Price':'250'}]);
  assert.throws(()=>imported(f),/unsupported bounds/);
});

test('market-driven settings are recorded without pretending Helm can reproduce their algorithm',()=>{
  const value='Market Driven (Balanced): Current observed rule';
  const s=imported(files({}, {'Far Out Prices':value})).drafts,h=s.homes[home.id];
  assert.equal(h.importSource?.settings['Far Out Prices'],value);assert.ok(h.importSource?.warnings.some(w=>w.includes('not reproduced')));
  assert.equal(resolvePricingDraft(s,home.id).farOutPremiumPct,0);
});

test('repeat import advances versions and keeps unrelated drafts and provenance on ordinary saves',()=>{
  const s=imported().drafts;s.homes.unrelated={...s.homes[home.id],groupId:null};
  const next=importPriceLabsSettings(files(),[home],s,stamp);
  assert.deepEqual(next.drafts.homes.unrelated,s.homes.unrelated);assert.equal(next.drafts.homes[home.id].version,2);
  const policy=resolvePricingDraft(next.drafts,home.id);policy.baseCents=42000;
  const saved=savePricingDraftPolicy(next.drafts,home.id,policy,2);
  assert.deepEqual(saved.homes[home.id].importSource,next.drafts.homes[home.id].importSource);
});
