import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

// Property config: property_id -> { name, owner, fee_pct, bank_last4 }
const PROPERTIES: Record<string, { name: string; owner: string; fee_pct: number; bank_last4: string }> = {
  '3_south_st': { name: '3 South St', owner: 'Bailey', fee_pct: 25, bank_last4: '5622' },
  '21_horton': { name: '21 Horton St', owner: 'Kittredge', fee_pct: 22, bank_last4: '1323' },
  '53_rocky_neck': { name: '53 Rocky Neck Ave', owner: 'Prudenzi', fee_pct: 25, bank_last4: '9910' },
  '4_brier_neck': { name: '4 Brier Neck Rd', owner: 'Armstrong', fee_pct: 20, bank_last4: '7876' },
  '30_woodward': { name: '30 Woodward Ave', owner: 'McWethy', fee_pct: 25, bank_last4: '8221' },
  '20_hammond': { name: '20 Hammond St', owner: 'Ramsey', fee_pct: 25, bank_last4: '9969' },
  '20_enon': { name: '20 Enon Rd', owner: 'Snyder', fee_pct: 25, bank_last4: '1307' },
  '73_rocky_neck': { name: '73 Rocky Neck Ave', owner: 'Moynahan', fee_pct: 25, bank_last4: '3227' },
  '17_beach_rd': { name: '17 Beach Rd', owner: 'Nolan', fee_pct: 22, bank_last4: '5621' },
};

// Parse CSV text into array of objects
function parseCSV(text: string): Record<string, string>[] {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];

  // Handle both comma and tab delimited
  const delimiter = lines[0].includes('\t') ? '\t' : ',';

  // Parse header
  const headers = parseCSVLine(lines[0], delimiter);
  const rows: Record<string, string>[] = [];

  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i], delimiter);
    if (values.length === 0) continue;
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => {
      row[h.trim()] = (values[idx] || '').trim();
    });
    rows.push(row);
  }
  return rows;
}

function parseCSVLine(line: string, delimiter: string): string[] {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === delimiter && !inQuotes) {
      result.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current);
  return result;
}

