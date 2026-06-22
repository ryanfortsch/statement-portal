import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Server-only Supabase client using the SERVICE ROLE key.
 *
 * It BYPASSES row-level security, so it must never be imported into a client
 * component (the service key is not in the browser bundle, so it would be a
 * non-functional placeholder there anyway). Use it for every read or write of a
 * table that is locked down at the RLS layer -- contacts, contact_touches,
 * audience_*, booking_finance, bookings, imported_inquiries, property_access,
 * and so on -- now that those tables no longer carry a permissive anon policy.
 *
 * The cheapest way to move an existing server file off the anon key is a
 * one-line import swap, which leaves the rest of the file untouched:
 *
 *   - import { supabase } from '@/lib/supabase';
 *   + import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
 *
 * and, where the file also guarded on the anon client's isConfigured:
 *
 *   + import { supabaseAdmin as supabase, isServiceConfigured as isConfigured }
 *   +   from '@/lib/supabase-admin';
 */

const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

/**
 * True when both the Supabase URL and the service-role key are present. Always
 * false in a browser bundle (the service key is server-only), which is the
 * intended guard for server code that switched off the anon client.
 */
export const isServiceConfigured = !!url && !!serviceKey;

let cached: SupabaseClient | null = null;

/** Lazily-created, memoized service-role client. */
export function getServiceClient(): SupabaseClient {
  if (!cached) {
    cached = createClient(
      url || 'https://placeholder.supabase.co',
      serviceKey || 'placeholder',
      { auth: { persistSession: false } },
    );
  }
  return cached;
}

/** Ready-to-use service-role client; alias as `supabase` in a one-line swap. */
export const supabaseAdmin: SupabaseClient = getServiceClient();
