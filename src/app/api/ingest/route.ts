import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { syncPropertyStripe, getStripeKeysMap, type StripeSyncResult } from '@/lib/stripe-sync';

// Service role so future UPDATEs don't silently no-op. Anon has
// INSERT/DELETE policies on reservations/cleaning_events/data_gaps but
// no UPDATE policy -- the current code only inserts-and-deletes so anon
// works today, but a future maintainer adding an UPDATE call would hit
// the same PostgREST-200-with-zero-rows-changed silent failure we saw
// in /api/fill-gap.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

// Property config (internal naming convention: address without suffix)
const PROPERTIES: Record<string, { name: string; owner: string; fee_pct: number; bank_last4: string }> = {
  '3_south_st': { name: '3 South', owner: 'Bailey', fee_pct: 25, bank_last4: '5622' },
  '21_horton': { name: '21 Horton', owner: 'Kittredge', fee_pct: 22, bank_last4: '1323' },
  '53_rocky_neck': { name: '53 Rocky Neck', owner: 'Prudenzi', fee_pct: 25, bank_last4: '9910' },
  '4_brier_neck': { name: '4 Brier Neck', owner: 'Armstrong', fee_pct: 20, bank_last4: '7876' },
  '30_woodward': { name: '30 Woodward', owner: 'McWethy', fee_pct: 25, bank_last4: '8221' },
  '20_hammond': { name: '20 Hammond', owner: 'Ramsey', fee_pct: 25, bank_last4: '9969' },
  '20_enon': { name: '20 Enon', owner: 'Snyder', fee_pct: 25, bank_last4: '1307' },
  '73_rocky_neck': { name: '73 Rocky Neck', owner: 'Moynahan', fee_pct: 25, bank_last4: '3227' },
  '17_beach_rd': { name: '17 Beach', owner: 'Nolan', fee_pct: 22, bank_last4: '5621' },
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

// Stripe fee: 3.9% + $0.20/txn, 2 txns per reservation = $0.40.
// The processor charges on the processed amount -- i.e. what the guest
// paid, not on Guesty's net rental income. For channels where Rising
// Tide's Stripe account processes the card (VRBO + Manual), the base is
// TOTAL PAID from the reservations CSV. For Airbnb/Booking.com the
// channel processes payment so this fee doesn't apply on our side.
function calcStripeFee(processedAmount: number): number {
  return Math.round((processedAmount * 0.039 + 0.40) * 100) / 100;
}

/**
 * Detect and strip the legacy 4.4% gross-up kludge that used to live in
 * the CHANNEL COMMISSION column of the Guesty reservations report.
 *
 * Before the accounting overhaul, Ryan/Dotti added a 4.4% fee to the
 * channel commission in Guesty so Guesty's Owner Statement PDF would
 * approximate the real post-Stripe owner net (because 3.9% on gross is
 * roughly 4.4% on the pre-Stripe net). The commissions in Guesty have
 * been corrected going forward, but historical reservations (anything
 * checked in before the fix landed) still carry the inflated value.
 *
 * For **Manual** rows: real commission is 0, so any commission > ~2% of
 * (TOTAL_PAID - TAXES) is legacy. Treat as 0.
 *
 * For **VRBO** rows: real commission is 5%, so a value > ~7% of
 * (TOTAL_PAID - TAXES) has the 4.4% kludge stacked on top. Subtract 4.4%
 * to recover the real 5% component.
 *
 * Returns a safe effective_commission plus whether a legacy adjustment
 * was applied so we can flag it in the statement audit trail.
 */
function stripLegacyCommissionKludge(args: {
  platform: string;
  totalPaid: number;
  totalTaxes: number;
  commission: number;
}): { effective: number; hadKludge: boolean } {
  const { platform, totalPaid, totalTaxes, commission } = args;
  if (!commission || commission <= 0) return { effective: 0, hadKludge: false };
  const base = Math.max(totalPaid - totalTaxes, 0);
  if (base <= 0) return { effective: commission, hadKludge: false };
  const ratio = commission / base;
  const p = platform.toUpperCase();
  if (p === 'MANUAL') {
    // Real Manual commission = 0. Anything above 2% ratio is kludge.
    if (ratio > 0.02) return { effective: 0, hadKludge: true };
    return { effective: commission, hadKludge: false };
  }
  if (p.includes('HOMEAWAY') || p === 'VRBO') {
    // Real VRBO commission = 5% of (TOTAL_PAID - TAXES). Above 7% = kludge.
    if (ratio > 0.07) {
      const cleaned = Math.round(base * 0.05 * 100) / 100;
      return { effective: cleaned, hadKludge: true };
    }
    return { effective: commission, hadKludge: false };
  }
  // Airbnb / Booking.com: commission handled by the channel, never kludged.
  return { effective: commission, hadKludge: false };
}

// Title-case a guest name: "julie polvinen" -> "Julie Polvinen"
function titleCase(s: string | null | undefined): string {
  if (!s) return '';
  return s.replace(/\b[\p{L}'’-]+/gu, w =>
    w.charAt(0).toLocaleUpperCase() + w.slice(1).toLocaleLowerCase()
  );
}

// Anything starting with GY-/HM followed by a string of letters+digits is a
// Guesty / Airbnb reservation code, not a real name.
function looksLikeConfirmationCode(s: string | null | undefined): boolean {
  if (!s) return false;
  return /^(GY|HM)[- ]?[A-Za-z0-9]{6,}$/i.test(s.trim());
}

// Normalize platform strings coming from the Guesty Platform CSV ("Airbnb",
// "HomeAway", "Manual", "Booking.com") vs. sync-API ("airbnb2", "homeaway2",
// "bookingCom", "manual").
function normalizePlatform(raw?: string | null): string | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!s) return null;
  const l = s.toLowerCase();
  if (l.startsWith('airbnb')) return 'Airbnb';
  if (l.startsWith('homeaway') || l === 'vrbo') return 'HomeAway';
  if (l === 'bookingcom' || l.startsWith('booking')) return 'Booking.com';
  if (l === 'direct' || l === 'manual') return 'Manual';
  if (l === 'unknown') return null;
  return s;
}

