import {previewPricing,type PricingPreview,type PricingSnapshot} from './dynamic-pricing.ts';
import {currentPricingSnapshot,type PricingLiveCalendar} from './dynamic-pricing-live.ts';
import {applyPricingDraftOverrides,matchingPricingOverride,pricingDraftsSchema,pricingOverrideSchema,pricingOverridesSchema,pricingInheritedOverrides,resolvePricingDraft,resolvePricingCustomizations,type PricingDrafts,type PricingOverride} from './dynamic-pricing-drafts.ts';
import {isIsoDay,shiftIsoDay} from './sca-quotes-types.ts';

export type PricingCalendarResult={id:string;calendar:PricingLiveCalendar|null};
export type PricingCalendarReader=(id:string)=>Promise<{ok:true;value:PricingLiveCalendar}|{ok:false;error:string}>;

/** Bound reads; cancellation stops queued work and cannot reuse another home's calendar. */
export async function loadPricingMultiCalendars(ids:string[],read:PricingCalendarReader,cancelled=()=>false):Promise<PricingCalendarResult[]> {
  const unique=[...new Set(ids)],results:PricingCalendarResult[]=new Array(unique.length);let next=0;
  await Promise.all(Array.from({length:Math.min(4,unique.length)},async()=>{
    while(next<unique.length&&!cancelled()){
      const i=next++,id=unique[i];
      try{const r=await read(id);results[i]={id,calendar:r.ok&&r.value.home.id===id?r.value:null};}
      catch{results[i]={id,calendar:null};}
    }
  }));
  return results.filter(Boolean);
}

export function pricingMultiDates(start:string,count:number):string[] {
  if(!isIsoDay(start)||!Number.isFinite(Date.parse(start))||new Date(start).toISOString().slice(0,10)!==start||![7,14,30].includes(count))throw Error('Choose a valid date and 7, 14 or 30 nights');
  return Array.from({length:count},(_,i)=>shiftIsoDay(start,i));
}
export function pricingMultiDraft(calendar:PricingLiveCalendar,state:PricingDrafts,now:Date):{snapshot:PricingSnapshot;preview:PricingPreview|null;error:string|null} {
  const snapshot={...currentPricingSnapshot(calendar.snapshot,now),...(calendar.snapshot.evidence?{evidence:calendar.snapshot.evidence}:{})};
  if(!state.homes[calendar.home.id])return {snapshot,preview:null,error:null};
  try{
    if(snapshot.evidence&&snapshot.evidence.propertyId!==calendar.home.id)throw Error('Evidence belongs to another listing');
    const id=calendar.home.id,policy=resolvePricingDraft(state,id),custom=resolvePricingCustomizations(state,{kind:'listing',id}).rules;
    const preview=applyPricingDraftOverrides(previewPricing(policy,snapshot,now,custom),policy,snapshot,state.homes[id].overrides,pricingInheritedOverrides(state,id),custom);
    return {snapshot,preview,error:null};
  }catch{return {snapshot,preview:null,error:'Draft rules need review'};}
}

export type PricingBulkChange={id:string;name:string;changed:number;skipped:number;review:number;limited:number;minimumCents:number|null;maximumCents:number|null};
/** Prepare all listings before any local storage mutation; never silently replace an existing override. */
export function preparePricingBulkOverride(state:PricingDrafts,ids:string[],calendars:PricingLiveCalendar[],input:PricingOverride,now:Date) {
  const override=pricingOverrideSchema.parse(input),unique=[...new Set(ids)];
  if(!unique.length)throw Error('Select at least one listing');
  const homes={...state.homes},changes:PricingBulkChange[]=[],errors:string[]=[];
  for(const id of unique){
    const calendar=calendars.find(c=>c.home.id===id),home=state.homes[id],name=calendar?.home.name??'Listing';
    if(!home||!calendar){errors.push(`${name}: configure prices and load the calendar first`);continue;}
    try{homes[id]={...home,overrides:pricingOverridesSchema.parse([...home.overrides,override]),version:home.version+1};}
    catch{errors.push(`${name}: conflicts with an existing date override or the override limit`);}
  }
  if(errors.length)throw Error(errors.join(' · '));
  const next=pricingDraftsSchema.parse({...state,homes});
  for(const id of unique){
    const calendar=calendars.find(c=>c.home.id===id)!,before=pricingMultiDraft(calendar,state,now),after=pricingMultiDraft(calendar,next,now);
    if(before.error||after.error||!before.preview||!after.preview)throw Error(`${calendar.home.name}: draft rules need review`);
    const days=new Map(after.snapshot.days.map(d=>[d.date,d])),prior=new Map(before.preview.days.map(d=>[d.date,d])),proposed=new Map(after.preview.days.map(d=>[d.date,d]));
    const change:PricingBulkChange={id,name:calendar.home.name,changed:0,skipped:0,review:0,limited:0,minimumCents:null,maximumCents:null};
    for(let date=override.start;date<=override.end;date=shiftIsoDay(date,1)){
      if(!matchingPricingOverride([override],date))continue;
      const source=days.get(date),a=prior.get(date),b=proposed.get(date);
      if(!source||date<after.snapshot.today||source.state==='unknown')throw Error(`${calendar.home.name}: refresh or choose dates within the available calendar`);
      if(source.state!=='open'||source.protected){change.skipped++;continue;}
      if(!a||!b||a.recommendedCents===null||b.recommendedCents===null)throw Error(`${calendar.home.name}: pricing unavailable for ${date}`);
      if(a.recommendedCents===b.recommendedCents&&a.minNights===b.minNights)continue;
      change.changed++;
      if(!b.eligible)change.review++;
      if(b.reasons.includes('Override limited by minimum or maximum price'))change.limited++;
      change.minimumCents=Math.min(change.minimumCents??Infinity,b.recommendedCents);change.maximumCents=Math.max(change.maximumCents??0,b.recommendedCents);
    }
    changes.push(change);
  }
  if(!changes.some(c=>c.changed))throw Error('No available nights would change');
  return {next,changes};
}
