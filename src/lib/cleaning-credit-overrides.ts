/**
 * Hand-applied cleaning credits that survive the rebuild. Pure, no imports.
 *
 * Both rebuild paths (/api/ingest and /api/fill-gap) wipe a statement's
 * cleaning_events and rebuild them from the bank CSV. A credit the
 * operator applied by hand (Mark Duplicate on a charge the vendor billed
 * twice) lived only on the wiped row, so the next re-upload silently
 * billed the owner the full amount again. That was the last open critical
 * from the August 2026 audit, and it is the "fixed errors visibly return"
 * pattern that ate that close.
 *
 * Matching a stored credit back to a rebuilt charge by heuristics was
 * tried and removed (#1472, four review rounds; see the note in
 * vendor-credit-netting.ts). This module does the durable version: the
 * operator's ruling is its own row, keyed on the charge's bank identity
 * (family, posting date, amount), loaded on every rebuild and re-applied
 * to the freshly built charges. Two rules make it sound:
 *
 *   1. A charge carries exactly ONE credit. The auto-netter runs first
 *      and assigns real refunds; an override then takes the first twin
 *      charge that has no credit. An override whose only twins already
 *      carry a netted refund is a collision and is NOT stacked (the
 *      refund already covers the charge); it is reported instead.
 *   2. An override that finds no charge is reported as a row, never
 *      inferred onto a near match. The operator removes a stale one.
 *
 * Twins (same family, date, amount) are interchangeable for the owner's
 * bill, so which twin carries the credit is immaterial; overrides apply
 * in creation order to twins in bank order, deterministically.
 */

export type CreditFamily = 'cleaning' | 'linen' | 'laundry';

export type CreditOverride = {
  id: string;
  family: CreditFamily;
  /** YYYY-MM-DD, the bank posting date of the charge. */
  charge_date: string;
  /** The charge as billed. */
  charge_amount: number;
  /** What the operator credited, at most charge_amount. */
  credit_amount: number;
  reason: string | null;
  /** ISO timestamp; overrides apply in creation order. */
  created_at: string;
};

/**
 * The charge shape both rebuild paths net against: the in-memory
 * VendorCharge pool rows, whose `date` is the CSV's MM/DD/YYYY. Applied
 * there (right after auto-netting, before any total is computed) so every
 * downstream figure and the inserted cleaning_events rows all see the
 * credit. Only credit_amount / credit_reason are written.
 */
export type CreditTargetCharge = {
  date: string;
  amount: number;
  credit_amount?: number;
  credit_reason?: string;
};

export type CreditTargetPools = {
  cleaning: CreditTargetCharge[];
  linen: CreditTargetCharge[];
  laundry: CreditTargetCharge[];
};

/** cleaning_events.source -> the family an override keys on. Null: not a bank charge (invoice-only, pending). */
export function familyOfSource(source: string | null | undefined): CreditFamily | null {
  switch (source) {
    case 'matched':
    case 'bank':
    case 'corroborated':
      return 'cleaning';
    case 'bank-linen':
      return 'linen';
    case 'bank-laundry':
      return 'laundry';
    default:
      return null;
  }
}

/**
 * The marker vendor-credit-netting.ts writes into credit_reason on an
 * auto-netted refund. A credit whose reason lacks it is the operator's.
 * Kept as a literal here so this module stays import-free; the test
 * suite pins the two modules to the same string.
 */
export const AUTO_NETTED_MARKER = '(auto-netted at ';
export const isAutoNettedReason = (reason: string | null | undefined): boolean =>
  (reason || '').includes(AUTO_NETTED_MARKER);

/** MM/DD/YYYY (the bank CSV) -> YYYY-MM-DD (the override row). '' when unparseable. */
export function bankDateToISO(mmddyyyy: string): string {
  const parts = (mmddyyyy || '').split('/');
  if (parts.length !== 3) return '';
  return `${parts[2]}-${parts[0].padStart(2, '0')}-${parts[1].padStart(2, '0')}`;
}

const EPS = 0.005;
const round2 = (n: number) => Math.round(n * 100) / 100;

export type ApplyCreditOverridesResult<T> = {
  applied: { override: CreditOverride; charge: T }[];
  /** No charge with this identity on this rebuild. */
  unapplied: CreditOverride[];
  /** Every twin already carries this rebuild's auto-netted refund; not stacked. */
  collisions: { override: CreditOverride; charge: T }[];
};

