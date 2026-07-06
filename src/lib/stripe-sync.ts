/**
 * Per-property Stripe sync logic, shared by:
 *   - /api/sync-stripe -- explicit "Sync Stripe" button on the dashboard;
 *     loops over every property in STRIPE_KEYS_JSON for a given month
 *   - /api/ingest -- runs automatically at the end of a single-property
 *     upload so the formula-estimated stripe fees get replaced with the
 *     real numbers from balance_transaction.fee before the response
 *     comes back to the operator
 *
 * Until 2026-05-03 the sync was only available via the explicit button,
 * which left a small drift on every freshly-ingested statement until
 * someone hit Sync. Auto-running it on ingest closes that gap so the
 * statement the operator clicks on right after upload already has actual
 * Stripe numbers, not estimates.
 *
 * Behavior summary:
 *   1. Pulls the property's successful Stripe charges in a 6-months-back
 *      / 2-months-forward window around the statement month (STR booking
 *      lead times often span months).
 *   2. Aggregates charges by confirmation code (reservations frequently
 *      have an initial + final-balance charge sharing one descriptor).
 *   3. For each reservation in the statement, replaces stripe_fee with
 *      the real summed fee, recomputes adjusted_revenue, and propagates
 *      the delta into property_statements totals.
 *   4. Emits stripe_* data gaps for refunds, gross mismatches vs Guesty's
 *      TOTAL_PAID, and missing charges. Wipes prior stripe gaps on every
 *      run so re-runs don't accumulate duplicates.
 *
 * Airbnb + Booking.com reservations are skipped -- those don't flow
 * through Rising Tide's Stripe accounts.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

export type StripeSyncResult = {
  property_id: string;
  charges_found: number;
  matched: number;
  unmatched_charges: string[];
  fee_updates: { code: string; guest: string; prev: number; next: number; delta: number }[];
  refunds_detected: { code: string; guest: string; amount: number }[];
  gross_mismatches: { code: string; guest: string; stripe: number; guesty: number }[];
  reservations_missing_charge: { code: string; guest: string; expected: number }[];
  error?: string;
};

type StripeCharge = {
  id: string;
  amount: number;              // cents
  amount_refunded: number;     // cents
  currency: string;
  created: number;             // unix seconds
  description: string | null;
  status: string;              // 'succeeded' | 'pending' | 'failed'
  refunded: boolean;
  paid: boolean;
  balance_transaction:
    | string
    | { id: string; fee: number; net: number; amount: number; currency: string }
    | null;
};

type ReservationRow = {
  id: string;
  confirmation_code: string;
  platform: string | null;
  guest_name: string | null;
  property_statement_id: string;
  guesty_rental_income: number;
  stripe_fee: number | null;
  adjusted_revenue: number | null;
  bank_match_status: string | null;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function getStripeKeysMap(): Record<string, string> {
  const raw = process.env.STRIPE_KEYS_JSON || '';
  if (!raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as Record<string, string>;
  } catch {
    return {};
  }
}

async function stripeGet<T>(key: string, path: string, params: Record<string, string | string[]>): Promise<T> {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (Array.isArray(v)) v.forEach(item => q.append(k, item));
    else q.append(k, v);
  }
  const res = await fetch(`https://api.stripe.com/v1/${path}?${q.toString()}`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Stripe ${path} failed (${res.status}): ${body?.error?.message || JSON.stringify(body)}`);
  }
  return body as T;
}

async function listChargesAroundMonth(key: string, month: string): Promise<StripeCharge[]> {
  const [y, m] = month.split('-').map(Number);
  // 6 months before the start of the statement month, through 2 months
  // after the end of it. Covers normal STR booking lead times where
  // guests pay months ahead of check-in.
  const start = Math.floor(Date.UTC(y, m - 1 - 6, 1) / 1000);
  const end = Math.floor(Date.UTC(y, m + 2, 1) / 1000);
  const charges: StripeCharge[] = [];
  let startingAfter: string | undefined;
  // Safety cap at 50 pages (5000 charges).
  for (let i = 0; i < 50; i++) {
    const params: Record<string, string | string[]> = {
      'created[gte]': String(start),
      'created[lt]': String(end),
      limit: '100',
      'expand[]': ['data.balance_transaction'],
    };
    if (startingAfter) params.starting_after = startingAfter;
    const page = await stripeGet<{ data: StripeCharge[]; has_more: boolean }>(key, 'charges', params);
    charges.push(...page.data);
    if (!page.has_more || page.data.length === 0) break;
    startingAfter = page.data[page.data.length - 1].id;
  }
  return charges;
}

/**
 * Sync one property's Stripe charges against its reservations for a
 * single statement month. Mutates the DB (reservations.stripe_fee,
 * property_statements totals, data_gaps) in place. Returns a per-property
 * result object the caller can show the operator.
 *
 * Caller responsibilities:
 *   - Pass in the already-fetched property_statements row (only the
 *     fields listed below are needed). We don't refetch because both
 *     callers already have it in hand.
 *   - Don't pre-filter for "should we run this" -- the function returns
 *     a result with charges_found=0 if nothing matches, which is a
 *     legitimate state on quiet months.
 */
