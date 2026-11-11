/** Independent, deterministic pricing policy. No vendor IO or learned-market claims. */
import { z } from 'zod';
import { pricingEvidenceSchema } from './dynamic-pricing-evidence.ts';
import { analyzePricingEvidence, historicalSafetyFloor, marketPaceAdjustment } from './dynamic-pricing-model.ts';
import { isIsoDay, shiftIsoDay, nightsBetween } from './sca-quotes-types.ts';
import {pricingCustomizationSchema,seasonalPricingPolicy,type PricingCustomizations} from './dynamic-pricing-customizations.ts';

export const PRICING_MODEL_VERSION = 'helm-3';
const cents = z.number().int().min(100).max(10000000);
const pct = z.number().min(0).max(80);
const iso = z.string().refine(s => isIsoDay(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString().slice(0,10) === s, 'Invalid calendar date');
export const pricingPolicySchema = z.object({
  version: z.literal(1), currency: z.literal('USD'),
  baseCents: cents, floorCents: cents, ceilingCents: cents,
  priceShape: z.enum(['manual','history','market']).default('manual'), marketPacingEnabled:z.boolean().default(false),
  safetyFloorEnabled:z.boolean().default(false), safetyFloorAfterDays:z.number().int().min(0).max(499).default(180),
  lowestMinNights:z.number().int().min(1).max(30).default(1), minimumBookingCents:z.number().int().min(0).max(10000000).default(0),
  orphanPreservesEvents:z.boolean().default(true), adjacentMinNights:z.number().int().min(0).max(7).default(0),
  lastMinStays:z.array(z.object({withinDays:z.number().int().min(0).max(90),weekday:z.number().int().min(1).max(30),weekend:z.number().int().min(1).max(30)}).strict()).max(3).default([]),
  monthlyFactors: z.array(z.number().min(0.25).max(4)).length(12),
  weekdayFactors: z.array(z.number().min(0.5).max(2)).length(7),
  lastMinuteDays: z.number().int().min(1).max(90), lastMinuteDiscountPct: pct,
  farOutStart: z.number().int().min(30).max(365),
  farOutEnd: z.number().int().min(31).max(730), farOutPremiumPct: pct,
  occupancyEnabled: z.boolean(), occupancyTargets: z.array(z.number().min(0).max(100)).length(3),
  occupancyMaxAdjustmentPct: z.number().min(0).max(30),
  recencyEnabled: z.boolean(), orphanMaxNights: z.number().int().min(0).max(7), orphanDiscountPct: pct,
  maxCombinedDiscountPct: pct, maxChangePct: z.number().min(1).max(100),
  weekdayMinNights: z.number().int().min(1).max(30), weekendMinNights: z.number().int().min(1).max(30),
  farMinStays: z.array(z.object({ afterDays: z.number().int().min(0).max(730),
    weekday: z.number().int().min(1).max(30), weekend: z.number().int().min(1).max(30) }).strict()).max(5),
  events: z.array(z.object({ start: iso, end: iso, label: z.string().trim().min(1).max(100),
    adjustmentPct: z.number().min(-50).max(200), minNights: z.number().int().min(1).max(30).nullable(),
  }).strict().refine(e => e.end >= e.start && nightsBetween(e.start, e.end) <= 90, 'Invalid event window')).max(40),
}).strict().superRefine((p, ctx) => {
  if (p.floorCents > p.baseCents || p.baseCents > p.ceilingCents) ctx.addIssue({ code: 'custom', message: 'Minimum ≤ base ≤ maximum is required' });
  if (p.farOutStart >= p.farOutEnd) ctx.addIssue({ code: 'custom', message: 'Far-out end must follow its start' });
  if(new Set(p.lastMinStays.map(r=>r.withinDays)).size!==p.lastMinStays.length) ctx.addIssue({code:'custom',message:'Last-minute thresholds must be unique'});
  const events = [...p.events].sort((a,b) => a.start.localeCompare(b.start));
  if (events.some((e,i) => i > 0 && e.start <= events[i-1].end)) ctx.addIssue({ code: 'custom', message: 'Event windows must not overlap' });
  if (new Set(p.farMinStays.map(s => s.afterDays)).size !== p.farMinStays.length) ctx.addIssue({ code: 'custom', message: 'Minimum-stay thresholds must be unique' });
});
export type PricingPolicy = z.infer<typeof pricingPolicySchema>;
export function defaultPricingPolicy(baseCents: number, floorCents: number, ceilingCents: number): PricingPolicy {
  return pricingPolicySchema.parse({ version: 1, currency: 'USD', baseCents, floorCents, ceilingCents,
    monthlyFactors: Array(12).fill(1), weekdayFactors: Array(7).fill(1),
    lastMinuteDays: 30, lastMinuteDiscountPct: 22, farOutStart: 60, farOutEnd: 227, farOutPremiumPct: 20,
    occupancyEnabled: false, occupancyTargets: [70,50,30], occupancyMaxAdjustmentPct: 20,
    recencyEnabled: false, orphanMaxNights: 1, orphanDiscountPct: 0,
    maxCombinedDiscountPct: 30, maxChangePct: 20, weekdayMinNights: 2, weekendMinNights: 2,
    farMinStays: [{afterDays:15,weekday:2,weekend:3},{afterDays:60,weekday:3,weekend:4}], events: [],
  });
}

const pricingDaySchema = z.object({ date: iso, state: z.enum(['open','booked','blocked','unknown']),
  currentCents: cents.nullable(), minNights: z.number().int().min(1).max(365).nullable(),
  protected: z.boolean(), observedAt: z.string().datetime(),
}).strict();
export type PricingDay = z.infer<typeof pricingDaySchema>;
const snapshotSchema = z.object({ today: iso, observedAt: z.string().datetime(), evidence:pricingEvidenceSchema.optional(),
  days: z.array(pricingDaySchema).max(550), lastBookedOn: iso.nullable(),
  market: z.array(z.object({ date: iso, factor: z.number().min(0.5).max(2),
    observedAt: z.string().datetime(), source: z.string().min(1).max(120) }).strict()).max(500),
}).strict();
export type PricingSnapshot = z.infer<typeof snapshotSchema>;
export type PricingStep = { label: string; adjustmentPct: number; resultCents: number };
export type PriceRecommendation = {
  date: string; state: PricingDay['state']; currentCents: number | null;
  recommendedCents: number | null; minNights: number | null; changePct: number | null;
  eligible: boolean; reasons: string[]; steps: PricingStep[];
};
export type PricingPreview = { modelVersion: string; days: PriceRecommendation[];
  occupancy: { start: string; end: string; booked: number; sellable: number; unknown: number; pct: number | null }[];
  warnings: string[] };
const clamp = (n:number, a:number, b:number) => Math.min(b, Math.max(a,n));
const fresh = (stamp: string, now:number) => Number.isFinite(Date.parse(stamp)) && Date.parse(stamp) <= now && now - Date.parse(stamp) <= 36*3600000;

/** No calendar mutation: booked, closed, unknown and operator nights are never eligible.
 * Occupancy excludes deliberate blocks and never interprets missing coverage as vacant.
 * The budget cap applies to the PRODUCT of discounts, before premiums and hard bounds.
 */
export function previewPricing(policyInput: unknown, snapshotInput: unknown, now: Date = new Date(), draftCustomizations?:PricingCustomizations): PricingPreview {
  const policy = pricingPolicySchema.parse(policyInput), snap = snapshotSchema.parse(snapshotInput), at = now.getTime();
  const custom=draftCustomizations?pricingCustomizationSchema.parse(draftCustomizations):undefined,defaultPolicy=policy;
  if (!Number.isFinite(at)) throw Error('Invalid evaluation clock');
  const byDate = new Map(snap.days.map(d => [d.date,d]));
  if (byDate.size !== snap.days.length) throw Error('Duplicate calendar date');
  if (new Set(snap.market.map(d=>d.date)).size !== snap.market.length) throw Error('Duplicate market date');
  if (snap.lastBookedOn && snap.lastBookedOn > snap.today) throw Error('Booking recency date is in the future');
  const analysis=snap.evidence?analyzePricingEvidence(snap.evidence,snap.today,now):null;
  const warnings = ['Pricing rules and forecast coefficients are Helm assumptions, not PriceLabs proprietary weights.',...(analysis?.warnings??[])];
  if(policy.priceShape==='history'&&!analysis?.shape.qualified)warnings.push('Historical price learning is unavailable. Publishing is blocked until qualified data is supplied.');
  if((policy.priceShape==='market'||policy.marketPacingEnabled)&&!analysis?.marketFresh)warnings.push('Fresh market evidence is required for this policy. Publishing is blocked.');
  if (!snap.market.length&&!analysis?.marketFresh) warnings.push('No independent market-demand feed is connected. Market adjustments are neutral.');
  if (!fresh(snap.observedAt,at)) warnings.push('Calendar snapshot is stale. Publishing is blocked.');
  if (policy.recencyEnabled && !snap.lastBookedOn) warnings.push('Booking creation date is unavailable. Recency discount is skipped.');
  const occupancy = [[0,14],[15,29],[30,59]].map(([a,b]) => {
    let booked=0,sellable=0,unknown=0;
    for(let i=a;i<=b;i++) {
      const d=byDate.get(shiftIsoDay(snap.today,i));
      if (!d || d.state==='unknown' || !fresh(d.observedAt,at)) unknown++;
      else if(d.state==='open' || d.state==='booked') { sellable++; if(d.state==='booked') booked++; }
    }
    return {start:shiftIsoDay(snap.today,a),end:shiftIsoDay(snap.today,b),booked,sellable,unknown,pct:unknown || !sellable ? null : 100*booked/sellable};
  });
  if (policy.occupancyEnabled && occupancy.some(w=>w.pct===null)) warnings.push('Incomplete or fully blocked occupancy windows are not adjusted.');
  function gapLength(date:string) {
    let start=date,end=date;
    // Only a bounded gap between known booked/blocked nights; horizon edges are not gaps.
    for(let i=0;i<=policy.orphanMaxNights;i++) {
      const prev=byDate.get(shiftIsoDay(start,-1));
      if(prev?.state!=='open' || !fresh(prev.observedAt,at)) break;
      start=prev.date;
    }
    for(let i=0;i<=policy.orphanMaxNights;i++) {
      const next=byDate.get(shiftIsoDay(end,1));
      if(next?.state!=='open' || !fresh(next.observedAt,at)) break;
      end=next.date;
    }
    const before=byDate.get(shiftIsoDay(start,-1)),after=byDate.get(shiftIsoDay(end,1));
    const held=(d:PricingDay|undefined)=>d && (d.state==='booked'||d.state==='blocked') && fresh(d.observedAt,at);
    return held(before)&&held(after) ? nightsBetween(start,end)+1 : 0;
  }
  const days = [...snap.days].sort((a,b)=>a.date.localeCompare(b.date)).map((day):PriceRecommendation => {
    const reasons:string[]=[],steps:PricingStep[]=[];
    const lead=nightsBetween(snap.today,day.date), dow=new Date(day.date+'T12:00:00Z').getUTCDay();
    const result:PriceRecommendation={date:day.date,state:day.state,currentCents:day.currentCents,recommendedCents:null,minNights:day.minNights,changePct:null,eligible:false,reasons,steps};
    if(lead<0 || lead>499) { reasons.push('Outside the future pricing horizon'); return result; }
    if(day.state!=='open') { reasons.push(day.state==='unknown'?'Calendar coverage missing':'Unavailable night kept unchanged'); return result; }
    if(day.protected) { reasons.push('Operator override kept unchanged'); result.recommendedCents=day.currentCents; return result; }
    const seasonal=seasonalPricingPolicy(defaultPolicy,day.date,custom?.seasonalPrices),policy=seasonal.policy;
    if(seasonal.error){reasons.push(seasonal.error);return result;}
    let value=policy.baseCents;
    steps.push({label:seasonal.season?`Season: ${seasonal.season.name} · Base price`:'Base price',adjustmentPct:0,resultCents:value});
    function apply(label:string,factor:number) { value*=factor; steps.push({label,adjustmentPct:(factor-1)*100,resultCents:Math.round(value)}); }
    const evidenceMarket=snap.evidence?.market.find(m=>m.date===day.date);
    if(policy.priceShape==='history'&&analysis?.shape.qualified) {
      apply('Learned monthly pattern',analysis.shape.monthlyFactors[Number(day.date.slice(5,7))-1]);
      apply('Learned weekday residual',analysis.shape.weekdayFactors[dow]);
    } else if(policy.priceShape==='market'&&analysis?.marketFresh&&analysis.marketCenter&&evidenceMarket?.p50Cents) {
      apply('Market asking-price shape (base anchored)',clamp(evidenceMarket.p50Cents/analysis.marketCenter,0.5,2));
    } else {
      apply('Seasonal assumption',policy.monthlyFactors[Number(day.date.slice(5,7))-1]);
      apply('Day of week',policy.weekdayFactors[dow]);
      if(policy.priceShape!=='manual')reasons.push('Selected price shape lacks qualified evidence');
    }
    if(policy.marketPacingEnabled) {
      if(analysis?.marketFresh&&evidenceMarket&&evidenceMarket.occupancyPct!==null&&evidenceMarket.sameTimeLastYearPct!==null)
        apply('Market booking pace and pickup',1+marketPaceAdjustment(evidenceMarket)/100);
      else reasons.push('Fresh market occupancy and same-time baseline required');
    }
    const market=snap.market.find(m=>m.date===day.date);
    if(market && fresh(market.observedAt,at)) apply(`Market: ${market.source}`,market.factor);
    else if(market) reasons.push('Stale market observation skipped');
    const event=policy.events.find(e=>e.start<=day.date&&e.end>=day.date);
    if(event) apply(event.label,1+event.adjustmentPct/100);
    const beforeDiscounts=value;
    if(custom?.leadTimeModes.lastMinute==='flat'){
      if(lead<=policy.lastMinuteDays)apply('Last minute (flat)',1-policy.lastMinuteDiscountPct/100);
    }else if(lead<policy.lastMinuteDays) apply('Last minute',1-policy.lastMinuteDiscountPct/100*(1-lead/policy.lastMinuteDays));
    const bucket=lead<=14?0:lead<=29?1:lead<=59?2:null;
    if(policy.occupancyEnabled && bucket!==null && occupancy[bucket].pct!==null) {
      // Bounded response to the operator's booking-pace target; no elasticity claim.
      const delta=clamp((occupancy[bucket].pct!-policy.occupancyTargets[bucket])*0.5,-policy.occupancyMaxAdjustmentPct,policy.occupancyMaxAdjustmentPct);
      if(delta<0) apply('Occupancy below target',1+delta/100);
    }
    if(policy.recencyEnabled && snap.lastBookedOn && lead<30) {
      const since=nightsBetween(snap.lastBookedOn,snap.today);
      if(since>=15) apply('Booking recency',1-clamp(5+(since-15)/3,5,15)/100);
    }
    const gap=policy.orphanMaxNights?gapLength(day.date):0;
    const orphan=gap>0&&gap<=policy.orphanMaxNights;
    if(orphan && policy.orphanDiscountPct) apply('Short calendar gap',1-policy.orphanDiscountPct/100);
    const discountFloor=beforeDiscounts*(1-policy.maxCombinedDiscountPct/100);
    if(value<discountFloor) { value=discountFloor; steps.push({label:'Combined discount limit',adjustmentPct:0,resultCents:Math.round(value)}); }
    if(policy.occupancyEnabled && bucket!==null && occupancy[bucket].pct!==null) {
      const delta=clamp((occupancy[bucket].pct!-policy.occupancyTargets[bucket])*0.5,0,policy.occupancyMaxAdjustmentPct);
      if(delta>0) apply('Occupancy above target',1+delta/100);
    }
    if(lead>policy.farOutStart) apply(custom?.leadTimeModes.farOut==='flat'?'Far-out premium (flat)':'Far-out premium',1+policy.farOutPremiumPct/100*(custom?.leadTimeModes.farOut==='flat'?1:clamp((lead-policy.farOutStart)/(policy.farOutEnd-policy.farOutStart),0,1)));
    if(policy.safetyFloorEnabled&&lead>policy.safetyFloorAfterDays&&!event&&snap.evidence) {
      const safety=historicalSafetyFloor(snap.evidence,day.date,snap.today);
      if(safety!==null&&value<safety){value=safety;steps.push({label:'110% of matched last-year accommodation ADR',adjustmentPct:0,resultCents:value});}
    }
    value=Math.max(Math.round(clamp(value,policy.floorCents,policy.ceilingCents)/100)*100,
      Math.ceil((discountFloor-1e-7)/100)*100); // rounding must not deepen a capped discount
    value=clamp(value,policy.floorCents,policy.ceilingCents); // rounding can never cross hard bounds
    steps.push({label:'Minimum, maximum and rounding',adjustmentPct:0,resultCents:value});
    const weekend=custom?custom.weekendDays.includes(dow):dow===5||dow===6;
    let minNights=weekend?policy.weekendMinNights:policy.weekdayMinNights;
    for(const rule of [...policy.lastMinStays].sort((a,b)=>b.withinDays-a.withinDays)) if(lead<=rule.withinDays) minNights=weekend?rule.weekend:rule.weekday;
    for(const rule of [...policy.farMinStays].sort((a,b)=>a.afterDays-b.afterDays)) if(lead>rule.afterDays) minNights=weekend?rule.weekend:rule.weekday;
    if(policy.minimumBookingCents>0)minNights=Math.max(minNights,Math.ceil(policy.minimumBookingCents/value));
    const before=byDate.get(shiftIsoDay(day.date,-1));
    if(policy.adjacentMinNights&&before&&(before.state==='booked'||before.state==='blocked')&&fresh(before.observedAt,at))minNights=Math.min(minNights,policy.adjacentMinNights);
    if(event?.minNights) minNights=event.minNights;
    if(orphan&&(!event?.minNights||!policy.orphanPreservesEvents)) minNights=Math.min(minNights,gap);
    minNights=Math.max(minNights,policy.lowestMinNights);
    if(minNights>30)reasons.push('Booking-value minimum exceeds supported 30 nights');
    if(orphan&&minNights>gap)reasons.push('Minimum stay cannot fit this gap');
    steps.push({label:`Minimum stay: ${minNights} nights`,adjustmentPct:0,resultCents:value});
    result.recommendedCents=value; result.minNights=minNights;
    result.changePct=day.currentCents?100*(value/day.currentCents-1):null;
    if(!fresh(snap.observedAt,at)||!fresh(day.observedAt,at)) reasons.push('Refresh calendar before publishing');
    if(day.currentCents===null) reasons.push('No current rate to compare');
    else if(Math.abs(result.changePct!)>policy.maxChangePct+1e-9) reasons.push(`Change exceeds ${policy.maxChangePct}% review limit`);
    result.eligible=reasons.length===0;
    return result;
  });
  return {modelVersion:custom?'helm-3-local-customizations':PRICING_MODEL_VERSION,days,occupancy,warnings};
}
