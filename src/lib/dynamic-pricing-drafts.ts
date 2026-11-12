/** Device-local prototype settings. No calendar records or market evidence are persisted. */
import {z} from 'zod';
import {pricingImportSourceSchema} from './dynamic-pricing-import-source.ts';
import {defaultPricingPolicy,pricingPolicySchema,type PricingPolicy,type PricingPreview,type PricingSnapshot} from './dynamic-pricing.ts';
import {isIsoDay,nightsBetween} from './sca-quotes-types.ts';
import {pricingLengthOfStaySchema,pricingArrivalDepartureSchema,defaultPricingStayRules} from './dynamic-pricing-stays.ts';
import {pricingSeasonsSchema,pricingWeekendDaysSchema,pricingLeadTimeModesSchema,defaultPricingCustomizations,seasonalPricingPolicy,type PricingCustomizations} from './dynamic-pricing-customizations.ts';
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
/** Minimum-stay settings inherit as one category, never a mixture of subrules. */
export const PRICING_RULE_CATEGORIES={
  seasonality:{label:'Seasonality',fields:['priceShape','monthlyFactors']},
  weekdays:{label:'Day of week',fields:['weekdayFactors']},
  market:{label:'Market pace',fields:['marketPacingEnabled']},
  lastMinute:{label:'Last-minute prices',fields:['lastMinuteDays','lastMinuteDiscountPct']},
  farOut:{label:'Far-out prices',fields:['farOutStart','farOutEnd','farOutPremiumPct']},
  occupancy:{label:'Occupancy adjustments',fields:['occupancyEnabled','occupancyTargets','occupancyMaxAdjustmentPct']},
  recency:{label:'Booking recency',fields:['recencyEnabled']},
  minimumStay:{label:'Minimum stays & gaps',fields:['weekdayMinNights','weekendMinNights','lowestMinNights','minimumBookingCents','orphanMaxNights','orphanDiscountPct','orphanPreservesEvents','adjacentMinNights','lastMinStays','farMinStays']},
  limits:{label:'Price safeguards',fields:['safetyFloorEnabled','safetyFloorAfterDays','maxCombinedDiscountPct','maxChangePct']},
  events:{label:'Events',fields:['events']},
} as const satisfies Record<string,{label:string;fields:readonly (keyof PricingPolicy)[]}>;
export type PricingRuleCategory=keyof typeof PRICING_RULE_CATEGORIES;
export const pricingRuleCategories=Object.keys(PRICING_RULE_CATEGORIES) as PricingRuleCategory[];
const categories=z.array(z.enum(pricingRuleCategories)).max(pricingRuleCategories.length).refine(v=>new Set(v).size===v.length,'Duplicate rule category');
const sharedFields={seasonalPrices:pricingSeasonsSchema.optional(),weekendDays:pricingWeekendDaysSchema.optional(),leadTimeModes:pricingLeadTimeModesSchema.optional(),lengthOfStay:pricingLengthOfStaySchema.optional(),arrivalDeparture:pricingArrivalDepartureSchema.optional(),policy:pricingPolicySchema,overrides:pricingOverridesSchema,ruleCategories:categories.optional()};
const homeSchema=z.object({...sharedFields,importSource:pricingImportSourceSchema.optional(),version:z.number().int().positive(),groupId:z.string().nullable(),inheritRules:z.boolean()}).strict();
const groupSchema=z.object({...sharedFields,id:z.string().min(1).max(100),name:z.string().trim().min(1).max(60),parentId:z.string().nullable().optional()}).strict();
export const pricingDraftsSchema=z.object({version:z.literal(1),homes:z.record(z.string().min(1).max(100),homeSchema),groups:z.array(groupSchema).max(50),
  account:z.object(sharedFields).strict().optional(),assignments:z.record(z.string().min(1).max(100),z.string().nullable()).optional(),
}).strict().superRefine((v,ctx)=>{
  if(new Set(v.groups.map(g=>g.id)).size!==v.groups.length||new Set(v.groups.map(g=>g.name.toLowerCase())).size!==v.groups.length)ctx.addIssue({code:'custom',message:'Groups must have unique names and IDs'});
  if([...Object.values(v.homes).map(h=>h.groupId),...Object.values(v.assignments??{})].some(id=>id&&!v.groups.some(g=>g.id===id)))ctx.addIssue({code:'custom',message:'Unknown group'});
  for(const g of v.groups)if(g.parentId){const parent=v.groups.find(p=>p.id===g.parentId);if(!parent||parent.id===g.id||parent.parentId)ctx.addIssue({code:'custom',message:'A subgroup must belong to a top-level group'});}
});
export type PricingDrafts=z.infer<typeof pricingDraftsSchema>;
export type PricingHomeDraft=PricingDrafts['homes'][string];
export const PRICING_DRAFT_STORAGE='helm-pricing-drafts-v1';
export const emptyPricingDrafts=():PricingDrafts=>({version:1,homes:{},groups:[]});
export function pricingHomeCategories(home:PricingHomeDraft){return home.ruleCategories??(home.inheritRules?[]:pricingRuleCategories);}
export function pricingGroupId(state:PricingDrafts,id:string){return state.homes[id]?state.homes[id].groupId:state.assignments?.[id]??null;}
export function pricingGroupChain(state:PricingDrafts,groupId:string|null){
  const group=state.groups.find(g=>g.id===groupId),parent=state.groups.find(g=>g.id===group?.parentId);
  return group?(parent?[parent,group]:[group]):[];
}
export function pricingGroupName(state:PricingDrafts,id:string|null){return pricingGroupChain(state,id).map(g=>g.name).join(' / ')||'No group';}
export function pricingInGroup(state:PricingDrafts,homeId:string,groupId:string){return pricingGroupChain(state,pricingGroupId(state,homeId)).some(g=>g.id===groupId);}
function applyCategories(base:PricingPolicy,rule:PricingPolicy,keys:readonly PricingRuleCategory[]):PricingPolicy {
  return {...base,...Object.fromEntries(keys.flatMap(k=>PRICING_RULE_CATEGORIES[k].fields.map(f=>[f,rule[f]])))};
}
export type PricingRuleScope={kind:'account'}|{kind:'group';id:string}|{kind:'listing';id:string};
export function pricingRuleSources(state:PricingDrafts,scope:PricingRuleScope,validate=true){
  const sources=Object.fromEntries(pricingRuleCategories.map(k=>[k,'Helm defaults'])) as Record<PricingRuleCategory,string>;
  let policy=neutralPricingDraft(100,100,100);
  function apply(rule:{policy:PricingPolicy;ruleCategories?:PricingRuleCategory[]}|undefined,label:string,keys?:PricingRuleCategory[]){if(!rule)return;const active=keys??rule.ruleCategories??pricingRuleCategories;policy=applyCategories(policy,rule.policy,active);active.forEach(k=>{sources[k]=label;});}
  apply(state.account,'Account');
  const groupId=scope.kind==='listing'?pricingGroupId(state,scope.id):scope.kind==='group'?scope.id:null;
  for(const g of pricingGroupChain(state,groupId))apply(g,g.name);
  if(scope.kind==='listing'){
    const h=state.homes[scope.id];if(!h)throw Error('Create a draft first');
    apply(h,'This listing',pricingHomeCategories(h));policy={...policy,baseCents:h.policy.baseCents,floorCents:h.policy.floorCents,ceilingCents:h.policy.ceilingCents};
  }
  return {policy:validate?pricingPolicySchema.parse(policy):policy,sources};
}
export function resolvePricingDraft(state:PricingDrafts,id:string):PricingPolicy {return pricingRuleSources(state,{kind:'listing',id}).policy;}
export function pricingChangedCategories(before:PricingPolicy,after:PricingPolicy){return pricingRuleCategories.filter(k=>PRICING_RULE_CATEGORIES[k].fields.some(f=>JSON.stringify(before[f])!==JSON.stringify(after[f])));}
/** Only changed categories become listing overrides. Other categories keep inheriting. */
export function savePricingDraftPolicy(state:PricingDrafts,id:string,policy:PricingPolicy,version:number):PricingDrafts {
  const old=state.homes[id];if(!old||old.version!==version)throw Error('Draft changed. Reload before saving.');
  const ruleCategories=[...new Set([...pricingHomeCategories(old),...pricingChangedCategories(resolvePricingDraft(state,id),policy)])];
  return pricingDraftsSchema.parse({...state,homes:{...state.homes,[id]:{...old,policy,ruleCategories,inheritRules:ruleCategories.length===0,version:version+1}}});
}
export function savePricingSharedRules(state:PricingDrafts,scope:Exclude<PricingRuleScope,{kind:'listing'}>,policy:PricingPolicy,ruleCategories:PricingRuleCategory[]):PricingDrafts {
  pricingPolicySchema.parse(policy);
  if(scope.kind==='account')return pricingDraftsSchema.parse({...state,account:{...state.account,policy,ruleCategories,overrides:state.account?.overrides??[]}});
  if(!state.groups.some(g=>g.id===scope.id))throw Error('Unknown group');
  return pricingDraftsSchema.parse({...state,groups:state.groups.map(g=>g.id===scope.id?{...g,policy,ruleCategories}:g)});
}
export function assignPricingGroup(state:PricingDrafts,ids:string[],groupId:string|null,inherit:boolean):PricingDrafts {
  if(!ids.length)throw Error('Select at least one listing');
  if(groupId&&!state.groups.some(g=>g.id===groupId))throw Error('Unknown group');
  const homes={...state.homes},assignments={...state.assignments};
  for(const id of new Set(ids)){
    const old=homes[id];if(old){homes[id]={...old,...(inherit?{lengthOfStay:undefined,arrivalDeparture:undefined,seasonalPrices:undefined,weekendDays:undefined,leadTimeModes:undefined}:{}),policy:resolvePricingDraft(state,id),groupId,ruleCategories:inherit?[]:pricingHomeCategories(old),inheritRules:inherit||pricingHomeCategories(old).length===0,version:old.version+1};delete assignments[id];}
    else assignments[id]=groupId;
  }
  return pricingDraftsSchema.parse({...state,homes,assignments});
}
/** Most-specific date rule wins for the whole date, without compounding parent overrides. */
export function pricingInheritedOverrides(state:PricingDrafts,id:string):{label:string;rows:PricingOverride[]}[]{
  return [...pricingGroupChain(state,pricingGroupId(state,id)).reverse().map(g=>({label:g.parentId?'Subgroup':'Group',rows:g.overrides})),{label:'Account',rows:state.account?.overrides??[]}];
}
/** Deliberately neutral start. Never implies PriceLabs settings were imported. */
export function neutralPricingDraft(base:number,min:number,max:number):PricingPolicy {
  return {...defaultPricingPolicy(base,min,max),lastMinuteDiscountPct:0,farOutPremiumPct:0,orphanMaxNights:0,farMinStays:[]};
}
export function matchingPricingOverride(rows:PricingOverride[],day:string) {
  return rows.find(r=>day>=r.start&&day<=r.end&&r.weekdays.includes(new Date(day+'T12:00:00Z').getUTCDay()));
}
/** Listing dates take precedence over group dates. Hard price bounds and protected inventory always win. */
export function applyPricingDraftOverrides(preview:PricingPreview,policy:PricingPolicy,snapshot:PricingSnapshot,listing:PricingOverride[],group:PricingOverride[]|{label:string;rows:PricingOverride[]}[]=[],custom?:PricingCustomizations):PricingPreview {
  pricingOverridesSchema.parse(listing);
  const levels:{label:string;rows:PricingOverride[]}[]=group.length&&'rows' in group[0]?group as {label:string;rows:PricingOverride[]}[]:[{label:'Group',rows:group as PricingOverride[]}];
  levels.forEach(l=>pricingOverridesSchema.parse(l.rows));
  const now=new Date(snapshot.observedAt),calendar=new Map(snapshot.days.map(d=>[d.date,d]));
  return {...preview,days:preview.days.map(day=>{
    const source=calendar.get(day.date),local=matchingPricingOverride(listing,day.date),inherited=levels.map(l=>({label:l.label,row:matchingPricingOverride(l.rows,day.date)})).find(l=>l.row),override=local??inherited?.row,scope=local?'Listing':inherited?.label;
    if(!override||!source||source.protected||day.state!=='open'||day.date<snapshot.today||day.recommendedCents===null||!evidenceFresh(source.observedAt,now))return day;
    const raw=override.kind==='fixed'?override.value:override.kind==='percent'?Math.round(day.recommendedCents*(1+override.value/100)):day.recommendedCents;
    const bounds=seasonalPricingPolicy(policy,day.date,custom?.seasonalPrices);if(bounds.error)return {...day,recommendedCents:null,eligible:false,reasons:[...day.reasons,bounds.error]};
    const price=Math.max(bounds.policy.floorCents,Math.min(bounds.policy.ceilingCents,raw)),change=day.currentCents?Math.round((price/day.currentCents-1)*10000)/100:null;
    const reasons=[...day.reasons,`${scope} override: ${override.label}`];
    if(raw!==price)reasons.push('Override limited by minimum or maximum price');
    if(change!==null&&Math.abs(change)>policy.maxChangePct)reasons.push('Override exceeds maximum price-change threshold');
    return {...day,recommendedCents:price,minNights:override.minNights===null?day.minNights:Math.max(policy.lowestMinNights,override.minNights),changePct:change,
      eligible:day.eligible&&(change!==null&&Math.abs(change)<=policy.maxChangePct),reasons,
      steps:[...day.steps,{label:`${scope} override: ${override.label}`,adjustmentPct:Math.round((price/day.recommendedCents-1)*10000)/100,resultCents:price}]};
  })};
}