export async function syncPropertyStripe(opts: {
  supabase: SupabaseClient;
  propertyId: string;
  restrictedKey: string;
  month: string;
  stmt: {
    id: string;
    management_fee_pct: number;
    cleaning_total: number;
    repairs_total: number;
    reserve_holdback?: number;
  };
}): Promise<StripeSyncResult> {
  const { supabase, propertyId, restrictedKey, month, stmt } = opts;

  const result: StripeSyncResult = {
    property_id: propertyId,
    charges_found: 0,
    matched: 0,
    unmatched_charges: [],
    fee_updates: [],
    refunds_detected: [],
    gross_mismatches: [],
    reservations_missing_charge: [],
  };

  try {
    const charges = await listChargesAroundMonth(restrictedKey, month);
    const succeeded = charges.filter(c => c.status === 'succeeded' || c.paid);
    result.charges_found = succeeded.length;

    // This statement-month's reservations -- the rows we may update fees
    // on and emit gaps for.
    const { data: rRes } = await supabase
      .from('reservations')
      .select('id, confirmation_code, platform, guest_name, property_statement_id, guesty_rental_income, stripe_fee, adjusted_revenue, bank_match_status')
      .eq('property_statement_id', stmt.id);
    const reservations: ReservationRow[] = (rRes || []) as ReservationRow[];
    const byCode = new Map<string, ReservationRow>();
    for (const r of reservations) if (r.confirmation_code) byCode.set(r.confirmation_code, r);

    // Installment-aware guard. Cross-month installment bookings (a long
    // stay split across months via reservation_installments) already have
    // their per-month adjusted_revenue set to the NET installment amount
    // and a PRORATED stripe_fee written by ingest's installment fork.
    // Stripe-sync must NOT overwrite those: the full-stay Stripe charge
    // (e.g. one $65k Payment Link) would otherwise get matched to a single
    // month's row and dump the entire fee on that one month, corrupting
    // adjusted_revenue and the statement total. For any code with
    // installment rows we still match/report the charge, but leave the
    // fee + adjusted_revenue exactly as ingest wrote them.
    const installmentCodes = new Set<string>();
    {
      const codes = reservations.map(r => r.confirmation_code).filter(Boolean);
      if (codes.length > 0) {
        const { data: instRows } = await supabase
          .from('reservation_installments')
          .select('confirmation_code')
          .in('confirmation_code', codes);
        for (const row of instRows || []) {
          if (row.confirmation_code) installmentCodes.add(row.confirmation_code as string);
        }
      }
    }

    // Cross-month known codes for this property -- used to distinguish
    // "real orphan charge" (no reservation anywhere) from "charge for a
    // stay in a different statement month" (normal: guests pay months
    // before check-in).
    const { data: allStmtsThisProp } = await supabase
      .from('property_statements')
      .select('id')
      .eq('property_id', propertyId);
    const thisPropStmtIds = new Set((allStmtsThisProp || []).map(s => s.id));

    const { data: crossMonthRes } = await supabase
      .from('reservations')
      .select('confirmation_code, property_statement_id')
      .not('confirmation_code', 'is', null);
    const knownCodesThisProp = new Set(
      (crossMonthRes || [])
        .filter(r => r.property_statement_id && thisPropStmtIds.has(r.property_statement_id))
        .map(r => r.confirmation_code as string),
    );
    const { data: guestyAllForProp } = await supabase
      .from('guesty_reservations')
      .select('confirmation_code')
      .eq('property_id', propertyId);
    for (const g of guestyAllForProp || []) {
      if (g.confirmation_code) knownCodesThisProp.add(g.confirmation_code);
    }

    // TOTAL_PAID + TOTAL_TAXES on this month's reservations. TOTAL_PAID is
    // used for the gross-mismatch check; taxes feed the amount-based
    // fallback matcher below (Stripe charges the guest's full gross, taxes
    // included, while guesty_rental_income is the pre-tax channel-net).
    const codesForThisProp = reservations.map(r => r.confirmation_code).filter(Boolean);
    const { data: gRes } = codesForThisProp.length
      ? await supabase.from('guesty_reservations').select('confirmation_code, total_paid, total_taxes').in('confirmation_code', codesForThisProp)
      : { data: [] as { confirmation_code: string; total_paid: number | null; total_taxes: number | null }[] };
    const grossByCode = new Map<string, number>();
    const taxesByCode = new Map<string, number>();
    (gRes || []).forEach(g => {
      if (!g.confirmation_code) return;
      if (g.total_paid != null) grossByCode.set(g.confirmation_code, g.total_paid);
      if (g.total_taxes != null) taxesByCode.set(g.confirmation_code, g.total_taxes);
    });

    // Aggregate Stripe charges. For Guesty-routed bookings the description
    // starts with the confirmation code (HM..., HA-, GY-, BC-) and multiple
    // captures of the same reservation aggregate cleanly under that code.
    // SCA / staycapeann.com Payment Link descriptions all start with the
    // same word ("Stay at <name> - YYYY-MM-DD...") -- aggregating those by
    // first-token would collapse every SCA charge in the month into one big
    // "Stay" pile and defeat the amount-based fallback below. Keep those
    // atomic by using the charge id as the grouping key.
    const GUESTY_CODE = /^(HM|HA-|GY-|BC-)[A-Za-z0-9-]+/;
    type Agg = { grossCents: number; refundedCents: number; feeCents: number; feeKnown: boolean; chargeCount: number; displayLabel: string };
    const byCodeAgg = new Map<string, Agg>();
    const orphanCodes: { code: string; amount: number; displayLabel: string }[] = [];

    for (const charge of succeeded) {
      const desc = (charge.description || '').trim();
      const firstToken = desc.split(/\s+/)[0];
      if (!firstToken) {
        result.unmatched_charges.push(`no description (${charge.id})`);
        continue;
      }
      // Guesty-coded charges aggregate by code; custom Payment Link charges
      // stay atomic so the orphan list shows one entry per real charge.
      const looksLikeCode = GUESTY_CODE.test(firstToken);
      const code = looksLikeCode ? firstToken : charge.id;
      const displayLabel = looksLikeCode ? firstToken : (desc.length > 48 ? desc.slice(0, 45) + '…' : desc);

      const agg = byCodeAgg.get(code) || { grossCents: 0, refundedCents: 0, feeCents: 0, feeKnown: false, chargeCount: 0, displayLabel };
      agg.grossCents += charge.amount;
      agg.refundedCents += charge.amount_refunded;
      const fee = (charge.balance_transaction && typeof charge.balance_transaction !== 'string')
        ? charge.balance_transaction.fee
        : null;
      if (fee != null) { agg.feeCents += fee; agg.feeKnown = true; }
      agg.chargeCount += 1;
      byCodeAgg.set(code, agg);
    }

    const matchedCodes = new Set<string>();

    for (const [code, agg] of byCodeAgg.entries()) {
      const res = byCode.get(code);
      if (!res) {
        if (!knownCodesThisProp.has(code)) {
          orphanCodes.push({ code, amount: round2(agg.grossCents / 100), displayLabel: agg.displayLabel });
        }
        continue;
      }
      matchedCodes.add(code);
      result.matched++;

      const p = (res.platform || '').toUpperCase();
      const isRTStripeChannel = p.includes('HOMEAWAY') || p === 'VRBO' || p === 'MANUAL';
      if (!isRTStripeChannel) continue;

      const stripeGross = round2(agg.grossCents / 100);
      const refunded = round2(agg.refundedCents / 100);
      const actualFee = agg.feeKnown ? round2(agg.feeCents / 100) : null;

      const guestyGross = grossByCode.get(code);
      if (guestyGross != null && Math.abs(guestyGross - stripeGross) > 1) {
        result.gross_mismatches.push({ code, guest: res.guest_name || 'Guest', stripe: stripeGross, guesty: guestyGross });
      }

      if (refunded > 0) {
        result.refunds_detected.push({ code, guest: res.guest_name || 'Guest', amount: refunded });
      }

      // Replace estimate with actual whenever Stripe returned the fee --
      // every penny matters because deltas snowball across N reservations.
      // Skip rows marked paid_off_stripe (paid by check/wire; their
      // stripe_fee is intentionally fixed).
      if (actualFee != null && res.stripe_fee != null && res.bank_match_status !== 'paid_off_stripe' && !installmentCodes.has(code)) {
        const prev = round2(res.stripe_fee);
        if (prev !== actualFee) {
          const deltaFee = round2(actualFee - prev);
          const newAdjusted = round2((res.adjusted_revenue || 0) - deltaFee);
          await supabase
            .from('reservations')
            .update({ stripe_fee: actualFee, adjusted_revenue: newAdjusted })
            .eq('id', res.id);
          result.fee_updates.push({ code, guest: res.guest_name || 'Guest', prev, next: actualFee, delta: deltaFee });
        }
      }
    }

    // Amount-based fallback. Stripe descriptions on custom Payment Links
    // (Direct/Manual stays paid through RT's own checkout, not Guesty's)
    // don't lead with a Guesty confirmation code, so the description-token
    // matcher above misses them. For each still-unmatched RT-Stripe
    // reservation, compute the expected Stripe gross and look for an
    // orphan charge that matches within $1. Only links if exactly one
    // orphan matches -- ambiguity falls through to the missing-charge gap.
    for (const r of reservations) {
      if (matchedCodes.has(r.confirmation_code)) continue;
      const p = (r.platform || '').toUpperCase();
      const isRTStripeChannel = p.includes('HOMEAWAY') || p === 'VRBO' || p === 'MANUAL';
      if (!isRTStripeChannel) continue;
      const isHomeownerStay = p === 'MANUAL' && (!r.guesty_rental_income || r.guesty_rental_income === 0);
      if (isHomeownerStay) continue;

      // Stripe charges the guest the full gross: rental + taxes. If
      // guesty_reservations has TOTAL_PAID populated use that; else
      // reconstruct from guesty_rental_income + total_taxes.
      const knownGross = grossByCode.get(r.confirmation_code) || 0;
      const reconstructed = round2((r.guesty_rental_income || 0) + (taxesByCode.get(r.confirmation_code) || 0));
      const expectedGross = knownGross > 0 ? knownGross : reconstructed;
      if (expectedGross <= 0) continue;

      const candidates = orphanCodes.filter(o => Math.abs(o.amount - expectedGross) <= 1);
      if (candidates.length !== 1) continue;
      const orphan = candidates[0];
      const agg = byCodeAgg.get(orphan.code);
      if (!agg) continue;

      // Treat as matched. Remove from orphan list / aggregates so the
      // existing reporting blocks see it as paired.
      matchedCodes.add(r.confirmation_code);
      result.matched += 1;
      orphanCodes.splice(orphanCodes.indexOf(orphan), 1);
      byCodeAgg.delete(orphan.code);

      // Replace the approximated fee with Stripe's actual whenever the
      // balance_transaction was returned -- same write the description-
      // match path does. Skip rows marked paid_off_stripe.
      const actualFee = agg.feeKnown ? round2(agg.feeCents / 100) : null;
      if (actualFee != null && r.stripe_fee != null && r.bank_match_status !== 'paid_off_stripe' && !installmentCodes.has(r.confirmation_code)) {
        const prev = round2(r.stripe_fee);
        if (prev !== actualFee) {
          const deltaFee = round2(actualFee - prev);
          const newAdjusted = round2((r.adjusted_revenue || 0) - deltaFee);
          await supabase
            .from('reservations')
            .update({ stripe_fee: actualFee, adjusted_revenue: newAdjusted })
            .eq('id', r.id);
          result.fee_updates.push({ code: r.confirmation_code, guest: r.guest_name || 'Guest', prev, next: actualFee, delta: deltaFee });
        }
      }

      const refunded = round2(agg.refundedCents / 100);
      if (refunded > 0) {
        result.refunds_detected.push({ code: r.confirmation_code, guest: r.guest_name || 'Guest', amount: refunded });
      }
    }

    result.unmatched_charges = orphanCodes.map(o => `${o.displayLabel} ($${o.amount.toFixed(2)})`);

    // Reservations we expected a Stripe charge for but didn't find --
    // VRBO / Manual non-homeowner stays only.
    for (const r of reservations) {
      if (matchedCodes.has(r.confirmation_code)) continue;
      const p = (r.platform || '').toUpperCase();
      const isRTStripeChannel = p.includes('HOMEAWAY') || p === 'VRBO' || p === 'MANUAL';
      if (!isRTStripeChannel) continue;
      const isHomeownerStay = p === 'MANUAL' && (!r.guesty_rental_income || r.guesty_rental_income === 0);
      if (isHomeownerStay) continue;
      result.reservations_missing_charge.push({
        code: r.confirmation_code,
        guest: r.guest_name || 'Guest',
        expected: round2(r.guesty_rental_income || 0),
      });
    }

    // Recompute statement totals if any fees changed.
    if (result.fee_updates.length > 0) {
      const { data: freshRes } = await supabase
        .from('reservations')
        .select('adjusted_revenue')
        .eq('property_statement_id', stmt.id);
      const newRentalRevenue = round2((freshRes || []).reduce((s, r) => s + (r.adjusted_revenue || 0), 0));
      const newMgmtFee = round2(newRentalRevenue * (stmt.management_fee_pct / 100));
      const reserveHoldback = Number(stmt.reserve_holdback ?? 0);
      const newOwnerPayout = round2(newRentalRevenue - newMgmtFee - (stmt.cleaning_total || 0) - (stmt.repairs_total || 0) - reserveHoldback);
      await supabase
        .from('property_statements')
        .update({ rental_revenue: newRentalRevenue, management_fee: newMgmtFee, owner_payout: newOwnerPayout })
        .eq('id', stmt.id);
    }

    // Persist discrepancy gaps. Wipe any prior stripe_* gaps so re-runs
    // don't pile up duplicates.
    await supabase
      .from('data_gaps')
      .delete()
      .eq('property_statement_id', stmt.id)
      .in('gap_type', ['stripe_refund_detected', 'stripe_gross_mismatch', 'stripe_missing_charge', 'stripe_orphan_charge']);

    // Pull any reservation_notes for the codes we're about to flag, so
    // gap descriptions inherit the durable context that arrived
    // out-of-band (e.g., "Allie refunded half because Guesty
    // auto-charged"). Notes are keyed on confirmation_code so they
    // survive ingest re-runs even though reservation UUIDs don't.
    // Tolerates the table not existing yet (PGRST205) -- gaps just
    // ship without notes when the migration hasn't run.
    const flaggedCodes = new Set<string>([
      ...result.refunds_detected.map(r => r.code),
      ...result.gross_mismatches.map(m => m.code),
      ...result.reservations_missing_charge.map(mc => mc.code),
    ]);
    const notesByCode = new Map<string, { body: string; created_at: string }>();
    if (flaggedCodes.size > 0) {
      const { data: notes, error: notesErr } = await supabase
        .from('reservation_notes')
        .select('confirmation_code, body, created_at')
        .in('confirmation_code', Array.from(flaggedCodes))
        .order('created_at', { ascending: false });
      if (notesErr && notesErr.code !== 'PGRST205' && !/does not exist|relation|Could not find the table/i.test(notesErr.message || '')) {
        console.warn('reservation_notes lookup failed:', notesErr.message);
      } else if (notes) {
        // Latest note per code wins (we ordered desc, so first occurrence is newest).
        for (const n of notes as { confirmation_code: string; body: string; created_at: string }[]) {
          if (!notesByCode.has(n.confirmation_code)) {
            notesByCode.set(n.confirmation_code, { body: n.body, created_at: n.created_at });
          }
        }
      }
    }
    const noteSuffix = (code: string): string => {
      const note = notesByCode.get(code);
      return note ? ` Note: ${note.body}` : '';
    };

    const newGaps: { gap_type: string; description: string; severity: string; expected_data: string }[] = [];
    for (const r of result.refunds_detected) {
      newGaps.push({
        gap_type: 'stripe_refund_detected',
        description: `Stripe shows $${r.amount.toFixed(2)} refunded on ${r.guest} (${r.code}). Owner payout may need adjustment.${noteSuffix(r.code)}`,
        severity: 'warning',
        expected_data: `Confirm whether the refund is in-period and update the statement manually`,
      });
    }
    for (const m of result.gross_mismatches) {
      newGaps.push({
        gap_type: 'stripe_gross_mismatch',
        description: `Stripe gross $${m.stripe.toFixed(2)} disagrees with Guesty TOTAL_PAID $${m.guesty.toFixed(2)} for ${m.guest} (${m.code}).${noteSuffix(m.code)}`,
        severity: 'info',
        expected_data: `Re-check the Guesty reservation amount for this stay`,
      });
    }
    for (const mc of result.reservations_missing_charge) {
      newGaps.push({
        gap_type: 'stripe_missing_charge',
        description: `No Stripe charge found for ${mc.guest} (${mc.code}) expected $${mc.expected.toFixed(2)}.${noteSuffix(mc.code)}`,
        severity: 'info',
        expected_data: `Check Stripe dashboard for this confirmation code`,
      });
    }
    if (newGaps.length > 0) {
      await supabase
        .from('data_gaps')
        .insert(newGaps.map(g => ({ property_statement_id: stmt.id, ...g })));
    }

    // Auto-resolve missing_guest_gross gaps once the sync proves we have
    // real Stripe data for every Manual/VRBO stay on the statement. The
    // gap was raised at ingest when a reservation lacked TOTAL_PAID, so
    // stripe_fee fell back to a 3.9%-on-net approximation. Once
    // sync-stripe matches every Manual/VRBO reservation to its real Stripe
    // charge (i.e. reservations_missing_charge is empty), the
    // approximation has been replaced with balance_transaction.fee and
    // the warning is stale -- exactly the phantom flag pattern we hit on
    // 21 Horton's Karen Bandy (GY-VfmMf3z4): Guesty never populated
    // total_paid for that direct booking, so the suggested CSV re-upload
    // can't help, but the real Stripe fee is already on the reservation.
    if (result.reservations_missing_charge.length === 0) {
      await supabase
        .from('data_gaps')
        .update({ resolved: true })
        .eq('property_statement_id', stmt.id)
        .eq('gap_type', 'missing_guest_gross')
        .eq('resolved', false);
    }
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
  }

  return result;
}
