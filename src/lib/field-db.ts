/**
 * Service-role Supabase client for the Field module (contractor portal).
 *
 * The shared `@/lib/supabase` client uses the ANON key, which is shipped to
 * browsers and is subject to the repo's permissive RLS. The Field tables
 * (contractors, sessions, packets, events) are RLS-locked with no anon
 * policy, so they're only reachable through this server-side service-role
 * client — which bypasses RLS. Every contractor-facing query that runs on
 * top of this MUST scope to the resolved contractor in application code;
 * the client provides no isolation on its own.
 *
 * Lazy singleton, matching the pattern in daily-brief.ts / guesty.ts.
 * Server-only: never import this into a Client Component.
 */
import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let _client: SupabaseClient | null = null;

export function fieldDb(): SupabaseClient {
  if (_client) return _client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!url || !key) {
    throw new Error('Field module requires NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY');
  }
  _client = createClient(url, key, { auth: { persistSession: false } });
  return _client;
}

export const isFieldConfigured =
  !!process.env.NEXT_PUBLIC_SUPABASE_URL && !!process.env.SUPABASE_SERVICE_ROLE_KEY;
