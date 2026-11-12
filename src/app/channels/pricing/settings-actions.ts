'use server';
import {requireOwnerEmail} from '@/lib/helm-access-server';
import {supabaseAdmin} from '@/lib/supabase-admin';
import {readSharedPricingSettings,saveSharedPricingSettings} from '@/lib/dynamic-pricing-shared.server';

export async function readSharedPricingSettingsAction() {
  await requireOwnerEmail();
  return readSharedPricingSettings(supabaseAdmin);
}
export async function saveSharedPricingSettingsAction(input:unknown) {
  const actor=await requireOwnerEmail();
  return saveSharedPricingSettings(supabaseAdmin,input,actor);
}
