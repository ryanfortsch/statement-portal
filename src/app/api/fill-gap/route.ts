import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

/**
 * Fill a data gap on an existing property_statement without running the full
 * ingest. Unlike /api/ingest, this does NOT delete + rebuild the statement.
 * It patches specific fields derived from the one file being uploaded:
 *
 *   bank_csv:
 *     - re-parses cleaning charges + deposits for the statement month
 *     - recomputes cleaning_total + cleaning_events from scratch
 *     - re-runs the deposit-matching pass against existing reservations
 *     - updates owner_payout, has_bank_csv, confidence
 *     - removes the 'missing_bank_csv' gap and re-emits 'unmatched_bank'
 *       gaps with fresh status
 *
 * This is the endpoint hit by the "Upload Bank CSV" action on a data-gap
 * chip. Guesty PDF is NOT required; reservations are left untouched.
 *
 * More file types (platform_csv, etc.) can be added as additional switch
 * branches.
 */

// Service role: this route needs to UPDATE reservations.bank_match_status /
// bank_deposit_amount, and the anon key's RLS policy silently no-ops UPDATEs
// (returns 200 with zero rows changed, no error). Service role bypasses RLS.
// This is safe on a server route -- the key never reaches the client.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

// ── shared helpers (duplicated from /api/ingest so a refactor of the ingest
// route doesn't risk breaking this flow, and vice versa) ────────────────────

function parseCSV(text: string): Record<string, string>[] {
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.trim().split('\n');
  if (lines.length < 2) return [];
  const headers = parseCSVLine(lines[0]);
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i]);
    if (values.length === 0) continue;
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => { row[h.trim()] = (values[idx] || '').trim(); });
    rows.push(row);
  }
  return rows;
}

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else { inQuotes = !inQuotes; }
    } else if (char === ',' && !inQuotes) {
      result.push(current); current = '';
    } else { current += char; }
  }
  result.push(current);
  return result;
}

function isInMonth(dateStr: string, month: string): boolean {
  // Chase format: MM/DD/YYYY
  const parts = dateStr.split('/');
  if (parts.length !== 3) return false;
  const mm = parts[0].padStart(2, '0');
  const yyyy = parts[2];
  return `${yyyy}-${mm}` === month;
}

function isoFromMMDDYYYY(dateStr: string): string {
  const parts = dateStr.split('/');
  if (parts.length !== 3) return '';
  return `${parts[2]}-${parts[0].padStart(2, '0')}-${parts[1].padStart(2, '0')}`;
}

/**
 * Assign bank cleaning charges to reservations 1:1 so no single stay
 * ever claims multiple Cape Ann Elite charges. Walk reservations in
 * check-out order; for each, claim the earliest still-unclaimed cleaning
 * whose posting date is on/after the check-out. A cleaning posted before
 * any known check-out (or any leftover once every reservation has its
 * cleaning) stays unattributed (source='bank').
 *
 * The previous logic was "nearest check-out within 0-3 days" with no
 * claim-tracking, so two back-to-back stays would both match the same
 * charge and leave the earlier stay's cleaning unassigned. Cape Ann
 * Elite also bills with variable lag, so the 3-day cap was too tight --
 * widened to unbounded (any cleaning on/after the checkout can match).
 */
function matchCleaningsToReservations<R extends { check_out: string; guest_name: string }>(
  cleaningCharges: { date: string; amount: number; description: string }[],
  reservations: R[],
): { charge: typeof cleaningCharges[number]; matchedGuest: string | null; matchedCheckout: string | null }[] {
  const withISO = cleaningCharges.map((c, origIdx) => ({
    c, origIdx, iso: isoFromMMDDYYYY(c.date),
  }));
  const sortedByDate = [...withISO].sort((a, b) => a.iso.localeCompare(b.iso));
  const sortedRes = [...reservations].sort((a, b) => a.check_out.localeCompare(b.check_out));

  const claimedIdx = new Set<number>();
  const assignment = new Map<number, R>();  // origIdx -> reservation

  for (const res of sortedRes) {
    for (const { origIdx, iso } of sortedByDate) {
      if (claimedIdx.has(origIdx)) continue;
      if (!iso) continue;
      if (iso < res.check_out) continue;  // cleaning predates checkout
      claimedIdx.add(origIdx);
      assignment.set(origIdx, res);
      break;
    }
  }

  return cleaningCharges.map((c, origIdx) => {
    const matched = assignment.get(origIdx);
    return {
      charge: c,
      matchedGuest: matched ? matched.guest_name : null,
      matchedCheckout: matched ? matched.check_out : null,
    };
  });
}

