/**
 * Lanes: who a work slip is for, read off columns the app already keeps.
 *
 * The board and the per-property print sheet used to show one flat list,
 * so an inspector's checklist carried the owner's shopping list, the
 * office's listing edits and a plumber's job in with the bulb swaps. A lane
 * is the one question a printed sheet has to answer per row: whose hands
 * does this go to?
 *
 *   supply    bring it from the closet or buy it: restocks and consumables
 *   visit     a field inspector does it on a routine stop (quick fixes,
 *             checks, guest prep such as a pack 'n play)
 *   handyman  a dedicated maintenance run: tools, parts, time
 *   pro       a licensed or specialty trade the office books
 *   owner     the owner has to buy, approve or decide first
 *   office    desk work: listing text, notes, emails, follow-through
 *
 * Nothing here is stored. The lane is a pure function of category,
 * run_scope, the owner flag and the provenance keys, so every surface
 * (board, print sheet, packets) agrees without a sync, and an operator's
 * category or scope edit moves the slip everywhere at once. The nightly
 * organize pass (lib/organize-work-slips.ts) only ever writes those same
 * columns.
 */

import type { WorkSlipRow } from './work-types';

export type WorkLane = 'supply' | 'visit' | 'handyman' | 'pro' | 'owner' | 'office';

/** Walk order on paper: shop first, then what the visit does, then what
 *  waits on somebody else. */
export const LANE_ORDER: WorkLane[] = ['supply', 'visit', 'handyman', 'pro', 'owner', 'office'];

export const LANE_LABELS: Record<WorkLane, string> = {
  supply: 'Needs restock',
  visit: 'This visit',
  handyman: 'Handyman run',
  pro: 'Licensed pro or vendor',
  owner: 'Owner to purchase or decide',
  office: 'Office follow-through',
};

/** One-line subtitle under each print section. */
export const LANE_HINTS: Record<WorkLane, string> = {
  supply: 'Bring from the supply closet or pick up on the way.',
  visit: 'Quick fixes, checks and guest prep an inspector handles on a routine stop.',
  handyman: 'Needs real tools, parts or time. Bundled onto a maintenance run.',
  pro: 'Needs a licensed or specialty trade. The office books the appointment.',
  owner: 'Waiting on the owner. Nothing to do in the house until they answer.',
  office: 'Desk work for the office. Not for this visit.',
};

export type LaneSlip = Pick<WorkSlipRow, 'category' | 'title'> &
  Partial<Pick<WorkSlipRow, 'run_scope' | 'owner_action_required' | 'from_supply_key' | 'from_guest_request_key'>>;

/**
 * Inventory vs. work. Three ways a slip counts as a supply:
 *   1. category 'inventory', picked on the New Work Slip form or by the
 *      organize pass.
 *   2. from_supply_key, auto-created by the inspection Supplies Check.
 *   3. legacy 'rising_tide' titled "Restock: ...", which pre-dates the
 *      inventory category and is kept so old hand-entered restocks still
 *      land on the supplies side instead of among the repairs.
 */
export function isSupplySlip(s: LaneSlip): boolean {
  return (
    s.category === 'inventory' ||
    !!s.from_supply_key ||
    (s.category === 'rising_tide' && /^restock:\s/i.test(s.title))
  );
}

export function slipLane(s: LaneSlip): WorkLane {
  // The owner flag wins over everything: a flagged restock or repair is
  // waiting on the owner no matter what else it is.
  if (s.owner_action_required || s.category === 'owner') return 'owner';
  if (isSupplySlip(s)) return 'supply';
  const key = s.from_guest_request_key ?? '';
  if (s.category === 'other') {
    // The concierge files guest gear and stay notes as 'other'. Both are
    // for the person standing in the house; every other concierge rail
    // under 'other' (far-future holds, payment links, receipts) is desk work.
    return key.startsWith('gear:') || key.startsWith('staycontact:') ? 'visit' : 'office';
  }
  if (s.category === 'rising_tide' || s.category === 'ad_hoc') return 'office';
  if (s.category === 'vendor') return 'pro';
  if (s.run_scope === 'pro') return 'pro';
  if (s.run_scope === 'handyman') return 'handyman';
  // 'inspector', and untriaged: a routine stop picks it up by default.
  return 'visit';
}

/** A slip filed as "73 Rocky Neck: Fix the back door" reads as "Fix the
 *  back door" inside that home's own group or sheet. Only a leading home
 *  name followed by a separator is stripped; "73 Rocky Neck Ave gutter"
 *  is left alone. */
export function slipDisplayTitle(title: string, propertyName: string | null | undefined): string {
  const t = title.trim();
  const name = (propertyName ?? '').trim();
  if (!name || !t.toLowerCase().startsWith(name.toLowerCase())) return t;
  const tail = t.slice(name.length);
  const rest = tail.replace(/^\s*[:\-–—]\s*/, '');
  return rest && rest !== tail ? rest : t;
}

