import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

// Property config
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

// Parse Guesty Owner Statement PDF text into reservations
// pdf-parse v1 concatenates fields without spaces, e.g.:
// "Rental payment for HM33A9MBBRRental Income$1,338.48"
function parseGuestyPDF(text: string): { confirmation_code: string; check_in: string; check_out: string; nights: number; rental_income: number }[] {
  const reservations: { confirmation_code: string; check_in: string; check_out: string; nights: number; rental_income: number }[] = [];

  // Match date range blocks: "(Mar 30 - Apr 3, 2026) - 4 nights"
  const dateRangeRegex = /\((\w+ \d+)\s*-\s*(\w+ \d+),?\s*(\d{4})\)\s*-\s*(\d+)\s*nights?/g;
  let match;

  while ((match = dateRangeRegex.exec(text)) !== null) {
    const startStr = match[1];
    const endStr = match[2];
    const year = match[3];
    const nights = parseInt(match[4]);

    const checkIn = parseShortDate(startStr, year);
    const checkOut = parseShortDate(endStr, year);

    // Get text after this date range match to find the rental payment line
    const afterMatch = text.substring(match.index);

    // pdf-parse concatenates: "HM33A9MBBRRental Income$1,338.48"
    // So we match the code as everything before "Rental Income"
    const rentalMatch = afterMatch.match(/Rental payment for\s*(\S+?)Rental Income\$?([\d,]+\.?\d*)/);

    if (rentalMatch) {
      const confirmationCode = rentalMatch[1];
      const rentalIncome = parseFloat(rentalMatch[2].replace(/,/g, ''));

      reservations.push({
        confirmation_code: confirmationCode,
        check_in: checkIn,
        check_out: checkOut,
        nights,
        rental_income: rentalIncome,
      });
    }
  }

  return reservations;
}

function parseShortDate(dateStr: string, year: string): string {
  const months: Record<string, string> = {
    'Jan': '01', 'Feb': '02', 'Mar': '03', 'Apr': '04',
    'May': '05', 'Jun': '06', 'Jul': '07', 'Aug': '08',
    'Sep': '09', 'Oct': '10', 'Nov': '11', 'Dec': '12',
  };
  const parts = dateStr.trim().split(' ');
  const month = months[parts[0]] || '01';
  const day = parts[1].padStart(2, '0');
  return `${year}-${month}-${day}`;
}

// Parse CSV with proper quote handling
function parseCSV(text: string): Record<string, string>[] {
  // Normalize line endings (Chase CSVs use CRLF)
  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.trim().split('\n');
  if (lines.length < 2) return [];
  const delimiter = ',';
  const headers = parseCSVLine(lines[0], delimiter);
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const values = parseCSVLine(lines[i], delimiter);
    if (values.length === 0) continue;
    const row: Record<string, string> = {};
    headers.forEach((h, idx) => { row[h.trim()] = (values[idx] || '').trim(); });
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
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else { inQuotes = !inQuotes; }
    } else if (char === delimiter && !inQuotes) {
      result.push(current); current = '';
    } else { current += char; }
  }
  result.push(current);
  return result;
}

// Stripe fee: 3.9% + $0.20/txn, 2 txns per reservation = $0.40
function calcStripeFee(rentalIncome: number): number {
  return Math.round((rentalIncome * 0.039 + 0.40) * 100) / 100;
}