// ── endpoint ─────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const month = formData.get('month') as string;
    const propertyId = formData.get('property_id') as string;
    const fileType = (formData.get('file_type') as string) || 'bank_csv';
    const file = formData.get('file') as File | null;

    if (!month || !propertyId) {
      return NextResponse.json({ error: 'month and property_id are required' }, { status: 400 });
    }
    if (!file) {
      return NextResponse.json({ error: 'file is required' }, { status: 400 });
    }
    if (fileType !== 'bank_csv') {
      return NextResponse.json(
        { error: `file_type '${fileType}' not supported yet. Currently only 'bank_csv' is handled.` },
        { status: 400 },
      );
    }

    // 1. Locate the existing statement for this (property, month). If there
    //    isn't one, the gap-fill flow doesn't apply -- they need the full
    //    ingest to create it first.
    const { data: period } = await supabase
      .from('statement_periods')
      .select('id')
      .eq('month', month)
      .single();
    if (!period) {
      return NextResponse.json(
        { error: `No statement period exists for ${month}. Run the full upload first.` },
        { status: 404 },
      );
    }

    const { data: stmt } = await supabase
      .from('property_statements')
      .select('id, property_id, property_name, rental_revenue, management_fee, repairs_total')
      .eq('period_id', period.id)
      .eq('property_id', propertyId)
      .single();
    if (!stmt) {
      return NextResponse.json(
        { error: `No existing statement for ${propertyId} / ${month}. Run the full upload first.` },
        { status: 404 },
      );
    }

    // 2. Pull existing reservations so we can re-match them against the new
    //    bank deposits and rebuild cleaning_events.
    const { data: reservations } = await supabase
      .from('reservations')
      .select('id, guest_name, confirmation_code, check_in, check_out, nights, platform, guesty_rental_income, stripe_fee, adjusted_revenue')
      .eq('property_statement_id', stmt.id);

    // 3. Parse the bank CSV (same shape the main ingest expects).
    const bankText = await file.text();
    const bankRows = parseCSV(bankText);
    if (bankRows.length === 0) {
      return NextResponse.json({ error: 'Bank CSV appears empty or malformed' }, { status: 400 });
    }

    const cleaningCharges: { date: string; amount: number; description: string }[] = [];
    const deposits: { date: string; amount: number; description: string; source: string }[] = [];
    for (const row of bankRows) {
      const desc = row['Description'] || row['DESCRIPTION'] || '';
      const amountStr = row['Amount'] || row['AMOUNT'] || '0';
      const date = row['Posting Date'] || row['DATE'] || row['Post Date'] || '';
      const amount = parseFloat(amountStr.replace(/[,$]/g, '')) || 0;

      if (desc.toUpperCase().includes('CAPE ANN ELITE')) {
        if (isInMonth(date, month)) {
          cleaningCharges.push({ date, amount: Math.abs(amount), description: desc });
        }
      } else if (amount > 0) {
        let source = 'other';
        const descUpper = desc.toUpperCase();
        if (descUpper.includes('AIRBNB')) source = 'airbnb';
        else if (descUpper.includes('STRIPE')) source = 'stripe';
        else if (descUpper.includes('BOOKING.COM') || descUpper.includes('BOOKING COM')) source = 'booking';
        deposits.push({ date, amount, description: desc, source });
      }
    }

    const cleaningTotal = Math.round(cleaningCharges.reduce((sum, c) => sum + c.amount, 0) * 100) / 100;

    // 4. Re-run the deposit matching pass. Same algorithm as /api/ingest, but
    //    operating on the reservations already in the DB.
    type ResUpdate = { id: string; bank_deposit_amount: number | null; bank_match_status: string };
    const resUpdates: ResUpdate[] = [];
    const availableDeposits = [...deposits]; // consumed as we match

    for (const res of reservations || []) {
      const platform = (res.platform || '').toUpperCase();
      const isStripeChannel = platform.includes('HOMEAWAY') || platform.includes('VRBO') || platform === 'MANUAL';
      const isBooking = platform.includes('BOOKING');
      const isHomeownerStay = platform === 'MANUAL' && (!res.guesty_rental_income || res.guesty_rental_income === 0);
      let matched: { amount: number; status: string } = { amount: 0, status: 'unmatched' };

      if (!isHomeownerStay && (res.adjusted_revenue || 0) > 0) {
        if (!isStripeChannel && !isBooking) {
          // Airbnb / other 1:1 platforms: amount match within $5, prefer date
          // nearest to check-in.
          const target = res.guesty_rental_income || 0;
          const checkInTs = new Date(res.check_in + 'T00:00:00').getTime();
          let bestIdx = -1;
          let bestDist = Infinity;
          for (let i = 0; i < availableDeposits.length; i++) {
            const d = availableDeposits[i];
            if (d.source !== 'airbnb' && d.source !== 'other') continue;
            if (Math.abs(d.amount - target) >= 5) continue;
            const iso = isoFromMMDDYYYY(d.date);
            if (iso) {
              const depTs = new Date(iso + 'T00:00:00').getTime();
              const dist = Math.abs(depTs - checkInTs);
              if (dist < bestDist) { bestDist = dist; bestIdx = i; }
            } else if (bestIdx === -1) {
              bestIdx = i;
            }
          }
          if (bestIdx >= 0) {
            matched = { amount: availableDeposits[bestIdx].amount, status: 'matched' };
            availableDeposits.splice(bestIdx, 1);
          }
        } else if (isStripeChannel) {
          const hasStripe = availableDeposits.some(d => d.source === 'stripe');
          if (hasStripe) matched = { amount: res.adjusted_revenue, status: 'matched' };
        } else if (isBooking) {
          const exactIdx = availableDeposits.findIndex(d =>
            (d.source === 'booking' || d.source === 'other') &&
            Math.abs(d.amount - (res.guesty_rental_income || 0)) < 5
          );
          if (exactIdx >= 0) {
            matched = { amount: availableDeposits[exactIdx].amount, status: 'matched' };
            availableDeposits.splice(exactIdx, 1);
          } else {
            const hasBookingActivity = bankRows.some(r => {
              const d = r['Description'] || '';
              return d.toUpperCase().includes('BOOKING.COM') || d.toUpperCase().includes('BOOKING COM');
            });
            if (hasBookingActivity) matched = { amount: res.guesty_rental_income || 0, status: 'matched' };
          }
        }
      }

      resUpdates.push({
        id: res.id,
        bank_deposit_amount: matched.amount || null,
        bank_match_status: matched.status,
      });
    }

    // 5. Apply reservation updates (one by one -- Supabase doesn't support
    //    per-row upserts with different values in a single call easily).
    for (const u of resUpdates) {
      await supabase
        .from('reservations')
        .update({ bank_deposit_amount: u.bank_deposit_amount, bank_match_status: u.bank_match_status })
        .eq('id', u.id);
    }

    // 6. Rebuild cleaning_events: the old ones were sourced from (probably
    //    absent) prior bank data. Wipe and re-insert from the fresh CSV.
    await supabase.from('cleaning_events').delete().eq('property_statement_id', stmt.id);

    if (cleaningCharges.length > 0) {
      const cleaningInserts = matchCleaningsToReservations(
        cleaningCharges,
        reservations || [],
      ).map(m => ({
        property_statement_id: stmt.id,
        guest_name: m.matchedGuest,
        checkout_date: m.matchedCheckout,
        bank_charge_amount: m.charge.amount,
        bank_charge_date: isoFromMMDDYYYY(m.charge.date) || null,
        amount: m.charge.amount,
        source: m.matchedGuest ? 'matched' : 'bank',
      }));
      const { error: cleanErr } = await supabase.from('cleaning_events').insert(cleaningInserts);
      if (cleanErr) throw cleanErr;
    }

    // 7. Update the property_statements row with the new bank-derived fields.
    //    rental_revenue + management_fee are unchanged (those come from Guesty,
    //    which we haven't touched). cleaning_total changes, owner_payout
    //    recomputes from the new cleaning_total.
    const newOwnerPayout =
      Math.round(((stmt.rental_revenue || 0) - (stmt.management_fee || 0) - cleaningTotal - (stmt.repairs_total || 0)) * 100) / 100;

    // Confidence: green if we now have all three sources. We don't know
    // about has_platform_csv here without reading the existing row, but
    // the safest behavior is: upgrade yellow -> green only if the other
    // flags are already set; otherwise keep yellow. Fetch the current
    // row's source flags to decide.
    const { data: curr } = await supabase
      .from('property_statements')
      .select('has_guesty_statement, has_platform_csv')
      .eq('id', stmt.id)
      .single();
    const hasGuesty = !!curr?.has_guesty_statement;
    const hasPlatform = !!curr?.has_platform_csv;
    let confidence = 'red';
    if (hasGuesty && hasPlatform) confidence = 'green';
    else if (hasGuesty) confidence = 'yellow';

    await supabase
      .from('property_statements')
      .update({
        cleaning_total: cleaningTotal,
        owner_payout: newOwnerPayout,
        has_bank_csv: true,
        confidence,
      })
      .eq('id', stmt.id);

    // 8. Rebuild the bank-adjacent gaps. Remove the old 'missing_bank_csv'
    //    and 'unmatched_bank' rows, then re-emit unmatched_bank for any
    //    reservation that still didn't get a deposit match.
    await supabase
      .from('data_gaps')
      .delete()
      .eq('property_statement_id', stmt.id)
      .in('gap_type', ['missing_bank_csv', 'unmatched_bank']);

    const newGaps: { gap_type: string; description: string; severity: string; expected_data: string }[] = [];
    for (const u of resUpdates) {
      if (u.bank_match_status !== 'unmatched') continue;
      const res = (reservations || []).find(r => r.id === u.id);
      if (!res || !res.adjusted_revenue || res.adjusted_revenue <= 0) continue;
      const daysSinceCheckout = (Date.now() - new Date(res.check_out + 'T00:00:00').getTime()) / (1000 * 60 * 60 * 24);
      const isPending = daysSinceCheckout < 7;
      newGaps.push({
        gap_type: 'unmatched_bank',
        description: isPending
          ? `Deposit pending for ${res.guest_name} ($${res.adjusted_revenue}) -- checkout was recent`
          : `No bank deposit match for ${res.guest_name} ($${res.adjusted_revenue})`,
        severity: isPending ? 'info' : 'warning',
        expected_data: `Bank deposit ~$${res.adjusted_revenue}`,
      });
    }
    if (newGaps.length > 0) {
      await supabase
        .from('data_gaps')
        .insert(newGaps.map(g => ({ property_statement_id: stmt.id, ...g })));
    }

    return NextResponse.json({
      success: true,
      property: stmt.property_name,
      month,
      property_statement_id: stmt.id,
      summary: {
        cleaning_total: cleaningTotal,
        owner_payout: newOwnerPayout,
        cleaning_events: cleaningCharges.length,
        reservations_matched: resUpdates.filter(u => u.bank_match_status === 'matched').length,
        reservations_unmatched: resUpdates.filter(u => u.bank_match_status === 'unmatched').length,
        new_gaps: newGaps.length,
        confidence,
      },
    });
  } catch (err) {
    console.error('fill-gap error:', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : JSON.stringify(err) }, { status: 500 });
  }
}
