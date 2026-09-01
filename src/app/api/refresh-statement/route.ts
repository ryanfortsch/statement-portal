import { NextRequest, NextResponse } from 'next/server';
import { loadAddOnTotals } from '@/lib/statement-addons';
import { loadInstallmentsForCodes } from '@/lib/installments';
import { REVENUE_SIGNAL_COLUMNS, REVENUE_SIGNAL_OR, hasPriceableGross } from '@/lib/guesty-revenue-signal';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import { assertStatementWritable, StatementFrozenError, frozenResponseBody } from '@/lib/statement-finality';

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
 * candidate with revenue only in host_payout files a 'refresh_missing_gross'
 * data gap instead of being guessed at. Reservations already on the
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
      .select(`confirmation_code, guest_name, check_in, check_out, nights, channel, guesty_channel_id, status, total_taxes, channel_commission, ${REVENUE_SIGNAL_COLUMNS}`)
      .eq('property_id', propertyId)
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
    // changing what the owner is paid. Those rows are reported as a gap for
    // the operator to resolve (sync Stripe, or re-ingest with the PDF),
    // never guessed at.
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
    // A cancelled booking legitimately has no collected gross; flagging it
    // as "revenue missing from this statement" would be a false alarm, and
    // the cancelled-reservation guard elsewhere already owns that case.
    const isCancelled = (g: { status?: string | null }) =>
      /cancel|declined|expired/i.test(String(g.status || ''));
    const noGross = deduped.filter(g => !hasPriceableGross(g) && !isCancelled(g));
    const noGrossCodes = noGross.map(g => g.confirmation_code as string);

    // Record (or clear) the unpriceable-candidate gap before returning, so
    // it exists even when there is nothing to insert. Delete-then-insert
    // keeps repeated Refresh clicks idempotent instead of stacking rows.
    // This gap_type is owned solely by this route, so the narrow delete
    // cannot race /api/ingest's wholesale gap rebuild.
    const { error: gapDelErr } = await supabase
      .from('data_gaps')
      .delete()
      .eq('property_statement_id', stmt.id)
      .eq('gap_type', 'refresh_missing_gross');
    if (gapDelErr) {
      return NextResponse.json(
        { error: `data_gaps cleanup failed: ${gapDelErr.message}. Nothing was changed.` },
        { status: 500 },
      );
    }
    if (noGrossCodes.length > 0) {
      const { error: gapErr } = await supabase.from('data_gaps').insert({
        property_statement_id: stmt.id,
        gap_type: 'refresh_missing_gross',
        severity: 'critical',
        description: `${noGrossCodes.length} booking${noGrossCodes.length === 1 ? '' : 's'} checked out in ${month} and ${noGrossCodes.length === 1 ? 'is' : 'are'} missing from this statement, but Guesty has no collected gross for ${noGrossCodes.length === 1 ? 'it' : 'them'} (TOTAL_PAID empty), so the revenue cannot be computed here. Typically a Stay Cape Ann direct booking paid through the property's own Stripe.`,
        // Sync Stripe writes to `reservations`, not `guesty_reservations`,
        // so it cannot make this row insertable here. Re-ingesting with the
        // Guesty PDF is the remedy that works: ingest reads the accrual
        // rental income off the PDF and prices the stay from that.
        expected_data: `Re-ingest this month with the Guesty owner-statement PDF (Re-upload Data); that path prices the stay from the PDF's rental income. Codes: ${noGrossCodes.join(', ')}`,
        resolved: false,
      });
      // The response text below tells the operator these were "flagged as a
      // data gap". If the flag could not be written, saying so anyway would
      // be the same false all-clear this phase exists to remove.
      if (gapErr) {
        return NextResponse.json({
          error: `${noGrossCodes.length} booking${noGrossCodes.length === 1 ? '' : 's'} could not be priced AND the warning flag could not be saved (${gapErr.message}). `
            + `Re-ingest this month with the Guesty PDF before sending. Codes: ${noGrossCodes.join(', ')}`,
        }, { status: 500 });
      }
    }

    if (insertable.length === 0) {
      return NextResponse.json({
        success: true,
        added: [],
        skipped_installment_codes: skippedInstallmentCodes,
        missing_gross_codes: noGrossCodes,
        message: [
          'No new bookings could be added.',
          skippedInstallmentCodes.length > 0
            ? `${skippedInstallmentCodes.length} skipped because they are recognized via installment splits (${skippedInstallmentCodes.join(', ')}).`
            : '',
          noGrossCodes.length > 0
            ? `${noGrossCodes.length} booking${noGrossCodes.length === 1 ? ' has' : 's have'} no collected gross in Guesty and cannot be priced here -- flagged as a data gap on the statement (${noGrossCodes.join(', ')}).`
            : '',
          skippedInstallmentCodes.length === 0 && noGrossCodes.length === 0
            ? 'The statement is up to date with guesty_reservations.'
            : '',
        ].filter(Boolean).join(' '),
      });
    }

    const newRows = insertable.map(g => {
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

    // Recompute statement totals from the freshest reservations. This read
    // runs AFTER the insert, so a failure cannot be a clean refusal -- but
    // it must not be silent either: an empty result here would zero
    // rental_revenue, num_stays and nights_booked and rewrite the payout as
    // if the property had no bookings at all.
    const { data: allRes, error: allResErr } = await supabase
      .from('reservations')
      .select('adjusted_revenue, nights, check_out')
      .eq('property_statement_id', stmt.id);
    if (allResErr) {
      throw new Error(
        `Bookings were added, but the statement totals could not be recomputed (${allResErr.message}). ` +
        'The statement now understates revenue until you re-run Refresh or re-ingest the month.',
      );
    }
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

    return NextResponse.json({
      success: true,
      skipped_installment_codes: skippedInstallmentCodes,
      missing_gross_codes: noGrossCodes,
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
