/** Synthetic only. This module has no IO, credentials or production rows. */
import {defaultPricingPolicy,previewPricing,pricingPolicySchema,type PricingSnapshot} from './dynamic-pricing.ts';
import {emptyPricingEvidence,pricingEvidenceSchema} from './dynamic-pricing-evidence.ts';
import {shiftIsoDay} from './sca-quotes-types.ts';
import {makePricingObservation,type PricingObservationRecord,type PricingTracking} from './dynamic-pricing-observations.ts';
import {dateInZone} from './dynamic-pricing-inputs.ts';
import type {PricingPortfolioHome} from './dynamic-pricing-portfolio.ts';
export function createPricingDemo(now:Date=new Date()) {
  const today=dateInZone(now,'America/New_York'),policy=defaultPricingPolicy(44500,22500,120000);
  const snapshot:PricingSnapshot={today,observedAt:now.toISOString(),lastBookedOn:null,market:[],days:Array.from({length:180},(_,i)=>({date:shiftIsoDay(today,i),state:i%17===0?'booked':i%13===0?'blocked':'open',currentCents:44500,minNights:2,protected:i===4,observedAt:now.toISOString()}))};
  snapshot.evidence={...emptyPricingEvidence('demo_home'),marketSource:'Synthetic market · sample coastal homes',marketObservedAt:now.toISOString(),historySource:'Synthetic inventory',historyObservedAt:now.toISOString(),
    market:Array.from({length:360},(_,i)=>{const date=shiftIsoDay(today,i),base=40000+10000*Math.sin(i/28);return {date,occupancyPct:Math.max(5,50-i/8),sameTimeLastYearPct:Math.max(3,45-i/8),lastYearFinalPct:75,pickup7Pct:5,lastYearPickup7Pct:3,p25Cents:Math.round(base*.7),p50Cents:Math.round(base),p75Cents:Math.round(base*1.3),p90Cents:Math.round(base*1.7),bookedMedianCents:Math.round(base*.9),bookings:45,vendorCents:Math.round(base*1.05),event:'',lastYearAdrCents:null};}),
    history:Array.from({length:900},(_,i)=>{const date=shiftIsoDay(today,i-900);return {date,state:i%3===0?'open':'booked',bookedOn:i%3===0?null:shiftIsoDay(date,-3),rentCents:i%3===0?null:35000+Number(date.slice(5,7))*700};})};
  return {policy,snapshot};
}

export function createDemoObservations(fixture:ReturnType<typeof createPricingDemo>,authority:'helm'|'guesty'='helm'):PricingObservationRecord[] {
  return [7,14].map(offset=>{
    const snapshot=structuredClone(fixture.snapshot),stamp=new Date(Date.parse(snapshot.observedAt)-offset*86400000).toISOString();
    snapshot.today=shiftIsoDay(snapshot.today,-offset);snapshot.observedAt=stamp;
    snapshot.days=snapshot.days.map(d=>({...d,date:shiftIsoDay(d.date,-offset),observedAt:stamp,currentCents:44500-offset*100}));
    snapshot.evidence={...snapshot.evidence!,marketObservedAt:stamp,historyObservedAt:stamp,
      market:snapshot.evidence!.market.map(m=>({...m,date:shiftIsoDay(m.date,-offset)})),
      history:snapshot.evidence!.history.map(h=>({...h,date:shiftIsoDay(h.date,-offset),bookedOn:h.bookedOn?shiftIsoDay(h.bookedOn,-offset):null}))};
    return {id:`synthetic-${offset}-days-ago`,data:makePricingObservation(fixture.snapshot.evidence?.propertyId??'demo_home',authority,fixture.policy,snapshot,1,0)};
  });
}