function oneLine(text: string): string {
  // Keep the shape of a multi-line field note ("Pot holders / Recycling
  // bin") readable on one line instead of running the items together.
  return text
    .replace(/\r/g, '')
    .split(/\n+/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .join(' · ');
}

function clipWords(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const at = cut.lastIndexOf(' ');
  return `${(at > max * 0.6 ? cut.slice(0, at) : cut).replace(/[\s,;:·-]+$/, '')}…`;
}

function sameText(a: string, b: string): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  return norm(a) === norm(b);
}

export type DetailSlip = Pick<WorkSlipRow, 'title' | 'action_summary' | 'description'>;

/**
 * The one line under a title on a row or a printed sheet: the action
 * summary when it says more than the title does, otherwise the description
 * collapsed and clipped. A pasted review or thread never prints whole; the
 * slip page keeps the full text.
 */
export function slipDetailLine(s: DetailSlip, propertyName?: string | null, max = 240): string | null {
  const title = slipDisplayTitle(s.title, propertyName);
  const summary = oneLine(s.action_summary ?? '');
  if (summary && !sameText(summary, title) && !sameText(summary, s.title)) return clipWords(summary, max);
  const desc = oneLine(s.description ?? '');
  if (!desc || sameText(desc, title)) return null;
  return clipWords(desc, max);
}

export type SourceSlip = Partial<
  Pick<
    WorkSlipRow,
    | 'from_review_id'
    | 'from_guest_message_key'
    | 'from_guest_request_key'
    | 'from_supply_key'
    | 'inspection_id'
    | 'reported_by_contractor_id'
    | 'created_by_email'
  >
> & { from_quo_message_id?: string | null; from_gmail_message_id?: string | null };

/** Where a slip came from, in words for a sheet: "a guest review", "a
 *  field inspector", "the office". Names are resolved by the caller when
 *  it has them (the board says "flagged by Delaney"). */
export function slipSourceLabel(s: SourceSlip): string {
  if (s.from_review_id) return 'a guest review';
  if (s.from_guest_message_key) return 'a guest message';
  if (s.from_gmail_message_id) return 'an email';
  if (s.from_quo_message_id) return 'a text to the office';
  if (s.from_supply_key) return 'the supplies check';
  if (s.from_guest_request_key) return 'the guest concierge';
  if (s.inspection_id) return 'an inspection';
  if (s.reported_by_contractor_id) return 'a field inspector';
  const email = (s.created_by_email ?? '').toLowerCase();
  if (email.endsWith('@helm.system')) return 'Helm';
  return 'the office';
}

const PRIORITY_RANK: Record<string, number> = { high: 0, normal: 1, low: 2 };

export type LaneGroup<T> = { lane: WorkLane; slips: T[] };

type SortSlip = LaneSlip &
  Pick<WorkSlipRow, 'priority' | 'created_at'> &
  Partial<Pick<WorkSlipRow, 'organize_group'>>;

/**
 * Split slips into the lanes that have members, in walk order. Inside a
 * lane, high priority floats, clustered slips (same organize_group) stay
 * adjacent and take their cluster's best priority and earliest date, and
 * the rest reads oldest first so the easy wins sit near the top.
 */
export function groupSlipsByLane<T extends SortSlip>(slips: T[]): LaneGroup<T>[] {
  const byLane = new Map<WorkLane, T[]>();
  for (const s of slips) {
    const lane = slipLane(s);
    const list = byLane.get(lane) ?? [];
    list.push(s);
    byLane.set(lane, list);
  }
  const out: LaneGroup<T>[] = [];
  for (const lane of LANE_ORDER) {
    const list = byLane.get(lane);
    if (!list || list.length === 0) continue;
    const anchor = new Map<string, { rank: number; created: string }>();
    for (const s of list) {
      if (!s.organize_group) continue;
      const cur = anchor.get(s.organize_group);
      const rank = PRIORITY_RANK[s.priority] ?? 1;
      if (!cur) anchor.set(s.organize_group, { rank, created: s.created_at });
      else anchor.set(s.organize_group, { rank: Math.min(cur.rank, rank), created: cur.created < s.created_at ? cur.created : s.created_at });
    }
    const keyOf = (s: T) => {
      const a = s.organize_group ? anchor.get(s.organize_group) : undefined;
      return a ?? { rank: PRIORITY_RANK[s.priority] ?? 1, created: s.created_at };
    };
    out.push({
      lane,
      slips: [...list].sort((a, b) => {
        const ka = keyOf(a);
        const kb = keyOf(b);
        return (
          ka.rank - kb.rank ||
          ka.created.localeCompare(kb.created) ||
          (a.organize_group ?? '').localeCompare(b.organize_group ?? '') ||
          (PRIORITY_RANK[a.priority] ?? 1) - (PRIORITY_RANK[b.priority] ?? 1) ||
          a.created_at.localeCompare(b.created_at)
        );
      }),
    });
  }
  return out;
}

export function laneCounts(slips: LaneSlip[]): Record<WorkLane, number> {
  const counts: Record<WorkLane, number> = { supply: 0, visit: 0, handyman: 0, pro: 0, owner: 0, office: 0 };
  for (const s of slips) counts[slipLane(s)] += 1;
  return counts;
}
