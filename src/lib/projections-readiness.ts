import type { ProjectionRow } from './projections-types';

/**
 * Property Readiness Checklist data + per-property quantity math.
 *
 * The source artifact is Rising Tide's printed walk-through checklist —
 * everything an owner needs to convert a "normal home" into a Rising
 * Tide-ready short-term rental. The PDF version lists items grouped by
 * room (Kitchen / Bedrooms / Bathrooms / Smart Home / Misc) with
 * recommended quantities expressed as multipliers ("3 x Guest",
 * "1 x Bedroom", etc.). This file:
 *
 *   1. encodes the punch list as data, with a multiplier + "per" key
 *      per item so quantities can be computed against a real property,
 *   2. derives a `ReadinessContext` from a ProjectionRow (bedrooms +
 *      bathrooms from onboarding intake, max guests inferred from
 *      bedrooms when not explicit), and
 *   3. exports a single `computeReadiness(projection)` that returns the
 *      groups + per-item quantities ready for the renderer.
 *
 * Same data drives the on-screen checklist at /projections/<id>/readiness
 * and the puppeteer-printed PDF.
 */

// ─── Multiplier semantics ──────────────────────────────────────────────────
// 'flat'      — fixed count regardless of property size (e.g. one toaster)
// 'guest'     — multiplied by max occupancy (e.g. 3 plates per guest)
// 'bedroom'   — multiplied by bedrooms
// 'bed'       — alias for bedroom (assume 1 bed / room)
// 'closet'    — alias for bedroom (assume 1 closet / room)
// 'pillow'    — pillows = bedrooms × pillows-per-bed (queen default 4)
// 'bedside'   — bedside tables = bedrooms × 2 (one per side of bed)
// 'bathroom'  — multiplied by bathrooms count
export type Per =
  | 'flat'
  | 'guest'
  | 'bedroom'
  | 'bed'
  | 'closet'
  | 'pillow'
  | 'bedside'
  | 'bathroom';

export type ReadinessItem = {
  /** Display name; pulled directly from Rising Tide's printed PDF. */
  label: string;
  /** How many per unit (3 plates per guest = qty 3 per 'guest'). */
  qty: number;
  /** What "unit" the qty multiplies by. */
  per: Per;
  /** Optional one-line note shown small under the row (qualifies the math
   *  when it's not obvious, e.g. "Queen default — adjust per bed type"). */
  note?: string;
};

export type ReadinessGroup = {
  title: string;
  items: ReadinessItem[];
};

/**
 * Master punch list. Order, capitalization, and quantity multipliers
 * mirror the source PDF so a printed Helm checklist is interchangeable
 * with the version Allie has been walking owners through by hand.
 */
export const READINESS_GROUPS: ReadinessGroup[] = [
  {
    title: 'Kitchen',
    items: [
      { label: 'Silverware', qty: 1, per: 'flat', note: '1 set sized to max guests' },
      { label: 'Paper towel holder', qty: 1, per: 'flat' },
      { label: 'Measuring cup', qty: 1, per: 'flat' },
      { label: 'Pot holders', qty: 2, per: 'flat' },
      { label: 'Knife block', qty: 1, per: 'flat' },
      { label: 'Pots & pans', qty: 1, per: 'flat', note: '1 starter set' },
      { label: 'Baking pans', qty: 2, per: 'flat' },
      { label: 'Cutting board', qty: 1, per: 'flat' },
      { label: 'BBQ utensils', qty: 3, per: 'flat' },
      { label: 'Small plates', qty: 3, per: 'guest' },
      { label: 'Dinner plates', qty: 3, per: 'guest' },
      { label: 'Bowls', qty: 3, per: 'guest' },
      { label: 'Water glasses', qty: 3, per: 'guest' },
      { label: 'Wine glasses', qty: 3, per: 'guest' },
      { label: 'Coffee mugs', qty: 3, per: 'guest' },
      { label: 'Wine opener', qty: 1, per: 'flat' },
      { label: 'Can opener', qty: 1, per: 'flat' },
      { label: 'Cheese grater', qty: 1, per: 'flat' },
      { label: 'Coffee maker', qty: 1, per: 'flat' },
      { label: 'Strainer', qty: 1, per: 'flat' },
      { label: 'Wooden spoon', qty: 1, per: 'flat' },
      { label: 'Utensil holder', qty: 1, per: 'flat' },
      { label: 'Soap dispenser', qty: 1, per: 'flat' },
      { label: 'Trash can', qty: 1, per: 'flat' },
      { label: 'Recycling bin', qty: 1, per: 'flat' },
      { label: 'Salad bowl', qty: 1, per: 'flat' },
      { label: 'Glass baking dish', qty: 1, per: 'flat' },
      { label: 'Clear plastic bins', qty: 2, per: 'flat' },
      { label: 'Toaster', qty: 1, per: 'flat' },
      { label: 'Vegetable peeler', qty: 1, per: 'flat' },
      { label: 'Measuring spoons (set)', qty: 1, per: 'flat' },
      { label: 'Fire extinguisher', qty: 1, per: 'flat' },
    ],
  },
  {
    title: 'Bedrooms',
    items: [
      { label: 'Mattress encasement', qty: 1, per: 'bed' },
      { label: 'Bed pillows', qty: 4, per: 'pillow', note: 'Queen default; 6 for king, 2 for full/twin' },
      { label: 'Bed pillow encasements', qty: 4, per: 'pillow', note: 'One per pillow' },
      { label: 'Sound machine', qty: 1, per: 'bedroom' },
      { label: 'Bedside table', qty: 1, per: 'bedside', note: '2 per king/queen, 1 per full/twin' },
      { label: 'USB hub', qty: 1, per: 'bedside' },
      { label: 'Hangers', qty: 6, per: 'closet' },
      { label: 'Clothes hanging (rod or hooks)', qty: 1, per: 'bedroom' },
      { label: 'Luggage stand', qty: 1, per: 'bedroom' },
    ],
  },
  {
    title: 'Bathrooms',
    items: [
      { label: 'Hand towels', qty: 2, per: 'bathroom' },
      { label: 'Bath towels', qty: 2, per: 'guest', note: 'Two per guest, rotating set' },
      { label: 'Bath mats', qty: 1, per: 'bathroom' },
      { label: 'Hand soap dispenser', qty: 1, per: 'bathroom' },
      { label: 'Plunger / toilet brush set', qty: 1, per: 'bathroom' },
      { label: 'Hair dryer', qty: 1, per: 'flat' },
    ],
  },
  {
    title: 'Smart home',
    items: [
      { label: 'Smart lock', qty: 1, per: 'flat', note: 'Per exterior door; add one for side / back entries' },
      { label: 'WiFi thermostat', qty: 1, per: 'flat' },
      { label: 'Security camera', qty: 1, per: 'flat', note: 'Exterior only — never interior' },
      { label: 'Router / modem', qty: 1, per: 'flat' },
      { label: 'Garage keypad', qty: 1, per: 'flat', note: 'If applicable' },
    ],
  },
  {
    title: 'Children / Laundry / Misc',
    items: [
      { label: 'Pack & play', qty: 1, per: 'flat' },
      { label: 'High chair', qty: 1, per: 'flat' },
      { label: 'Iron', qty: 1, per: 'flat' },
      { label: 'Ironing board', qty: 1, per: 'flat' },
      { label: 'Broom & dustpan', qty: 1, per: 'flat' },
      { label: 'Key lockbox', qty: 1, per: 'flat', note: 'Backup access for the cleaner' },
    ],
  },
];

