import type { RoomBed } from '@/lib/property-rooms-shared';
import {
  READINESS_GROUPS,
  quantityFor,
  type ReadinessContext,
  type RenderedItem,
} from '@/lib/projections-readiness';

/**
 * Property outfitting ORDER checklist - what to buy to take a new home to
 * guest-ready, with quantities computed from the property's real data.
 *
 * This is the property-side sibling of the prospect readiness checklist
 * (src/lib/projections-readiness.ts). Two things are different here:
 *
 *   1. Quantities come from the onboarding walkthrough when it exists:
 *      beds by SIZE from property_rooms (a queen sheet set does not fit a
 *      king), bathrooms from the property record. The readiness list only
 *      ever had bedrooms-count heuristics because prospects have no rooms
 *      on file yet.
 *   2. The linen and towel rows encode the Fix Linens ordering rules Allie
 *      confirmed 2026-08-31:
 *        - sheet sets: 2.5 x bed count, per bed size, rounded up
 *        - bath towels (large): 2.5 x max guests, rounded up. That number
 *          drives the whole towel order because every Fix Linens package
 *          carries more face and hand towels than bath towels, so those
 *          cover themselves.
 *      These rules supersede the readiness list's flat "2 per guest" /
 *      "2 per bathroom" towel rows, which are filtered out of the reused
 *      groups below.
 *
 * Everything else a home needs (kitchen, smart home, misc) is reused
 * verbatim from READINESS_GROUPS so the two checklists can never drift on
 * the shared items. Item labels double as the persistence keys in
 * property_order_checklist.state.have (same label-keyed jsonb shape as
 * projections.readiness_state), so treat a label rename like a DB key
 * rename: the old entry silently drops.
 *
 * No server imports in this file - the interactive client renders from it.
 * Room types come from property-rooms-shared, never property-rooms (that
 * one is server-only and fails next build, not tsc).
 */

export const LINEN_MULTIPLIER = 2.5;
export const LINEN_VENDOR = 'Fix Linens';

// Readiness rows superseded by the size-aware Fix Linens math below. If a
// label here drifts from READINESS_GROUPS the row simply shows up twice,
// so keep them in sync when editing either side.
const SUPERSEDED_READINESS_LABELS = new Set([
  'Mattress encasement',
  'Bed pillows',
  'Bed pillow encasements',
  'Bath towels',
  'Hand towels',
]);

// ─── Bed size normalization ────────────────────────────────────────────────
// Walkthrough dictation stores sizes as free text ("queen", "2x twin",
// "King", "bunk"). Collapse synonyms so the order list aggregates cleanly;
// unknown sizes pass through as their own row because sheet sets are
// size-specific and a wrong guess orders the wrong linens.

type NormalizedBed = { size: string; count: number } | null;

function normalizeBed(bed: RoomBed): NormalizedBed {
  const raw = (bed.size || '').trim().toLowerCase();
  const count = Math.max(1, Math.round(bed.count || 1));
  if (!raw) return null;
  // Infant gear sleeps in its own linens and never enters the sheet order.
  if (/crib|pack|bassinet|toddler/.test(raw)) return null;
  if (/cal(ifornia)?\s*king/.test(raw)) return { size: 'cal king', count };
  if (raw.includes('king')) return { size: 'king', count };
  if (raw.includes('queen')) return { size: 'queen', count };
  if (raw.includes('full') || raw.includes('double')) return { size: 'full', count };
  if (/twin\s*xl|xl\s*twin/.test(raw)) return { size: 'twin xl', count };
  // A bunk is two twin mattresses: double the count so the sheet order and
  // sleeper math both see the real mattress count.
  if (raw.includes('bunk')) return { size: 'twin', count: count * 2 };
  if (raw.includes('twin') || raw.includes('single') || raw.includes('day')) {
    return { size: 'twin', count };
  }
  return { size: raw, count };
}

const SIZE_ORDER = ['cal king', 'king', 'queen', 'full', 'twin xl', 'twin'];

