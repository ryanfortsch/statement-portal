import 'server-only';
import type {SupabaseClient} from '@supabase/supabase-js';
import {pricingResearchRecordSchema,validatePricingResearch,type PricingResearchRecord,type PricingResearchResult} from './dynamic-pricing-research.ts';
import {pricingSettingsKey} from './dynamic-pricing-shared.ts';

export async function readPricingResearch(db:SupabaseClient,propertyId:string):Promise<{ok:true;value:PricingResearchRecord|null}|{ok:false;error:string}> {
  try {
    const {data,error}=await db.from('helm_pricing_research').select('version,data,updated_at').eq('property_id',propertyId).maybeSingle();
    if(error)throw error;
    const record=data?pricingResearchRecordSchema.parse(data):null;
    if(record&&record.data.propertyId!==propertyId)throw Error('Wrong listing');
    return {ok:true,value:record};
  } catch {return {ok:false,error:'Saved market data is unavailable. Refresh to try again.'};}
}
export async function savePricingResearch(db:SupabaseClient,input:unknown,actor:string):Promise<PricingResearchResult> {
  let checked;
  try {checked=validatePricingResearch(input);}catch {return {ok:false,error:'Check the listing, daily rows and observation time before saving.'};}
  try {
    const home=await db.from('properties').select('id').eq('id',checked.propertyId).eq('kind','managed').eq('is_active',true).maybeSingle();
    if(home.error||!home.data)return {ok:false,error:'Choose an active managed listing.'};
    const {data,error}=await db.rpc('helm_save_pricing_research',{p_property:checked.propertyId,p_data:checked.data,p_expected:checked.version,p_request:checked.requestId,p_actor:actor});
    if(error)return {ok:false,...(error.code==='40001'?{conflict:true}:{}),error:error.code==='40001'?'Market data changed in Helm. Refresh this listing before importing again.':'Market data was not confirmed saved. Your selected import is still here; retry.'};
    const record=pricingResearchRecordSchema.parse(data);
    if(record.version!==checked.version+1||pricingSettingsKey(record.data)!==pricingSettingsKey(checked.data))throw Error('Unexpected receipt');
    return {ok:true,value:record};
  }catch {return {ok:false,error:'Market data was not confirmed saved. Your selected import is still here; retry.'};}
}
