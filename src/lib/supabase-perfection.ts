import { createClient, SupabaseClient } from '@supabase/supabase-js';

/**
 * Read-only client for the Perfection (Lovable) Supabase project.
 *
 * Separate client from src/lib/supabase.ts so the two projects stay isolated.
 * In Path A federation, Helm reads property metadata, inspections, work slips,
 * etc. from Perfection's project; writes still happen via Lovable.
 *
 * The anon key is safe in client bundles (same key the Lovable app ships to
 * browsers). RLS policies on the Perfection project gate what unauthenticated
 * reads can see.
 *
 * Env vars (set in .env.local and in Vercel project settings):
 *   NEXT_PUBLIC_PERFECTION_SUPABASE_URL
 *   NEXT_PUBLIC_PERFECTION_SUPABASE_ANON_KEY
 *
 * Mirrors the placeholder pattern in lib/supabase.ts so the build doesn't
 * blow up if env vars are unset; runtime queries against the placeholder
 * URL will fail and pages should check `isPerfectionConfigured` to show a
 * helpful message instead.
 */
const url = process.env.NEXT_PUBLIC_PERFECTION_SUPABASE_URL || '';
const key = process.env.NEXT_PUBLIC_PERFECTION_SUPABASE_ANON_KEY || '';

export const supabasePerfection: SupabaseClient = createClient(
  url || 'https://placeholder.supabase.co',
  key || 'placeholder'
);

export const isPerfectionConfigured = !!url && !!key;
