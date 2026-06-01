import { supabase, isConfigured } from '@/lib/supabase';

// ── Types ────────────────────────────────────────────────────────────────────

export type PlaybookStatus = 'draft' | 'published' | 'archived';

export type PlaybookEntryRow = {
  id: string;
  slug: string;
  title: string;
  category: string;
  summary: string | null;
  body_md: string;
  tags: string[];
  property_id: string | null;
  status: PlaybookStatus;
  pinned: boolean;
  created_by_email: string;
  updated_by_email: string | null;
  created_at: string;
  updated_at: string;
};

export type PlaybookRevisionRow = {
  id: string;
  entry_id: string;
  title: string;
  body_md: string;
  change_note: string | null;
  by_email: string;
  created_at: string;
};

export type PropertyOption = { id: string; name: string };

// ── Categories ───────────────────────────────────────────────────────────────
// Free text in the database for flexibility, but the editor offers this curated
// set so the list groups cleanly. Add one here and it shows up in the picker; no
// migration needed.

export const PLAYBOOK_CATEGORIES: { key: string; label: string; blurb: string }[] = [
  { key: 'onboarding', label: 'Onboarding', blurb: 'Standing up a new property or owner' },
  { key: 'statements', label: 'Statements', blurb: 'Building and sending owner statements' },
  { key: 'finance', label: 'Finance & Banking', blurb: 'Chase, Stripe, fees, revenue rules' },
  { key: 'operations', label: 'Operations & Turnovers', blurb: 'Cleaning, turnovers, scheduling' },
  { key: 'guests', label: 'Guests & Reviews', blurb: 'Messaging, reviews, the guest experience' },
  { key: 'properties', label: 'Properties & Maintenance', blurb: 'Maintenance, locks, the homes themselves' },
  { key: 'integrations', label: 'Integrations & Tools', blurb: 'Guesty, Quo, Seam, Gmail, the stack' },
  { key: 'general', label: 'General', blurb: 'Everything else' },
];

const CATEGORY_LABELS: Record<string, string> = Object.fromEntries(
  PLAYBOOK_CATEGORIES.map((c) => [c.key, c.label]),
);

/** Human label for a category key. Falls back to a title-cased version of an
 *  unknown key so a custom category still reads cleanly. */
export function categoryLabel(key: string): string {
  if (CATEGORY_LABELS[key]) return CATEGORY_LABELS[key];
  return key
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

export const STATUS_LABELS: Record<PlaybookStatus, string> = {
  draft: 'Draft',
  published: 'Published',
  archived: 'Archived',
};

// ── Slug + text helpers ──────────────────────────────────────────────────────

export function slugify(title: string): string {
  return title
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'entry';
}

/** Strip markdown to readable plain text, for list excerpts and search/Ask
 *  summaries when an entry has no explicit summary. */
export function stripMarkdown(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, ' ')        // fenced code
    .replace(/`([^`]+)`/g, '$1')            // inline code
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')  // images
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1') // links -> text
    .replace(/^#{1,6}\s+/gm, '')            // headings
    .replace(/^\s*>\s?/gm, '')              // blockquotes
    .replace(/^\s*([-*+]|\d+\.)\s+/gm, '')  // list markers
    .replace(/(\*\*|__)(.*?)\1/g, '$2')     // bold
    .replace(/(\*|_)(.*?)\1/g, '$2')        // italic
    .replace(/^---+$/gm, ' ')               // hr
    .replace(/\s+/g, ' ')
    .trim();
}

/** Best available short description for an entry. */
export function excerptFor(entry: Pick<PlaybookEntryRow, 'summary' | 'body_md'>, max = 160): string {
  const base = entry.summary?.trim() || stripMarkdown(entry.body_md);
  if (base.length <= max) return base;
  return base.slice(0, max).replace(/\s+\S*$/, '') + '…';
}

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

export async function getPropertyOptions(): Promise<PropertyOption[]> {
  if (!isConfigured) return [];
  const { data, error } = await supabase
    .from('properties')
    .select('id, name')
    .order('name');
  if (error) return [];
  return (data ?? []) as PropertyOption[];
}
