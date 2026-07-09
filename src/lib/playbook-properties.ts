import 'server-only';
import { supabaseAdmin } from '@/lib/supabase-admin';

export type PropertyOption = { id: string; name: string };

/**
 * Property picker options for the Playbook module. Split out of lib/playbook.ts
 * (which stays on the anon client for its OWN tables -- playbook_entries /
 * playbook_revisions, out of scope here) specifically so this properties read
 * can move to the service role without pulling that client into the browser
 * bundle: lib/playbook.ts is also imported by client components (PlaybookClient,
 * PlaybookEditor, UniversalSearch) for their pure string helpers, and this file's
 * `server-only` import hard-fails the build if anything client-side ever reaches
 * it by mistake.
 */
export async function getPropertyOptions(): Promise<PropertyOption[]> {
  const { data, error } = await supabaseAdmin.from('properties').select('id, name').order('name');
  if (error) return [];
  return (data ?? []) as PropertyOption[];
}
