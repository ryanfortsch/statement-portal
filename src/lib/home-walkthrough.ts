/**
 * The outfitting walkthrough's state: one per home, from the prospect visit
 * (counting what the home has) to the property (ordering the gap). Pure, so
 * the page, the review email and the tests share one rule.
 *
 * Persisted in public.home_walkthroughs (src/lib/home-walkthrough-db.ts).
 * Until 2026-10-18 the same shape lived twice: projections.readiness_state
 * and property_order_checklist.state. Item labels are the keys, so a label
 * rename in the catalogs is a key rename: the old entry silently drops.
 */

export type WalkthroughState = {
  /** How many the home has (or has on order), by item label. 0 is an explicit none. */
  have?: Record<string, number>;
  /** LEGACY: labels checked off before partial counts shipped; read as
   *  "has all of it" when the label has no entry in `have`. */
  checked?: string[];
  /** Free text by field key (the visit's walkthrough notes, order_notes). */
  notes?: Record<string, string>;
  updated_at?: string;
};

type Items = ReadonlyArray<{ items: ReadonlyArray<{ label: string; count: number }> }>;

/** Coerce whatever a jsonb column held into the typed shape. */
export function normalizeWalkthroughState(raw: unknown): WalkthroughState {
  const r = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const have: Record<string, number> = {};
  if (r.have && typeof r.have === 'object' && !Array.isArray(r.have)) {
    for (const [k, v] of Object.entries(r.have as Record<string, unknown>)) {
      const n = Number(v);
      if (Number.isFinite(n)) have[k] = Math.max(0, Math.round(n));
    }
  }
  const notes: Record<string, string> = {};
  if (r.notes && typeof r.notes === 'object' && !Array.isArray(r.notes)) {
    for (const [k, v] of Object.entries(r.notes as Record<string, unknown>)) if (typeof v === 'string') notes[k] = v;
  }
  const out: WalkthroughState = { have, notes };
  if (Array.isArray(r.checked)) out.checked = r.checked.filter((c): c is string => typeof c === 'string');
  if (typeof r.updated_at === 'string') out.updated_at = r.updated_at;
  return out;
}

/** The have counts a page shows: saved counts, with legacy checked labels as "all of it". */
export function haveCounts(state: WalkthroughState, groups: Items): Record<string, number> {
  const out: Record<string, number> = { ...(state.have ?? {}) };
  const checked = state.checked ?? [];
  if (checked.length) {
    for (const g of groups) {
      for (const it of g.items) {
        if (out[it.label] === undefined && checked.includes(it.label)) out[it.label] = it.count;
      }
    }
  }
  return out;
}

/**
 * Fold the two retired stores into one state, the way the carry-over
 * migration did (20261018210000_home_walkthroughs.sql): the property's
 * counts and notes win per key. Used only when a home has no row yet.
 */
export function mergeLegacyStates(readiness: unknown, order: unknown): WalkthroughState {
  const a = normalizeWalkthroughState(readiness);
  const b = normalizeWalkthroughState(order);
  const out: WalkthroughState = {
    have: { ...(a.have ?? {}), ...(b.have ?? {}) },
    notes: { ...(a.notes ?? {}), ...(b.notes ?? {}) },
  };
  if (a.checked?.length) out.checked = a.checked;
  const updated = b.updated_at ?? a.updated_at;
  if (updated) out.updated_at = updated;
  return out;
}

/** One count written; the legacy checked entry for that label goes so the two can't disagree. */
export function withHave(state: WalkthroughState, label: string, count: number): WalkthroughState {
  const safe = Math.max(0, Math.round(Number(count) || 0));
  const next: WalkthroughState = { ...state, have: { ...(state.have ?? {}), [label]: safe } };
  if (state.checked) next.checked = state.checked.filter((c) => c !== label);
  return next;
}

/** One note written; an empty value clears it. */
export function withNote(state: WalkthroughState, key: string, value: string): WalkthroughState {
  const notes = { ...(state.notes ?? {}) };
  if (value.trim() === '') delete notes[key];
  else notes[key] = value;
  return { ...state, notes };
}