/** Shared edits invalidate every affected home's saved rule version. */
export function revisePricingDraftGroups(before:PricingDrafts,next:PricingDrafts):PricingDrafts {
  return {...next,homes:Object.fromEntries(Object.entries(next.homes).map(([id,h])=>{
    const old=before.homes[id];if(!old||old.version!==h.version)return [id,h];
    const signature=(s:PricingDrafts)=>JSON.stringify([resolvePricingDraft(s,id),resolvePricingStayRules(s,{kind:'listing',id}),resolvePricingCustomizations(s,{kind:'listing',id}),pricingInheritedOverrides(s,id),s.homes[id].overrides]);
    return [id,signature(before)!==signature(next)?{...h,version:h.version+1}:h];
  }))};
}

export function pricingDraftError(error:unknown):string {
  if(error instanceof z.ZodError)return [...new Set(error.issues.map(i=>i.message))].join(' · ');
  return error instanceof Error?error.message:'Could not save this draft';
}

/** Each additional stay customization inherits independently through the same scope chain. */
export function resolvePricingStayRules(state:PricingDrafts,scope:PricingRuleScope){
  const rules=defaultPricingStayRules(),sources={lengthOfStay:'Helm defaults',arrivalDeparture:'Helm defaults'};
  const levels:{label:string;rule:Partial<typeof rules>|undefined}[]=[{label:'Account',rule:state.account}];
  const groupId=scope.kind==='listing'?pricingGroupId(state,scope.id):scope.kind==='group'?scope.id:null;
  levels.push(...pricingGroupChain(state,groupId).map(g=>({label:g.name,rule:g})));
  if(scope.kind==='listing')levels.push({label:'This listing',rule:state.homes[scope.id]});
  for(const {label,rule} of levels){if(rule?.lengthOfStay!==undefined){rules.lengthOfStay=rule.lengthOfStay;sources.lengthOfStay=label;}if(rule?.arrivalDeparture!==undefined){rules.arrivalDeparture=rule.arrivalDeparture;sources.arrivalDeparture=label;}}
  return {rules,sources};
}

