import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

/**
 * Fill a data gap on an existing property_statement without running the full
 * ingest. Unlike /api/ingest, this does NOT delete + rebuild the statement.
 * It patches specific fields derived from the one file being uploaded.
 *
 * Supported file_type values:
 *
 *   bank_csv:
 *     - re-parses cleaning charges + deposits for the statement month
 *     - recomputes cleaning_total + cleaning_events from scratch
 *     - re-runs the deposit-matching pass against existing reservations
 *     - updates owner_payout, has_bank_csv, confidence
 *     - removes the 'missing_bank_csv' gap and re-emits 'unmatched_bank'
 *       gaps with fresh status
 *
 *   platform_csv:
 *     - re-parses the platform CSV (confirmation code -> platform + guest)
 *     - for each existing reservation matched by confirmation_code:
 *         fills in guest_name when it was a placeholder,
 *         sets the correct platform, and
 *         recomputes stripe_fee + adjusted_revenue
 *     - recomputes rental_revenue, management_fee, owner_payout on the
 *       property_statement
 *     - updates has_platform_csv, confidence
 *     - removes 'no_platform_match' and 'unresolved_guest_names' gaps
 *     - upserts guesty_reservations rows so the CSV feeds the upcoming
 *       bookings panel as well (same shape /api/ingest writes)
 *
 * Guesty PDF is never required -- the reservations that were parsed from
 * it on the first ingest stay as-is.
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

// Mirror of /api/ingest's MAINTENANCE_VENDORS list. Keep in sync.
const MAINTENANCE_VENDORS: { name: string; matches: string[] }[] = [
  { name: 'Ian Drometer', matches: ['DROMETER'] },
];

function matchMaintenanceVendor(descUpper: string): string | null {
  for (const v of MAINTENANCE_VENDORS) {
    if (v.matches.some(m => descUpper.includes(m))) return v.name;
  }
  return null;
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

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

// Stripe fee: 3.9% + $0.20/txn, 2 txns per reservation = $0.40
// Stripe: 3.9% + $0.40 ($0.20 × 2 transactions) on the amount Stripe
// actually processed (the guest's top-line charge), not on Guesty's net.
function calcStripeFee(processedAmount: number): number {
  return round2(processedAmount * 0.039 + 0.40);
}

// Lenient number parse: "", " ", "$1,234.56" -> number or null.
function parseMoney(raw: string | undefined | null): number | null {
  if (raw == null) return null;
  const s = String(raw).replace(/[,$"\s]/g, '').trim();
  if (!s) return null;
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

/**
 * Back out the legacy 4.4% gross-up kludge embedded in Guesty's channel
 * commission column for pre-fix VRBO + Manual reservations. See the
 * twin helper in /api/ingest for the history. Returns the effective
 * commission after removing the kludge (0 for Manual, 5% × pre-tax for
 * VRBO) along with a flag so callers can note the adjustment.
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
    if (ratio > 0.02) return { effective: 0, hadKludge: true };
    return { effective: commission, hadKludge: false };
  }
  if (p.includes('HOMEAWAY') || p === 'VRBO') {
    if (ratio > 0.07) {
      return { effective: round2(base * 0.05), hadKludge: true };
    }
    return { effective: commission, hadKludge: false };
  }
  return { effective: commission, hadKludge: false };
}

function titleCase(s: string | null | undefined): string {
  if (!s) return '';
  return s.replace(/\b[\p{L}'’-]+/gu, w =>
    w.charAt(0).toLocaleUpperCase() + w.slice(1).toLocaleLowerCase()
  );
}

function looksLikeConfirmationCode(s: string | null | undefined): boolean {
  if (!s) return false;
  return /^(GY|HM)[- ]?[A-Za-z0-9]{6,}$/i.test(s.trim());
}

// Normalize platform: "airbnb2" -> "Airbnb", "HomeAway" -> "HomeAway",
// "bookingCom" -> "Booking.com", "direct"/"manual" -> "Manual".
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
 * Assign bank cleaning charges to reservations 1:1 so no single stay
 * ever claims multiple Cape Ann Elite charges, and so the *last*
 * checkout of the month pairs with the *last* cleaning of the month.
 *
 * Walk reservations in REVERSE check-out order. For each, claim the
 * latest still-unclaimed cleaning whose posting date is on/after that
 * check-out. Earlier checkouts cascade backward through the remaining
 * cleanings, each picking the latest option inside their own window.
 *
 * See /api/ingest for the algorithm's rationale. Duplicated here so
 * neither route drifts from the other on this accounting rule.
 */
