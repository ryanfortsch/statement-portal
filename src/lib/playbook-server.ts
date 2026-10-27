import 'server-only';
import { supabaseAdmin as supabase, isServiceConfigured as isConfigured } from '@/lib/supabase-admin';
import type { PlaybookEntryRow, PlaybookRevisionRow } from './playbook';

// ── Loaders (server-side) ────────────────────────────────────────────────────

type LoadOpts = { includeUnpublished?: boolean };

export async function getPlaybookEntries(opts: LoadOpts = {}): Promise<PlaybookEntryRow[]> {
  if (!isConfigured) return [];
  let query = supabase
    .from('playbook_entries')
    .select('*')
    .order('pinned', { ascending: false })
    .order('updated_at', { ascending: false });
  if (!opts.includeUnpublished) query = query.eq('status', 'published');
  const { data, error } = await query;
  if (error) return [];
  return (data ?? []) as PlaybookEntryRow[];
}

export async function getPlaybookEntryBySlug(slug: string): Promise<PlaybookEntryRow | null> {
  if (!isConfigured) return null;
  const { data, error } = await supabase
    .from('playbook_entries')
    .select('*')
    .eq('slug', slug)
    .maybeSingle();
  if (error || !data) return null;
  return data as PlaybookEntryRow;
}

export async function getEntryRevisions(entryId: string): Promise<PlaybookRevisionRow[]> {
  if (!isConfigured) return [];
  const { data, error } = await supabase
    .from('playbook_revisions')
    .select('*')
    .eq('entry_id', entryId)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) return [];
  return (data ?? []) as PlaybookRevisionRow[];
}

