/**
 * Missed-Direct detector: finds confirmed Direct/Manual stays that Guesty
 * knows about but the statement doesn't, and describes them as critical
 * data gaps. Flag-only by design -- it never inserts a reservation and
 * never touches payout math.
 *
 * WHY THIS EXISTS (Martha Mazzone, GY-ZUnEnMgw, 3 Windward, Aug 2026).
 * A $29k Direct booking fell through every net at once:
 *
 *   - Guesty's owner statement PDF omitted it (no owner revenue on the
 *     reservation -- the Business model gate), so /api/ingest never saw it.
 *   - /api/refresh-statement filters on total_paid > 0, and Direct/SCA
 *     stays show total_paid null/0 in Guesty by design because the money
 *     goes through the property's own Stripe, never through Guesty.
 *
 * No gap was raised; the statement read "0 gaps / High Confidence".
 *
 * The tell that separates a real missed booking from a homeowner stay is
 * the Guesty folio: a paying guest's folio carries a positive
 * ACCOMMODATION_FARE line, while a homeowner stay's folio is empty or
 * zero. Verified against live August 2026 data: the four Direct stays
 * legitimately absent from statements (Silverman x2, Snyder, Vorias) all
 * carry $0 accommodation fare, and the one large absent stay with real
 * fare (Kate Bacon, $65k) is installment-coded and recognized through its
 * slices, which is why installment-coded stays are excluded here exactly
 * as /api/refresh-statement excludes them.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { loadInstallmentsForCodes } from '@/lib/installments';
import { splitFolio } from '@/lib/remittance';

export const MISSING_DIRECT_GAP_TYPE = 'missing_direct_reservation';

export type MissingDirectStay = {
  confirmation_code: string;
  guest_name: string | null;
  check_in: string | null;
  check_out: string | null;
  channel: string;
  /** Sum of the folio's ACCOMMODATION_FARE lines. Always > 0 here. */
  accommodation_fare: number;
  /** The folio's full pre-tax guest total (fare, fees, discounts). */
  folio_pre_tax: number;
};

const round2 = (n: number) => Math.round(n * 100) / 100;

type FolioLine = { type?: string | null; normalType?: string | null; amount?: number | string | null };

/** Sum of the folio's accommodation-fare lines (type ACCOMMODATION_FARE,
 *  normalType AF). Discount lines (AFWD) deliberately do NOT reduce this:
 *  the question is "did a guest book real nights", not "what is owed". */
function accommodationFare(folio: unknown): number {
  if (!Array.isArray(folio)) return 0;
  let fare = 0;
  for (const raw of folio as FolioLine[]) {
    if (raw?.type === 'ACCOMMODATION_FARE' || raw?.normalType === 'AF') {
      const amt = Number(raw?.amount);
      if (Number.isFinite(amt)) fare += amt;
    }
  }
  return round2(fare);
}

/**
 * Find confirmed Direct/Manual guesty_reservations rows that check out in
 * the statement month, carry a positive accommodation fare on their folio,
 * are not recognized through installment slices, and have no reservations
 * row on the given statement. Throws on a database error so callers can
 * decide whether stale gaps may be cleared; wrap in try/catch (the check
 * must never fail an ingest or refresh).
 */
