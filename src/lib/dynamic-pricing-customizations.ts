/** Optional local-draft customizations. Production profiles do not store or enable these. */
import {z} from 'zod';
import {isIsoDay,nightsBetween} from './sca-quotes-types.ts';
import type {PricingPolicy} from './dynamic-pricing.ts';

const date=z.string().refine(d=>isIsoDay(d)&&Number.isFinite(Date.parse(d))&&new Date(d).toISOString().slice(0,10)===d,'Choose a valid season date');
const optionalNumber=z.number().finite().nullable();
export const pricingSeasonSchema=z.object({
  id:z.string().min(1).max(100),name:z.string().trim().min(1).max(60),start:date,end:date,repeat:z.boolean(),
  kind:z.enum(['fixed','percent']),base:optionalNumber,min:optionalNumber,max:optionalNumber,
  weekdayMin:z.number().int().min(1).max(30).nullable(),weekendMin:z.number().int().min(1).max(30).nullable(),
}).strict().superRefine((s,ctx)=>{
  if(s.end<s.start||nightsBetween(s.start,s.end)>365)ctx.addIssue({code:'custom',message:'A season must end after it starts and cover at most 366 nights'});
  if(s.repeat&&s.start.slice(0,4)!==s.end.slice(0,4))ctx.addIssue({code:'custom',message:'Split recurring seasons at December 31'});
  for(const key of ['base','min','max'] as const){const value=s[key];if(value!==null&&(s.kind==='fixed'?(!Number.isInteger(value)||value<100||value>10000000):(value< -80||value>200)))ctx.addIssue({code:'custom',message:s.kind==='fixed'?'Seasonal prices must be $1 to $100,000':'Seasonal adjustments must be -80% to +200%',path:[key]});}
  if(s.kind==='fixed'&&((s.min!==null&&s.base!==null&&s.min>s.base)||(s.base!==null&&s.max!==null&&s.base>s.max)||(s.min!==null&&s.max!==null&&s.min>s.max)))ctx.addIssue({code:'custom',message:'Seasonal minimum ≤ base ≤ maximum is required'});
});
export type PricingSeason=z.infer<typeof pricingSeasonSchema>;
export const pricingSeasonsSchema=z.array(pricingSeasonSchema).max(30).superRefine((rows,ctx)=>{
  if(new Set(rows.map(r=>r.id)).size!==rows.length||new Set(rows.map(r=>r.name.toLowerCase())).size!==rows.length)ctx.addIssue({code:'custom',message:'Seasons need unique names and IDs'});
  for(let i=0;i<rows.length;i++)for(let j=i+1;j<rows.length;j++){
    const a=rows[i],b=rows[j];if(a.repeat!==b.repeat)continue; // A dated season supersedes an annual season.
    const key=(d:string)=>a.repeat?d.slice(5):d;
    if(key(a.start)<=key(b.end)&&key(b.start)<=key(a.end))ctx.addIssue({code:'custom',message:'Seasons of the same recurrence cannot overlap'});
  }
});
export const pricingWeekendDaysSchema=z.array(z.number().int().min(0).max(6)).max(7).refine(v=>new Set(v).size===v.length,'Duplicate weekend days');
export const pricingLeadTimeModesSchema=z.object({lastMinute:z.enum(['gradual','flat']),farOut:z.enum(['gradual','flat'])}).strict();
export const pricingCustomizationSchema=z.object({seasonalPrices:pricingSeasonsSchema,weekendDays:pricingWeekendDaysSchema,leadTimeModes:pricingLeadTimeModesSchema}).strict();
export type PricingCustomizations=z.infer<typeof pricingCustomizationSchema>;
export const pricingCustomizationKeys=['seasonalPrices','weekendDays','leadTimeModes'] as const;
export const defaultPricingCustomizations=():PricingCustomizations=>({seasonalPrices:[],weekendDays:[5,6],leadTimeModes:{lastMinute:'gradual',farOut:'gradual'}});
export function matchingPricingSeason(rows:PricingSeason[],day:string){
  return rows.find(s=>!s.repeat&&s.start<=day&&day<=s.end)??rows.find(s=>s.repeat&&s.start.slice(5)<=day.slice(5)&&day.slice(5)<=s.end.slice(5));
}
/** Percentages always refer to this listing's normal prices, never another season's prices. */
export function seasonalPricingPolicy(base:PricingPolicy,day:string,rows:PricingSeason[]=[]){
  const season=matchingPricingSeason(rows,day);if(!season)return {policy:base,season:null,error:null};
  const price=(key:'base'|'min'|'max',fallback:number)=>season[key]===null?fallback:season.kind==='fixed'?season[key]:Math.round(fallback*(1+season[key]/100));
  const policy={...base,baseCents:price('base',base.baseCents),floorCents:price('min',base.floorCents),ceilingCents:price('max',base.ceilingCents),weekdayMinNights:season.weekdayMin??base.weekdayMinNights,weekendMinNights:season.weekendMin??base.weekendMinNights};
  const valid=policy.floorCents>=100&&policy.ceilingCents<=10000000&&policy.floorCents<=policy.baseCents&&policy.baseCents<=policy.ceilingCents;
  return {policy,season,error:valid?null:`${season.name}: seasonal minimum ≤ base ≤ maximum is required for this listing ($1–$100,000)`};
}
