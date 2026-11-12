'use server';
import {requireOwnerEmail} from '@/lib/helm-access-server';
import {supabaseAdmin} from '@/lib/supabase-admin';
import {savePricingResearch} from '@/lib/dynamic-pricing-research.server';
export async function savePricingResearchAction(input:unknown) {
  const actor=await requireOwnerEmail();
  return savePricingResearch(supabaseAdmin,input,actor);
}
