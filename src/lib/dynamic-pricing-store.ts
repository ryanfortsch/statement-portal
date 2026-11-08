import 'server-only';
import { supabaseAdmin, isServiceConfigured } from './supabase-admin.ts';
import { defaultPricingPolicy, pricingPolicySchema, previewPricing, PRICING_MODEL_VERSION, type PricingPolicy } from './dynamic-pricing.ts';
import { dateInZone, pricingSnapshot, type PricingContext } from './dynamic-pricing-inputs.ts';
import { shiftIsoDay } from './sca-quotes-types.ts';

export type PricingProfile = { property_id:string; policy:PricingPolicy; mode:'shadow'|'helm_direct'; version:number };
export type PricingRunSummary = { id:string; status:string; created_at:string; applied_at:string|null };
export async function readPricingWorkspace(propertyId:string, now=new Date()) {
  if(!isServiceConfigured) throw Error('Database is not configured');
  const {data:property,error:propertyError}=await supabaseAdmin.from('properties').select('id,timezone').eq('id',propertyId).single();
  if(propertyError||!property) throw Error('Property not found');
  const start=dateInZone(now,property.timezone??'America/New_York'),end=shiftIsoDay(start,179);
  const [c,p,r]=await Promise.all([
    supabaseAdmin.rpc('helm_pricing_context',{p_property:propertyId,p_start:start,p_end:end}),
    supabaseAdmin.from('property_pricing_profiles').select('property_id,policy,mode,version').eq('property_id',propertyId).maybeSingle(),
    supabaseAdmin.from('property_pricing_runs').select('id,status,created_at,applied_at').eq('property_id',propertyId).order('created_at',{ascending:false}).limit(12),
  ]);
  if(c.error||p.error||r.error) throw Error('Pricing storage is unavailable. The Helm pricing migration must be installed before connecting a listing.');
  const context=c.data as PricingContext;
  if(!context.property?.is_active) throw Error('Choose an active property');
  if(context.plan && context.plan.currency!=='USD') throw Error('Only USD rate plans are supported');
  const snapshot=pricingSnapshot(context,start,180,now);
  const profile=p.data?{...p.data,policy:pricingPolicySchema.parse(p.data.policy)} as PricingProfile:null;
  const current=snapshot.days.map(d=>d.currentCents).filter((n):n is number=>n!==null).sort((a,b)=>a-b);
  const base=context.plan?.base_nightly_cents || current[Math.floor(current.length/2)] || 30000;
  // Draft defaults must be reviewed by an owner; never a market-derived recommendation.
  const policy=profile?.policy??defaultPricingPolicy(base,Math.max(100,Math.round(base/2)),Math.min(10000000,base*3));
  return {context,snapshot,profile,policy,runs:(r.data??[]) as PricingRunSummary[],start,end};
}
export async function savePricingProfile(propertyId:string, policy:unknown,mode:'shadow'|'helm_direct',expected:number,actor:string) {
  const parsed=pricingPolicySchema.parse(policy);
  const {data,error}=await supabaseAdmin.rpc('helm_save_pricing_profile',{
    p_property:propertyId,p_policy:parsed,p_mode:mode,p_expected:expected,p_actor:actor,
  });
  if(error) throw Error(error.message);
  return data as PricingProfile;
}
export async function createPricingReview(propertyId:string,actor:string) {
  const now=new Date(), workspace=await readPricingWorkspace(propertyId,now);
  if(!workspace.profile) throw Error('Save your policy before creating a publishing review');
  const preview=previewPricing(workspace.policy,workspace.snapshot,now);
  const {data,error}=await supabaseAdmin.from('property_pricing_runs').insert({
    property_id:propertyId,profile_version:workspace.profile.version,model_version:PRICING_MODEL_VERSION,
    start_date:workspace.start,end_date:workspace.end,context:workspace.context,
    recommendations:preview.days,created_by:actor,
  }).select('id,created_at').single();
  if(error||!data) throw Error('Could not save the review');
  return {id:data.id as string,createdAt:data.created_at as string,preview,snapshot:workspace.snapshot,profile:workspace.profile};
}