import {z} from 'zod';
import type {PricingProfile,PricingRunSummary} from './dynamic-pricing-store.ts';
/** Local in-memory service. No database or production action imports. */
export function createPricingDemoServices(fixture:ReturnType<typeof createPricingDemo>,authority:'helm'|'guesty'='helm') {
    const propertyId=fixture.snapshot.evidence?.propertyId??'demo_home';
    let snapshot=structuredClone(fixture.snapshot),profile:PricingProfile|null=null,evidenceVersion=0;
    let tracking:PricingTracking={enabled:false,version:0};
    const observations=createDemoObservations(fixture,authority),captureIds=new Map<string,string>();
    const history=()=>({observations:[...observations],tracking:{...tracking},scheduledCaptureEnabled:false});
    const runs:PricingRunSummary[]=[],reviews=new Map<string,{preview:ReturnType<typeof previewPricing>;version:number;context:string;createdAt:string}>(),before=new Map<string,PricingSnapshot>(),counts=new Map<string,number>();
    const fail=(error:string)=>({ok:false as const,error});
    return {
      async save(input:unknown){const i=z.object({propertyId:z.literal(propertyId),policy:pricingPolicySchema,mode:z.enum(['shadow','helm_direct']),version:z.number()}).parse(input);
        if(i.mode==='helm_direct'&&authority!=='helm')return fail('Guesty homes remain comparison only');
        if(i.version!==(profile?.version??0))return fail('Settings changed; reload');
        profile={property_id:propertyId,policy:i.policy,mode:i.mode,version:i.version+1};return {ok:true as const,value:profile};},
      async refresh(){return {ok:true as const,value:{profile,policy:profile?.policy??fixture.policy,snapshot,runs:[...runs],evidenceVersion,...history()}};},
      async observe(input:unknown){const i=z.object({propertyId:z.literal(propertyId),requestId:z.string().uuid()}).strict().parse(input);
        if(!profile)return fail('Save a policy first');
        if(!captureIds.has(i.requestId)){const id=crypto.randomUUID();snapshot={...snapshot,observedAt:new Date().toISOString()};
          observations.unshift({id,data:makePricingObservation(i.propertyId,authority,profile.policy,snapshot,profile.version,evidenceVersion)});observations.splice(14);captureIds.set(i.requestId,id);}
        return {ok:true as const,value:history()};},
      async tracking(input:unknown){const i=z.object({propertyId:z.literal(propertyId),enabled:z.boolean(),version:z.number().int().nonnegative()}).strict().parse(input);
        if(!profile||tracking.version!==i.version)return fail('Save the policy or refresh tracking first');
        tracking={enabled:i.enabled,version:i.version+1};return {ok:true as const,value:history()};},
      async evidence(input:unknown){const i=z.object({propertyId:z.literal(propertyId),data:pricingEvidenceSchema,version:z.number()}).parse(input);
        if(i.data.propertyId!==propertyId||i.version!==evidenceVersion)return fail('Evidence changed; reload');
        const observedAt=new Date().toISOString();
        if([i.data.marketObservedAt,i.data.historyObservedAt].some(stamp=>stamp&&Date.parse(stamp)>Date.parse(observedAt)))return fail('Observation time cannot be in the future');
        evidenceVersion++;snapshot={...snapshot,observedAt,evidence:i.data};reviews.clear();return {ok:true as const,value:{snapshot,evidenceVersion}};},
      async review(){if(!profile)return fail('Save a policy first');const id=crypto.randomUUID(),createdAt=new Date().toISOString(),preview=previewPricing(profile.policy,snapshot);
        reviews.set(id,{preview,version:profile.version,context:JSON.stringify(snapshot),createdAt});return {ok:true as const,value:{id,createdAt,preview,snapshot,profile}};},
      async publish(input:unknown){const id=z.string().parse(input),review=reviews.get(id);if(!review||!profile||profile.mode!=='helm_direct')return fail('Prepare a connected review first');
        if(profile.version!==review.version||review.context!==JSON.stringify(snapshot)||Date.now()-Date.parse(review.createdAt)>300000)return fail('Review changed or expired');
        const eligible=review.preview.days.filter(d=>d.eligible);before.set(id,structuredClone(snapshot));counts.set(id,eligible.length);snapshot={...snapshot,days:snapshot.days.map(d=>{const r=eligible.find(n=>n.date===d.date);return r?{...d,currentCents:r.recommendedCents,minNights:r.minNights}:d;})};
        runs.unshift({id,status:'applied',created_at:review.createdAt,applied_at:new Date().toISOString()});reviews.clear();return {ok:true as const,value:eligible.length};},
      async undo(input:unknown){const id=z.string().parse(input),old=before.get(id);if(!old||runs.find(r=>r.status==='applied')?.id!==id)return fail('Only the latest demo batch can be undone');
        snapshot={...snapshot,days:old.days};before.delete(id);const run=runs.find(r=>r.id===id)!;run.status='reverted';reviews.clear();const count=counts.get(id)??0;counts.delete(id);return {ok:true as const,value:count};},
    };
}

/** Six fictional homes with different demand, prices, closures and evidence coverage. */
export function createPricingPortfolioDemo(now=new Date()) {
  const definitions:[string,string,number,number,number,number,'helm'|'guesty'][]=[
    ['Harbor house','Gloucester',3,44500,48,64,'helm'],
    ['Beach cottage','Rockport',2,28500,78,62,'guesty'],
    ['Lighthouse retreat','Gloucester',4,62500,36,56,'helm'],
    ['Cove apartment','Beverly',1,19500,64,52,'guesty'],
    ['Garden house','Rockport',3,36500,58,62,'guesty'],
    ['Seaside bungalow','Gloucester',2,32000,60,60,'helm'],
  ];
  return definitions.map(([name,city,bedrooms,base,occupancy,market,authority],index)=>{
    const home:PricingPortfolioHome={id:`demo_home_${index}`,name,city,bedrooms,authority};
    const fixture=createPricingDemo(now);
    fixture.policy=defaultPricingPolicy(base,Math.round(base/1000)*500,base*3);
    fixture.snapshot.days=fixture.snapshot.days.map((day,i)=>({...day,
      state:index===5&&i<3?'unknown':i%19===15?'blocked':(i*37+index*13)%100<occupancy?'booked':'open',
      currentCents:base,protected:i===9,
    }));
    fixture.snapshot.evidence!.propertyId=home.id;
    fixture.snapshot.evidence!.marketSource=`Synthetic ${city} market`;
    fixture.snapshot.evidence!.market=fixture.snapshot.evidence!.market.map((m,i)=>({...m,occupancyPct:Math.max(0,market-i/8),p25Cents:Math.round(base*.7),p50Cents:base,p75Cents:Math.round(base*1.3),p90Cents:Math.round(base*1.7),vendorCents:base}));
    if(index===4)fixture.snapshot.evidence!.marketObservedAt=new Date(now.getTime()-72*3600000).toISOString();
    return {home,fixture};
  });
}