// ─── Context derivation ────────────────────────────────────────────────────

export type ReadinessContext = {
  /** Max overnight occupancy. Default heuristic: 2 × bedrooms when not
   *  explicitly entered. Used for "3 x Guest" quantities. */
  maxGuests: number;
  /** Number of bedrooms. */
  bedrooms: number;
  /** Number of bathrooms. Pulled from onboarding intake when available,
   *  else estimated as max(1, round(bedrooms × 0.75)) so 2-bed → 2 bath
   *  defaults instead of 0. */
  bathrooms: number;
  /** True when bathrooms came from the owner's submitted onboarding form
   *  rather than the heuristic — surfaced as a hint on the page. */
  bathroomsFromIntake: boolean;
};

export function deriveReadinessContext(projection: ProjectionRow): ReadinessContext {
  const bedrooms = Math.max(1, Math.round(projection.bedrooms || 1));

  // Bathrooms: onboarding_data.bathrooms is a free-text string like "2"
  // or "2.5". Parse forgivingly.
  let bathrooms = Math.max(1, Math.round(bedrooms * 0.75));
  let bathroomsFromIntake = false;
  const intakeBaths = projection.onboarding_data?.bathrooms;
  if (intakeBaths) {
    const parsed = parseFloat(String(intakeBaths).replace(/[^0-9.]/g, ''));
    if (Number.isFinite(parsed) && parsed > 0) {
      // Round half-baths up — a "2.5 bath" property has 3 toilet brushes,
      // 3 plungers, etc., not 2.
      bathrooms = Math.ceil(parsed);
      bathroomsFromIntake = true;
    }
  }

  // Max guests: default to bedrooms × 2 (industry rule of thumb).
  // Later we may add an explicit max_guests column; for now infer.
  const maxGuests = bedrooms * 2;

  return { maxGuests, bedrooms, bathrooms, bathroomsFromIntake };
}

// ─── Quantity math ─────────────────────────────────────────────────────────

export function quantityFor(item: ReadinessItem, ctx: ReadinessContext): number {
  switch (item.per) {
    case 'flat':
      return item.qty;
    case 'guest':
      return item.qty * ctx.maxGuests;
    case 'bedroom':
    case 'bed':
    case 'closet':
      return item.qty * ctx.bedrooms;
    case 'pillow':
      // Pillow count = bedrooms × pillows-per-bed (item.qty)
      return item.qty * ctx.bedrooms;
    case 'bedside':
      // 2 bedside tables per bedroom (one per side of the bed)
      return item.qty * ctx.bedrooms * 2;
    case 'bathroom':
      return item.qty * ctx.bathrooms;
  }
}

/**
 * Build the renderable shape: groups → items → { label, count, note }.
 * One call site can produce the on-screen checklist and the PDF.
 */
export type RenderedItem = {
  label: string;
  count: number;
  note?: string;
};

export type RenderedGroup = {
  title: string;
  items: RenderedItem[];
};

export function computeReadiness(projection: ProjectionRow): {
  context: ReadinessContext;
  groups: RenderedGroup[];
} {
  const ctx = deriveReadinessContext(projection);
  const groups = READINESS_GROUPS.map((g) => ({
    title: g.title,
    items: g.items.map((it) => ({
      label: it.label,
      count: quantityFor(it, ctx),
      note: it.note,
    })),
  }));
  return { context: ctx, groups };
}
