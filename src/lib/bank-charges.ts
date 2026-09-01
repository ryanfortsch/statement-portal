/**
 * Single source of truth for classifying Chase bank-CSV rows by vendor.
 *
 * Before this module, the cleaning/repair detection logic was copy-pasted
 * across `/api/ingest` and `/api/fill-gap` and had already drifted (the
 * fill-gap copy was missing the Morris Heating maintenance vendor). Both
 * routes now import from here so a new vendor is added in exactly one place.
 *
 * Three categories, all matched by upper-cased substring on the Chase
 * "Description" column (the Type column -- ACH_DEBIT vs DEBIT_CARD -- is
 * intentionally NOT used; description matching is sufficient and survives
 * Chase changing how it labels a transaction's rail):
 *
 *   cleaning  -- Cape Ann Elite housekeeping (ACH). Pass-through to owner.
 *   linen     -- Nor'East Cleaners "Wash-Dry & Fold" (debit card). As of
 *                May 2026 linens unbundled from Cape Ann Elite. Folded into
 *                the owner statement's single "Cleaning" line, but tagged
 *                with its own vendor so cleaning vs linens stays decomposable.
 *   repair    -- recurring maintenance vendors (handyman, HVAC, etc.).
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export type CleaningVendor = { name: string; matches: string[] };

/** Housekeeping vendors. Their charges feed cleaning_total and the 1:1
 *  reservation-to-cleaning match (one turnover = one cleaning). */
export const CLEANING_VENDORS: CleaningVendor[] = [
  { name: 'Cape Ann Elite', matches: ['CAPE ANN ELITE'] },
];

/** Linen vendors. Their charges are ADDITIVE to cleaning_total but do NOT
 *  consume a reservation match slot (a linen pickup isn't a turnover), so
 *  they never inflate the "N turns" count on the statement. Bank descriptor
 *  reads "NOREAST CLEANERS NOREASTCLEANE"; the apostrophe form is included
 *  defensively in case a future export spells it "NOR'EAST". */
export const LINEN_VENDORS: CleaningVendor[] = [
  { name: "Nor'East Cleaners", matches: ['NOREAST', "NOR'EAST", 'NOR EAST'] },
];

/** Laundry vendors. Same semantics as linens: ADDITIVE to cleaning_total,
 *  never consume a reservation match slot. Bank descriptor reads
 *  "LAUNDRY PLUS DELIVERED 781-8732000 MA" on debit card, and
 *  "POS DEBIT LAUNDRY PLUS DELIVERED 7818732000 MA" on POS debit -- both
 *  contain "LAUNDRY PLUS" so the substring match catches both. */
export const LAUNDRY_VENDORS: CleaningVendor[] = [
  { name: 'Laundry Plus', matches: ['LAUNDRY PLUS'] },
];

/**
 * Recurring maintenance / repair vendors. Bank ingest scans descriptions
 * for any of these and tags them with the canonical name. New vendors
 * (plumber, electrician, landscaper, etc.) get added here.
 */
export const MAINTENANCE_VENDORS: CleaningVendor[] = [
  { name: 'Ian Drometer', matches: ['DROMETER'] },
  // Morris Heating & Air -- HVAC service contract for the rentals. Bank
  // descriptor truncates to "Morris Heating &" so we match the prefix.
  { name: 'Morris Heating & Air', matches: ['MORRIS HEATING'] },
  // SP Properties -- Anthony Silva, handyman. Card descriptor reads
  // "IN *SP PROPERTIES 978-9491399 NH".
  { name: 'SP Properties', matches: ['SP PROPERTIES'] },
];

/* -------------------------------------------------------------------------
 * Internal account transfers.
 *
 * Deliberately NOT a `BankRowClass` kind and NOT reachable from
 * classifyBankRow. Every existing caller treats a truthy class as
 * "billable vendor activity": /api/ingest's vendor-credit branch is
 * `if (cls && amount > 0 && isInMonth(...))` -- truthiness, not a per-kind
 * test -- so a fifth kind would capture the inbound `Online Transfer from
 * CHK ...5130` credits as vendor refunds, drop them into a netting pool
 * that has no bucket for them, and raise a critical vendor_refund_unapplied
 * gap for each. There are ten such rows live ($12,274.86). Hence a separate
 * pure helper that callers opt into.
 *
 * Money moving between Rising Tide's own Chase accounts is not a vendor
 * paying us and not us paying a vendor. Two destinations matter:
 *
 *   *9928  the centralized tax account. Occupancy tax collected on VRBO,
 *          Booking.com and direct stays is swept here out of each property
 *          account, and MassTaxConnect pays the state from it. That money
 *          was never owner revenue -- adjusted_revenue is computed net of
 *          TOTAL_TAXES -- so a sweep to *9928 must never be billed to an
 *          owner.
 *   *5130  Rising Tide operating. Ambiguous by design: the VRBO commission
 *          sweep, the monthly management-fee settlement AND genuine expense
 *          reimbursements all move here. Recognizing the account is
 *          therefore only the first half of the decision; see
 *          src/lib/internal-transfers.ts for the amount test that separates
 *          a sweep from a reimbursement.
 *
 * Observed descriptor shape, uniform across all 90 live transfer rows:
 *   "Online Transfer to CHK ...5130 transaction#: 30571000226 08/27"
 *   "Online Transfer from CHK ...5130 transaction#: 29717013440"
 * The trailing " MM/DD" is present on outbound rows and absent on inbound
 * ones, so it is not part of the match.
 */

