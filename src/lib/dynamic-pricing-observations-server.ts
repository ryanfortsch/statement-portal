import 'server-only';
import {supabaseAdmin} from './supabase-admin.ts';
import {readPricingWorkspace} from './dynamic-pricing-store.ts';
import {makePricingObservation,pricingObservationSchema,capturePricingBatch,type PricingObservationRecord,type PricingTracking} from './dynamic-pricing-observations.ts';

export async function readPricingObservationWorkspace(propertyId:string) {
  const [tracking,records]=await Promise.all([
    supabaseAdmin.from('property_pricing_tracking').select('enabled,version').eq('property_id',propertyId).maybeSingle(),
    supabaseAdmin.from('property_pricing_observations').select('id,data').eq('property_id',propertyId).order('recorded_at',{ascending:false}).limit(14),
  ]);
  if(tracking.error||records.error)throw Error('Comparison tracking storage is unavailable. Install the observation migration first.');
  const observations:PricingObservationRecord[]=(records.data??[]).map(r=>{
    const data=pricingObservationSchema.parse(r.data);
    if(data.propertyId!==propertyId)throw Error('Observation belongs to another property');
    return {id:r.id as string,data};
  });
  return {tracking:(tracking.data??{enabled:false,version:0}) as PricingTracking,observations,
    scheduledCaptureEnabled:process.env.HELM_PRICING_CAPTURE_ENABLED==='true'&&process.env.VERCEL_ENV==='production'};
}

export async function recordPricingObservation(propertyId:string,actor:string,key:{manualId:string}|{trackingVersion:number}) {
  const w=await readPricingWorkspace(propertyId);
  if(!w.profile)throw Error('Save your policy before recording comparisons');
  const data=makePricingObservation(propertyId,w.context.property.calendar_authority==='helm'?'helm':'guesty',w.policy,w.snapshot,w.profile.version,w.context.evidence?.version??0);
  const daily='trackingVersion' in key;
  const {data:id,error}=await supabaseAdmin.rpc('helm_record_pricing_observation',{
    p_property:propertyId,p_key:daily?`daily:${data.asOf}`:`manual:${key.manualId}`,p_data:data,p_context:w.context,
    p_tracking_version:daily?key.trackingVersion:null,p_actor:actor,
  });
  if(error||!id)throw Error('The comparison could not be saved. Refresh and try again.');
  return String(id);
}

/** Capture is distinct from publishing. Off by default; no rate writer is called. */
export async function runDailyPricingCapture(enabled:boolean) {
  if(!enabled)return capturePricingBatch(false,[],async()=>{});
  const {data,error}=await supabaseAdmin.from('property_pricing_tracking').select('property_id,version').eq('enabled',true).order('property_id').limit(101);
  if(error)throw Error('Unable to read comparison tracking');
  const rows=data??[],versions=new Map(rows.map(r=>[r.property_id,r.version]));
  return capturePricingBatch(true,rows.map(r=>r.property_id),id=>recordPricingObservation(id,'scheduled-pricing-comparison',{trackingVersion:versions.get(id)!}));
}
