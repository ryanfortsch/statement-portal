import 'server-only';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import { selectAllPaged } from './paged-select';

export async function loadCleanerCountSource(db: SupabaseClient) {
  const [property, mirror] = await Promise.all([
    db.from('properties').select('calendar_authority').eq('id', '65_calderwood').single(),
    selectAllPaged(async (start, end) => {
      const result = await db.from('guesty_reservations')
        .select('guesty_reservation_id,property_id,listing_id,confirmation_code,check_in,check_out,status')
        .eq('property_id', '65_calderwood').order('guesty_reservation_id').range(start, end);
      if (!Array.isArray(result.data)) throw Error('Counts unavailable');
      return result;
    }, { pageSize: 500, maxRows: 5000 }),
  ]);
  if (property.error) throw Error('Counts unavailable');
  return { authority: z.enum(['guesty', 'helm']).parse(property.data?.calendar_authority), mirror };
}

/** Reuse the sync's cached token. This preview never creates credentials,
 * refreshes OAuth, or writes even an authentication row. */
export async function readCleanerCountToken(db: SupabaseClient) {
  const result = await db.from('guesty_auth').select('access_token,expires_at').eq('id', 1).single();
  const auth = result.data;
  if (result.error || typeof auth?.access_token !== 'string' || !auth.access_token
    || !Number.isFinite(Date.parse(auth.expires_at)) || Date.parse(auth.expires_at) <= Date.now() + 60000) {
    throw Error('Counts unavailable');
  }
  return auth.access_token;
}
