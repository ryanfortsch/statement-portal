/** Device-local prototype settings. No calendar records or market evidence are persisted. */
import {z} from 'zod';
import {defaultPricingPolicy,pricingPolicySchema,type PricingPolicy,type PricingPreview,type PricingSnapshot} from './dynamic-pricing.ts';
import {isIsoDay,nightsBetween} from './sca-quotes-types.ts';
import {evidenceFresh} from './dynamic-pricing-evidence.ts';
const date=z.string().refine(d=>isIsoDay(d)&&Number.isFinite(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d,'Invalid date');
export const pricingOverrideSchema=z.object({
  id:z.string().min(1).max(100),label:z.string().trim().min(1).max(80),start:date,end:date,
  kind:z.enum(['fixed','percent','stay']),value:z.number().finite(),minNights:z.number().int().min(1).max(30).nullable(),
  weekdays:z.array(z.number().int().min(0).max(6)).min(1).max(7),
}).strict().superRefine((v,ctx)=>{
  if(v.end<v.start||nightsBetween(v.start,v.end)>549)ctx.addIssue({code:'custom',message:'Choose a date range of up to 550 nights'});
  if(v.kind==='fixed'&&(!Number.isInteger(v.value)||v.value<100||v.value>10000000))ctx.addIssue({code:'custom',message:'Fixed price must be $1 to $100,000'});
  if(v.kind==='percent'&&(v.value< -80||v.value>200))ctx.addIssue({code:'custom',message:'Adjustment must be between -80% and +200%'});
  if(v.kind==='stay'&&(v.minNights===null||v.value!==0))ctx.addIssue({code:'custom',message:'Enter a minimum stay'});
  if(new Set(v.weekdays).size!==v.weekdays.length)ctx.addIssue({code:'custom',message:'Duplicate weekdays'});
});
export type PricingOverride=z.infer<typeof pricingOverrideSchema>;
export const pricingOverridesSchema=z.array(pricingOverrideSchema).max(40).superRefine((rows,ctx)=>{
  if(new Set(rows.map(r=>r.id)).size!==rows.length)ctx.addIssue({code:'custom',message:'Duplicate override ID'});
  for(let i=0;i<rows.length;i++)for(let j=i+1;j<rows.length;j++){
    const a=rows[i],b=rows[j];
    if(a.start<=b.end&&b.start<=a.end&&a.weekdays.some(d=>b.weekdays.includes(d)))ctx.addIssue({code:'custom',message:'Overrides at the same level cannot overlap on the same weekdays'});
  }
});
const homeSchema=z.object({policy:pricingPolicySchema,version:z.number().int().positive(),groupId:z.string().nullable(),inheritRules:z.boolean(),overrides:pricingOverridesSchema}).strict();
const groupSchema=z.object({id:z.string().min(1).max(100),name:z.string().trim().min(1).max(60),policy:pricingPolicySchema,overrides:pricingOverridesSchema}).strict();
export const pricingDraftsSchema=z.object({version:z.literal(1),homes:z.record(z.string().min(1).max(100),homeSchema),groups:z.array(groupSchema).max(50)}).strict().superRefine((v,ctx)=>{
  if(new Set(v.groups.map(g=>g.id)).size!==v.groups.length||new Set(v.groups.map(g=>g.name.toLowerCase())).size!==v.groups.length)ctx.addIssue({code:'custom',message:'Groups must have unique names and IDs'});
  if(Object.values(v.homes).some(h=>h.groupId&&!v.groups.some(g=>g.id===h.groupId)))ctx.addIssue({code:'custom',message:'Unknown group'});
});
export type PricingDrafts=z.infer<typeof pricingDraftsSchema>;
export type PricingHomeDraft=PricingDrafts['homes'][string];
export const PRICING_DRAFT_STORAGE='helm-pricing-drafts-v1';
export const emptyPricingDrafts=():PricingDrafts=>({version:1,homes:{},groups:[]});
export function resolvePricingDraft(state:PricingDrafts,id:string):PricingPolicy {
  const home=state.homes[id];if(!home)throw Error('Create a draft first');
  const group=home.inheritRules?state.groups.find(g=>g.id===home.groupId):null;
  return pricingPolicySchema.parse(group?{...group.policy,baseCents:home.policy.baseCents,floorCents:home.policy.floorCents,ceilingCents:home.policy.ceilingCents}:home.policy);
}
/** Saving listing changes to a shared rule creates an explicit whole-rule-set override. */
export function savePricingDraftPolicy(state:PricingDrafts,id:string,policy:PricingPolicy,version:number):PricingDrafts {
  const old=state.homes[id];if(!old||old.version!==version)throw Error('Draft changed. Reload before saving.');
  const effective=resolvePricingDraft(state,id),rules=(p:PricingPolicy)=>({...p,baseCents:0,floorCents:0,ceilingCents:0});
  const inheritRules=old.inheritRules&&JSON.stringify(rules(effective))===JSON.stringify(rules(policy));
  return pricingDraftsSchema.parse({...state,homes:{...state.homes,[id]:{...old,policy,inheritRules,version:version+1}}});
}
/** Deliberately neutral start. Never implies PriceLabs settings were imported. */
export function neutralPricingDraft(base:number,min:number,max:number):PricingPolicy {
  return {...defaultPricingPolicy(base,min,max),lastMinuteDiscountPct:0,farOutPremiumPct:0,orphanMaxNights:0,farMinStays:[]};
}
export function matchingPricingOverride(rows:PricingOverride[],day:string) {
  return rows.find(r=>day>=r.start&&day<=r.end&&r.weekdays.includes(new Date(day+'T12:00:00Z').getUTCDay()));
}
/** Listing dates take precedence over group dates. Hard price bounds and protected inventory always win. */
export function applyPricingDraftOverrides(preview:PricingPreview,policy:PricingPolicy,snapshot:PricingSnapshot,listing:PricingOverride[],group:PricingOverride[]=[]):PricingPreview {
  pricingOverridesSchema.parse(listing);pricingOverridesSchema.parse(group);
  const now=new Date(snapshot.observedAt),calendar=new Map(snapshot.days.map(d=>[d.date,d]));
  return {...preview,days:preview.days.map(day=>{
    const source=calendar.get(day.date),local=matchingPricingOverride(listing,day.date),override=local??matchingPricingOverride(group,day.date);
    if(!override||!source||source.protected||day.state!=='open'||day.date<snapshot.today||day.recommendedCents===null||!evidenceFresh(source.observedAt,now))return day;
    const raw=override.kind==='fixed'?override.value:override.kind==='percent'?Math.round(day.recommendedCents*(1+override.value/100)):day.recommendedCents;
    const price=Math.max(policy.floorCents,Math.min(policy.ceilingCents,raw)),change=day.currentCents?Math.round((price/day.currentCents-1)*10000)/100:null;
    const reasons=[...day.reasons,`${local?'Listing':'Group'} override: ${override.label}`];
    if(raw!==price)reasons.push('Override limited by minimum or maximum price');
    if(change!==null&&Math.abs(change)>policy.maxChangePct)reasons.push('Override exceeds maximum price-change threshold');
    return {...day,recommendedCents:price,minNights:override.minNights===null?day.minNights:Math.max(policy.lowestMinNights,override.minNights),changePct:change,
      eligible:day.eligible&&(change!==null&&Math.abs(change)<=policy.maxChangePct),reasons,
      steps:[...day.steps,{label:`${local?'Listing':'Group'} override: ${override.label}`,adjustmentPct:Math.round((price/day.recommendedCents-1)*10000)/100,resultCents:price}]};
  })};
}

/** Shared edits invalidate every affected home's saved rule version. */
export function revisePricingDraftGroups(before:PricingDrafts,next:PricingDrafts):PricingDrafts {
  const changed=new Set(next.groups.filter(g=>JSON.stringify(g)!==JSON.stringify(before.groups.find(old=>old.id===g.id))).map(g=>g.id));
  return {...next,homes:Object.fromEntries(Object.entries(next.homes).map(([id,h])=>[id,h.groupId&&changed.has(h.groupId)&&before.homes[id]?.version===h.version?{...h,version:h.version+1}:h]))};
}

export function pricingDraftError(error:unknown):string {
  if(error instanceof z.ZodError)return [...new Set(error.issues.map(i=>i.message))].join(' · ');
  return error instanceof Error?error.message:'Could not save this draft';
}
