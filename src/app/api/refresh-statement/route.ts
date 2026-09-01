import { NextRequest, NextResponse } from 'next/server';
import { loadAddOnTotals } from '@/lib/statement-addons';
import { loadInstallmentsForCodes } from '@/lib/installments';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import { assertStatementWritable, StatementFrozenError, frozenResponseBody } from '@/lib/statement-finality';
import { detectMissingDirectStays, persistMissingDirectGaps, type MissingDirectStay } from '@/lib/missing-direct-stays';

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
 * Homeowner stays (total_paid <= 0) and reservations already on the
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

function stripLegacyCommissionKludge(args: {
  platform: string; totalPaid: number; totalTaxes: number; commission: number;
}): number {
  const { platform, totalPaid, totalTaxes, commission } = args;
  if (!commission || commission <= 0) return 0;
  const base = Math.max(totalPaid - totalTaxes, 0);
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
    try {
      await assertStatementWritable(supabase, { propertyId, month }, {
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
    const { data: existing } = await supabase
      .from('reservations')
      .select('confirmation_code')
      .eq('property_statement_id', stmt.id);
    const existingCodes = new Set(
      (existing || []).map(r => r.confirmation_code).filter((c): c is string => !!c),
    );

    // Candidate guesty_reservations: same property, checked out in month,
    // paid (total_paid > 0). Owner stays (total_paid = 0) excluded.
    const monthStart = `${month}-01`;
    const [y, m] = month.split('-').map(Number);
    const monthEndExclusive = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
    const { data: candidates } = await supabase
      .from('guesty_reservations')
      .select('confirmation_code, guest_name, check_in, check_out, nights, channel, guesty_channel_id, total_paid, total_taxes, channel_commission')
      .eq('property_id', propertyId)
      .gte('check_out', monthStart)
      .lt('check_out', monthEndExclusive)
      .gt('total_paid', 0);

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

    if (missing.length === 0) {
      const flaggedMissingDirect = await runMissingDirectCheck();
      const baseMessage = skippedInstallmentCodes.length > 0
        ? `No new bookings to add. ${skippedInstallmentCodes.length} skipped because they are recognized via installment splits (${skippedInstallmentCodes.join(', ')}).`
        : 'No new bookings to add. The statement is up to date with guesty_reservations.';
      return NextResponse.json({
        success: true,
        added: [],
        skipped_installment_codes: skippedInstallmentCodes,
        flagged_missing_direct: flaggedMissingDirect,
        message: flaggedMissingDirect.length > 0
          ? `${baseMessage} WARNING: ${flaggedMissingDirect.length} confirmed Direct stay${flaggedMissingDirect.length === 1 ? '' : 's'} with real folio revenue ${flaggedMissingDirect.length === 1 ? 'is' : 'are'} missing from this statement (${flaggedMissingDirect.map(f => f.confirmation_code).join(', ')}). A critical data gap was raised.`
          : baseMessage,
      });
    }

    const newRows = missing.map(g => {
      const platform = normalizePlatform(g.channel || g.guesty_channel_id);
      const platformUpper = platform.toUpperCase();
      const isStripeChannel = platformUpper.includes('HOMEAWAY') || platformUpper === 'VRBO' || platformUpper === 'MANUAL';
      const totalPaid = Number(g.total_paid) || 0;
      const totalTaxes = Number(g.total_taxes) || 0;
      const rawCommission = Number(g.channel_commission) || 0;

      let stripeFee = 0;
      let adjustedRevenue: number;
      let guestyRentalIncome: number;

      if (isStripeChannel) {
        // VRBO / Manual: reconstruct net from gross
        const effComm = stripLegacyCommissionKludge({ platform, totalPaid, totalTaxes, commission: rawCommission });
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

    // Recompute statement totals from the freshest reservations.
    const { data: allRes } = await supabase
      .from('reservations')
      .select('adjusted_revenue, nights, check_out')
      .eq('property_statement_id', stmt.id);
    const newRentalRev = round2((allRes || []).reduce((s, r) => s + (r.adjusted_revenue || 0), 0));
    // Attributed add-ons / debits stay in the equation (canonical formula,
    // same as the bank-deposits + reserve routes) so a refresh can't
    // clobber reviewed revenue.
    const { addOnsRevenue, addOnsMgmtBase, attributedDebits } = await loadAddOnTotals(supabase, propertyId, month);
    const newMgmtFee = round2((newRentalRev + addOnsMgmtBase) * (stmt.management_fee_pct / 100));
    const reserveHoldback = Number((stmt as { reserve_holdback?: number }).reserve_holdback ?? 0);
    const newOwnerPayout = round2(
      newRentalRev + addOnsRevenue - newMgmtFee - (stmt.cleaning_total || 0) - (stmt.repairs_total || 0) - attributedDebits - reserveHoldback,
    );
    // num_stays counts a booking ONCE on its checkout month -- synthetic
    // cross-month installment rows (check_out in a later month) carry
    // revenue here but are counted as a stay on their final statement.
    const newNumStays = (allRes || []).filter(
      r => (r.adjusted_revenue || 0) > 0 && (r.check_out || '').slice(0, 7) === month,
    ).length;
    const newNightsBooked = (allRes || []).reduce((s, r) => s + (r.nights || 0), 0);

    await supabase
      .from('property_statements')
      .update({
        rental_revenue: newRentalRev,
        management_fee: newMgmtFee,
        owner_payout: newOwnerPayout,
        num_stays: newNumStays,
        nights_booked: newNightsBooked,
      })
      .eq('id', stmt.id);

    const flaggedMissingDirect = await runMissingDirectCheck();

    return NextResponse.json({
      success: true,
      skipped_installment_codes: skippedInstallmentCodes,
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