function sizeSort(a: string, b: string): number {
  const ia = SIZE_ORDER.indexOf(a);
  const ib = SIZE_ORDER.indexOf(b);
  if (ia !== -1 && ib !== -1) return ia - ib;
  if (ia !== -1) return -1;
  if (ib !== -1) return 1;
  return a.localeCompare(b);
}

/** twin-family mattresses sleep one, everything else two. */
function sleepersFor(size: string): number {
  return size === 'twin' || size === 'twin xl' ? 1 : 2;
}

/** Pillows per bed by size (same rule as the readiness note: queen 4,
 *  king 6, full/twin 2; unknown sizes get the queen default). */
function pillowsFor(size: string): number {
  if (size === 'king' || size === 'cal king') return 6;
  if (size === 'full' || size === 'twin' || size === 'twin xl') return 2;
  if (size === 'queen') return 4;
  return 4;
}

function titleCase(size: string): string {
  return size.replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\bXl\b/, 'XL');
}

// ─── Context ───────────────────────────────────────────────────────────────

export type OrderBedLine = { size: string; count: number };

export type OrderContext = {
  bedrooms: number;
  bathrooms: number;
  /** True when bathrooms came off the property record, not the heuristic. */
  bathroomsFromRecord: boolean;
  maxGuests: number;
  /** True when maxGuests was summed from real beds (incl. pullout), not
   *  the 2-per-bedroom fallback. */
  guestsFromBeds: boolean;
  /** Normalized, aggregated beds. When no rooms carry beds yet this is the
   *  one-queen-per-bedroom assumption and bedsFromRooms is false. */
  beds: OrderBedLine[];
  bedCount: number;
  bedsFromRooms: boolean;
  hasPullout: boolean;
};

export function deriveOrderContext(args: {
  bedrooms: number | null;
  bathrooms: number | null;
  hasPulloutBed: boolean;
  /** property_rooms rows with room_type='bedroom', the fallback bedroom
   *  count when the record's bedrooms column is empty. */
  bedroomRoomCount: number;
  /** details.beds across every room on file (any room type - sleeper
   *  sofas get recorded on living rooms). */
  roomBeds: RoomBed[];
}): OrderContext {
  const aggregated = new Map<string, number>();
  for (const bed of args.roomBeds) {
    const norm = normalizeBed(bed);
    if (!norm) continue;
    aggregated.set(norm.size, (aggregated.get(norm.size) ?? 0) + norm.count);
  }

  const bedsFromRooms = aggregated.size > 0;
  const bedrooms = Math.max(
    1,
    Math.round(args.bedrooms ?? 0) || args.bedroomRoomCount || 1,
  );

  // No walkthrough yet: assume one queen per bedroom so the page still
  // prints a usable order, flagged as estimated in the header.
  const beds: OrderBedLine[] = bedsFromRooms
    ? [...aggregated.entries()]
        .map(([size, count]) => ({ size, count }))
        .sort((a, b) => sizeSort(a.size, b.size))
    : [{ size: 'queen', count: bedrooms }];

  const bedCount = beds.reduce((sum, b) => sum + b.count, 0);

  const maxGuests = bedsFromRooms
    ? beds.reduce((sum, b) => sum + sleepersFor(b.size) * b.count, 0) +
      (args.hasPulloutBed ? 2 : 0)
    : bedrooms * 2;

  let bathrooms = Math.max(1, Math.round(bedrooms * 0.75));
  let bathroomsFromRecord = false;
  if (args.bathrooms != null && args.bathrooms > 0) {
    // Round half-baths up - a 2.5-bath home stocks 3 of everything.
    bathrooms = Math.ceil(args.bathrooms);
    bathroomsFromRecord = true;
  }

  return {
    bedrooms,
    bathrooms,
    bathroomsFromRecord,
    maxGuests: Math.max(2, maxGuests),
    guestsFromBeds: bedsFromRooms,
    beds,
    bedCount,
    bedsFromRooms,
    hasPullout: args.hasPulloutBed,
  };
}