/**
 * Recurring maintenance / repair vendors. Bank ingest scans descriptions for
 * any of these matchers and tags them with the canonical name. New vendors
 * (plumber, electrician, landscaper, etc.) get added here.
 *
 * Match strings are upper-cased substrings.
 */
const MAINTENANCE_VENDORS: { name: string; matches: string[] }[] = [
  { name: 'Ian Drometer', matches: ['DROMETER'] },
  // Morris Heating & Air -- HVAC service contract for the rentals.
  // Bank descriptor truncates to "Morris Heating &" so we match on the
  // shorter unambiguous prefix.
  { name: 'Morris Heating & Air', matches: ['MORRIS HEATING'] },
];

function matchMaintenanceVendor(descUpper: string): string | null {
  for (const v of MAINTENANCE_VENDORS) {
    if (v.matches.some(m => descUpper.includes(m))) return v.name;
  }
  return null;
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

/**
 * Assign bank cleaning charges to reservations 1:1 so no single stay
 * ever claims multiple Cape Ann Elite charges, and so the *last*
 * checkout of the month pairs with the *last* cleaning of the month.
 *
 * Walk reservations in REVERSE check-out order. For each, claim the
 * latest still-unclaimed cleaning whose posting date is on/after that
 * check-out. Then cascade backward: earlier checkouts get what's left,
 * each also claiming the latest available option inside their own
 * window.
 *
 * Why this direction? Cape Ann Elite bills cleanings with variable lag
 * (1-10+ days). When there are N checkouts and fewer cleanings visible
 * in the month, the late checkouts are the ones whose cleanings most
 * likely *did* post in-month (short lag), while the earliest checkouts
 * may have had their cleaning bundled into a same-day turnover or
 * billed at a longer lag. Matching last-to-last captures that reality.
 *
 * The old "walk forward, claim earliest" direction gave later checkouts
 * nothing while assigning their likely-correct cleaning to an earlier
 * stay whose cleaning actually posted earlier.
 *
 * Leftover cleanings stay unattributed (source='bank'). Reservations
 * that don't get a cleaning in this month are fine -- theirs will
 * typically appear in the next month's ingest.
 */
function matchCleaningsToReservations<R extends { check_out: string; guest_name: string }>(
  cleaningCharges: { date: string; amount: number; description: string }[],
  reservations: R[],
): { charge: typeof cleaningCharges[number]; matchedGuest: string | null; matchedCheckout: string | null }[] {
  const toISO = (d: string) => {
    const parts = d.split('/');
    if (parts.length !== 3) return '';
    return `${parts[2]}-${parts[0].padStart(2, '0')}-${parts[1].padStart(2, '0')}`;
  };
  const withISO = cleaningCharges.map((c, origIdx) => ({
    c, origIdx, iso: toISO(c.date),
  }));
  // Cleanings ordered LATEST first so we can pick the latest unclaimed
  // in range with a simple scan.
  const sortedByDateDesc = [...withISO].sort((a, b) => b.iso.localeCompare(a.iso));
  // Reservations ordered LATEST check-out first.
  const sortedResDesc = [...reservations].sort((a, b) => b.check_out.localeCompare(a.check_out));

  const claimedIdx = new Set<number>();
  const assignment = new Map<number, R>();  // origIdx -> reservation

  for (const res of sortedResDesc) {
    for (const { origIdx, iso } of sortedByDateDesc) {
      if (claimedIdx.has(origIdx)) continue;
      if (!iso) continue;
      if (iso < res.check_out) continue;  // cleaning predates this checkout
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
    const guestyReservationUpserts: Record<string, string | number | null>[] = [];
    if (platformCSVFile) {
      const platformText = await platformCSVFile.text();
      const platformRows = parseCSV(platformText);
      for (const row of platformRows) {
        const code = (row['CONFIRMATION CODE'] || row['Confirmation Code'] || row['confirmation_code'] || '').trim();
        const platform = (row['PLATFORM'] || row['Platform'] || row['platform'] || '').trim();
        const guest = (row['GUEST'] || row['Guest'] || row['guest'] || '').trim();
        const checkInRaw = (row['CHECK-IN'] || row['Check-In'] || row['check_in'] || '').trim();
        const checkOutRaw = (row['CHECK-OUT'] || row['Check-Out'] || row['check_out'] || '').trim();
        if (!code) continue;

        platformMap[code] = { platform, guest };

        // Also queue a guesty_reservations upsert so the reservations feed
        // stays populated from whichever entry path the user chose.
        const checkIn = checkInRaw.split(' ')[0];
        const checkOut = checkOutRaw.split(' ')[0];
        if (!checkIn || !checkOut) continue;
        const d1 = new Date(checkIn + 'T00:00:00');
        const d2 = new Date(checkOut + 'T00:00:00');
        const nights = Math.max(0, Math.round((d2.getTime() - d1.getTime()) / 86400_000));
        const normalizedChannel = normalizePlatform(platform);
        const cleanedGuest = guest && !looksLikeConfirmationCode(guest) ? titleCase(guest) : null;

        guestyReservationUpserts.push({
          guesty_reservation_id: `csv:${code}`,
          property_id: propertyId,
          confirmation_code: code,
          guest_name: cleanedGuest,
          check_in: checkIn,
          check_out: checkOut,
          nights,
          channel: normalizedChannel,
          guesty_channel_id: platform || null,
          status: 'confirmed',
          source: 'csv-fallback',
          synced_at: new Date().toISOString(),
        });
      }

      // Persist guesty_reservations upserts (don't stomp on rows that came
      // from /v1/reservations API sync, which is authoritative).
      if (guestyReservationUpserts.length > 0) {
        const codesToCheck = guestyReservationUpserts
          .map(r => r.confirmation_code)
          .filter(Boolean) as string[];
        const { data: apiRows } = await supabase
          .from('guesty_reservations')
          .select('confirmation_code')
          .eq('source', 'guesty-api')
          .in('confirmation_code', codesToCheck);
        const apiSet = new Set((apiRows || []).map(r => r.confirmation_code));
        const filtered = guestyReservationUpserts.filter(
          r => typeof r.confirmation_code === 'string' && !apiSet.has(r.confirmation_code as string),
        );
        if (filtered.length > 0) {
          await supabase
            .from('guesty_reservations')
            .upsert(filtered, { onConflict: 'guesty_reservation_id' });
        }
      }
    }

    // Redundant guest-name + platform resolution. Waterfall through:
    //   1. Platform CSV (uploaded this request)
    //   2. guesty_reservations table (populated by Upload Guesty CSV or API sync)
    //   3. Leave null -- statement page will try to enrich at render time.
    //      NEVER use confirmation_code as a pseudo-name.
    const codes = reservations.map(r => r.confirmation_code).filter(Boolean);
    type GuestyLookup = {
      guest_name: string | null;
      channel: string | null;
      guesty_channel_id: string | null;
      total_paid: number | null;
      total_taxes: number | null;
      channel_commission: number | null;
      owner_net_revenue_guesty: number | null;
    };
    const guestyLookupMap = new Map<string, GuestyLookup>();
    if (codes.length > 0) {
      const { data: guestyRows } = await supabase
        .from('guesty_reservations')
        .select('confirmation_code, guest_name, channel, guesty_channel_id, total_paid, total_taxes, channel_commission, owner_net_revenue_guesty')
        .in('confirmation_code', codes);
      (guestyRows || []).forEach(r => {
        if (r.confirmation_code) guestyLookupMap.set(r.confirmation_code, r);
      });
    }

    const unresolvedNameCodes: string[] = [];
    for (const res of reservations) {
      const platformInfo = platformMap[res.confirmation_code];
      const guestyInfo = guestyLookupMap.get(res.confirmation_code);
      const rawName = (platformInfo?.guest?.trim() || guestyInfo?.guest_name?.trim() || '');
      if (rawName && !looksLikeConfirmationCode(rawName)) {
        res.guest_name = titleCase(rawName);
      } else {
        res.guest_name = '';
        unresolvedNameCodes.push(res.confirmation_code);
      }
    }

    // 3. Parse bank CSV
    // Cleaning charges: filter to selected month only
    // Deposits: search ALL dates (deposits can arrive before/after the stay month)
    let bankRows: Record<string, string>[] = [];
    if (bankCSVFile) {
      const bankText = await bankCSVFile.text();
      bankRows = parseCSV(bankText);
    }

    const cleaningCharges: { date: string; amount: number; description: string }[] = [];
    const repairCharges: { date: string; amount: number; description: string; vendor: string }[] = [];
    const deposits: { date: string; amount: number; description: string; source: string }[] = [];

    for (const row of bankRows) {
      const desc = row['Description'] || row['DESCRIPTION'] || '';
      const amountStr = row['Amount'] || row['AMOUNT'] || '0';
      const date = row['Posting Date'] || row['DATE'] || row['Post Date'] || '';
      const amount = parseFloat(amountStr.replace(/[,$]/g, '')) || 0;
      const descUpper = desc.toUpperCase();

      // Cleaning charges: month-filtered only
      if (descUpper.includes('CAPE ANN ELITE')) {
        if (isInMonth(date, month)) {
          cleaningCharges.push({ date, amount: Math.abs(amount), description: desc });
        }
        continue;
      }

      // Maintenance / repair vendor matches. Recurring property handymen,
      // plumbers, etc. Always a DEBIT (negative amount). Add to MAINTENANCE_VENDORS
      // when new vendors come up.
      const vendor = matchMaintenanceVendor(descUpper);
      if (vendor) {
        if (isInMonth(date, month) && amount < 0) {
          repairCharges.push({ date, amount: Math.abs(amount), description: desc, vendor });
        }
        continue;
      }

      if (amount > 0) {
        // Deposits: collect ALL dates for cross-month matching
        let source = 'other';
        if (descUpper.includes('AIRBNB')) source = 'airbnb';
        else if (descUpper.includes('STRIPE')) source = 'stripe';
        else if (descUpper.includes('BOOKING.COM') || descUpper.includes('BOOKING COM')) source = 'booking';
        deposits.push({ date, amount, description: desc, source });
      }
    }

    const cleaningTotal = Math.round(cleaningCharges.reduce((sum, c) => sum + c.amount, 0) * 100) / 100;
    const repairsTotal = Math.round(repairCharges.reduce((sum, c) => sum + c.amount, 0) * 100) / 100;

    // 4. Process reservations with channel logic.
    //
    // Revenue reconstruction (post-accounting-overhaul):
    //
    //   Airbnb / Booking.com -- channel processes the guest payment and
    //     forwards a net ACH. Guesty's PDF rental_income == that deposit.
    //     adjusted_revenue = rental_income, stripe_fee = 0.
    //
    //   VRBO / Manual -- Rising Tide's Stripe account processes the card.
    //     Guesty reports rental_income *before* Stripe fees but *after*
    //     channel commission + taxes. So we rebuild from the guest gross:
    //         stripe_fee = TOTAL_PAID * 0.039 + 0.40
    //         adjusted_revenue = TOTAL_PAID - TAXES - commission - stripe_fee
    //     where commission is post-legacy-kludge (see stripLegacyCommissionKludge).
    //     Falls back to the old rental_income-based approximation when the
    //     guesty_reservations row doesn't have TOTAL_PAID (e.g. older CSV
    //     exports) -- a data gap is raised so we know to re-upload.
    //
    //   Homeowner stay (Manual + rental_income == 0): always adjusted=0.
    let totalRevenue = 0;
    let totalStripeFees = 0;
    const reconciliationGaps: string[] = [];
    const missingGrossCodes: string[] = [];
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
      const guestyInfo = guestyLookupMap.get(res.confirmation_code);
      // Platform waterfall: platform CSV -> guesty_reservations -> 'Unknown'
      const platform =
        normalizePlatform(platformInfo?.platform) ||
        normalizePlatform(guestyInfo?.guesty_channel_id) ||
        normalizePlatform(guestyInfo?.channel) ||
        'Unknown';
      const platformUpper = platform.toUpperCase();
      const isStripeChannel = platformUpper.includes('HOMEAWAY') || platformUpper.includes('VRBO') || platformUpper === 'MANUAL';
      const isHomeownerStay = platformUpper === 'MANUAL' && (!res.rental_income || res.rental_income === 0);

      let stripeFee = 0;
      let adjustedRevenue = res.rental_income;

      if (isHomeownerStay) {
        adjustedRevenue = 0;
      } else if (isStripeChannel) {
        // Prefer the reconstructed formula using TOTAL_PAID from the
        // Guesty reservations CSV.
        const totalPaid = guestyInfo?.total_paid ?? null;
        const totalTaxes = guestyInfo?.total_taxes ?? 0;
        const rawCommission = guestyInfo?.channel_commission ?? 0;
        if (totalPaid && totalPaid > 0) {
          const { effective: effCommission, hadKludge } = stripLegacyCommissionKludge({
            platform,
            totalPaid,
            totalTaxes,
            commission: rawCommission,
          });
          stripeFee = calcStripeFee(totalPaid);
          adjustedRevenue = Math.round((totalPaid - totalTaxes - effCommission - stripeFee) * 100) / 100;
          // Reconciliation: compare our reconstructed net to Guesty's implied
          // rental income (gross - taxes - raw commission). If they differ by
          // more than $2 it usually means the kludge detection got it wrong
          // or Guesty's commission field includes something unexpected.
          const guestyImpliedNet = Math.round((totalPaid - totalTaxes - rawCommission) * 100) / 100;
          const ourPreStripeNet = Math.round((totalPaid - totalTaxes - effCommission) * 100) / 100;
          const drift = Math.abs(ourPreStripeNet - guestyImpliedNet);
          if (!hadKludge && drift > 2) {
            reconciliationGaps.push(
              `${res.confirmation_code}: reconstructed pre-Stripe net ($${ourPreStripeNet}) differs from Guesty net ($${guestyImpliedNet}) by $${drift.toFixed(2)}`,
            );
          }
        } else {
          // Fallback: no TOTAL_PAID available. Use the old approximation
          // (Stripe fee on Guesty's rental_income) and flag it so the
          // user knows to upload an updated reservations CSV.
          stripeFee = calcStripeFee(res.rental_income);
          adjustedRevenue = Math.round((res.rental_income - stripeFee) * 100) / 100;
          if (res.confirmation_code) missingGrossCodes.push(res.confirmation_code);
        }
      }

      // Bank deposit matching
      // Airbnb: 1:1 match by amount (within $5) across all dates, prefer dates near check-in
      // Stripe (VRBO/Direct): Stripe batches multiple reservations into single transfers,
      //   so 1:1 matching is impossible. Mark as "stripe_covered" if any Stripe deposits exist
      //   around the reservation dates.
      // Booking.com: Uses their own payout schedule, mark as "booking_pending" unless exact match found
      let bankMatch: { amount: number; status: string } = { amount: 0, status: 'unmatched' };

      const isBooking = platform.toUpperCase().includes('BOOKING');

      if (!isHomeownerStay && adjustedRevenue > 0) {
        if (!isStripeChannel && !isBooking) {
          // Airbnb: search ALL deposits for 1:1 amount match (within $5)
          // Airbnb pays per reservation, usually around check-in date
          // Prefer deposits closest to check-in date
          const targetAmount = res.rental_income;
          const checkInDate = new Date(res.check_in + 'T00:00:00');

          let bestIdx = -1;
          let bestDist = Infinity;
          for (let i = 0; i < deposits.length; i++) {
            const d = deposits[i];
            if (d.source !== 'airbnb' && d.source !== 'other') continue;
            if (Math.abs(d.amount - targetAmount) >= 5) continue;
            // Parse deposit date (MM/DD/YYYY)
            const parts = d.date.split('/');
            if (parts.length === 3) {
              const depDate = new Date(`${parts[2]}-${parts[0].padStart(2, '0')}-${parts[1].padStart(2, '0')}T00:00:00`);
              const dist = Math.abs(depDate.getTime() - checkInDate.getTime());
              if (dist < bestDist) { bestDist = dist; bestIdx = i; }
            } else if (bestIdx === -1) {
              bestIdx = i; // fallback if date parse fails
            }
          }

          if (bestIdx >= 0) {
            bankMatch = { amount: deposits[bestIdx].amount, status: 'matched' };
            deposits.splice(bestIdx, 1);
          }
        } else if (isStripeChannel) {
          // VRBO/Direct: Stripe batches deposits, can't do 1:1 matching.
          // Check if any Stripe deposits exist in the CSV at all -- if so, mark as covered.
          const hasStripeDeposits = deposits.some(d => d.source === 'stripe');
          if (hasStripeDeposits) {
            bankMatch = { amount: adjustedRevenue, status: 'matched' };
          }
        } else if (isBooking) {
          // Booking.com: Try exact 1:1 match first, otherwise check for Booking credits
          const exactIdx = deposits.findIndex(d =>
            (d.source === 'booking' || d.source === 'other') &&
            Math.abs(d.amount - res.rental_income) < 5
          );
          if (exactIdx >= 0) {
            bankMatch = { amount: deposits[exactIdx].amount, status: 'matched' };
            deposits.splice(exactIdx, 1);
          } else {
            // Booking.com often handles payouts internally; mark as covered if we see
            // any Booking.com activity (debits for commissions mean they're managing the property)
            const hasBookingActivity = bankRows.some(r => {
              const d = r['Description'] || '';
              return d.toUpperCase().includes('BOOKING.COM') || d.toUpperCase().includes('BOOKING COM');
            });
            if (hasBookingActivity) {
              bankMatch = { amount: res.rental_income, status: 'matched' };
            }
          }
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
    const ownerPayout = Math.round((totalRevenue - managementFee - cleaningTotal - repairsTotal) * 100) / 100;

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
      // repair_events table may not exist yet if the migration hasn't run.
      // Tolerate that and continue -- repairs flow degrades gracefully until
      // supabase-schema-repairs.sql lands.
      const { error: repDelErr } = await supabase.from('repair_events').delete().eq('property_statement_id', existingStmt.id);
      if (repDelErr && repDelErr.code !== 'PGRST205' && !/does not exist|relation|Could not find the table/i.test(repDelErr.message || '')) throw repDelErr;
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
        repairs_total: repairsTotal,
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
        .insert(processedReservations.map(r => ({
          property_statement_id: stmt.id,
          property_id: propertyId,
          ...r,
        })));
      if (resErr) throw resErr;
    }

    // 11. Insert cleaning events -- match to reservation checkouts (1:1 greedy
    //     assignment; see matchCleaningsToReservations for the algorithm.)
    if (cleaningCharges.length > 0) {
      const toISO = (d: string) => {
        const parts = d.split('/');
        if (parts.length !== 3) return '';
        return `${parts[2]}-${parts[0].padStart(2, '0')}-${parts[1].padStart(2, '0')}`;
      };
      const cleaningInserts = matchCleaningsToReservations(cleaningCharges, processedReservations).map(m => ({
        property_statement_id: stmt.id,
        guest_name: m.matchedGuest,
        checkout_date: m.matchedCheckout,
        bank_charge_amount: m.charge.amount,
        bank_charge_date: toISO(m.charge.date) || null,
        amount: m.charge.amount,
        source: m.matchedGuest ? 'matched' : 'bank',
      }));

      const { error: cleanErr } = await supabase
        .from('cleaning_events')
        .insert(cleaningInserts);
      if (cleanErr) throw cleanErr;
    }

    // 11b. Insert repair events (handyman / vendor charges from the bank).
    // Tolerates the migration not having run yet.
    if (repairCharges.length > 0) {
      const repairInserts = repairCharges.map(c => {
        const parts = c.date.split('/');
        const iso = parts.length === 3 ? `${parts[2]}-${parts[0].padStart(2, '0')}-${parts[1].padStart(2, '0')}` : null;
        return {
          property_statement_id: stmt.id,
          vendor_name: c.vendor,
          description: c.description,
          bank_charge_date: iso,
          bank_charge_amount: c.amount,
          source: 'bank',
        };
      });
      const { error: repErr } = await supabase
        .from('repair_events')
        .insert(repairInserts);
      if (repErr && repErr.code !== 'PGRST205' && !/does not exist|relation|Could not find the table/i.test(repErr.message || '')) throw repErr;
      if (repErr) console.warn('repair_events insert skipped (table missing -- run supabase-schema-repairs.sql)');
    }

    // 12. Data gap flags
    const gaps: { gap_type: string; description: string; severity: string; expected_data: string }[] = [];
    if (!hasGuesty) gaps.push({ gap_type: 'missing_guesty', description: 'No Guesty owner statement provided', severity: 'critical', expected_data: `Guesty owner statement for ${propConfig.name} - ${month}` });
    if (!hasPlatform) gaps.push({ gap_type: 'no_platform_match', description: 'No platform CSV -- cannot determine booking channels', severity: 'warning', expected_data: `Platform CSV from Guesty for ${month}` });
    if (!hasBank) gaps.push({ gap_type: 'missing_bank_csv', description: 'No bank statement for deposit/cleaning verification', severity: 'warning', expected_data: `Chase bank CSV for ...${propConfig.bank_last4}` });

    if (unresolvedNameCodes.length > 0) {
      gaps.push({
        gap_type: 'unresolved_guest_names',
        description: `${unresolvedNameCodes.length} reservation${unresolvedNameCodes.length === 1 ? '' : 's'} couldn't resolve a guest name from the platform CSV or guesty_reservations table`,
        severity: 'warning',
        expected_data: `Upload the Guesty reservations CSV (covers ${unresolvedNameCodes.join(', ')})`,
      });
    }

    const unmatched = processedReservations.filter(r => r.bank_match_status === 'unmatched' && r.adjusted_revenue > 0);
    for (const r of unmatched) {
      // Check if the checkout is recent (within 7 days of now) -- likely just pending
      const checkoutDate = new Date(r.check_out + 'T00:00:00');
      const daysSinceCheckout = (Date.now() - checkoutDate.getTime()) / (1000 * 60 * 60 * 24);
      const isPending = daysSinceCheckout < 7;
      gaps.push({
        gap_type: 'unmatched_bank',
        description: isPending
          ? `Deposit pending for ${r.guest_name} ($${r.adjusted_revenue}) -- checkout was recent`
          : `No bank deposit match for ${r.guest_name} ($${r.adjusted_revenue})`,
        severity: isPending ? 'info' : 'warning',
        expected_data: `Bank deposit ~$${r.adjusted_revenue}`,
      });
    }

    // Revenue reconstruction gaps:
    //  - missing_guest_gross: one or more VRBO/Manual reservations don't
    //    have TOTAL_PAID in guesty_reservations, so Stripe fee fell back
    //    to the old approximation on Guesty's net. Usually fixes itself
    //    after a fresh Upload Reservations CSV run.
    //  - revenue_reconciliation: our reconstructed pre-Stripe net for a
    //    VRBO/Manual stay diverges from Guesty's implied net by >$2.
    //    Worth a manual look -- sometimes a booking had a discount,
    //    refund, or unusual commission that our formula didn't model.
    if (missingGrossCodes.length > 0) {
      gaps.push({
        gap_type: 'missing_guest_gross',
        description: `${missingGrossCodes.length} VRBO/Manual reservation${missingGrossCodes.length === 1 ? '' : 's'} missing TOTAL_PAID. Stripe fee fell back to a 3.9% approximation on Guesty's net, which slightly understates the real fee.`,
        severity: 'warning',
        expected_data: `Upload the latest Guesty reservations CSV (covers ${missingGrossCodes.join(', ')})`,
      });
    }
    if (reconciliationGaps.length > 0) {
      gaps.push({
        gap_type: 'revenue_reconciliation',
        description: `Revenue reconstruction drifts from Guesty's implied net on ${reconciliationGaps.length} stay${reconciliationGaps.length === 1 ? '' : 's'}. Probably a discount, refund, or non-standard commission.`,
        severity: 'info',
        expected_data: reconciliationGaps.join('; '),
      });
    }

    if (gaps.length > 0) {
      await supabase.from('data_gaps').insert(gaps.map(g => ({ property_statement_id: stmt.id, ...g })));
    }

    // 13. Auto-sync Stripe for this property. Replaces our formula-estimated
    //     stripe_fee values with the real numbers from balance_transaction.fee
    //     so the operator never sees an estimate after upload. Only runs for
    //     properties whose restricted Stripe key is configured in
    //     STRIPE_KEYS_JSON; properties without a key (Airbnb-only listings,
    //     pre-Stripe-onboarding rentals) silently skip.
    //
    //     A sync failure here doesn't fail the ingest. The estimates we
    //     wrote in step 9 still stand, the operator can hit the explicit
    //     "Sync Stripe" button on the dashboard, and we surface the error
    //     in the response so the upload page can show it.
    type PostSyncTotals = { rental_revenue: number; management_fee: number; owner_payout: number };
    let stripeSync: StripeSyncResult | null = null;
    let postSyncTotals: PostSyncTotals | null = null;
    const stripeKey = getStripeKeysMap()[propertyId];
    if (stripeKey) {
      try {
        stripeSync = await syncPropertyStripe({
          supabase,
          propertyId,
          restrictedKey: stripeKey,
          month,
          stmt: {
            id: stmt.id,
            management_fee_pct: propConfig.fee_pct,
            cleaning_total: cleaningTotal,
            repairs_total: repairsTotal,
          },
        });
        if (stripeSync.fee_updates.length > 0) {
          // Sync just rewrote rental_revenue/management_fee/owner_payout.
          // Refetch so the response summary shows the post-sync numbers,
          // not the pre-sync estimates.
          const { data: refreshed } = await supabase
            .from('property_statements')
            .select('rental_revenue, management_fee, owner_payout')
            .eq('id', stmt.id)
            .single();
          if (refreshed) postSyncTotals = refreshed as PostSyncTotals;
        }
      } catch (err) {
        console.warn('Stripe auto-sync failed:', err);
        stripeSync = {
          property_id: propertyId,
          charges_found: 0, matched: 0,
          unmatched_charges: [], fee_updates: [], refunds_detected: [],
          gross_mismatches: [], reservations_missing_charge: [],
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }

    return NextResponse.json({
      success: true,
      property: propConfig.name,
      month,
      property_statement_id: stmt.id,
      summary: {
        reservations: processedReservations.length,
        total_revenue: postSyncTotals?.rental_revenue ?? totalRevenue,
        stripe_fees: totalStripeFees,
        management_fee: postSyncTotals?.management_fee ?? managementFee,
        cleaning_total: cleaningTotal,
        owner_payout: postSyncTotals?.owner_payout ?? ownerPayout,
        confidence,
        data_gaps: gaps.length + (stripeSync?.refunds_detected.length || 0) + (stripeSync?.gross_mismatches.length || 0) + (stripeSync?.reservations_missing_charge.length || 0),
      },
      stripe_sync: stripeSync,
      parsed_reservations: processedReservations,
      debug: { pdf_text_preview: pdfDebug, bank_rows_in_month: bankRows.filter(r => isInMonth(r['Posting Date'] || '', month)).length },
    });
  } catch (err) {
    console.error('Ingest error:', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : JSON.stringify(err) }, { status: 500 });
  }
}