/** The centralized MassTaxConnect funding account. */
export const TAX_REMITTANCE_ACCOUNT = '9928';
/** Rising Tide's main operating account. */
export const RT_OPERATING_ACCOUNT = '5130';

export type InternalTransfer = {
  /** Last four of the OTHER account -- the destination on an outbound row,
   *  the origin on an inbound one. */
  last4: string;
  /** True when money left this property's account. */
  outbound: boolean;
};

/**
 * Recognize a Chase internal account transfer from its description.
 * Anchored on the full "ONLINE TRANSFER TO|FROM CHK ...NNNN" phrase rather
 * than a bare "5130" substring, which would also fire on a transaction id
 * that happens to contain those digits.
 */
export function parseInternalTransfer(descUpper: string): InternalTransfer | null {
  const m = /ONLINE TRANSFER (TO|FROM) (?:CHK|SAV)\s*\.*\s*(\d{4})/.exec(descUpper);
  if (!m) return null;
  return { last4: m[2], outbound: m[1] === 'TO' };
}

function firstMatch(descUpper: string, vendors: CleaningVendor[]): string | null {
  for (const v of vendors) {
    if (v.matches.some(m => descUpper.includes(m))) return v.name;
  }
  return null;
}

export type BankRowClass =
  | { kind: 'cleaning'; vendor: string }
  | { kind: 'linen'; vendor: string }
  | { kind: 'laundry'; vendor: string }
  | { kind: 'repair'; vendor: string }
  | null;

/**
 * Classify a bank row by its (already upper-cased) description. Order
 * matters only in that a description won't realistically match more than
 * one category; cleaning is checked first, then linen, then laundry, then
 * repair.
 */
export function classifyBankRow(descUpper: string): BankRowClass {
  const cleaning = firstMatch(descUpper, CLEANING_VENDORS);
  if (cleaning) return { kind: 'cleaning', vendor: cleaning };
  const linen = firstMatch(descUpper, LINEN_VENDORS);
  if (linen) return { kind: 'linen', vendor: linen };
  const laundry = firstMatch(descUpper, LAUNDRY_VENDORS);
  if (laundry) return { kind: 'laundry', vendor: laundry };
  const repair = firstMatch(descUpper, MAINTENANCE_VENDORS);
  if (repair) return { kind: 'repair', vendor: repair };
  return null;
}

/** Back-compat helper for callers that only care about repairs. */
export function matchMaintenanceVendor(descUpper: string): string | null {
  return firstMatch(descUpper, MAINTENANCE_VENDORS);
}

/** The canonical linen vendor name, for callers that need to filter
 *  cleaning_events into cleaning-vs-linen (e.g. the "turns" count). */
export const LINEN_VENDOR_NAME = "Nor'East Cleaners";
export const LAUNDRY_VENDOR_NAME = 'Laundry Plus';
export const CLEANING_VENDOR_DEFAULT = 'Cape Ann Elite';

/** Vendors whose cleaning_events rows are additive-cost but NOT turnovers.
 *  UI surfaces that count "N turns" (e.g. the editorial statement's Cleaning
 *  line and cost-analysis's per-turn metric) must exclude these. */
export const NON_TURNOVER_VENDORS: string[] = [LINEN_VENDOR_NAME, LAUNDRY_VENDOR_NAME];

/** Cleaning_events.source discriminators. Kept as a union so the
 *  bank-<vendor> taxonomy stays discoverable across consumers. */
export type CleaningEventSource =
  | 'matched'        // Cape Ann Elite bank charge matched 1:1 to a checkout
  | 'bank'           // Cape Ann Elite bank charge with no matched checkout
  | 'bank-linen'     // Nor'East linen charge (additive, no turnover slot)
  | 'bank-laundry'   // Laundry Plus charge (additive, no turnover slot)
  | 'corroborated'   // matched bank charge with a Gmail invoice attached
  | 'invoice';       // invoice-only row (no matching bank charge yet)

/**
 * Insert cleaning_events rows, tolerating the `vendor` column not existing
 * yet (i.e. supabase-schema-cleaning-vendor.sql hasn't been applied). If
 * the insert fails because of the unmigrated column, retry once without
 * `vendor` so an upload never 500s on an un-migrated DB. cleaning_total
 * and owner payout are unaffected either way -- only the vendor tag (and
 * therefore the cleaning-vs-linen split in reporting) is deferred until
 * the migration runs.
 */
export async function insertCleaningEvents(
  supabase: SupabaseClient,
  rows: Record<string, unknown>[],
): Promise<void> {
  if (rows.length === 0) return;
  const { error } = await supabase.from('cleaning_events').insert(rows);
  if (!error) return;
  const missingVendorColumn =
    error.code === 'PGRST204' || /'?vendor'?\s+column|column .*vendor/i.test(error.message || '');
  if (!missingVendorColumn) throw error;
  const stripped = rows.map(r => {
    const copy = { ...r };
    delete copy.vendor;
    return copy;
  });
  const { error: retryErr } = await supabase.from('cleaning_events').insert(stripped);
  if (retryErr) throw retryErr;
}
