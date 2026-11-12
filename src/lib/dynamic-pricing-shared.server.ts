import 'server-only';
import type {SupabaseClient} from '@supabase/supabase-js';
import {selectAllPaged} from './paged-select.ts';
import {emptyPricingSharedRecord,pricingSharedRecordSchema,pricingSharedSaveSchema,validateSharedPricingSettings,samePricingSettings,type PricingSharedResult} from './dynamic-pricing-shared.ts';

const unavailable='Shared settings are unavailable. Your browser copy is unchanged.';
/** Owner-gated callers only. This storage never reads or writes live rate tables. */
export async function readSharedPricingSettings(db:SupabaseClient):Promise<PricingSharedResult> {
  try {
    const {data,error}=await db.from('helm_pricing_drafts').select('revision,settings,updated_at,updated_by').eq('id',1).maybeSingle();
    if(error)return {ok:false,error:unavailable};
    return {ok:true,value:data?pricingSharedRecordSchema.parse(data):emptyPricingSharedRecord()};
  } catch {return {ok:false,error:unavailable};}
}
export async function saveSharedPricingSettings(db:SupabaseClient,input:unknown,actor:string):Promise<PricingSharedResult> {
  const checked=pricingSharedSaveSchema.safeParse(input);
  if(!checked.success)return {ok:false,error:'Check the pricing settings before saving.',retryable:false};
  try {
    // Retired managed properties can remain in saved settings; only known registry IDs are accepted.
    const homes=await selectAllPaged<{id:string}>((from,to)=>db.from('properties').select('id').eq('kind','managed').order('id').range(from,to),{label:'Pricing property IDs',maxRows:1000});
    let settings;
    try {settings=validateSharedPricingSettings(checked.data.settings,new Set(homes.map(h=>h.id)));}
    catch {return {ok:false,retryable:false,error:'Check listing IDs, groups and rule conflicts before saving.'};}
    const {data,error}=await db.rpc('helm_save_pricing_drafts',{p_settings:settings,p_expected:checked.data.expectedRevision,p_request:checked.data.requestId,p_actor:actor.trim().toLowerCase()});
    if(error)return error.code==='40001'?{ok:false,conflict:true,error:'Settings changed in Helm. Review the latest version before saving.'}:{ok:false,error:unavailable};
    const record=pricingSharedRecordSchema.parse(data);
    if(!samePricingSettings(record.settings,settings)||record.revision!==checked.data.expectedRevision+1)throw Error('Unexpected save receipt');
    return {ok:true,value:record};
  } catch {return {ok:false,error:'Settings were not confirmed saved. Your browser copy is unchanged; retry or reload shared settings.'};}
}
