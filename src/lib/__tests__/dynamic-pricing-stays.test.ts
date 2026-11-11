import {test} from 'node:test';
import assert from 'node:assert/strict';
import {neutralPricingDraft} from '../dynamic-pricing-drafts.ts';
import {previewPricing,type PricingSnapshot} from '../dynamic-pricing.ts';
import {defaultPricingStayRules,previewPricingStay,pricingLengthOfStaySchema,pricingArrivalDepartureSchema} from '../dynamic-pricing-stays.ts';
import {shiftIsoDay} from '../sca-quotes-types.ts';
const policy=neutralPricingDraft(30001,20000,60000),rules={...defaultPricingStayRules(),lengthOfStay:[{nights:7,adjustmentPct:-10},{nights:28,adjustmentPct:-20}]};
const snapshot:PricingSnapshot={today:'2026-11-11',observedAt:'2026-11-11T16:00:00Z',lastBookedOn:null,market:[],days:Array.from({length:60},(_,i)=>({date:shiftIsoDay('2026-11-11',i),state:'open',currentCents:30001,minNights:2,protected:false,observedAt:'2026-11-11T16:00:00Z'}))};
// A date override may retain cents even though base model output rounds to whole dollars.
const base=previewPricing(policy,snapshot,new Date(snapshot.observedAt));
const preview={...base,days:base.days.map(d=>({...d,recommendedCents:30001}))};
test('stay discounts use longest threshold once with cent-accurate nightly rounding',()=>{
 const week=previewPricingStay(snapshot,preview,policy,rules,'2026-11-11','2026-11-18');assert.equal(week.totalCents,27001*7);assert.equal(week.subtotalCents,30001*7);assert.equal(week.passes,true);
 const month=previewPricingStay(snapshot,preview,policy,rules,'2026-11-11','2026-12-09');assert.equal(month.adjustmentPct,-20);assert.equal(month.totalCents,24001*28);
 const short=previewPricingStay(snapshot,preview,policy,rules,'2026-11-11','2026-11-17');assert.equal(short.adjustmentPct,0);assert.equal(short.totalCents,30001*6);
});
test('net stay prices preserve floor and ceiling and report constrained nights',()=>{
 const low=previewPricingStay(snapshot,preview,policy,{...rules,lengthOfStay:[{nights:2,adjustmentPct:-80}]},'2026-11-11','2026-11-18');assert.equal(low.totalCents,20000*7);assert.equal(low.limitedNights,7);
 const high=previewPricingStay(snapshot,preview,policy,{...rules,lengthOfStay:[{nights:2,adjustmentPct:200}]},'2026-11-11','2026-11-18');assert.equal(high.totalCents,60000*7);
});
test('stay checks arrival/departure weekdays, arrival minimum and minimum booking value',()=>{
 const restricted={...rules,arrivalDeparture:{arrival:[5],departure:[0]}};let r=previewPricingStay(snapshot,preview,policy,restricted,'2026-11-11','2026-11-18');assert.equal(r.errors.length,2);assert.equal(r.passes,false);
 r=previewPricingStay(snapshot,preview,policy,rules,'2026-11-11','2026-11-12');assert.ok(r.errors.some(e=>e.includes('at least 2')));
 r=previewPricingStay(snapshot,preview,{...policy,minimumBookingCents:300000},rules,'2026-11-11','2026-11-18');assert.ok(r.errors.some(e=>e.includes('minimum booking value')));
});
test('booked, blocked, protected, stale and unknown nights suppress totals',()=>{
 for(const change of [{state:'booked'},{state:'blocked'},{protected:true},{observedAt:'2026-11-08T00:00:00Z'},{state:'unknown'}]){
  const s=structuredClone(snapshot);Object.assign(s.days[1],change);const r=previewPricingStay(s,preview,policy,rules,'2026-11-11','2026-11-18');assert.equal(r.totalCents,null);assert.equal(r.subtotalCents,null);assert.equal(r.passes,false);
 }
 const missing=previewPricingStay(snapshot,preview,policy,rules,'2027-01-11','2027-01-18');assert.equal(missing.totalCents,null);
});
test('departure night is excluded and invalid windows or duplicate thresholds reject',()=>{
 const s=structuredClone(snapshot);s.days[7].state='booked';assert.equal(previewPricingStay(s,preview,policy,rules,'2026-11-11','2026-11-18').passes,true);
 for(const [a,b] of [['2026-11-10','2026-11-11'],['2026-11-11','2026-11-11'],['2026-11-11','2026-11-10'],['2026-11-11','2028-01-01'],['2026-02-30','2026-11-11']])assert.throws(()=>previewPricingStay(snapshot,preview,policy,rules,a,b));
 assert.throws(()=>pricingLengthOfStaySchema.parse([{nights:7,adjustmentPct:10},{nights:7,adjustmentPct:-10}]));assert.throws(()=>pricingArrivalDepartureSchema.parse({arrival:[],departure:[1]}));
});

test('unqualified nightly recommendations cannot produce a passing stay check',()=>{
 const unqualified={...preview,days:preview.days.map(d=>({...d,eligible:false}))};
 const r=previewPricingStay(snapshot,unqualified,policy,rules,'2026-11-11','2026-11-18');assert.equal(r.passes,false);assert.ok(r.errors.some(e=>e.includes('need review')));assert.equal(r.totalCents,27001*7);
});