/** These optional categories follow the same hierarchy; an empty array explicitly disables seasons. */
export function resolvePricingCustomizations(state:PricingDrafts,scope:PricingRuleScope){
  const rules=defaultPricingCustomizations(),sources={seasonalPrices:'Helm defaults',weekendDays:'Helm defaults',leadTimeModes:'Helm defaults'};
  const levels:{label:string;rule:Partial<PricingCustomizations>|undefined}[]=[{label:'Account',rule:state.account}];
  const groupId=scope.kind==='listing'?pricingGroupId(state,scope.id):scope.kind==='group'?scope.id:null;
  levels.push(...pricingGroupChain(state,groupId).map(g=>({label:g.name,rule:g})));
  if(scope.kind==='listing')levels.push({label:'This listing',rule:state.homes[scope.id]});
  for(const {label,rule} of levels){
    if(rule?.seasonalPrices!==undefined){rules.seasonalPrices=rule.seasonalPrices;sources.seasonalPrices=label;}
    if(rule?.weekendDays!==undefined){rules.weekendDays=rule.weekendDays;sources.weekendDays=label;}
    if(rule?.leadTimeModes!==undefined){rules.leadTimeModes=rule.leadTimeModes;sources.leadTimeModes=label;}
  }
  return {rules,sources};
}
export function pricingSeasonConflicts(state:PricingDrafts){
  return Object.entries(state.homes).flatMap(([id,h])=>resolvePricingCustomizations(state,{kind:'listing',id}).rules.seasonalPrices.flatMap(season=>{
    const {error}=seasonalPricingPolicy(h.policy,season.start,[season]);return error?[{id,error}]:[];
  }));
}
