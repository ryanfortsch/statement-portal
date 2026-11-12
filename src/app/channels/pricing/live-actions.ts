'use server';
import {requireOwnerEmail} from '@/lib/helm-access-server';
import {supabaseAdmin} from '@/lib/supabase-admin';
import {readPricingLiveHomes,readPricingLiveCalendar,readPricingLivePortfolio} from '@/lib/dynamic-pricing-live.server';

export async function refreshPricingLiveAction() {
  await requireOwnerEmail();
  try {return {ok:true as const,value:await readPricingLivePortfolio(supabaseAdmin,new Date(),true)};}
  catch {return {ok:false as const,error:'Calendar data is unavailable'};}
}
export async function readPricingLiveCalendarAction(id:string) {
  await requireOwnerEmail();
  try {
    const home=(await readPricingLiveHomes(supabaseAdmin)).find(h=>h.id===id);
    if(!home)throw Error('Choose an active property');
    return {ok:true as const,value:await readPricingLiveCalendar(supabaseAdmin,home,new Date(),true)};
  } catch {return {ok:false as const,error:'Calendar data is unavailable'};}
}