// ─── The order list ────────────────────────────────────────────────────────

export type OrderGroup = {
  title: string;
  /** One-line rationale shown under the group head (and on the printout). */
  blurb?: string;
  items: RenderedItem[];
};

const perBedNote = (count: number, size: string) =>
  `${count} ${titleCase(size)} bed${count === 1 ? '' : 's'} x ${LINEN_MULTIPLIER}`;

export function computeOrderChecklist(ctx: OrderContext): OrderGroup[] {
  // Group 1: sheets and bedding, per real bed size.
  const linenItems: RenderedItem[] = [];
  for (const bed of ctx.beds) {
    linenItems.push({
      label: `${titleCase(bed.size)} sheet sets`,
      count: Math.ceil(LINEN_MULTIPLIER * bed.count),
      note: perBedNote(bed.count, bed.size),
    });
  }
  if (ctx.hasPullout) {
    linenItems.push({
      label: 'Pullout bed sheet sets',
      count: Math.ceil(LINEN_MULTIPLIER * 1),
      note: 'The sofa bed counts as a bed; store these where the pullout linens live',
    });
  }
  for (const bed of ctx.beds) {
    linenItems.push({
      label: `${titleCase(bed.size)} mattress protectors`,
      count: bed.count,
      note: 'One per bed',
    });
  }
  const pillowTotal = ctx.beds.reduce(
    (sum, b) => sum + pillowsFor(b.size) * b.count,
    0,
  );
  linenItems.push(
    {
      label: 'Bed pillows',
      count: pillowTotal,
      note: '6 per king, 4 per queen, 2 per full/twin',
    },
    { label: 'Pillow protectors', count: pillowTotal, note: 'One per pillow' },
  );

  // Group 2: towels. Bath towel count is the order driver.
  const towelItems: RenderedItem[] = [
    {
      label: 'Bath towels (large)',
      count: Math.ceil(LINEN_MULTIPLIER * ctx.maxGuests),
      note: `${LINEN_MULTIPLIER} x ${ctx.maxGuests} max guests`,
    },
  ];

  const fixLinensGroups: OrderGroup[] = [
    {
      title: `Linens - ${LINEN_VENDOR}`,
      blurb: `Order ${LINEN_MULTIPLIER} sheet sets per bed from ${LINEN_VENDOR}, sized to the beds on file, so a turnover never waits on laundry.`,
      items: linenItems,
    },
    {
      title: `Towels - ${LINEN_VENDOR}`,
      blurb:
        `${LINEN_MULTIPLIER} large bath towels per guest is the whole towel order: each ${LINEN_VENDOR} package carries more face and hand towels than bath towels, so those cover themselves.`,
      items: towelItems,
    },
  ];

  // Groups 3+: the rest of the outfitting punch list, reused from the
  // readiness catalog with this property's numbers, minus the rows the
  // Fix Linens math above supersedes.
  const readinessCtx: ReadinessContext = {
    maxGuests: ctx.maxGuests,
    bedrooms: ctx.bedrooms,
    bathrooms: ctx.bathrooms,
    bathroomsFromIntake: ctx.bathroomsFromRecord,
  };
  const reused: OrderGroup[] = READINESS_GROUPS.map((g) => ({
    title: g.title,
    items: g.items
      .filter((it) => !SUPERSEDED_READINESS_LABELS.has(it.label))
      .map((it) => ({
        label: it.label,
        count: quantityFor(it, readinessCtx),
        note: it.note,
      })),
  })).filter((g) => g.items.length > 0);

  return [...fixLinensGroups, ...reused];
}

// ─── Persisted state ───────────────────────────────────────────────────────

/**
 * property_order_checklist.state - same label-keyed shape as the
 * projection's ReadinessState. `have` is how many are already on site or
 * ordered; the gap to the computed need is the order list.
 */
export type OrderChecklistState = {
  have?: Record<string, number>;
  /** Free-text notes keyed by field (currently just order_notes). */
  notes?: Record<string, string>;
  updated_at?: string;
};