export function applyCreditOverrides<T extends CreditTargetCharge>(
  pools: { cleaning: T[]; linen: T[]; laundry: T[] },
  overrides: CreditOverride[],
): ApplyCreditOverridesResult<T> {
  const ordered = [...overrides].sort((a, b) =>
    a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  const taken = new Set<T>();
  const applied: { override: CreditOverride; charge: T }[] = [];
  const unapplied: CreditOverride[] = [];
  const collisions: { override: CreditOverride; charge: T }[] = [];
  for (const o of ordered) {
    const pool = pools[o.family] || [];
    const twins = pool.filter(c =>
      bankDateToISO(c.date) === o.charge_date && Math.abs(c.amount - o.charge_amount) <= EPS && !taken.has(c),
    );
    const free = twins.find(c => !(c.credit_amount && c.credit_amount > 0));
    if (free) {
      free.credit_amount = round2(Math.min(o.credit_amount, free.amount));
      free.credit_reason = o.reason || 'Operator credit';
      taken.add(free);
      applied.push({ override: o, charge: free });
      continue;
    }
    const netted = twins.find(c => c.credit_amount && c.credit_amount > 0);
    if (netted) collisions.push({ override: o, charge: netted });
    else unapplied.push(o);
  }
  return { applied, unapplied, collisions };
}

export const CREDIT_OVERRIDE_UNAPPLIED = 'cleaning_credit_override_unapplied';
export const CREDIT_OVERRIDE_COLLISION = 'cleaning_credit_override_collision';
export const CREDIT_OVERRIDES_UNAVAILABLE = 'cleaning_credit_overrides_unavailable';

export type CreditOverrideGap = { gap_type: string; description: string; severity: string; expected_data: string };

const money = (n: number) => `$${n.toFixed(2)}`;

/** The notices a rebuild files for overrides it could not honor. expected_data carries the override id for the Remove action. */
export function creditOverrideGaps<T extends CreditTargetCharge>(result: ApplyCreditOverridesResult<T>): CreditOverrideGap[] {
  const gaps: CreditOverrideGap[] = [];
  for (const o of result.unapplied) {
    gaps.push({
      gap_type: CREDIT_OVERRIDE_UNAPPLIED,
      severity: 'warning',
      description: `A hand-applied credit of ${money(o.credit_amount)} ("${o.reason || 'no reason given'}") on a ${money(o.charge_amount)} ${o.family} charge dated ${o.charge_date} found no such charge on this rebuild, so it was not applied. The bank CSV may have changed, or the credit belongs to another month. Remove the hand credit if it is stale; if the charge is real, apply the credit again on its row.`,
      expected_data: `override:${o.id}`,
    });
  }
  for (const { override: o } of result.collisions) {
    gaps.push({
      gap_type: CREDIT_OVERRIDE_COLLISION,
      severity: 'warning',
      description: `A hand-applied credit of ${money(o.credit_amount)} ("${o.reason || 'no reason given'}") on the ${money(o.charge_amount)} ${o.family} charge dated ${o.charge_date} was not applied: this rebuild netted a vendor refund against that charge, and a charge carries one credit. The refund already covers it, so the hand credit is either the same money or moot. Remove it.`,
      expected_data: `override:${o.id}`,
    });
  }
  return gaps;
}

/** The critical notice when the overrides could not be read at all: credits may be missing from the bill. */
export function creditOverridesUnavailableGap(detail: string): CreditOverrideGap {
  return {
    gap_type: CREDIT_OVERRIDES_UNAVAILABLE,
    severity: 'critical',
    description: `Hand-applied cleaning credits could not be re-applied on this rebuild (${detail}). Any credit applied by hand on this month is missing from cleaning_total until a rebuild runs cleanly.`,
    expected_data: 'Re-run ingest; if this repeats, the cleaning_credit_overrides read is failing',
  };
}

/** Parse `override:<id>` off a gap's expected_data. */
export function overrideIdFromExpectedData(expectedData: string | null | undefined): string | null {
  const m = /^override:([0-9a-f-]{36})$/i.exec((expectedData || '').trim());
  return m ? m[1] : null;
}
