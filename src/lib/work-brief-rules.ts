/**
 * Pure rules for the per-home work brief (the paragraph at the top of a
 * home's work sheet). No database, no model, no server-only import, so the
 * tests can pin them. The generation itself lives in lib/work-briefs.ts.
 */

import type { WorkSlipRow } from './work-types';
import { slipLane } from './work-slip-lanes.ts';

export type BriefSlip = Pick<
  WorkSlipRow,
  | 'id'
  | 'title'
  | 'status'
  | 'priority'
  | 'category'
  | 'scheduled_date'
  | 'assigned_to_email'
  | 'assigned_to_label'
> &
  Partial<
    Pick<
      WorkSlipRow,
      'run_scope' | 'owner_action_required' | 'owner_status' | 'organize_group' | 'action_summary' | 'from_supply_key' | 'from_guest_request_key'
    >
  >;

export type WorkBriefRow = {
  property_id: string;
  headline: string;
  brief: string;
  slip_fingerprint: string;
  slip_count: number;
  model: string | null;
  generated_at: string;
};

/** FNV-1a over a string, hex. A stale-check, not a security hash: no
 *  imports, so this module stays client-safe. */
function fnv1a(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/**
 * The shape of the open slip set the brief was written from. Any change
 * that would change the sentences (a slip opened or closed, a lane move, a
 * cluster, a new synthesized line, a date, an assignee, the owner's answer)
 * changes the fingerprint; the order of the rows does not.
 */
export function briefFingerprint(slips: BriefSlip[]): string {
  const lines = slips
    .map((s) =>
      [
        s.id,
        s.status,
        slipLane(s),
        s.priority,
        s.organize_group ?? '',
        String((s.action_summary ?? '').length),
        s.scheduled_date ?? '',
        s.assigned_to_email ?? s.assigned_to_label ?? '',
        s.owner_status ?? '',
      ].join('|'),
    )
    .sort();
  // Two hashes over different orderings of the same lines: one 32-bit
  // hash alone is a little thin for a fleet of lists that change daily.
  return `${fnv1a(lines.join('\n'))}${fnv1a(lines.slice().reverse().join('\n'))}`;
}

/** True when the stored brief no longer describes this slip set. */
export function briefIsStale(brief: Pick<WorkBriefRow, 'slip_fingerprint'> | null | undefined, slips: BriefSlip[]): boolean {
  if (!brief) return slips.length > 0;
  return brief.slip_fingerprint !== briefFingerprint(slips);
}

/** Age in whole days, for the lines the model reads. */
export function ageDays(createdAt: string, now: Date = new Date()): number {
  const ms = now.getTime() - new Date(createdAt).getTime();
  return Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 86_400_000)) : 0;
}

/** A headline over the limit is cut at a clause boundary ("; " or ", "),
 *  never mid-word: "Plumber for the sink; handyman for the blind and gue"
 *  is worse than stopping a clause early. */
export function trimHeadline(raw: string, max = 100): string {
  const text = raw.replace(/\s+/g, ' ').trim().replace(/[.\s]+$/, '');
  if (text.length <= max) return text;
  const clauses = text.split(/;\s+/);
  let out = '';
  for (const clause of clauses) {
    const next = out ? `${out}; ${clause}` : clause;
    if (next.length > max) break;
    out = next;
  }
  if (out) return out;
  const cut = text.slice(0, max);
  const at = Math.max(cut.lastIndexOf(', '), cut.lastIndexOf(' '));
  return `${cut.slice(0, at > max * 0.5 ? at : max).replace(/[\s,;]+$/, '')}…`;
}

/** How old an item is, in the words the brief may use: fresh items say so,
 *  mid-age items say nothing (a day count is noise on a sheet), and only an
 *  item past 60 days names the month it has waited since. */
export function ageWords(createdAt: string, now: Date = new Date()): string | null {
  const days = ageDays(createdAt, now);
  if (days === 0) return 'opened today';
  if (days === 1) return 'opened yesterday';
  if (days <= 60) return null;
  const month = new Date(createdAt).toLocaleDateString('en-US', { month: 'long', timeZone: 'America/New_York' });
  return `waiting since ${month}`;
}