// Calculate Stripe fee for VRBO/Manual bookings
// 3.9% of transaction value + $0.20 per transaction, 2 transactions per reservation
function calcStripeFee(rentalIncome: number): number {
  // Rental income is gross before Stripe. Stripe fee = 3.9% * income + 2 * $0.20
  const fee = rentalIncome * 0.039 + 0.40;
  return Math.round(fee * 100) / 100;
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();

    const month = formData.get('month') as string; // "2026-04"
    const propertyId = formData.get('property_id') as string;
    const platformCSVFile = formData.get('platform_csv') as File | null;
    const bankCSVFile = formData.get('bank_csv') as File | null;
    const guestyJSON = formData.get('guesty_data') as string | null; // JSON string of reservation data

    if (!month || !propertyId) {
      return NextResponse.json({ error: 'month and property_id are required' }, { status: 400 });
    }

    const propConfig = PROPERTIES[propertyId];
    if (!propConfig) {
      return NextResponse.json({ error: 'Unknown property: ' + propertyId }, { status: 400 });
    }

    // 1. Create or get statement period
    let { data: period } = await supabase
      .from('statement_periods')
      .select('*')
      .eq('month', month)
      .single();

    if (!period) {
      const { data: newPeriod, error: periodErr } = await supabase
        .from('statement_periods')
        .insert({ month, status: 'draft' })
        .select()
        .single();
      if (periodErr) throw periodErr;
      period = newPeriod;
    }

    // 2. Parse platform CSV (maps confirmation codes to platforms)
    const platformMap: Record<string, string> = {};
    if (platformCSVFile) {
      const platformText = await platformCSVFile.text();
      const platformRows = parseCSV(platformText);
      for (const row of platformRows) {
        const code = row['CONFIRMATION CODE'] || row['Confirmation Code'] || row['confirmation_code'] || '';
        const platform = row['PLATFORM'] || row['Platform'] || row['platform'] || '';
        if (code && platform) {
          platformMap[code.trim()] = platform.trim();
        }
      }
    }

    // 3. Parse bank CSV (Chase format)
    let bankRows: Record<string, string>[] = [];
    if (bankCSVFile) {
      const bankText = await bankCSVFile.text();
      bankRows = parseCSV(bankText);
    }

    // Separate bank data: cleaning charges and deposits
    const cleaningCharges: { date: string; amount: number; description: string }[] = [];
    const deposits: { date: string; amount: number; description: string }[] = [];

    for (const row of bankRows) {
      const desc = row['Description'] || row['DESCRIPTION'] || '';
      const amountStr = row['Amount'] || row['AMOUNT'] || '0';
      const date = row['Posting Date'] || row['DATE'] || row['Post Date'] || '';
      const amount = parseFloat(amountStr.replace(/[,$]/g, '')) || 0;

      if (desc.toUpperCase().includes('CAPE ANN ELITE')) {
        cleaningCharges.push({ date, amount: Math.abs(amount), description: desc });
      } else if (amount > 0) {
        deposits.push({ date, amount, description: desc });
      }
    }

    const cleaningTotal = cleaningCharges.reduce((sum, c) => sum + c.amount, 0);

    // 4. Parse Guesty reservation data (JSON from manual entry or PDF extraction)
    interface GuestyReservation {
      guest_name: string;
      confirmation_code: string;
      check_in: string;
      check_out: string;
      nights: number;
      rental_income: number;
    }

    let reservations: GuestyReservation[] = [];
    if (guestyJSON) {
      try {
        reservations = JSON.parse(guestyJSON);
      } catch {
        return NextResponse.json({ error: 'Invalid guesty_data JSON' }, { status: 400 });
      }
    }

    // 5. Process reservations: apply channel logic
    let totalRevenue = 0;
    let totalStripeFees = 0;
    const processedReservations: {
      guest_name: string;
      confirmation_code: string;
      check_in: string;
      check_out: string;
      nights: number;
      platform: string;
      guesty_rental_income: number;
      stripe_fee: number;
      adjusted_revenue: number;
      bank_deposit_amount: number | null;
      bank_match_status: string;
    }[] = [];

    for (const res of reservations) {
      const platform = platformMap[res.confirmation_code] || 'Unknown';
      const isStripeChannel = platform.toUpperCase().includes('HOMEAWAY') ||
                               platform.toUpperCase().includes('VRBO') ||
                               platform.toUpperCase() === 'MANUAL';

      // Check if homeowner stay (Manual with no/zero revenue)
      const isHomeownerStay = platform.toUpperCase() === 'MANUAL' && (!res.rental_income || res.rental_income === 0);

      let stripeFee = 0;
      let adjustedRevenue = res.rental_income;

      if (isHomeownerStay) {
        adjustedRevenue = 0;
      } else if (isStripeChannel) {
        stripeFee = calcStripeFee(res.rental_income);
        adjustedRevenue = Math.round((res.rental_income - stripeFee) * 100) / 100;
      }

      // Try to match with bank deposit
      let bankMatch: { amount: number; status: string } = { amount: 0, status: 'unmatched' };
      if (!isHomeownerStay) {
        // Simple matching: find a deposit close to the adjusted revenue
        const matchIdx = deposits.findIndex(d =>
          Math.abs(d.amount - adjustedRevenue) < 5 // within $5
        );
        if (matchIdx >= 0) {
          bankMatch = { amount: deposits[matchIdx].amount, status: 'matched' };
          deposits.splice(matchIdx, 1); // remove so we don't double-match
        }
      }

      if (!isHomeownerStay) {
        totalRevenue += adjustedRevenue;
        totalStripeFees += stripeFee;
      }

      processedReservations.push({
        guest_name: res.guest_name,
        confirmation_code: res.confirmation_code,
        check_in: res.check_in,
        check_out: res.check_out,
        nights: res.nights,
        platform,
        guesty_rental_income: res.rental_income,
        stripe_fee: stripeFee,
        adjusted_revenue: adjustedRevenue,
        bank_deposit_amount: bankMatch.amount || null,
        bank_match_status: bankMatch.status,
      });
    }

    // 6. Calculate management fee and owner payout
    const managementFee = Math.round(totalRevenue * (propConfig.fee_pct / 100) * 100) / 100;
    const ownerPayout = Math.round((totalRevenue - managementFee - cleaningTotal) * 100) / 100;

    // 7. Determine confidence level
    const hasGuesty = reservations.length > 0;
    const hasPlatform = Object.keys(platformMap).length > 0;
    const hasBank = bankRows.length > 0;
    let confidence = 'red';
    if (hasGuesty && hasPlatform && hasBank) confidence = 'green';
    else if (hasGuesty && (hasPlatform || hasBank)) confidence = 'yellow';

    // 8. Upsert property statement
    // Delete existing data for this property/period if re-uploading
    const { data: existingStmt } = await supabase
      .from('property_statements')
      .select('id')
      .eq('period_id', period.id)
      .eq('property_id', propertyId)
      .single();

    if (existingStmt) {
      await supabase.from('reservations').delete().eq('property_statement_id', existingStmt.id);
      await supabase.from('cleaning_events').delete().eq('property_statement_id', existingStmt.id);
      await supabase.from('data_gaps').delete().eq('property_statement_id', existingStmt.id);
      await supabase.from('property_statements').delete().eq('id', existingStmt.id);
    }

    const { data: stmt, error: stmtErr } = await supabase
      .from('property_statements')
      .insert({
        period_id: period.id,
        property_id: propertyId,
        property_name: propConfig.name,
        owner_name: propConfig.owner,
        management_fee_pct: propConfig.fee_pct,
        rental_revenue: totalRevenue,
        management_fee: managementFee,
        cleaning_total: cleaningTotal,
        repairs_total: 0,
        tax_remittance: 0,
        owner_payout: ownerPayout,
        num_stays: processedReservations.filter(r => r.adjusted_revenue > 0).length,
        nights_booked: processedReservations.reduce((s, r) => s + (r.nights || 0), 0),
        has_guesty_statement: hasGuesty,
        has_platform_csv: hasPlatform,
        has_bank_csv: hasBank,
        confidence,
      })
      .select()
      .single();

    if (stmtErr) throw stmtErr;

    // 9. Insert reservations
    if (processedReservations.length > 0) {
      const { error: resErr } = await supabase
        .from('reservations')
        .insert(processedReservations.map(r => ({
          property_statement_id: stmt.id,
          ...r,
        })));
      if (resErr) throw resErr;
    }

    // 10. Insert cleaning events
    if (cleaningCharges.length > 0) {
      const { error: cleanErr } = await supabase
        .from('cleaning_events')
        .insert(cleaningCharges.map(c => ({
          property_statement_id: stmt.id,
          bank_charge_amount: c.amount,
          bank_charge_date: c.date || null,
          amount: c.amount,
          source: 'bank',
        })));
      if (cleanErr) throw cleanErr;
    }

    // 11. Create data gap flags
    const gaps: { gap_type: string; description: string; severity: string; expected_data: string }[] = [];

    if (!hasGuesty) {
      gaps.push({
        gap_type: 'missing_guesty',
        description: 'No Guesty owner statement data provided',
        severity: 'critical',
        expected_data: `Guesty owner statement PDF for ${propConfig.name} - ${month}`,
      });
    }
    if (!hasPlatform) {
      gaps.push({
        gap_type: 'no_platform_match',
        description: 'No platform CSV provided - cannot determine booking channels',
        severity: 'warning',
        expected_data: `Platform CSV from Guesty for ${month}`,
      });
    }
    if (!hasBank) {
      gaps.push({
        gap_type: 'missing_bank_csv',
        description: 'No bank statement provided - cannot verify deposits or cleaning charges',
        severity: 'warning',
        expected_data: `Chase bank CSV for account ...${propConfig.bank_last4}`,
      });
    }

    // Check for unmatched reservations (no bank deposit match)
    const unmatched = processedReservations.filter(r => r.bank_match_status === 'unmatched' && r.adjusted_revenue > 0);
    for (const r of unmatched) {
      gaps.push({
        gap_type: 'unmatched_bank',
        description: `No bank deposit match for ${r.guest_name} ($${r.adjusted_revenue})`,
        severity: 'info',
        expected_data: `Bank deposit around $${r.adjusted_revenue} for ${r.guest_name}`,
      });
    }

    if (gaps.length > 0) {
      await supabase
        .from('data_gaps')
        .insert(gaps.map(g => ({ property_statement_id: stmt.id, ...g })));
    }

    return NextResponse.json({
      success: true,
      property: propConfig.name,
      month,
      summary: {
        reservations: processedReservations.length,
        total_revenue: totalRevenue,
        management_fee: managementFee,
        cleaning_total: cleaningTotal,
        owner_payout: ownerPayout,
        confidence,
        data_gaps: gaps.length,
      },
    });
  } catch (err) {
    console.error('Ingest error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : JSON.stringify(err) },
      { status: 500 }
    );
  }
}
