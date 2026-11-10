/** Dated comparison evidence. No booking identities, revenue or publishing IO. */
import {z} from 'zod';
import {PRICING_MODEL_VERSION,previewPricing,type PricingPolicy,type PricingSnapshot} from './dynamic-pricing.ts';
import {forecastNight} from './dynamic-pricing-model.ts';
import {evidenceFresh} from './dynamic-pricing-evidence.ts';
import {nightsBetween} from './sca-quotes-types.ts';

const day=z.string().refine(s=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s,'Invalid date');
const price=z.number().int().min(100).max(10000000).nullable();
export const pricingObservationSchema=z.object({
  version:z.literal(1),propertyId:z.string().min(1).max(100),authority:z.enum(['helm','guesty']),
  capturedAt:z.string().datetime(),asOf:day,modelVersion:z.string().min(1).max(40),
  policyVersion:z.number().int().positive(),evidenceVersion:z.number().int().nonnegative(),
  days:z.array(z.object({
    date:day,state:z.enum(['open','booked','blocked','unknown']),currentCents:price,recommendedCents:price,
    minNights:z.number().int().min(1).max(100000).nullable(),eligible:z.boolean(),
    saleProbability:z.number().min(0).max(1).nullable(),forecastBasis:z.string().max(200),
    sourceObservedAt:z.string().datetime(),
  }).strict()).min(1).max(500),
}).strict().superRefine((o,c)=>{
  if(new Set(o.days.map(d=>d.date)).size!==o.days.length)c.addIssue({code:'custom',message:'Duplicate observation date'});
  if(o.days.some(d=>d.date<o.asOf||nightsBetween(o.asOf,d.date)>499))c.addIssue({code:'custom',message:'Observation dates must be within the forward window'});
  if(o.days.some(d=>d.state!=='open'&&d.saleProbability!==null))c.addIssue({code:'custom',message:'Only open nights have conditional sale probabilities'});
});
export type PricingObservation=z.infer<typeof pricingObservationSchema>;
export type PricingTracking={enabled:boolean;version:number};
export type PricingObservationRecord={id:string;data:PricingObservation};

export function makePricingObservation(propertyId:string,authority:'helm'|'guesty',policy:PricingPolicy,snapshot:PricingSnapshot,policyVersion:number,evidenceVersion:number):PricingObservation {
  const now=new Date(snapshot.observedAt),preview=previewPricing(policy,snapshot,now);
  return pricingObservationSchema.parse({version:1,propertyId,authority,capturedAt:snapshot.observedAt,asOf:snapshot.today,
    modelVersion:PRICING_MODEL_VERSION,policyVersion,evidenceVersion,
    days:snapshot.days.map(d=>{
      const recommendation=preview.days.find(r=>r.date===d.date)!;
      const state=evidenceFresh(d.observedAt,now)?d.state:'unknown';
      const f=state==='open'&&snapshot.evidence?forecastNight(snapshot.evidence,d.date,snapshot.today,now):null;
      return {date:d.date,state,currentCents:d.currentCents,recommendedCents:recommendation.recommendedCents,minNights:recommendation.minNights,
        eligible:recommendation.eligible&&state==='open',saleProbability:f?.probability??null,forecastBasis:f?.basis??'No qualified forecast',sourceObservedAt:d.observedAt};
    })});
}

/** Net state changes in overlapping, still-future nights; not reservation counts
 * or cancellation events. Authority changes break comparability. */
export function comparePricingObservations(before:PricingObservation,after:PricingObservation) {
  if(before.propertyId!==after.propertyId)throw Error('Compare observations for the same property');
  if(Date.parse(before.capturedAt)>=Date.parse(after.capturedAt))throw Error('Choose a later comparison');
  const comparableAuthority=before.authority===after.authority,old=new Map(before.days.map(d=>[d.date,d]));
  let common=0,unknown=0,availabilityChanged=0,newlyBooked=0,reopened=0,retainedOpen=0,rateChanges=0;
  for(const current of after.days){const previous=old.get(current.date);if(!previous)continue;common++;
    if(!comparableAuthority||[previous.state,current.state].includes('unknown')){unknown++;continue;}
    if(previous.state==='blocked'||current.state==='blocked'){if(previous.state!==current.state)availabilityChanged++;continue;}
    if(previous.state==='open'&&current.state==='booked')newlyBooked++;
    if(previous.state==='booked'&&current.state==='open')reopened++;
    if(previous.state==='open'&&current.state==='open'){
      retainedOpen++;
      if(previous.currentCents!==null&&current.currentCents!==null&&previous.currentCents!==current.currentCents)rateChanges++;
    }
  }
  return {common,unknown,availabilityChanged,newlyBooked,reopened,retainedOpen,rateChanges,comparableAuthority,
    policyChanged:before.policyVersion!==after.policyVersion||before.modelVersion!==after.modelVersion,
    evidenceChanged:before.evidenceVersion!==after.evidenceVersion};
}

/** Small bounded job, disabled unless explicitly enabled. One property's error
 * does not lose other captures, and no error bodies escape into cron output. */
export async function capturePricingBatch(enabled:boolean,properties:string[],capture:(propertyId:string)=>Promise<unknown>,clock:()=>number=Date.now) {
  if(!enabled)return {enabled:false,captured:0,failed:0,deferred:0};
  if(properties.length>100||new Set(properties).size!==properties.length)throw Error('Invalid pricing capture roster');
  const deadline=clock()+90000;let captured=0,failed=0,deferred=0;
  for(let i=0;i<properties.length;i++){
    if(clock()>=deadline){deferred=properties.length-i;break;}
    try{await capture(properties[i]);captured++;}catch{failed++;}
  }
  return {enabled:true,captured,failed,deferred};
}
