'use server';
import { z } from 'zod';
import { revalidatePath } from 'next/cache';
import { requireOwnerEmail } from '@/lib/helm-access-server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { createPricingReview, readPricingWorkspace, savePricingProfile } from '@/lib/dynamic-pricing-store';
import { pricingPolicySchema } from '@/lib/dynamic-pricing';
import { pricingEvidenceSchema } from '@/lib/dynamic-pricing-evidence';
const property=z.string().min(1).max(100).regex(/^[a-zA-Z0-9_-]+$/);
async function result<T>(fn:()=>Promise<T>) {
  try { return {ok:true as const,value:await fn()}; }
  catch(e) { return {ok:false as const,error:e instanceof z.ZodError?e.issues.map(i=>i.message).join('; '):e instanceof Error?e.message:'Pricing request failed'}; }
}
export async function savePricingAction(input:unknown) { return result(async()=>{
  const actor=await requireOwnerEmail();
  const i=z.object({propertyId:property,policy:pricingPolicySchema,mode:z.enum(['shadow','helm_direct']),version:z.number().int().nonnegative()}).strict().parse(input);
  const saved=await savePricingProfile(i.propertyId,i.policy,i.mode,i.version,actor);
  revalidatePath('/channels/pricing');return saved;
}); }
export async function reviewPricingAction(propertyId:unknown) { return result(async()=>{
  const actor=await requireOwnerEmail();return createPricingReview(property.parse(propertyId),actor);
}); }
export async function refreshPricingAction(propertyId:unknown) { return result(async()=>{
  await requireOwnerEmail();const w=await readPricingWorkspace(property.parse(propertyId));
  return {snapshot:w.snapshot,profile:w.profile,policy:w.policy,runs:w.runs,evidenceVersion:w.context.evidence?.version??0};
}); }
export async function publishPricingAction(runId:unknown) { return result(async()=>{
  const actor=await requireOwnerEmail();const id=z.string().uuid().parse(runId);
  const {data,error}=await supabaseAdmin.rpc('helm_apply_pricing_run',{p_run:id,p_actor:actor});
  if(error) throw Error(error.message);
  revalidatePath('/channels');revalidatePath('/properties');return Number(data);
}); }
export async function undoPricingAction(runId:unknown) { return result(async()=>{
  const actor=await requireOwnerEmail();const id=z.string().uuid().parse(runId);
  const {data,error}=await supabaseAdmin.rpc('helm_revert_pricing_run',{p_run:id,p_actor:actor});
  if(error) throw Error(error.message);
  revalidatePath('/channels');revalidatePath('/properties');return Number(data);
}); }

export async function savePricingEvidenceAction(input:unknown) { return result(async()=>{
  const actor=await requireOwnerEmail();
  const i=z.object({propertyId:property,data:pricingEvidenceSchema,version:z.number().int().nonnegative()}).strict().parse(input);
  if(i.data.propertyId!==i.propertyId)throw Error('Evidence belongs to another property');
  const now=Date.now();
  for(const stamp of [i.data.marketObservedAt,i.data.historyObservedAt])if(stamp&&Date.parse(stamp)>now)throw Error('Observation time cannot be in the future');
  const {error}=await supabaseAdmin.rpc('helm_save_pricing_evidence',{p_property:i.propertyId,p_data:i.data,p_expected:i.version,p_actor:actor});
  if(error)throw Error(error.message);
  const w=await readPricingWorkspace(i.propertyId);
  revalidatePath('/channels/pricing');return {snapshot:w.snapshot,evidenceVersion:w.context.evidence?.version??0};
}); }
