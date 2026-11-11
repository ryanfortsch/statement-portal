/** Read-only live calendars plus local draft settings. No production write imports. */
import {z} from 'zod';
import {pricingPolicySchema,previewPricing} from './dynamic-pricing.ts';
import {pricingEvidenceSchema,type PricingEvidence} from './dynamic-pricing-evidence.ts';
import {resolvePricingCustomizations,applyPricingDraftOverrides,pricingInheritedOverrides,resolvePricingDraft,savePricingDraftPolicy,type PricingDrafts} from './dynamic-pricing-drafts.ts';
import type {PricingLiveCalendar} from './dynamic-pricing-live.ts';
import {makePricingObservation,type PricingObservationRecord} from './dynamic-pricing-observations.ts';
import type {PricingServices} from '../app/channels/pricing/PricingWorkbench.tsx';
export function createPricingDraftServices(initial:PricingLiveCalendar,getDrafts:()=>PricingDrafts,saveDrafts:(state:PricingDrafts)=>void,readCalendar:(id:string)=>Promise<{ok:true;value:PricingLiveCalendar}|{ok:false;error:string}>) {
  const id=initial.home.id;let calendar=initial,evidence:PricingEvidence|undefined,evidenceVersion=0;
  const observations:PricingObservationRecord[]=[],requests=new Set<string>();
  const history=()=>({observations:[...observations],tracking:{enabled:false,version:0},scheduledCaptureEnabled:false});
  const fail=(error:string)=>({ok:false as const,error});
  const unavailable=async()=>fail('This local draft cannot publish or schedule background jobs.');
  const profile=()=>({property_id:id,policy:resolvePricingDraft(getDrafts(),id),mode:'shadow' as const,version:getDrafts().homes[id].version});
  const snapshot=()=>({...calendar.snapshot,...(evidence?{evidence}:{})});
  const inspect=()=>({snapshot:snapshot(),profile:profile(),policy:profile().policy,runs:[],evidenceVersion,...history()});
  const services:PricingServices = {
    async save(input){const i=z.object({propertyId:z.literal(id),policy:pricingPolicySchema,mode:z.literal('shadow'),version:z.number().int().positive()}).strict().parse(input);
      saveDrafts(savePricingDraftPolicy(getDrafts(),id,i.policy,i.version));return {ok:true,value:profile()};},
    async refresh(propertyId){if(propertyId!==id)return fail('Wrong listing');const r=await readCalendar(id);if(!r.ok)return r;
      if(r.value.home.id!==id)return fail('Calendar belongs to another listing');calendar=r.value;
      return {ok:true,value:inspect()};},
    async evidence(input){const i=z.object({propertyId:z.literal(id),data:pricingEvidenceSchema,version:z.number().int().nonnegative()}).strict().parse(input);
      if(i.data.propertyId!==id||i.version!==evidenceVersion)return fail('Data changed or belongs to another listing');
      if([i.data.marketObservedAt,i.data.historyObservedAt].some(t=>t&&Date.parse(t)>Date.now()))return fail('Observation time cannot be in the future');
      evidence=i.data;evidenceVersion++;calendar={...calendar,snapshot:{...calendar.snapshot,observedAt:new Date().toISOString()}};return {ok:true,value:{snapshot:snapshot(),evidenceVersion}};},
    async observe(input){const i=z.object({propertyId:z.literal(id),requestId:z.string().uuid()}).strict().parse(input);
      if(!requests.has(i.requestId)){
        const latest=await readCalendar(id);if(!latest.ok)return latest;if(latest.value.home.id!==id)return fail('Wrong listing');calendar=latest.value;
        const p=profile(),snap=snapshot(),state=getDrafts(),home=state.homes[id];
        const data=makePricingObservation(id,calendar.home.authority,p.policy,snap,p.version,evidenceVersion);
        const custom=resolvePricingCustomizations(state,{kind:"listing",id}).rules;
        const proposed=applyPricingDraftOverrides(previewPricing(p.policy,snap,new Date(snap.observedAt),custom),p.policy,snap,home.overrides,pricingInheritedOverrides(state,id),custom);
        data.modelVersion=proposed.modelVersion;
        data.days=data.days.map(d=>{const r=proposed.days.find(r=>r.date===d.date)!;return {...d,recommendedCents:r.recommendedCents,minNights:r.minNights,eligible:r.eligible};});
        observations.unshift({id:i.requestId,data});observations.splice(14);requests.add(i.requestId);
      }return {ok:true,value:history()};},
    review:unavailable,publish:unavailable,undo:unavailable,tracking:unavailable,
  };
  return {...services,inspect};
}
