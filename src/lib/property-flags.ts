import { supabaseAdmin as supabase, isServiceConfigured } from '@/lib/supabase-admin';
import { loadPropertyFlags, type FlagsResult } from './property-flags-load';

export type { FlagSource, PropertyFlag, FlagsResult } from './property-flags-load';

/** Open property flags with exact counts and an explicit unavailable state. */
export async function getPropertyFlags(propertyId: string, limit = 12): Promise<FlagsResult> {
  return loadPropertyFlags(isServiceConfigured ? supabase : null, propertyId, limit);
}
