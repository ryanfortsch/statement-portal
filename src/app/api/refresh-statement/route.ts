import { NextRequest, NextResponse } from 'next/server';
import { loadInstallmentsForCodes } from '@/lib/installments';
import { REVENUE_SIGNAL_COLUMNS, REVENUE_SIGNAL_OR, CONFIRMED_STATUS, hasPriceableGross } from '@/lib/guesty-revenue-signal';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import { assertStatementWritable, StatementFrozenError, frozenResponseBody } from '@/lib/statement-finality';
import { writeStatementTotals, type FreezeReceipt, type WriteResult } from '@/lib/statement-totals-write';
import { detectMissingDirectStays, persistMissingDirectGaps, type MissingDirectStay } from '@/lib/missing-direct-stays';
import { splitFolio } from '@/lib/remittance';

/**
 * Refresh an existing property_statement by adding any guesty_reservations
 * rows that have checked out in the statement month, are paid (total_paid > 0),
 * and aren't already on the statement.
 *
 * Use case: the monthly ingest was run early (e.g. Apr 20) and captured the
 * stays known at that time. New stays subsequently checked out (e.g. Apr 26)
 * and got synced into guesty_reservations via "Upload Reservations CSV" --
 * but the statement itself doesn't auto-incorporate those.
 *
 * This endpoint inserts the missing reservations using the same Stripe-on-
 * gross + kludge-strip formulas as /api/ingest, then recomputes the
 * statement's rental_revenue / management_fee / owner_payout / num_stays /
 * nights_booked. Cleaning events aren't touched (they're driven by the
 * Chase bank CSV which is a separate flow).
 *
 * Candidates carry revenue in ANY of total_paid / host_payout /
 * owner_net_revenue_guesty (a homeowner stay is zero in all three and drops
 * out). Only a candidate with total_paid > 0 is INSERTED, because the
 * Stripe-on-gross reconstruction has no other input it can price from; a
 * candidate with revenue only in host_payout is reported in
 * `missing_gross_codes` instead of being guessed at; the operator-facing
 * flag for such a stay belongs to the missed-Direct detector, which tests
 * the Guesty folio's accommodation fare rather than a scalar column. Reservations already on the
 * statement (matched by confirmation_code) are skipped.
 */


function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function calcStripeFee(processedAmount: number): number {
  return round2(processedAmount * 0.039 + 0.40);
}

function nightsBetween(a: string, b: string): number {
  const d1 = Date.parse(a + 'T00:00:00');
  const d2 = Date.parse(b + 'T00:00:00');
  if (isNaN(d1) || isNaN(d2)) return 0;
  return Math.max(0, Math.round((d2 - d1) / 86400_000));
}

function normalizePlatform(raw?: string | null): string {
  if (!raw) return 'Unknown';
  const s = raw.trim();
  if (!s) return 'Unknown';
  const l = s.toLowerCase();
  if (l.startsWith('airbnb')) return 'Airbnb';
  if (l.startsWith('homeaway') || l === 'vrbo') return 'HomeAway';
  if (l === 'bookingcom' || l.startsWith('booking')) return 'Booking.com';
  if (l === 'direct' || l === 'manual') return 'Manual';
  return s;
}

/** Twin of the canonical helper in /api/ingest -- keep in lockstep.
 *  The base is the pre-tax FOLIO whenever we have one: channel_commission is
 *  booking-level while total_paid is payment-level and Guesty logs only one
 *  leg of a 50/50 split, which doubles the ratio and cuts a real 5% VRBO
 *  commission as if it were the legacy kludge. */
