/**
 * Cross-module search. Used by /search (full results page) and
 * /api/search (live dropdown on the home page).
 *
 * Indexed entities, in priority order for the dropdown:
 *   - Pages (Helm modules from helm-modules.ts)
 *   - Properties (name, address, title, owner)
 *   - Contacts (name, organization)
 *   - Work slips (title, description, location)
 *   - Tasks (title, description)
 *
 * Pages are matched in-memory (no DB hit); the rest run in parallel as
 * permissive ILIKE queries against Supabase. Limit per group keeps the
 * dropdown lean.
 */

import { supabase, isConfigured as isHelmConfigured } from '@/lib/supabase';
import { HELM_MODULES, type HelmModule } from '@/lib/helm-modules';
import type { HelmPropertyRow } from '@/lib/properties';
import type { WorkSlipRow, TaskRow } from '@/lib/work-types';
import { ACTIVE_WORK_SLIP_STATUSES, ACTIVE_TASK_STATUSES } from '@/lib/work-types';
import type { ContactRow } from '@/lib/crm';

export type PageMatch = {
  id: string;
  title: string;
  description: string;
  href: string;
};

export type SlipMatch = WorkSlipRow & { property_name: string };

export type SearchResults = {
  pages: PageMatch[];
  properties: HelmPropertyRow[];
  contacts: ContactRow[];
  slips: SlipMatch[];
  tasks: TaskRow[];
  total: number;
};

const EMPTY: SearchResults = { pages: [], properties: [], contacts: [], slips: [], tasks: [], total: 0 };

/** Return up to N module pages matching the query against title / description / id. */
function searchPages(q: string, limit = 6): PageMatch[] {
  const ql = q.toLowerCase().trim();
  if (!ql) return [];
  const hits: PageMatch[] = [];
  for (const m of HELM_MODULES) {
    if (m.status !== 'active') continue;
    const title = m.title.toLowerCase();
    const desc = m.description.toLowerCase();
    if (title.includes(ql) || desc.includes(ql) || m.id.includes(ql)) {
      hits.push({ id: m.id, title: m.title, description: m.description, href: m.href });
    }
  }
  // Title matches rank higher than description matches.
  hits.sort((a, b) => {
    const at = a.title.toLowerCase().includes(ql) ? 0 : 1;
    const bt = b.title.toLowerCase().includes(ql) ? 0 : 1;
    return at - bt;
  });
  return hits.slice(0, limit);
}

/**
 * Run the full cross-module search. Returns empty groups for queries
 * shorter than 2 chars (avoids hammering the DB on every keystroke).
 */
export async function searchEverything(q: string, opts?: { perGroup?: number }): Promise<SearchResults> {
  if (!isHelmConfigured) return EMPTY;
  const trimmed = (q ?? '').trim();
  if (trimmed.length < 2) return EMPTY;

  const perGroup = opts?.perGroup ?? 8;
  const escaped = trimmed.replace(/[%_,]/g, ' ');
  const like = `%${escaped}%`;

  const [propRes, contactRes, slipRes, taskRes, propMapRes] = await Promise.all([
    supabase
      .from('properties')
      .select('*')
      .or(`name.ilike.${like},address.ilike.${like},title.ilike.${like},owner_full.ilike.${like},owner_last.ilike.${like}`)
      .order('name')
      .limit(perGroup),
    supabase
      .from('contacts')
      .select('*')
      .or(`name.ilike.${like},organization.ilike.${like}`)
      .order('name')
      .limit(perGroup),
    supabase
      .from('work_slips')
      .select('*')
      .in('status', ACTIVE_WORK_SLIP_STATUSES)
      .or(`title.ilike.${like},description.ilike.${like},location.ilike.${like}`)
      .order('priority', { ascending: false })
      .limit(perGroup * 2), // pull extra so post-snooze filter still hits perGroup
    supabase
      .from('tasks')
      .select('*')
      .in('status', ACTIVE_TASK_STATUSES)
      .or(`title.ilike.${like},description.ilike.${like}`)
      .order('priority', { ascending: false })
      .limit(perGroup),
    supabase.from('properties').select('id, name'),
  ]);

  const propertyMap = new Map<string, string>(
    ((propMapRes.data ?? []) as Array<{ id: string; name: string }>).map((p) => [p.id, p.name])
  );
  const todayIso = new Date().toISOString().slice(0, 10);

  const pages = searchPages(trimmed);
  const properties = (propRes.data ?? []) as HelmPropertyRow[];
  const contacts = (contactRes.data ?? []) as ContactRow[];
  const slips: SlipMatch[] = ((slipRes.data ?? []) as WorkSlipRow[])
    .filter((s) => !s.snoozed_until || s.snoozed_until <= todayIso)
    .slice(0, perGroup)
    .map((s) => ({ ...s, property_name: propertyMap.get(s.property_id) ?? s.property_id }));
  const tasks = (taskRes.data ?? []) as TaskRow[];

  const total = pages.length + properties.length + contacts.length + slips.length + tasks.length;

  return { pages, properties, contacts, slips, tasks, total };
}

/** Page-only search. Cheap, in-memory, no DB. Used as an instant pre-flight. */
export function searchPagesOnly(q: string): PageMatch[] {
  return searchPages(q, 8);
}