// Check if a date string (MM/DD/YYYY) falls within a given month (YYYY-MM)
function isInMonth(dateStr: string, month: string): boolean {
  // Chase format: MM/DD/YYYY
  const parts = dateStr.split('/');
  if (parts.length !== 3) return false;
  const mm = parts[0].padStart(2, '0');
  const yyyy = parts[2];
  return `${yyyy}-${mm}` === month;
}

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const month = formData.get('month') as string;
    const propertyId = formData.get('property_id') as string;
    const platformCSVFile = formData.get('platform_csv') as File | null;
    const bankCSVFile = formData.get('bank_csv') as File | null;
    const guestyPDFFile = formData.get('guesty_pdf') as File | null;

    if (!month || !propertyId) {
      return NextResponse.json({ error: 'month and property_id are required' }, { status: 400 });
    }

    const propConfig = PROPERTIES[propertyId];
    if (!propConfig) {
      return NextResponse.json({ error: 'Unknown property: ' + propertyId }, { status: 400 });
    }

    // 1. Parse Guesty PDF
    interface GuestyReservation {
      guest_name: string;
      confirmation_code: string;
      check_in: string;
      check_out: string;
      nights: number;
      rental_income: number;
    }

    let reservations: GuestyReservation[] = [];
    let pdfDebug = '';

    if (guestyPDFFile) {
      const pdfBuffer = Buffer.from(await guestyPDFFile.arrayBuffer());
      // Use pdf-parse/lib/pdf-parse.js directly to avoid the test file ENOENT bug
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const pdfParse = require('pdf-parse/lib/pdf-parse.js');
      const pdfData = await pdfParse(pdfBuffer);
      const pdfText: string = pdfData.text;
      pdfDebug = pdfText.substring(0, 500);

      const parsed = parseGuestyPDF(pdfText);
      reservations = parsed.map(r => ({ ...r, guest_name: '' }));
    }

    // 2. Parse platform CSV (maps confirmation codes to platforms + guest names)
    const platformMap: Record<string, { platform: string; guest: string }> = {};
    if (platformCSVFile) {
      const platformText = await platformCSVFile.text();
      const platformRows = parseCSV(platformText);
      for (const row of platformRows) {
        const code = row['CONFIRMATION CODE'] || row['Confirmation Code'] || row['confirmation_code'] || '';
        const platform = row['PLATFORM'] || row['Platform'] || row['platform'] || '';
        const guest = row['GUEST'] || row['Guest'] || row['guest'] || '';
        if (code) {
          platformMap[code.trim()] = { platform: platform.trim(), guest: guest.trim() };
        }
      }
    }

    // Fill in guest names from platform CSV
    for (const res of reservations) {
      const platformInfo = platformMap[res.confirmation_code];
      if (platformInfo && platformInfo.guest && !res.guest_name) {
        res.guest_name = platformInfo.guest;
      }
      if (!res.guest_name) {
        res.guest_name = res.confirmation_code;
      }
    }

    // 3. Parse bank CSV -- FILTER TO SELECTED MONTH ONLY
    let bankRows: Record<string, string>[] = [];
    if (bankCSVFile) {
      const bankText = await bankCSVFile.text();
      bankRows = parseCSV(bankText);
    }

    const cleaningCharges: { date: string; amount: number; description: string }[] = [];
    const deposits: { date: string; amount: number; description: string; source: string }[] = [];

    for (const row of bankRows) {
      const desc = row['Description'] || row['DESCRIPTION'] || '';
      const amountStr = row['Amount'] || row['AMOUNT'] || '0';
      const date = row['Posting Date'] || row['DATE'] || row['Post Date'] || '';
      const amount = parseFloat(amountStr.replace(/[,$]/g, '')) || 0;

      // Only include transactions from the selected month
      if (!isInMonth(date, month)) continue;

      if (desc.toUpperCase().includes('CAPE ANN ELITE')) {
        cleaningCharges.push({ date, amount: Math.abs(amount), description: desc });
      } else if (amount > 0) {
        // Categorize deposit source
        let source = 'other';
        const descUpper = desc.toUpperCase();
        if (descUpper.includes('AIRBNB')) source = 'airbnb';
        else if (descUpper.includes('STRIPE')) source = 'stripe';
        else if (descUpper.includes('BOOKING.COM') || descUpper.includes('BOOKING COM')) source = 'booking';
        deposits.push({ date, amount, description: desc, source });
      }
    }

    const cleaningTotal = Math.round(cleaningCharges.reduce((sum, c) => sum + c.amount, 0) * 100) / 100;

    // 4. Process reservations with channel logic
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
      const platformInfo = platformMap[res.confirmation_code];
      const platform = platformInfo?.platform || 'Unknown';
      const isStripeChannel = platform.toUpperCase().includes('HOMEAWAY') ||
                               platform.toUpperCase().includes('VRBO') ||
                               platform.toUpperCase() === 'MANUAL';
      const isHomeownerStay = platform.toUpperCase() === 'MANUAL' && (!res.rental_income || res.rental_income === 0);

      let stripeFee = 0;
      let adjustedRevenue = res.rental_income;

      if (isHomeownerStay) {
        adjustedRevenue = 0;
      } else if (isStripeChannel) {
        stripeFee = calcStripeFee(res.rental_income);
        adjustedRevenue = Math.round((res.rental_income - stripeFee) * 100) / 100;
      }

      // Bank deposit matching (within $5 tolerance)
      let bankMatch: { amount: number; status: string } = { amount: 0, status: 'unmatched' };
      if (!isHomeownerStay && adjustedRevenue > 0) {
        // For Airbnb, match against Airbnb deposits; for Stripe channels, match Stripe deposits
        const targetSource = isStripeChannel ? 'stripe' : 'airbnb';
        const matchIdx = deposits.findIndex(d =>
          Math.abs(d.amount - (isStripeChannel ? adjustedRevenue : res.rental_income)) < 5 &&
          (d.source === targetSource || d.source === 'other')
        );
        if (matchIdx >= 0) {
          bankMatch = { amount: deposits[matchIdx].amount, status: 'matched' };
          deposits.splice(matchIdx, 1);
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

    // 5. Calculate totals
    totalRevenue = Math.round(totalRevenue * 100) / 100;
    const managementFee = Math.round(totalRevenue * (propConfig.fee_pct / 100) * 100) / 100;
    const ownerPayout = Math.round((totalRevenue - managementFee - cleaningTotal) * 100) / 100;

    // 6. Confidence
    const hasGuesty = reservations.length > 0;
    const hasPlatform = Object.keys(platformMap).length > 0;
    const hasBank = bankRows.length > 0;
    let confidence = 'red';
    if (hasGuesty && hasPlatform && hasBank) confidence = 'green';
    else if (hasGuesty && (hasPlatform || hasBank)) confidence = 'yellow';

    // 7. Create or get period
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

    // 8. Delete existing data for this property/period (re-upload support)
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

    // 9. Insert property statement
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

    // 10. Insert reservations
    if (processedReservations.length > 0) {
      const { error: resErr } = await supabase
        .from('reservations')
        .insert(processedReservations.map(r => ({ property_statement_id: stmt.id, ...r })));
      if (resErr) throw resErr;
    }

    // 11. Insert cleaning events -- match to reservation checkouts
    if (cleaningCharges.length > 0) {
      // Sort reservations by checkout date for matching
      const sortedRes = [...processedReservations].sort((a, b) => a.check_out.localeCompare(b.check_out));

      const cleaningInserts = cleaningCharges.map(c => {
        // Parse bank charge date (MM/DD/YYYY) to YYYY-MM-DD
        let chargeDateISO = '';
        if (c.date) {
          const parts = c.date.split('/');
          if (parts.length === 3) {
            chargeDateISO = `${parts[2]}-${parts[0].padStart(2, '0')}-${parts[1].padStart(2, '0')}`;
          }
        }

        // Find the reservation whose checkout is on or just before this cleaning charge
        // Cleaning typically happens on checkout day or the day after
        let matchedGuest = '';
        let matchedCheckout = '';
        if (chargeDateISO && sortedRes.length > 0) {
          let bestMatch = sortedRes[0];
          let bestDiff = Infinity;
          for (const r of sortedRes) {
            const checkoutDate = new Date(r.check_out + 'T00:00:00');
            const chargeDate = new Date(chargeDateISO + 'T00:00:00');
            const diffDays = (chargeDate.getTime() - checkoutDate.getTime()) / (1000 * 60 * 60 * 24);
            // Cleaning charge should be 0-3 days after checkout
            if (diffDays >= 0 && diffDays <= 3 && diffDays < bestDiff) {
              bestDiff = diffDays;
              bestMatch = r;
            }
          }
          if (bestDiff <= 3) {
            matchedGuest = bestMatch.guest_name;
            matchedCheckout = bestMatch.check_out;
          }
        }

        return {
          property_statement_id: stmt.id,
          guest_name: matchedGuest || null,
          checkout_date: matchedCheckout || null,
          bank_charge_amount: c.amount,
          bank_charge_date: chargeDateISO || null,
          amount: c.amount,
          source: matchedGuest ? 'matched' : 'bank',
        };
      });

      const { error: cleanErr } = await supabase
        .from('cleaning_events')
        .insert(cleaningInserts);
      if (cleanErr) throw cleanErr;
    }

    // 12. Data gap flags
    const gaps: { gap_type: string; description: string; severity: string; expected_data: string }[] = [];
    if (!hasGuesty) gaps.push({ gap_type: 'missing_guesty', description: 'No Guesty owner statement provided', severity: 'critical', expected_data: `Guesty owner statement for ${propConfig.name} - ${month}` });
    if (!hasPlatform) gaps.push({ gap_type: 'no_platform_match', description: 'No platform CSV -- cannot determine booking channels', severity: 'warning', expected_data: `Platform CSV from Guesty for ${month}` });
    if (!hasBank) gaps.push({ gap_type: 'missing_bank_csv', description: 'No bank statement for deposit/cleaning verification', severity: 'warning', expected_data: `Chase bank CSV for ...${propConfig.bank_last4}` });

    const unmatched = processedReservations.filter(r => r.bank_match_status === 'unmatched' && r.adjusted_revenue > 0);
    for (const r of unmatched) {
      gaps.push({ gap_type: 'unmatched_bank', description: `No bank deposit match for ${r.guest_name} ($${r.adjusted_revenue})`, severity: 'info', expected_data: `Bank deposit ~$${r.adjusted_revenue}` });
    }

    if (gaps.length > 0) {
      await supabase.from('data_gaps').insert(gaps.map(g => ({ property_statement_id: stmt.id, ...g })));
    }

    return NextResponse.json({
      success: true,
      property: propConfig.name,
      month,
      summary: {
        reservations: processedReservations.length,
        total_revenue: totalRevenue,
        stripe_fees: totalStripeFees,
        management_fee: managementFee,
        cleaning_total: cleaningTotal,
        owner_payout: ownerPayout,
        confidence,
        data_gaps: gaps.length,
      },
      parsed_reservations: processedReservations,
      debug: { pdf_text_preview: pdfDebug, bank_rows_in_month: bankRows.filter(r => isInMonth(r['Posting Date'] || '', month)).length },
    });
  } catch (err) {
    console.error('Ingest error:', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : JSON.stringify(err) }, { status: 500 });
  }
}