function matchCleaningsToReservations<R extends { check_out: string; guest_name: string }>(
  cleaningCharges: { date: string; amount: number; description: string }[],
  reservations: R[],
): { charge: typeof cleaningCharges[number]; matchedGuest: string | null; matchedCheckout: string | null }[] {
  const withISO = cleaningCharges.map((c, origIdx) => ({
    c, origIdx, iso: isoFromMMDDYYYY(c.date),
  }));
  const sortedByDateDesc = [...withISO].sort((a, b) => b.iso.localeCompare(a.iso));
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

// ── platform_csv handler ────────────────────────────────────────────────────

type ExistingStmt = {
  id: string;
  property_id: string;
  property_name: string;
  rental_revenue: number;
  management_fee: number;
  management_fee_pct: number;
  cleaning_total: number;
  repairs_total: number;
  has_guesty_statement: boolean;
  has_platform_csv: boolean;
  has_bank_csv: boolean;
};

type ExistingReservation = {
  id: string;
  guest_name: string | null;
  confirmation_code: string;
  check_in: string;
  check_out: string;
  nights: number;
  platform: string | null;
  guesty_rental_income: number;
  stripe_fee: number | null;
  adjusted_revenue: number | null;
  bank_match_status: string | null;
  bank_deposit_amount: number | null;
};

async function fillPlatformGap(args: {
  stmt: ExistingStmt;
  reservations: ExistingReservation[];
  propertyId: string;
  file: File;
}) {
  const { stmt, reservations, propertyId, file } = args;

  // 1. Parse the platform CSV into a map keyed by confirmation code, and
  //    build the guesty_reservations upsert set (mirroring the shape
  //    /api/ingest writes so the upcoming-bookings panel benefits too).
  const text = await file.text();
  const rows = parseCSV(text);
  if (rows.length === 0) {
    return NextResponse.json({ error: 'Platform CSV appears empty or malformed' }, { status: 400 });
  }

  type CsvMatch = {
    platform: string;
    guest: string;
    total_paid: number | null;
    total_taxes: number | null;
    channel_commission: number | null;
    owner_net_revenue_guesty: number | null;
  };
  const platformMap = new Map<string, CsvMatch>();
  const guestyResUpserts: Record<string, string | number | null>[] = [];

  for (const row of rows) {
    const code = (row['CONFIRMATION CODE'] || row['Confirmation Code'] || row['confirmation_code'] || '').trim();
    const platform = (row['PLATFORM'] || row['Platform'] || row['platform'] || '').trim();
    const guest = (row['GUEST'] || row['Guest'] || row['guest'] || '').trim();
    const checkInRaw = (row['CHECK-IN'] || row['Check-In'] || row['check_in'] || '').trim();
    const checkOutRaw = (row['CHECK-OUT'] || row['Check-Out'] || row['check_out'] || '').trim();
    if (!code) continue;

    const totalPaid = parseMoney(row['TOTAL PAID']);
    const totalTaxes = parseMoney(row['TOTAL TAXES']);
    const channelCommission = parseMoney(row['CHANNEL COMMISSION INCL TAX']);
    const ownerNet = parseMoney(row['OWNER NET REVENUE (ACCOUNTING)']);

    platformMap.set(code, {
      platform,
      guest,
      total_paid: totalPaid,
      total_taxes: totalTaxes,
      channel_commission: channelCommission,
      owner_net_revenue_guesty: ownerNet,
    });

    const checkIn = checkInRaw.split(' ')[0];
    const checkOut = checkOutRaw.split(' ')[0];
    if (!checkIn || !checkOut) continue;
    const d1 = Date.parse(checkIn + 'T00:00:00');
    const d2 = Date.parse(checkOut + 'T00:00:00');
    if (isNaN(d1) || isNaN(d2)) continue;
    const nights = Math.max(0, Math.round((d2 - d1) / 86400_000));
    const normalizedChannel = normalizePlatform(platform);
    const cleanedGuest = guest && !looksLikeConfirmationCode(guest) ? titleCase(guest) : null;

    guestyResUpserts.push({
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
      total_paid: totalPaid,
      total_taxes: totalTaxes,
      channel_commission: channelCommission,
      owner_net_revenue_guesty: ownerNet,
    });
  }

  // 2. For each existing reservation: if the CSV has a row for its
  //    confirmation code, recompute platform + stripe fee + adjusted
  //    revenue and (when the stored name was a placeholder) fill in the
  //    real guest name. Reservations without a CSV match are left alone
  //    so we never regress a row the platform CSV doesn't mention.
  type ResChange = {
    id: string;
    prev: { guest: string | null; platform: string | null; adjusted: number | null };
    next: { guest: string; platform: string; stripe_fee: number; adjusted_revenue: number };
  };
  const changes: ResChange[] = [];
  let totalRevenue = 0;
  let stripeFeeTotal = 0;
  let matchedCount = 0;

  for (const res of reservations) {
    const match = platformMap.get(res.confirmation_code);
    if (!match) {
      // No CSV row for this reservation; keep its current adjusted revenue
      // in the running total so the statement math stays right.
      totalRevenue += res.adjusted_revenue || 0;
      stripeFeeTotal += res.stripe_fee || 0;
      continue;
    }
    matchedCount++;
    const normalizedPlatform = normalizePlatform(match.platform) || 'Unknown';
    const platformUpper = normalizedPlatform.toUpperCase();
    const isStripeChannel = platformUpper.includes('HOMEAWAY') || platformUpper === 'VRBO' || platformUpper === 'MANUAL';
    const isHomeownerStay = platformUpper === 'MANUAL' && (!res.guesty_rental_income || res.guesty_rental_income === 0);

    let stripeFee = 0;
    let adjustedRevenue = res.guesty_rental_income || 0;
    if (isHomeownerStay) {
      adjustedRevenue = 0;
    } else if (isStripeChannel) {
      // VRBO / Manual: reconstruct from guest gross (see /api/ingest for
      // the reasoning). Use CSV's TOTAL_PAID as the Stripe fee base.
      const totalPaid = match.total_paid || 0;
      const totalTaxes = match.total_taxes || 0;
      const rawCommission = match.channel_commission || 0;
      if (totalPaid > 0) {
        const { effective } = stripLegacyCommissionKludge({
          platform: normalizedPlatform,
          totalPaid, totalTaxes, commission: rawCommission,
        });
        stripeFee = calcStripeFee(totalPaid);
        adjustedRevenue = round2(totalPaid - totalTaxes - effective - stripeFee);
      } else {
        // CSV didn't carry TOTAL_PAID (older export shape). Fall back to
        // the old 3.9%-on-net approximation and leave a data gap below.
        stripeFee = calcStripeFee(res.guesty_rental_income || 0);
        adjustedRevenue = round2((res.guesty_rental_income || 0) - stripeFee);
      }
    }

    // Only overwrite guest_name when the stored value is a placeholder
    // (empty, confirmation code, or missing). If we already have a real
    // name from a prior sync, keep it.
    const priorName = (res.guest_name || '').trim();
    const priorIsPlaceholder = !priorName || looksLikeConfirmationCode(priorName);
    const csvName = titleCase(match.guest);
    const nextName = priorIsPlaceholder && csvName ? csvName : (priorName || csvName || 'Guest');

    changes.push({
      id: res.id,
      prev: { guest: res.guest_name, platform: res.platform, adjusted: res.adjusted_revenue },
      next: { guest: nextName, platform: normalizedPlatform, stripe_fee: stripeFee, adjusted_revenue: adjustedRevenue },
    });
    totalRevenue += adjustedRevenue;
    stripeFeeTotal += stripeFee;
  }

  totalRevenue = round2(totalRevenue);
  stripeFeeTotal = round2(stripeFeeTotal);

  // 3. Apply reservation updates one by one (PostgREST can't do per-row
  //    UPDATEs with different values in a single call, and writing to
  //    service role makes the UPDATE actually land).
  for (const c of changes) {
    await supabase
      .from('reservations')
      .update({
        guest_name: c.next.guest,
        platform: c.next.platform,
        stripe_fee: c.next.stripe_fee,
        adjusted_revenue: c.next.adjusted_revenue,
      })
      .eq('id', c.id);
  }

  // 4. Upsert the guesty_reservations rows so the upcoming-bookings panel
  //    has this CSV's future stays too. Don't stomp on rows that came
  //    from the Guesty API (those are authoritative); the upsert keys on
  //    guesty_reservation_id, and our CSV rows use a "csv:<code>" id so
  //    they never collide with API-sourced "<guesty_id>" rows for the
  //    same confirmation code.
  if (guestyResUpserts.length > 0) {
    await supabase
      .from('guesty_reservations')
      .upsert(guestyResUpserts, { onConflict: 'guesty_reservation_id' });
  }

  // 5. Recompute the statement totals. Management fee follows whatever
  //    totalRevenue now is; owner payout nets out cleaning + repairs
  //    (unchanged from the prior run, since platform CSV doesn't touch
  //    bank-sourced cleaning).
  const managementFee = round2(totalRevenue * (stmt.management_fee_pct / 100));
  const ownerPayout = round2(totalRevenue - managementFee - (stmt.cleaning_total || 0) - (stmt.repairs_total || 0));
  const numStays = reservations.filter(r => {
    const ch = changes.find(c => c.id === r.id);
    const adjusted = ch ? ch.next.adjusted_revenue : (r.adjusted_revenue || 0);
    return adjusted > 0;
  }).length;

  let confidence: 'red' | 'yellow' | 'green' = 'red';
  const hasGuesty = !!stmt.has_guesty_statement;
  const hasBank = !!stmt.has_bank_csv;
  if (hasGuesty && hasBank) confidence = 'green';
  else if (hasGuesty) confidence = 'yellow';

  await supabase
    .from('property_statements')
    .update({
      rental_revenue: totalRevenue,
      management_fee: managementFee,
      owner_payout: ownerPayout,
      num_stays: numStays,
      has_platform_csv: true,
      confidence,
    })
    .eq('id', stmt.id);

  // 6. Clear the gaps platform CSV resolves.
  await supabase
    .from('data_gaps')
    .delete()
    .eq('property_statement_id', stmt.id)
    .in('gap_type', ['no_platform_match', 'unresolved_guest_names']);

  return NextResponse.json({
    success: true,
    file_type: 'platform_csv',
    property: stmt.property_name,
    property_statement_id: stmt.id,
    summary: {
      rental_revenue: totalRevenue,
      management_fee: managementFee,
      owner_payout: ownerPayout,
      stripe_fee_total: stripeFeeTotal,
      reservations_total: reservations.length,
      reservations_matched_by_csv: matchedCount,
      confidence,
    },
    changes: changes.map(c => ({
      id: c.id,
      guest_before: c.prev.guest,
      guest_after: c.next.guest,
      platform_before: c.prev.platform,
      platform_after: c.next.platform,
      adjusted_revenue_before: c.prev.adjusted,
      adjusted_revenue_after: c.next.adjusted_revenue,
    })),
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
    if (fileType !== 'bank_csv' && fileType !== 'platform_csv') {
      return NextResponse.json(
        { error: `file_type '${fileType}' not supported. Accepted: 'bank_csv' or 'platform_csv'.` },
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
      .select('id, property_id, property_name, rental_revenue, management_fee, management_fee_pct, cleaning_total, repairs_total, has_guesty_statement, has_platform_csv, has_bank_csv')
      .eq('period_id', period.id)
      .eq('property_id', propertyId)
      .single();
    if (!stmt) {
      return NextResponse.json(
        { error: `No existing statement for ${propertyId} / ${month}. Run the full upload first.` },
        { status: 404 },
      );
    }

    // 2. Pull existing reservations so we can patch them in place.
    const { data: reservations } = await supabase
      .from('reservations')
      .select('id, guest_name, confirmation_code, check_in, check_out, nights, platform, guesty_rental_income, stripe_fee, adjusted_revenue, bank_match_status, bank_deposit_amount')
      .eq('property_statement_id', stmt.id);

    // Dispatch to the per-file-type handler.
    if (fileType === 'platform_csv') {
      return await fillPlatformGap({ stmt, reservations: reservations || [], propertyId, file });
    }
    // else bank_csv -- continues below with existing logic.

    // 3. Parse the bank CSV (same shape the main ingest expects).
    const bankText = await file.text();
    const bankRows = parseCSV(bankText);
    if (bankRows.length === 0) {
      return NextResponse.json({ error: 'Bank CSV appears empty or malformed' }, { status: 400 });
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

      if (descUpper.includes('CAPE ANN ELITE')) {
        if (isInMonth(date, month)) {
          cleaningCharges.push({ date, amount: Math.abs(amount), description: desc });
        }
        continue;
      }

      // Maintenance / repair vendors (Ian Drometer-style handyman charges).
      // Keep this list in sync with /api/ingest's MAINTENANCE_VENDORS.
      const vendor = matchMaintenanceVendor(descUpper);
      if (vendor) {
        if (isInMonth(date, month) && amount < 0) {
          repairCharges.push({ date, amount: Math.abs(amount), description: desc, vendor });
        }
        continue;
      }

      if (amount > 0) {
        let source = 'other';
        if (descUpper.includes('AIRBNB')) source = 'airbnb';
        else if (descUpper.includes('STRIPE')) source = 'stripe';
        else if (descUpper.includes('BOOKING.COM') || descUpper.includes('BOOKING COM')) source = 'booking';
        deposits.push({ date, amount, description: desc, source });
      }
    }

    const cleaningTotal = Math.round(cleaningCharges.reduce((sum, c) => sum + c.amount, 0) * 100) / 100;
    const repairsTotal = Math.round(repairCharges.reduce((sum, c) => sum + c.amount, 0) * 100) / 100;

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

    // 6. Rebuild cleaning_events + repair_events: the old ones were sourced
    //    from (probably absent) prior bank data. Wipe and re-insert from the
    //    fresh CSV.
    await supabase.from('cleaning_events').delete().eq('property_statement_id', stmt.id);
    // repair_events table may not exist if the migration hasn't run.
    const { error: repDelErr } = await supabase.from('repair_events').delete().eq('property_statement_id', stmt.id);
    if (repDelErr && repDelErr.code !== 'PGRST205' && !/does not exist|relation|Could not find the table/i.test(repDelErr.message || '')) throw repDelErr;

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

    if (repairCharges.length > 0) {
      const repairInserts = repairCharges.map(c => ({
        property_statement_id: stmt.id,
        vendor_name: c.vendor,
        description: c.description,
        bank_charge_date: isoFromMMDDYYYY(c.date) || null,
        bank_charge_amount: c.amount,
        source: 'bank',
      }));
      const { error: repErr } = await supabase.from('repair_events').insert(repairInserts);
      if (repErr && repErr.code !== 'PGRST205' && !/does not exist|relation|Could not find the table/i.test(repErr.message || '')) throw repErr;
      if (repErr) console.warn('repair_events insert skipped (table missing)');
    }

    // 7. Update the property_statements row with the new bank-derived fields.
    //    rental_revenue + management_fee are unchanged (those come from Guesty,
    //    which we haven't touched). cleaning_total + repairs_total change,
    //    owner_payout recomputes from both.
    const newOwnerPayout =
      Math.round(((stmt.rental_revenue || 0) - (stmt.management_fee || 0) - cleaningTotal - repairsTotal) * 100) / 100;

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
        repairs_total: repairsTotal,
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

    // Capture per-reservation changes so the client can show "Svetlana
    // Dukhon: unmatched -> matched ($859.36)" instead of opaque counts.
    const resChanges = resUpdates
      .map(u => {
        const res = (reservations || []).find(r => r.id === u.id);
        if (!res) return null;
        const prev = res.bank_match_status || 'unmatched';
        const next = u.bank_match_status;
        return {
          guest: res.guest_name || 'Guest',
          status_before: prev,
          status_after: next,
          deposit_amount: u.bank_deposit_amount,
          adjusted_revenue: res.adjusted_revenue,
          changed: prev !== next,
        };
      })
      .filter((c): c is NonNullable<typeof c> => c !== null);

    return NextResponse.json({
      success: true,
      file_type: 'bank_csv',
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
      changes: resChanges,
    });
  } catch (err) {
    console.error('fill-gap error:', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : JSON.stringify(err) }, { status: 500 });
  }
}