function stripLegacyCommissionKludge(args: {
  platform: string; totalPaid: number; totalTaxes: number; commission: number;
  folioPreTax?: number | null;
}): number {
  const { platform, totalPaid, totalTaxes, commission, folioPreTax } = args;
  if (!commission || commission <= 0) return 0;
  const base = folioPreTax && folioPreTax > 0
    ? folioPreTax
    : Math.max(totalPaid - totalTaxes, 0);
  if (base <= 0) return commission;
  const ratio = commission / base;
  const p = platform.toUpperCase();
  if (p === 'MANUAL' && ratio > 0.02) return 0;
  if ((p.includes('HOMEAWAY') || p === 'VRBO') && ratio > 0.07) {
    return round2(base * 0.05);
  }
  return commission;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({} as { month?: string; property_id?: string; force?: boolean }));
    const month = body.month || '';
    const propertyId = body.property_id || '';
    if (!/^\d{4}-\d{2}$/.test(month) || !propertyId) {
      return NextResponse.json({ error: 'month (YYYY-MM) and property_id are required' }, { status: 400 });
    }

    // Sent-statement freeze: a refresh moves owner_payout, so a statement
    // already marked sent needs an explicit force (recorded as a gap).
    let finalityGate: FreezeReceipt;
    try {
      finalityGate = await assertStatementWritable(supabase, { propertyId, month }, {
        force: body.force === true,
        action: 'Refresh statement (add missed bookings)',
      });
    } catch (e) {
      if (e instanceof StatementFrozenError) return NextResponse.json(frozenResponseBody(e), { status: 409 });
      throw e;
    }

    const { data: period } = await supabase.from('statement_periods').select('id').eq('month', month).single();
    if (!period) {
      return NextResponse.json({ error: `No statement period for ${month}` }, { status: 404 });
    }

    const { data: stmt } = await supabase
      .from('property_statements')
      .select('id, management_fee_pct, cleaning_total, repairs_total, reserve_holdback')
      .eq('period_id', period.id)
      .eq('property_id', propertyId)
      .single();
    if (!stmt) {
      return NextResponse.json(
        { error: `No statement for ${propertyId} / ${month}. Run a full ingest first via Re-Upload Data.` },
        { status: 404 },
      );
    }

    // Existing reservation codes -- we won't duplicate any of these.
    // FAIL CLOSED: this is the dedupe key for the whole route. A swallowed
    // error empties the set, every candidate then looks missing, and the
    // insert below re-adds the ENTIRE month on top of itself -- the owner
    // paid twice. Refuse instead; nothing has been written yet.
    const { data: existing, error: existingErr } = await supabase
      .from('reservations')
      .select('confirmation_code')
      .eq('property_statement_id', stmt.id);
    if (existingErr) {
      return NextResponse.json(
        { error: `Could not read the statement's existing bookings (${existingErr.message}). Nothing was changed -- retrying is safe.` },
        { status: 502 },
      );
    }
    const existingCodes = new Set(
      (existing || []).map(r => r.confirmation_code).filter((c): c is string => !!c),
    );

    // Candidate guesty_reservations: same property, checked out in month,
    // carrying revenue in ANY of total_paid / host_payout /
    // owner_net_revenue_guesty. A homeowner stay earns nothing in all three
    // and drops out here, which is the same rule /api/ingest applies
    // (Manual + zero accrual revenue). The old `.gt('total_paid', 0)` also
    // excluded NULL, which hid every staycapeann.com direct stay: SCA takes
    // payment through the property's own Stripe, so Guesty records
    // total_paid NULL and only host_payout carries the gross.
    //
    // CANDIDACY IS NOT PERMISSION TO INSERT -- see the insertable/noGross
    // split below. Widening this filter alone would let the reconstruction
    // price a stay it has no gross for.
    const monthStart = `${month}-01`;
    const [y, m] = month.split('-').map(Number);
    const monthEndExclusive = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
    const { data: candidates, error: candErr } = await supabase
      .from('guesty_reservations')
      .select(`confirmation_code, guest_name, check_in, check_out, nights, channel, guesty_channel_id, status, total_taxes, channel_commission, folio_items, ${REVENUE_SIGNAL_COLUMNS}`)
      .eq('property_id', propertyId)
      // Confirmed only: an inquiry has a quoted host_payout but no booking
      // behind it, and a cancelled row must never be added to a statement.
      .eq('status', CONFIRMED_STATUS)
      .gte('check_out', monthStart)
      .lt('check_out', monthEndExclusive)
      .or(REVENUE_SIGNAL_OR);
    // Fail closed: an unreadable candidate list is not an empty one, and
    // reporting "nothing to add" off a failed read is how a missed booking
    // becomes a sent statement.
    if (candErr) {
      return NextResponse.json(
        { error: `Could not read bookings for ${month}: ${candErr.message}. Nothing was changed.` },
        { status: 502 },
      );
    }

    const candidatesMissing = (candidates || []).filter(c =>
      c.confirmation_code && !existingCodes.has(c.confirmation_code)
    );

    // A code with reservation_installments rows is owned by the ingest
    // installment fork / synthetic injection: its per-month slices are what
    // get recognized, never the full-value guesty_reservations row. Without
    // this filter, Refresh re-adds a fully-recognized long stay at full
    // value in its checkout month (a stay checking out on the 1st has zero
    // nights there, so no slice exists to catch it) and double-pays the
    // owner.
    const installmentCoded = await loadInstallmentsForCodes(
      supabase,
      candidatesMissing.map(c => c.confirmation_code as string),
    );
    const missing = candidatesMissing.filter(c => !installmentCoded.has(c.confirmation_code as string));
    const skippedInstallmentCodes = candidatesMissing
      .filter(c => installmentCoded.has(c.confirmation_code as string))
      .map(c => c.confirmation_code as string);

    // Split candidacy from insertability. The reconstruction below prices a
    // stay off TOTAL_PAID and nothing else: at total_paid = 0 it computes
    // stripe_fee = $0.40 and adjusted_revenue = -$0.40, so inserting a
    // gross-less row would invent money. host_payout is a different basis
    // (gross INCLUDING taxes) and owner_net_revenue_guesty is already net of
    // the management fee -- neither can be fed to these formulas without
    // changing what the owner is paid.
    //
    // The FLAG for such a stay is owned by the missed-Direct detector below
    // (#1414), which asks the sharper question: does the Guesty folio carry
    // real accommodation fare? That separates a paying guest from a
    // homeowner block far better than any of the scalar revenue columns, so
    // this route reports the codes it could not price and lets that detector
    // raise the operator-facing gap. No second, blunter gap for the same stay.
    //
    // Dedupe by confirmation_code, preferring the priceable row. Live data
    // carries one row per code today, but guesty_reservations accumulates a
    // row per source in principle, and two rows for one stay would otherwise
    // be inserted twice (double revenue) or land in both buckets at once.
    const byCode = new Map<string, typeof missing[number]>();
    for (const g of missing) {
      const code = g.confirmation_code as string;
      const held = byCode.get(code);
      if (!held || (!hasPriceableGross(held) && hasPriceableGross(g))) byCode.set(code, g);
    }
    const deduped = Array.from(byCode.values());

    const insertable = deduped.filter(hasPriceableGross);
    // A cancelled booking legitimately has no collected gross, and the
    // cancelled-reservation guard already owns that case.
    const isCancelled = (g: { status?: string | null }) =>
      /cancel|declined|expired/i.test(String(g.status || ''));
    const noGrossCodes = deduped
      .filter(g => !hasPriceableGross(g) && !isCancelled(g))
      .map(g => g.confirmation_code as string);

    // Missed-Direct guard. The total_paid > 0 candidate filter above is
    // correct for skipping homeowner stays, but it also skips real Direct
    // bookings, whose payment goes through the property's own Stripe and
    // never registers in Guesty (Martha Mazzone, GY-ZUnEnMgw, $29k, Aug
    // 2026). This detector raises a critical data gap for any confirmed
    // Direct/Manual stay with real accommodation fare on its Guesty folio
    // that is still absent from the statement. Flag-only -- adding the
    // reservation stays an operator decision. Runs after any inserts so a
    // just-added stay is not flagged, and never fails the refresh.
    const runMissingDirectCheck = async (): Promise<MissingDirectStay[]> => {
      try {
        const flagged = await detectMissingDirectStays(supabase, {
          propertyStatementId: stmt.id,
          propertyId,
          month,
        });
        await persistMissingDirectGaps(supabase, stmt.id, flagged, month);
        return flagged;
      } catch (err) {
        console.warn('missing-direct check skipped:', err instanceof Error ? err.message : err);
        return [];
      }
    };

    if (insertable.length === 0) {
      const flaggedMissingDirect = await runMissingDirectCheck();
      const baseMessage = skippedInstallmentCodes.length > 0
        ? `No new bookings to add. ${skippedInstallmentCodes.length} skipped because they are recognized via installment splits (${skippedInstallmentCodes.join(', ')}).`
        : 'No new bookings to add. The statement is up to date with guesty_reservations.';
      return NextResponse.json({
        success: true,
        added: [],
        skipped_installment_codes: skippedInstallmentCodes,
        missing_gross_codes: noGrossCodes,
        flagged_missing_direct: flaggedMissingDirect,
        message: [
          baseMessage,
          flaggedMissingDirect.length > 0
            ? `WARNING: ${flaggedMissingDirect.length} confirmed Direct stay${flaggedMissingDirect.length === 1 ? '' : 's'} with real folio revenue ${flaggedMissingDirect.length === 1 ? 'is' : 'are'} missing from this statement (${flaggedMissingDirect.map(f => f.confirmation_code).join(', ')}). A critical data gap was raised.`
            : '',
          // Codes this route saw but could not price. Usually the same
          // stays the detector just flagged; listed so the operator knows
          // Refresh could not fix them by itself.
          noGrossCodes.length > 0
            ? `${noGrossCodes.length} booking${noGrossCodes.length === 1 ? '' : 's'} could not be priced here (no collected gross in Guesty): ${noGrossCodes.join(', ')}.`
            : '',
        ].filter(Boolean).join(' '),
      });
    }

    const newRows = insertable.map(g => {
      const platform = normalizePlatform(g.channel || g.guesty_channel_id);
      const platformUpper = platform.toUpperCase();
      const isStripeChannel = platformUpper.includes('HOMEAWAY') || platformUpper === 'VRBO' || platformUpper === 'MANUAL';
      const reportedPaid = Number(g.total_paid) || 0;
      const totalTaxes = Number(g.total_taxes) || 0;
      const rawCommission = Number(g.channel_commission) || 0;
      // Whole booking total from the folio; TOTAL_PAID can be one leg of a
      // 50/50 split. Same rule as /api/ingest -- keep in lockstep. Applied
      // to the Stripe channels only: on Airbnb/Booking.com total_paid is
      // already the channel's net and carries different semantics.
      const folio = splitFolio((g as { folio_items?: unknown }).folio_items);
      const folioGross = folio.hasFolio ? round2(folio.preTax + folio.tax) : 0;
      const totalPaid = isStripeChannel && folioGross > 0 && reportedPaid > 0 && reportedPaid < folioGross - 1
        ? folioGross
        : reportedPaid;

      let stripeFee = 0;
      let adjustedRevenue: number;
      let guestyRentalIncome: number;

      if (isStripeChannel) {
        // VRBO / Manual: reconstruct net from gross
        const effComm = stripLegacyCommissionKludge({
          platform, totalPaid, totalTaxes, commission: rawCommission,
          folioPreTax: folio.hasFolio ? folio.preTax : null,
        });
        stripeFee = calcStripeFee(totalPaid);
        guestyRentalIncome = round2(totalPaid - totalTaxes - effComm);
        adjustedRevenue = round2(guestyRentalIncome - stripeFee);
      } else {
        // Airbnb / Booking.com: total_paid is already net of channel fees
        guestyRentalIncome = totalPaid;
        adjustedRevenue = totalPaid;
      }

      return {
        property_statement_id: stmt.id,
        guest_name: g.guest_name,
        confirmation_code: g.confirmation_code,
        check_in: g.check_in,
        check_out: g.check_out,
        nights: g.nights || nightsBetween(g.check_in, g.check_out),
        platform,
        guesty_rental_income: guestyRentalIncome,
        stripe_fee: stripeFee,
        adjusted_revenue: adjustedRevenue,
        bank_match_status: 'unmatched',
        bank_deposit_amount: null,
      };
    });

    const { error: insertErr } = await supabase.from('reservations').insert(newRows);
    if (insertErr) throw insertErr;

    // The single write path recomputes every money column from the rows just
    // inserted and fails closed on any read error (statement-totals-write.ts).
    // The early guard's receipt is passed so a forced refresh files one
    // audit row, not two.
    let totals: WriteResult;
    try {
      totals = await writeStatementTotals(supabase, stmt.id, {
        action: 'Refresh statement (add missed bookings)',
        assertedFreeze: finalityGate,
      });
    } catch (e) {
      throw new Error(
        `Bookings were added, but the statement totals could not be recomputed (${e instanceof Error ? e.message : String(e)}). ` +
        'The statement now understates revenue until you re-run Refresh or re-ingest the month.',
      );
    }
    const newRentalRev = totals.after.rental_revenue;
    const newMgmtFee = totals.after.management_fee;
    const newOwnerPayout = totals.after.owner_payout;
    const newNumStays = totals.after.num_stays;
    const newNightsBooked = totals.after.nights_booked;

    const flaggedMissingDirect = await runMissingDirectCheck();

    return NextResponse.json({
      success: true,
      skipped_installment_codes: skippedInstallmentCodes,
      missing_gross_codes: noGrossCodes,
      flagged_missing_direct: flaggedMissingDirect,
      added: newRows.map(r => ({
        guest: r.guest_name,
        confirmation_code: r.confirmation_code,
        check_in: r.check_in,
        check_out: r.check_out,
        platform: r.platform,
        adjusted_revenue: r.adjusted_revenue,
      })),
      statement: {
        rental_revenue: newRentalRev,
        management_fee: newMgmtFee,
        owner_payout: newOwnerPayout,
        num_stays: newNumStays,
        nights_booked: newNightsBooked,
      },
    });
  } catch (err) {
    console.error('refresh-statement error:', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}
