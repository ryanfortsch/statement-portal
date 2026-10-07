import { randomBytes } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';

/** Install a token only while absent, then return the database winner. */
export async function getOrCreatePropertyOnboardingToken(sb: SupabaseClient, propertyId: string): Promise<string> {
  const read = () => sb.from('properties').select('onboarding_token').eq('id', propertyId).maybeSingle();
  const { data: existing, error } = await read();
  if (error) throw new Error(error.message);
  if (!existing) throw new Error('Property not found');
  if (existing.onboarding_token) return existing.onboarding_token;
  const { data: saved, error: writeError } = await sb.from('properties')
    .update({ onboarding_token: randomBytes(16).toString('hex') })
    .eq('id', propertyId).is('onboarding_token', null).select('onboarding_token').maybeSingle();
  if (writeError) throw new Error(writeError.message);
  if (saved?.onboarding_token) return saved.onboarding_token;
  // Another request won the conditional write. Never return our unused token.
  const { data: winner, error: readError } = await read();
  if (readError) throw new Error(readError.message);
  if (!winner?.onboarding_token) throw new Error('Could not confirm the onboarding link. Try again.');
  return winner.onboarding_token;
}