export async function detectMissingDirectStays(
  supabase: SupabaseClient,
  args: { propertyStatementId: string; propertyId: string; month: string },
): Promise<MissingDirectStay[]> {
  const { propertyStatementId, propertyId, month } = args;
  const monthStart = `${month}-01`;
  const [y, m] = month.split('-').map(Number);
  const monthEndExclusive = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);

  const { data: candidates, error: candErr } = await supabase
    .from('guesty_reservations')
    .select('confirmation_code, guest_name, check_in, check_out, channel, folio_items')
    .eq('property_id', propertyId)
    .eq('status', 'confirmed')
    .in('channel', ['Direct', 'Manual'])
    .gte('check_out', monthStart)
    .lt('check_out', monthEndExclusive);
  if (candErr) throw new Error(`guesty_reservations read failed: ${candErr.message}`);

  // A folio with real accommodation fare AND a positive pre-tax total is a
  // paying guest. The pre-tax guard keeps a fully-comped stay (fare offset
  // by a 100% discount line) from flagging: ingest skips $0 Manual stays
  // as homeowner stays on purpose.
  const withFare = (candidates || []).filter(c => {
    if (!c.confirmation_code) return false;
    const fare = accommodationFare(c.folio_items);
    if (fare <= 0) return false;
    return splitFolio(c.folio_items).preTax > 0;
  });
  if (withFare.length === 0) return [];

  const { data: existing, error: existErr } = await supabase
    .from('reservations')
    .select('confirmation_code')
    .eq('property_statement_id', propertyStatementId);
  if (existErr) throw new Error(`reservations read failed: ${existErr.message}`);
  const existingCodes = new Set(
    (existing || []).map(r => r.confirmation_code).filter((c): c is string => !!c),
  );

  const absent = withFare.filter(c => !existingCodes.has(c.confirmation_code as string));
  if (absent.length === 0) return [];

  // Installment-coded stays are recognized through their per-month slices,
  // never through a full-value row in the checkout month (a stay checking
  // out on the 1st has zero nights there). Same exclusion Refresh applies.
  const installmentCoded = await loadInstallmentsForCodes(
    supabase,
    absent.map(c => c.confirmation_code as string),
  );

  return absent
    .filter(c => !installmentCoded.has(c.confirmation_code as string))
    .map(c => {
      const folio = splitFolio(c.folio_items);
      return {
        confirmation_code: c.confirmation_code as string,
        guest_name: c.guest_name ?? null,
        check_in: c.check_in ?? null,
        check_out: c.check_out ?? null,
        channel: c.channel || 'Direct',
        accommodation_fare: accommodationFare(c.folio_items),
        folio_pre_tax: folio.preTax,
      };
    });
}

/** data_gaps row bodies (without property_statement_id) for detected stays. */
export function missingDirectGapRows(
  stays: MissingDirectStay[],
  month: string,
): { gap_type: string; description: string; severity: string; expected_data: string }[] {
  return stays.map(s => ({
    gap_type: MISSING_DIRECT_GAP_TYPE,
    description: `${s.guest_name || 'Unknown guest'} (${s.confirmation_code}) is a confirmed ${s.channel} stay ${s.check_in || '?'} to ${s.check_out || '?'} with $${s.folio_pre_tax.toFixed(2)} pre-tax on its Guesty folio, but it is MISSING from this statement. Guesty's owner statement PDF omits stays with no owner revenue (check the listing's Business model setting) and Refresh skips Direct stays Guesty shows as unpaid, so nothing adds it automatically. Verify the booking and get it onto the statement before close.`,
    severity: 'critical',
    expected_data: `Reservation row for ${s.confirmation_code}. Fix owner revenue in Guesty (Business model), re-run Sync Guesty or Upload Reservations CSV, then Re-Upload Data for ${month}.`,
  }));
}

/**
 * Replace this statement's missing-direct gaps with the current detection
 * result: stale flags clear once the stay lands on the statement, and
 * re-runs never pile up duplicates (same wipe-then-insert pattern as the
 * stripe_* gaps in lib/stripe-sync.ts). Call only after a successful
 * detect -- never wipe on a failed read.
 */
export async function persistMissingDirectGaps(
  supabase: SupabaseClient,
  propertyStatementId: string,
  stays: MissingDirectStay[],
  month: string,
): Promise<void> {
  await supabase
    .from('data_gaps')
    .delete()
    .eq('property_statement_id', propertyStatementId)
    .eq('gap_type', MISSING_DIRECT_GAP_TYPE);
  if (stays.length === 0) return;
  await supabase
    .from('data_gaps')
    .insert(missingDirectGapRows(stays, month).map(g => ({ property_statement_id: propertyStatementId, ...g })));
}
