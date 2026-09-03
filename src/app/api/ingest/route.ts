import { NextRequest, NextResponse } from 'next/server';
import { matchProperty, loadListingMatches } from '@/lib/listing-match';
import { reportMissingStripeKey, syncPropertyStripe, getStripeKeysMap, type StripeSyncResult } from '@/lib/stripe-sync';
import { cachePlatformCSV, loadCachedPlatformCSVText } from '@/lib/platform-csv-cache';
import { classifyBankRow, insertCleaningEvents, LINEN_VENDOR_NAME, LAUNDRY_VENDOR_NAME, CLEANING_VENDOR_DEFAULT, parseInternalTransfer, TAX_REMITTANCE_ACCOUNT, RT_OPERATING_ACCOUNT } from '@/lib/bank-charges';
import { classifyInternalTransfers, remittanceMonthFor, type SweepExpectations, type SweepVerdict, type TransferCandidate } from '@/lib/internal-transfers';
import { buildRemittanceSheet } from '@/lib/remittance';
import { getActivePropertyForStatements } from '@/lib/properties';
import { loadInstallmentsForMonth, loadInstallmentsForCode, loadInstallmentsForCodes, type Installment } from '@/lib/installments';
import { checkLiveGuestyStatus, isCancelledStatus } from '@/lib/cancel-check';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import { assertStatementWritable, StatementFrozenError, frozenResponseBody } from '@/lib/statement-finality';
import { writeStatementTotals, type FreezeReceipt } from '@/lib/statement-totals-write';
import { loadAddOnTotals } from '@/lib/statement-addons';
import { detectMissingDirectStays, missingDirectGapRows } from '@/lib/missing-direct-stays';
import { splitFolio } from '@/lib/remittance';

// Service role so future UPDATEs don't silently no-op. Anon has
// INSERT/DELETE policies on reservations/cleaning_events/data_gaps but
// no UPDATE policy -- the current code only inserts-and-deletes so anon
// works today, but a future maintainer adding an UPDATE call would hit
// the same PostgREST-200-with-zero-rows-changed silent failure we saw
// in /api/fill-gap.

// Property config is now sourced from public.properties at the start of
// each POST (see getActivePropertyForStatements). Promoting a prospect
// in Helm is sufficient to make the new property eligible for monthly
// statement ingest — no code edit + redeploy required.

// Parse Guesty Owner Statement PDF text into reservations
// pdf-parse v1 concatenates fields without spaces, e.g.:
// "Rental payment for HM33A9MBBRRental Income$1,338.48"
//
// Multi-property owner statements (Guesty generates one statement per
// OWNER, e.g. Prudenzi's covers both 53 Rocky Neck and 53 Rocky Neck
// (DOWN)) carry one section per property, headed by a line like
// "53 Rocky Neck8 reservations" / "53 Rocky Neck (DOWN)2 reservations".
// When 2+ section headers are present, only reservations inside the
// section(s) belonging to the target property are ingested -- the same
// owner PDF gets uploaded once per property and each ingest picks its
// own slice. Longest-listing_match-wins assigns headers to properties,
// so "53 rocky neck (down" beats its parent's "53 rocky neck" substring
// (same rule as sync-guesty's LISTING_MATCH). PDFs with 0-1 headers
// (every single-property statement) parse the whole text, exactly the
// pre-section behavior.
type ParsedPdf = {
  reservations: { confirmation_code: string; check_in: string; check_out: string; nights: number; rental_income: number }[];
  /** Section headings found in the PDF (empty for single-property PDFs). */
  sections: { heading: string; property_id: string | null }[];
  /** True when 2+ sections were found and filtering was applied. */
  multiSection: boolean;
  /**
   * Set when the PDF's ONE section resolves to a DIFFERENT property than the
   * one being ingested -- i.e. this statement describes someone else's house.
   * Zero reservations are returned; the caller raises a critical gap.
   *
   * Deliberately not the same treatment as the 2+ section mismatch, which
   * hard-400s. With 2+ sections and none matching, the PDF definitively
   * belongs to another owner. With exactly one section it is ambiguous: it
   * is either the wrong PDF, or the right owner's PDF in a month where this
   * property had no bookings and Guesty emitted only the sibling's section.
   * The second case still needs its ingest to run for cleaning, repairs and
   * bank data, so we book no revenue and let the operator resolve the gap.
   */
  foreignSingleSection: { heading: string; listing: string; property_id: string } | null;
};

function parseGuestyPDF(
  text: string,
  sectionFilter?: { targetPropertyId: string; listingMatches: Record<string, string> },
): ParsedPdf {
  const reservations: { confirmation_code: string; check_in: string; check_out: string; nights: number; rental_income: number }[] = [];

  // Section headers: "<listing name><count> reservations" on its own line.
  const headerRegex = /^(.+?)(\d+)\s*reservations?$/gm;
  const rawSections: { heading: string; start: number }[] = [];
  let headerMatch;
  while ((headerMatch = headerRegex.exec(text)) !== null) {
    rawSections.push({ heading: headerMatch[0].trim(), start: headerMatch.index });
  }

  // Assign each section to a property by longest listing_match contained
  // in the heading line. Matching against the full heading (count digits
  // included) sidesteps any ambiguity in splitting name from count.
  const assign = (heading: string): string | null => {
    if (!sectionFilter) return null;
    const hay = heading.toLowerCase();
    let best: string | null = null;
    let bestLen = 0;
    for (const [propId, needle] of Object.entries(sectionFilter.listingMatches)) {
      if (needle && needle.length > bestLen && hay.includes(needle)) {
        best = propId;
        bestLen = needle.length;
      }
    }
    return best;
  };

  const sections = rawSections.map((s, i) => ({
    heading: s.heading,
    property_id: assign(s.heading),
    start: s.start,
    end: i + 1 < rawSections.length ? rawSections[i + 1].start : text.length,
  }));

  const multiSection = sections.length >= 2 && !!sectionFilter;
  const targetRanges = multiSection
    ? sections.filter(s => s.property_id === sectionFilter!.targetPropertyId)
    : [];

  // A lone section that resolves to a different property means every
  // reservation in this PDF belongs to that other house. Before this check
  // the single-section path fell through to "parse the whole text", so
  // uploading 73 Rocky Neck's statement with 3 Windward selected booked 73's
  // revenue against 3 Windward at 3 Windward's management fee, silently.
  // An UNMATCHED heading (property_id null) is left alone -- it just means no
  // listing_match needle recognised the listing name, which is not evidence
  // the PDF is for the wrong property.
  const foreignSingleSection = (
    sectionFilter
    && sections.length === 1
    && sections[0].property_id
    && sections[0].property_id !== sectionFilter.targetPropertyId
  )
    // `listing` is the heading without its glued-on "<N> reservations" tail
    // ("73 Rocky Neck2 reservations" -> "73 Rocky Neck"), for display.
    ? {
        heading: sections[0].heading,
        listing: sections[0].heading.replace(/\d+\s*reservations?$/i, '').trim(),
        property_id: sections[0].property_id as string,
      }
    : null;

  const inTargetSection = (index: number): boolean => {
    if (foreignSingleSection) return false;
    if (!multiSection) return true;
    return targetRanges.some(r => index >= r.start && index < r.end);
  };

  // Match date range blocks: "(Mar 30 - Apr 3, 2026) - 4 nights"
  const dateRangeRegex = /\((\w+ \d+)\s*-\s*(\w+ \d+),?\s*(\d{4})\)\s*-\s*(\d+)\s*nights?/g;
  const nextDateRangeRegex = /\(\w+ \d+\s*-\s*\w+ \d+,?\s*\d{4}\)\s*-\s*\d+\s*nights?/;
  let match;

  while ((match = dateRangeRegex.exec(text)) !== null) {
    if (!inTargetSection(match.index)) continue;
    const startStr = match[1];
    const endStr = match[2];
    const year = match[3];
    const nights = parseInt(match[4]);

    const checkIn = parseShortDate(startStr, year);
    const checkOut = parseShortDate(endStr, year);

    // Bound the rental-line search to just this section. When a reservation
    // is cancelled and reprocessed in Guesty, Guesty still writes its date-
    // range header on the owner statement PDF but with $0.00 and no rental
    // line. Without a bound, the empty section would slurp the NEXT
    // reservation's rental line and duplicate that reservation into this
    // empty slot -- the exact symptom that produced a phantom Nicholas Mount
    // on Bethany's June 36 Granite statement after James Cox's cancellation
    // was reprocessed (2026-07-01). Empty sections now correctly no-op.
    const remainder = text.substring(match.index + match[0].length);
    const nextStart = remainder.search(nextDateRangeRegex);
    const searchWindow = nextStart >= 0 ? remainder.substring(0, nextStart) : remainder;

    // pdf-parse concatenates: "HM33A9MBBRRental Income$1,338.48"
    // So we match the code as everything before "Rental Income"
    const rentalMatch = searchWindow.match(/Rental payment for\s*(\S+?)Rental Income\$?([\d,]+\.?\d*)/);

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

  return {
    reservations,
    sections: sections.map(s => ({ heading: s.heading, property_id: s.property_id })),
    multiSection,
    foreignSingleSection,
  };
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
 * the pre-tax booking total is legacy. Treat as 0.
 *
 * For **VRBO** rows: real commission is 5%, so a value > ~7% of the pre-tax
 * booking total has the 4.4% kludge stacked on top. Subtract 4.4% to recover
 * the real 5% component.
 *
 * THE BASE MUST BE BOOKING-LEVEL. `channel_commission` is a booking-level
 * figure. `total_paid` is a PAYMENT-level figure, and since July 2026 Guesty
 * has logged only one leg of a guest's 50/50 split (the same defect
 * lib/remittance.ts routes around). `total_taxes` stays booking-level
 * throughout, so a halved TOTAL_PAID shrinks (TOTAL_PAID - TAXES) by more
 * than half and roughly doubles the ratio: a genuine 5% VRBO commission
 * reads as 11.3% and gets cut to 5% of the halved base. HA-XlpeL8K (Evan
 * Friese, 4 Brier Neck, Aug 2026) lost $333.45 of real commission that way
 * and had to be repaired by hand on 2026-09-01.
 *
 * So `folioPreTax` -- the sum of the booking's own non-TAX folio lines, which
 * is always whole -- is the base whenever we have it. (TOTAL_PAID - TAXES)
 * remains the fallback for rows Guesty gave us no folio for, which is the
 * pre-folio historical shape and exactly the population the kludge lives in.
 *
 * Returns a safe effective_commission plus whether a legacy adjustment
 * was applied so we can flag it in the statement audit trail.
 */
function stripLegacyCommissionKludge(args: {
  platform: string;
  totalPaid: number;
  totalTaxes: number;
  commission: number;
  folioPreTax?: number | null;
}): { effective: number; hadKludge: boolean } {
  const { platform, totalPaid, totalTaxes, commission, folioPreTax } = args;
  if (!commission || commission <= 0) return { effective: 0, hadKludge: false };
  const base = folioPreTax && folioPreTax > 0
    ? folioPreTax
    : Math.max(totalPaid - totalTaxes, 0);
  if (base <= 0) return { effective: commission, hadKludge: false };
  const ratio = commission / base;
  const p = platform.toUpperCase();
  if (p === 'MANUAL') {
    // Real Manual commission = 0. Anything above 2% ratio is kludge.
    if (ratio > 0.02) return { effective: 0, hadKludge: true };
    return { effective: commission, hadKludge: false };
  }
  if (p.includes('HOMEAWAY') || p === 'VRBO') {
    // Real VRBO commission = 5% of the pre-tax booking total. Above 7% = kludge.
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
function matchCleaningsToReservations<C extends { date: string; amount: number; description: string }, R extends { check_out: string; guest_name: string }>(
  cleaningCharges: C[],
  reservations: R[],
): { charge: C; matchedGuest: string | null; matchedCheckout: string | null }[] {
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

// Per-file upload caps. The Statements ingest takes a Guesty Owner Statement
// PDF plus two CSVs (Platform + Bank). Real monthly files for a 12-property
// portfolio are well under a megabyte each; the caps here are a safety net
// against an oversized or wrong-file upload exhausting the function memory.
// Bumped one tier higher than expected so a fat scanned PDF still fits.
const MAX_PDF_BYTES = 8 * 1024 * 1024;   // 8 MB
const MAX_CSV_BYTES = 4 * 1024 * 1024;   // 4 MB each
const MAX_TOTAL_BYTES = 12 * 1024 * 1024; // 12 MB whole payload

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

    // Sent-statement freeze: re-ingest wholesale rebuilds the statement.
    // A month the operator already marked sent (or finalized) needs an
    // explicit force, which is recorded on the statement as a gap.
    let finalityForced = false;
    let finalityGate: FreezeReceipt | null = null;
    try {
      finalityGate = await assertStatementWritable(supabase, { propertyId, month }, {
        force: (formData.get('force') as string) === 'true',
        action: 'Re-ingest statement',
      });
      finalityForced = finalityGate.forced;
    } catch (e) {
      if (e instanceof StatementFrozenError) return NextResponse.json(frozenResponseBody(e), { status: 409 });
      throw e;
    }

    // Reject oversized uploads before any parse work happens. 413 (Payload
    // Too Large) per the spec, with a message that names the offending file
    // and limit so the operator can act on it.
    const oversized: string[] = [];
    if (guestyPDFFile && guestyPDFFile.size > MAX_PDF_BYTES) {
      oversized.push(`PDF ${(guestyPDFFile.size / 1024 / 1024).toFixed(1)}MB > ${MAX_PDF_BYTES / 1024 / 1024}MB`);
    }
    if (platformCSVFile && platformCSVFile.size > MAX_CSV_BYTES) {
      oversized.push(`Platform CSV ${(platformCSVFile.size / 1024 / 1024).toFixed(1)}MB > ${MAX_CSV_BYTES / 1024 / 1024}MB`);
    }
    if (bankCSVFile && bankCSVFile.size > MAX_CSV_BYTES) {
      oversized.push(`Bank CSV ${(bankCSVFile.size / 1024 / 1024).toFixed(1)}MB > ${MAX_CSV_BYTES / 1024 / 1024}MB`);
    }
    const totalBytes =
      (guestyPDFFile?.size ?? 0) + (platformCSVFile?.size ?? 0) + (bankCSVFile?.size ?? 0);
    if (totalBytes > MAX_TOTAL_BYTES) {
      oversized.push(`total ${(totalBytes / 1024 / 1024).toFixed(1)}MB > ${MAX_TOTAL_BYTES / 1024 / 1024}MB`);
    }
    if (oversized.length > 0) {
      return NextResponse.json(
        { error: `Upload too large: ${oversized.join('; ')}. Trim or re-export the files.` },
        { status: 413 },
      );
    }

    const propRow = await getActivePropertyForStatements(propertyId);
    if (!propRow) {
      return NextResponse.json({ error: 'Unknown property: ' + propertyId }, { status: 400 });
    }
    // Shape kept identical to the prior local PROPERTIES const so the
    // downstream parsers don't notice the source change.
    const propConfig = {
      name: propRow.name,
      owner: propRow.owner_last,
      fee_pct: propRow.fee_pct,
      bank_last4: propRow.bank_last4 ?? '',
    };

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
    // Set when the uploaded PDF's only section belongs to another property.
    // Carried to step 12, which turns it into a critical gap.
    let foreignPdfSection: { heading: string; listing: string; property_id: string } | null = null;
    let pdfDebug = '';

    if (guestyPDFFile) {
      const pdfBuffer = Buffer.from(await guestyPDFFile.arrayBuffer());
      // Use pdf-parse/lib/pdf-parse.js directly to avoid the test file ENOENT bug
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const pdfParse = require('pdf-parse/lib/pdf-parse.js');
      const pdfData = await pdfParse(pdfBuffer);
      const pdfText: string = pdfData.text;
      pdfDebug = pdfText.substring(0, 500);

      // Listing matches for every active property, so a multi-property
      // owner PDF (one Guesty statement per OWNER, sectioned per listing)
      // can route each section to the right property. Longest match wins
      // inside the parser, so sub-unit needles beat their parent's prefix.
      const { data: matchRows } = await supabase
        .from('properties')
        .select('id, listing_match')
        .eq('is_active', true);
      const listingMatches: Record<string, string> = {};
      for (const row of matchRows || []) {
        if (row.id && row.listing_match) listingMatches[row.id] = String(row.listing_match).toLowerCase();
      }

      const parsed = parseGuestyPDF(pdfText, { targetPropertyId: propertyId, listingMatches });
      if (parsed.multiSection && !parsed.sections.some(s => s.property_id === propertyId)) {
        const headings = parsed.sections.map(s => `"${s.heading}"${s.property_id ? ` -> ${s.property_id}` : ' (unmatched)'}`).join(', ');
        return NextResponse.json({
          error: `This owner statement PDF has ${parsed.sections.length} property sections (${headings}) and none belong to ${propConfig.name}. Check that the right PDF was uploaded for this property.`,
        }, { status: 400 });
      }
      foreignPdfSection = parsed.foreignSingleSection;
      reservations = parsed.reservations.map(r => ({ ...r, guest_name: '' }));
    }

    // 2. Parse platform CSV (maps confirmation codes to platforms + guest names).
    //
    //    Source waterfall:
    //      a) File in the FormData -> use it AND save to the per-month
    //         Supabase Storage cache so the next property's upload doesn't
    //         have to re-attach the same portfolio-wide export.
    //      b) No file uploaded -> try the cached CSV for this month.
    //         Same file works for every property; this is the typical
    //         case after the first ingest of the month.
    //      c) Neither -> skip platform CSV parsing entirely (existing
    //         degrade-gracefully behavior).
    const platformMap: Record<string, { platform: string; guest: string }> = {};
    const guestyReservationUpserts: Record<string, string | number | null>[] = [];
    let platformText: string | null = null;
    let platformCsvSource: 'upload' | 'cache' | null = null;
    if (platformCSVFile) {
      platformText = await platformCSVFile.text();
      platformCsvSource = 'upload';
      // Persist to cache so subsequent ingests for this month don't need
      // the operator to re-attach the same file. Failure here is logged
      // but doesn't fail the ingest -- the request still has the data.
      try {
        await cachePlatformCSV(supabase, month, platformCSVFile);
      } catch (err) {
        console.warn('platform CSV cache write failed:', err instanceof Error ? err.message : err);
      }
    } else {
      try {
        const cached = await loadCachedPlatformCSVText(supabase, month);
        if (cached) {
          platformText = cached.text;
          platformCsvSource = 'cache';
        }
      } catch (err) {
        console.warn('platform CSV cache read failed:', err instanceof Error ? err.message : err);
      }
    }
    if (platformText) {
      const platformRows = parseCSV(platformText);
      // The platform CSV is FLEET-WIDE and full-history: it holds every
      // property's stays, not this statement's. Resolve each row to its own
      // property from the LISTING column and skip anything that will not
      // resolve.
      //
      // This loop used to stamp `propertyId` -- the property being ingested --
      // onto every row in the file, keyed on a portfolio-global
      // `csv:<confirmation_code>`. Last writer won, so whichever property was
      // ingested last captured the whole fleet's unprotected codes. On
      // 2026-09-01 that was 3 Windward, which collected 31 stays belonging to
      // nine other properties, including ten overlapping guests on 2026-04-11
      // at a house that did not exist in Helm until 2026-07-15.
      const csvListingMatches = await loadListingMatches(supabase);
      let csvRowsSkippedUnmatched = 0;
      for (const row of platformRows) {
        const code = (row['CONFIRMATION CODE'] || row['Confirmation Code'] || row['confirmation_code'] || '').trim();
        const listing = (row['LISTING'] || row['Listing'] || row['listing'] || '').trim();
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

        // Whose stay is this? The CSV says, and only the CSV says.
        const rowPropertyId = matchProperty(listing, csvListingMatches);
        if (!rowPropertyId) {
          // Not ours to claim. Falling back to `propertyId` here is precisely
          // the defect described above.
          csvRowsSkippedUnmatched += 1;
          continue;
        }

        guestyReservationUpserts.push({
          guesty_reservation_id: `csv:${code}`,
          property_id: rowPropertyId,
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

      if (csvRowsSkippedUnmatched > 0) {
        console.warn(
          `[ingest] platform CSV: ${csvRowsSkippedUnmatched} row(s) had a LISTING that matched no active property; skipped rather than attributed to ${propertyId}`,
        );
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
      status: string | null;
      total_paid: number | null;
      total_taxes: number | null;
      channel_commission: number | null;
      owner_net_revenue_guesty: number | null;
      folio_items: unknown;
    };
    const guestyLookupMap = new Map<string, GuestyLookup>();
    if (codes.length > 0) {
      const { data: guestyRows } = await supabase
        .from('guesty_reservations')
        .select('confirmation_code, guest_name, channel, guesty_channel_id, status, total_paid, total_taxes, channel_commission, owner_net_revenue_guesty, folio_items')
        .in('confirmation_code', codes);
      (guestyRows || []).forEach(r => {
        if (r.confirmation_code) guestyLookupMap.set(r.confirmation_code, r);
      });
    }

    // ── Cross-month installments ────────────────────────────────────────
    // A long booking (Hancock at 3 South, Jun 22 → Aug 6) can be opt-in
    // split across months via reservation_installments. Two effects below:
    //  1. PDF FORK: if this month's parsed PDF includes a reservation that
    //     has an installment row for THIS month, override its
    //     adjustedRevenue with the installment amount and pro-rate the
    //     Stripe fee by share. Nights field also reduced to the in-month
    //     portion so dashboards report correct monthly occupancy.
    //  2. SYNTHETIC INJECTION: for installments in this month whose
    //     confirmation_code is NOT in the PDF (the booking checks out in
    //     a later month, so Guesty wouldn't list it on this month's
    //     statement), look the booking up in guesty_reservations and
    //     synthesize a processedReservation row so the owner gets the
    //     in-month portion on this month's statement.
    // Whenever no installment rows exist for this property/month, the
    // entire feature is a no-op and the per-reservation loop runs
    // byte-for-byte identical to today.
    const installmentsThisMonth: Installment[] = await loadInstallmentsForMonth(supabase, propertyId, month);
    const installmentByCode = new Map<string, Installment>();
    for (const inst of installmentsThisMonth) installmentByCode.set(inst.confirmation_code, inst);
    // Cache the full per-code installment set so the share denominator
    // (sum of installment_revenue across all months of a booking) is
    // computed once per code, not per-reservation.
    const allInstallmentsByCode = new Map<string, Installment[]>();
    async function getAllInstallmentsForCode(code: string): Promise<Installment[]> {
      const cached = allInstallmentsByCode.get(code);
      if (cached) return cached;
      const all = await loadInstallmentsForCode(supabase, code);
      allInstallmentsByCode.set(code, all);
      return all;
    }
    //  3. RECOGNIZED-ELSEWHERE GUARD: a booking whose installment slices
    //     ALL live in other months is already fully recognized there. The
    //     canonical shape: a stay checking out on the 1st has zero nights
    //     in its checkout month, so the split has no slice here -- but
    //     Guesty lists the booking on THIS month's owner statement at
    //     full value (recognition at checkout), and without a slice for
    //     the month the PDF fork can't catch it. The row must be skipped
    //     entirely or the owner is paid the whole stay twice.
    //     Bulk-load every PDF code's slices in one query (also warms the
    //     per-code cache for the fork's fee denominator).
    const installmentsForPdfCodes = await loadInstallmentsForCodes(supabase, codes);
    for (const [code, list] of installmentsForPdfCodes) allInstallmentsByCode.set(code, list);
    const recognizedElsewhere: { code: string; guest: string; months: string[]; amount: number }[] = [];
    // For synthetic injection, we need guesty_reservations metadata
    // (guest, dates, channel, money fields) for installment codes that
    // AREN'T in the parsed PDF. Build a separate lookup keyed by code.
    type SynthGuesty = {
      confirmation_code: string;
      guest_name: string | null;
      check_in: string | null;
      check_out: string | null;
      nights: number | null;
      channel: string | null;
      guesty_channel_id: string | null;
      total_paid: number | null;
      total_taxes: number | null;
      channel_commission: number | null;
      owner_net_revenue_guesty: number | null;
    };
    const syntheticInstallments: Installment[] = installmentsThisMonth.filter(i => !codes.includes(i.confirmation_code));
    const synthGuestyByCode = new Map<string, SynthGuesty>();
    // Installments whose month falls OUTSIDE their own booking's stay span.
    // Collected during injection below, reported as a gap at gap-build time.
    const installmentSpanMismatches: { code: string; month: string; amount: number; checkIn: string; checkOut: string }[] = [];
    if (syntheticInstallments.length > 0) {
      const synthCodes = syntheticInstallments.map(i => i.confirmation_code);
      const { data: synthRows } = await supabase
        .from('guesty_reservations')
        .select('confirmation_code, guest_name, check_in, check_out, nights, channel, guesty_channel_id, total_paid, total_taxes, channel_commission, owner_net_revenue_guesty')
        .in('confirmation_code', synthCodes);
      (synthRows || []).forEach(r => {
        if (r.confirmation_code) synthGuestyByCode.set(r.confirmation_code, r as SynthGuesty);
      });
    }

    const unresolvedNameCodes: string[] = [];
    for (const res of reservations) {
      // Recognized-elsewhere guard (effect 3 above): slices exist for this
      // code but none for this month -> the booking's revenue lives entirely
      // on other statements. Skip before bank matching so it can't consume
      // a deposit another row needs.
      const slicesForCode = res.confirmation_code ? (allInstallmentsByCode.get(res.confirmation_code) || []) : [];
      if (slicesForCode.length > 0 && !installmentByCode.has(res.confirmation_code)) {
        recognizedElsewhere.push({
          code: res.confirmation_code,
          guest: res.guest_name,
          months: slicesForCode.map(s => s.month),
          amount: Math.round(slicesForCode.reduce((s, i) => s + (Number(i.installment_revenue) || 0), 0) * 100) / 100,
        });
        continue;
      }

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

    // Cleaning (Cape Ann Elite) and linen (Nor'East) charges are tracked in
    // separate buckets: cleaning charges get the 1:1 reservation match (one
    // turnover = one cleaning), linen charges are additive cost only. Both
    // roll into cleaning_total so the owner statement shows one combined
    // "Cleaning" line (linens were bundled into Cape Ann Elite's invoices
    // before May 2026; folding them back in keeps owner payouts correct).
    type VendorCharge = {
      date: string; amount: number; description: string; vendor: string;
      // Set when a same-vendor CREDIT in the same month nets this charge
      // out (see the vendor-refund pass below the bank loop).
      credit_amount?: number; credit_reason?: string;
    };
    const cleaningCharges: VendorCharge[] = [];
    const linenCharges: VendorCharge[] = [];
    const laundryCharges: VendorCharge[] = [];
    const repairCharges: VendorCharge[] = [];
    // CREDITS from a known vendor. Vendors bill us; they never pay us --
    // a positive amount on a vendor descriptor is always a refund of one
    // of their own charges, so it must reduce what the owner is billed,
    // never sit silently in a review queue (the $47.40 Laundry Plus refund
    // on 20 Hammond July 2026 that quietly parked as an unattributed
    // deposit while the owner was charged the full amount).
    const vendorCredits: { kind: 'cleaning' | 'linen' | 'laundry' | 'repair'; vendor: string; date: string; amount: number; description: string }[] = [];
    const deposits: { date: string; amount: number; description: string; source: string }[] = [];
    // Unmatched in-month DEBITS (negative amounts that didn't classify as
    // cleaning / linen / known repair vendor). These often turn out to be
    // owner reimbursements -- e.g. an Online Transfer from a property's
    // Chase account to RT operating that reimbursed RT for a trash can
    // bought on the corporate card. The operator attributes them from the
    // Statements page; attributed ones flow to repairs_total.
    const unmatchedDebits: { date: string; amount: number; description: string }[] = [];

    for (const row of bankRows) {
      const desc = row['Description'] || row['DESCRIPTION'] || '';
      const amountStr = row['Amount'] || row['AMOUNT'] || '0';
      const date = row['Posting Date'] || row['DATE'] || row['Post Date'] || '';
      const amount = parseFloat(amountStr.replace(/[,$]/g, '')) || 0;
      const descUpper = desc.toUpperCase();

      const cls = classifyBankRow(descUpper);

      // Cleaning / linen / repair charges: real DEBITS only (negative).
      // A CREDIT matching the same vendor's name is a refund -- DON'T
      // capture it as another charge, and DON'T continue past the deposit
      // collector below, otherwise the refund disappears (the bug that
      // dropped 53 Rocky Neck's $275 May 21 fedwire reimbursement).
      if (cls?.kind === 'cleaning' && isInMonth(date, month) && amount < 0) {
        cleaningCharges.push({ date, amount: Math.abs(amount), description: desc, vendor: cls.vendor });
        continue;
      }
      if (cls?.kind === 'linen' && isInMonth(date, month) && amount < 0) {
        linenCharges.push({ date, amount: Math.abs(amount), description: desc, vendor: cls.vendor });
        continue;
      }
      if (cls?.kind === 'laundry' && isInMonth(date, month) && amount < 0) {
        laundryCharges.push({ date, amount: Math.abs(amount), description: desc, vendor: cls.vendor });
        continue;
      }
      if (cls?.kind === 'repair' && isInMonth(date, month) && amount < 0) {
        repairCharges.push({ date, amount: Math.abs(amount), description: desc, vendor: cls.vendor });
        continue;
      }

      // Vendor CREDIT (refund). Held out of the deposits pool on purpose:
      // a $47.40 laundry refund must never amount-match an Airbnb payout.
      // Netted against its own vendor's charges after the loop.
      if (cls && amount > 0 && isInMonth(date, month)) {
        vendorCredits.push({ kind: cls.kind, vendor: cls.vendor, date, amount: Math.round(amount * 100) / 100, description: desc });
        continue;
      }

      if (amount > 0) {
        // Deposits: collect ALL dates for cross-month matching
        let source = 'other';
        if (descUpper.includes('AIRBNB')) source = 'airbnb';
        else if (descUpper.includes('STRIPE')) source = 'stripe';
        else if (descUpper.includes('BOOKING.COM') || descUpper.includes('BOOKING COM')) source = 'booking';
        deposits.push({ date, amount, description: desc, source });
      } else if (amount < 0 && isInMonth(date, month)) {
        // Unmatched in-month debit -- park for operator review.
        unmatchedDebits.push({ date, amount: Math.abs(amount), description: desc });
      }
    }

    // Net vendor refunds against their own charges. Exact-amount match
    // within the same vendor category, nearest bank date wins, each charge
    // absorbs at most one credit. A matched charge keeps its row (audit
    // trail) but carries credit_amount/credit_reason -- the same fields the
    // operator's Mark Duplicate control writes -- so the dashboard shows
    // the strikethrough and cleaning_total recomputes stay consistent.
    // Credits with no same-month exact match (partial refunds, refunds of a
    // prior month's charge) are NOT guessed at: they raise a critical data
    // gap and land in the bank review queue below.
    const bankDateMs = (d: string): number => {
      const parts = d.split('/');
      if (parts.length !== 3) return NaN;
      return Date.UTC(Number(parts[2]), Number(parts[0]) - 1, Number(parts[1]));
    };
    const unmatchedVendorCredits: typeof vendorCredits = [];
    for (const credit of vendorCredits) {
      // Auto-net only the cleaning family: cleaning_events carries
      // credit_amount/credit_reason so the netted row stays visible.
      // repair_events has no credit fields yet, so a maintenance-vendor
      // refund goes the loud route (critical gap + review queue) instead
      // of silently diverging rows from repairs_total.
      const pool: VendorCharge[] | null =
        credit.kind === 'cleaning' ? cleaningCharges :
        credit.kind === 'linen' ? linenCharges :
        credit.kind === 'laundry' ? laundryCharges : null;
      let target: VendorCharge | null = null;
      const creditMs = bankDateMs(credit.date);
      for (const ch of pool || []) {
        if (ch.credit_amount) continue;
        if (Math.abs(ch.amount - credit.amount) > 0.005) continue;
        if (!target) { target = ch; continue; }
        const a = Math.abs(bankDateMs(ch.date) - creditMs);
        const b = Math.abs(bankDateMs(target.date) - creditMs);
        if (!isNaN(a) && (isNaN(b) || a < b)) target = ch;
      }
      if (target) {
        target.credit_amount = credit.amount;
        target.credit_reason = `${credit.vendor} refund posted ${credit.date} (auto-netted at ingest)`;
      } else {
        unmatchedVendorCredits.push(credit);
      }
    }
    const chargeNet = (c: VendorCharge) => c.amount - (c.credit_amount || 0);

    // cleaning_total folds cleaning + linens into one number (owner-facing
    // single "Cleaning" line). owner_payout already deducts cleaning_total,
    // so no payout-formula change is needed. Auto-netted refunds are
    // excluded here so the owner is only billed the vendor's net.
    const cleaningOnlyTotal = Math.round(cleaningCharges.reduce((sum, c) => sum + chargeNet(c), 0) * 100) / 100;
    const linenTotal = Math.round(linenCharges.reduce((sum, c) => sum + chargeNet(c), 0) * 100) / 100;
    const laundryTotal = Math.round(laundryCharges.reduce((sum, c) => sum + chargeNet(c), 0) * 100) / 100;
    const cleaningTotal = Math.round((cleaningOnlyTotal + linenTotal + laundryTotal) * 100) / 100;
    let repairsTotal = Math.round(repairCharges.reduce((sum, c) => sum + chargeNet(c), 0) * 100) / 100;

    // Receipt-backed expenses fold into repairs_total. property_receipts is
    // keyed (property_id, month) -- NOT the statement UUID -- so operator-
    // entered receipts survive the wholesale delete-and-rebuild in section 8
    // below (the exact bank_deposit_attributions survival pattern). The
    // folded value then flows untouched through the owner-payout math, the
    // statement insert, and the syncPropertyStripe payload; mirror rows for
    // line-item display land in section 11b. Tolerates the
    // supabase-schema property_receipts migration not having run yet.
    type ActiveReceipt = {
      id: string;
      amount: number;
      vendor_name: string | null;
      description: string | null;
      expense_date: string | null;
    };
    let activeReceipts: ActiveReceipt[] = [];
    {
      const { data: receiptRows, error: receiptErr } = await supabase
        .from('property_receipts')
        .select('id, amount, vendor_name, description, expense_date')
        .eq('property_id', propertyId)
        .eq('month', month)
        .eq('status', 'active');
      if (receiptErr && receiptErr.code !== 'PGRST205' && !/does not exist|relation|Could not find the table/i.test(receiptErr.message || '')) {
        throw receiptErr;
      }
      if (receiptErr) console.warn('property_receipts read skipped (table missing -- run the property_receipts migration)');
      activeReceipts = (receiptRows || []) as ActiveReceipt[];
      const receiptsTotal = Math.round(activeReceipts.reduce((s, r) => s + (Number(r.amount) || 0), 0) * 100) / 100;
      repairsTotal = Math.round((repairsTotal + receiptsTotal) * 100) / 100;
    }

    // Central Booking.com deposits account (...5623) transfers to THIS
    // property. Booking.com pays every property into that one Chase account
    // and the money reaches the property's checking as a plain "Online
    // Transfer" -- nothing Booking.com-labeled ever hits the property's own
    // bank CSV, so Booking.com stays had no corroboration path. The operator
    // uploads the 5623 activity monthly from the Statements page (see
    // /api/upload-booking-deposits); a transfer out to this property's last4
    // in the statement window corroborates the channel paid us. Window runs
    // 60 days past month end because Booking.com payouts lag checkout.
    // Tolerates the booking_account_activity migration not having run yet.
    let centralBookingTransfers = 0;
    {
      const windowStart = `${month}-01`;
      const windowEndD = new Date(`${month}-01T00:00:00Z`);
      windowEndD.setUTCMonth(windowEndD.getUTCMonth() + 1);
      windowEndD.setUTCDate(windowEndD.getUTCDate() + 60);
      const windowEnd = windowEndD.toISOString().slice(0, 10);
      const { data: centralRows, error: centralErr } = await supabase
        .from('booking_account_activity')
        .select('id')
        .eq('property_id', propertyId)
        .eq('kind', 'property_transfer')
        .gte('posting_date', windowStart)
        .lte('posting_date', windowEnd);
      if (centralErr && centralErr.code !== 'PGRST205' && !/does not exist|relation|Could not find the table/i.test(centralErr.message || '')) {
        console.warn('booking_account_activity read skipped:', centralErr.message);
      }
      centralBookingTransfers = (centralRows || []).length;
    }

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

    // Rows the PDF listed that do not check out in the statement month.
    // Collected, never recognized; reported below.
    const outOfMonthRows: { code: string; guest: string; checkOut: string; amount: number }[] = [];

    for (const res of reservations) {
      // ── Statement-month gate ──────────────────────────────────────────
      // Revenue is recognized at CHECKOUT (see CLAUDE.md "Recognition").
      // Guesty's owner-statement PDF does not use that basis: it lists a
      // booking in the month the guest PAID, so a stay checking out next
      // month rides in on this month's PDF. The same hole passes an entire
      // wrong-month PDF: an August export dropped into July's slot lists
      // nothing but August stays and every one of them gets paid twice.
      //
      // The ONE sanctioned cross-month case is an operator-created
      // installment split, which always carries reservation_installments
      // slices -- the PDF fork and the synthetic injection below own those,
      // so a sliced code is exempt here and handled on its own terms.
      //
      // Skip the row rather than recognize it, and make the skip loud: a
      // silent drop is how the reverse bug (a stay that vanishes) starts.
      //
      // Exempt only a code with a slice for THIS month. `installmentByCode`
      // is month-scoped and that scoping is the whole point: keying on
      // `allInstallmentsByCode` (slices in ANY month) would exempt the exact
      // opposite case, a stay whose slices all live in other months and is
      // therefore already recognized there, and wave it through at full PDF
      // value. Worth knowing while reading this: the recognized-elsewhere
      // guard meant to catch that case sits in the guest-name loop above,
      // not in this one, so it files its gap without ever skipping
      // recognition. Month-scoping here closes the cross-month half of that
      // hole instead of widening it.
      const checkOutMonth = (res.check_out || '').slice(0, 7);
      const hasSliceThisMonth = !!res.confirmation_code && installmentByCode.has(res.confirmation_code);
      if (checkOutMonth && checkOutMonth !== month && !hasSliceThisMonth) {
        outOfMonthRows.push({
          code: res.confirmation_code,
          guest: res.guest_name,
          checkOut: res.check_out,
          amount: res.rental_income,
        });
        continue;
      }

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
        const reportedPaid = guestyInfo?.total_paid ?? null;
        const totalTaxes = guestyInfo?.total_taxes ?? 0;
        const rawCommission = guestyInfo?.channel_commission ?? 0;
        // The booking's own line items. Whole even when TOTAL_PAID records
        // only one leg of a 50/50 split, which is why both the kludge
        // detector and the gross basis prefer it. See lib/remittance.ts.
        const folio = splitFolio(guestyInfo?.folio_items);
        const folioGross = folio.hasFolio
          ? Math.round((folio.preTax + folio.tax) * 100) / 100
          : 0;
        // Guesty has logged only one leg of a guest's 50/50 installment
        // payment since July 2026. When the folio says the guest owes
        // materially more than TOTAL_PAID records, recognize on the folio:
        // the money is real, Guesty's payment record is short. This is the
        // same conclusion lib/stripe-sync.ts's gross reconstruction reaches
        // from the actual Stripe charges -- doing it here means the
        // statement is right on the first pass rather than after a sync,
        // and it is right even on the rows stripe-sync may not touch
        // (paid_off_stripe, installment splits, no matched charge).
        const partialPaid =
          folioGross > 0 && reportedPaid != null && reportedPaid > 0 && reportedPaid < folioGross - 1;
        const totalPaid = partialPaid ? folioGross : reportedPaid;
        if (totalPaid && totalPaid > 0) {
          const { effective: effCommission, hadKludge } = stripLegacyCommissionKludge({
            platform,
            totalPaid,
            totalTaxes,
            commission: rawCommission,
            folioPreTax: folio.hasFolio ? folio.preTax : null,
          });
          stripeFee = calcStripeFee(totalPaid);
          adjustedRevenue = Math.round((totalPaid - totalTaxes - effCommission - stripeFee) * 100) / 100;
          if (partialPaid) {
            reconciliationGaps.push(
              `${res.confirmation_code}: Guesty recorded TOTAL_PAID $${(reportedPaid as number).toFixed(2)} against a folio of $${folioGross.toFixed(2)} -- only part of the guest's payment is logged. Revenue recognized on the folio`,
            );
          }
          // A strip that fires is never silent. The drift check below is
          // suppressed when hadKludge is true (the drift IS the stripped
          // amount, by design), which is how a false positive stayed
          // invisible on HA-XlpeL8K until it was caught by hand. Say what
          // was stripped and on what base so the operator can judge it.
          if (hadKludge && effCommission !== rawCommission) {
            const stripBase = folio.hasFolio ? folio.preTax : Math.max(totalPaid - totalTaxes, 0);
            const pct = stripBase > 0 ? ((rawCommission / stripBase) * 100).toFixed(1) : '?';
            reconciliationGaps.push(
              `${res.confirmation_code}: legacy commission strip applied -- Guesty's $${rawCommission.toFixed(2)} is ${pct}% of the $${stripBase.toFixed(2)} pre-tax ${folio.hasFolio ? 'folio' : 'basis'}, billed as $${effCommission.toFixed(2)}`,
            );
          }
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
      // Airbnb: 1:1 match by amount (within $5) across all dates, prefer dates near check-in.
      //   Falls back to an unambiguous PAIR of deposits summing to the amount -- Airbnb
      //   sometimes splits one reservation's payout into two same-day ACH credits.
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
          } else {
            // Split-payout fallback: Airbnb sometimes pays one reservation as
            // TWO deposits (e.g. base payout + resolution adjustment landing
            // the same day: $999.63 + $351.52 = $1,351.15). Link a pair only
            // when it's unambiguous -- exactly one candidate pair, or exactly
            // one same-day pair among several. Anything murkier stays
            // unmatched; this is corroboration, never revenue.
            const elig: number[] = [];
            for (let i = 0; i < deposits.length; i++) {
              if (deposits[i].source === 'airbnb' || deposits[i].source === 'other') elig.push(i);
            }
            const pairs: [number, number][] = [];
            for (let a = 0; a < elig.length; a++) {
              for (let b = a + 1; b < elig.length; b++) {
                if (Math.abs(deposits[elig[a]].amount + deposits[elig[b]].amount - targetAmount) < 5) {
                  pairs.push([elig[a], elig[b]]);
                }
              }
            }
            let pick: [number, number] | null = pairs.length === 1 ? pairs[0] : null;
            if (!pick && pairs.length > 1) {
              const sameDay = pairs.filter(([a, b]) => deposits[a].date === deposits[b].date);
              if (sameDay.length === 1) pick = sameDay[0];
            }
            if (pick) {
              const [a, b] = pick;
              const sum = Math.round((deposits[a].amount + deposits[b].amount) * 100) / 100;
              bankMatch = { amount: sum, status: 'matched' };
              deposits.splice(Math.max(a, b), 1);
              deposits.splice(Math.min(a, b), 1);
            }
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
            } else if (centralBookingTransfers > 0) {
              // The payout landed in the central Bookingcom Deposits account
              // (...5623) and was transferred to this property's checking in
              // the statement window -- corroborated even though nothing
              // Booking.com-labeled appears in the property's own bank CSV.
              bankMatch = { amount: res.rental_income, status: 'matched' };
            }
          }
        }
      }

      // ── Installment fork ──────────────────────────────────────────
      // If this booking has an installment row for the CURRENT month,
      // swap the computed adjustedRevenue / stripeFee / nights for the
      // in-month allocation. The bookings that DON'T have an
      // installment row take the existing path untouched.
      let nightsForRow = res.nights;
      const installment = installmentByCode.get(res.confirmation_code);
      if (installment && !isHomeownerStay) {
        const allForCode = await getAllInstallmentsForCode(res.confirmation_code);
        const denom = allForCode.reduce((s, i) => s + (Number(i.installment_revenue) || 0), 0);
        const monthRev = Number(installment.installment_revenue) || 0;
        const proratedFee = denom > 0
          ? Math.round((stripeFee * (monthRev / denom)) * 100) / 100
          : 0;
        adjustedRevenue = monthRev;
        stripeFee = proratedFee;
        if (installment.installment_nights != null) nightsForRow = installment.installment_nights;
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
        nights: nightsForRow,
        platform,
        guesty_rental_income: res.rental_income,
        stripe_fee: stripeFee,
        adjusted_revenue: adjustedRevenue,
        bank_deposit_amount: bankMatch.amount || null,
        bank_match_status: bankMatch.status,
      });
    }

    // ── Synthetic installment injection ─────────────────────────────────
    // For bookings whose checkout is in a LATER month than `month`, the
    // Guesty PDF for `month` won't list them -- but if the operator has
    // split the booking, this month deserves its allocated installment.
    // Synthesize a processedReservation row from guesty_reservations
    // metadata so the in-month installment_revenue flows into
    // totalRevenue + the reservations table.
    //
    // These rows have check_out outside the statement month, so they're
    // EXCLUDED from num_stays at write-time (line below) -- the booking
    // counts as one stay only in its final / checkout month. Cleaning
    // and repairs also don't attach (they happen at the bank-CSV
    // matching pass above, which only sees checkout-month events).
    for (const installment of syntheticInstallments) {
      const synth = synthGuestyByCode.get(installment.confirmation_code);
      if (!synth || !synth.check_in || !synth.check_out) continue;

      // ── Stay-span invariant ───────────────────────────────────────────
      // An installment splits the NIGHTS of one stay, so every slice month
      // must overlap [check_in, check_out). A slice outside that span is
      // not a split at all -- it's money being carried into a month the
      // booking never touched, which the operator has almost certainly
      // already recognized some other way (the extras/add-on queue is the
      // supported path for a late-arriving charge). Injecting it here
      // would add rental revenue ON TOP of that attribution and overpay
      // the owner.
      //
      // Do NOT try to detect the collision via the attribution rows: an
      // add-on is attributed to whichever stay ANCHORS it in the month,
      // which is a different confirmation_code than the installment's, so
      // a code match would miss the very case this guard exists for. The
      // span check is structural and needs no second read.
      //
      // Skipping is loud, never silent: a gap goes on the statement so the
      // operator resolves the row rather than quietly losing revenue.
      const monthStart = `${installment.month}-01`;
      const [iy, im] = installment.month.split('-').map(Number);
      const monthEndExclusive = new Date(Date.UTC(iy, im, 1)).toISOString().slice(0, 10);
      const overlapsStay = monthStart < synth.check_out && monthEndExclusive > synth.check_in;
      if (!overlapsStay) {
        installmentSpanMismatches.push({
          code: installment.confirmation_code,
          month: installment.month,
          amount: Number(installment.installment_revenue) || 0,
          checkIn: synth.check_in,
          checkOut: synth.check_out,
        });
        continue;
      }

      const platformInfo = platformMap[installment.confirmation_code];
      const platform =
        normalizePlatform(platformInfo?.platform) ||
        normalizePlatform(synth.guesty_channel_id) ||
        normalizePlatform(synth.channel) ||
        'Unknown';
      const platformUpper = platform.toUpperCase();
      const isStripeChannel = platformUpper.includes('HOMEAWAY') || platformUpper.includes('VRBO') || platformUpper === 'MANUAL';

      // Reconstruct the booking's FULL stripe_fee + adjusted_revenue
      // (same math as the PDF path above) so we can pro-rate them across
      // installments by revenue share.
      let bookingStripeFee = 0;
      if (isStripeChannel && synth.total_paid && synth.total_paid > 0) {
        const totalPaid = synth.total_paid;
        const totalTaxes = synth.total_taxes ?? 0;
        const rawCommission = synth.channel_commission ?? 0;
        const { effective: effCommission } = stripLegacyCommissionKludge({
          platform, totalPaid, totalTaxes, commission: rawCommission,
        });
        bookingStripeFee = calcStripeFee(totalPaid);
        // adjusted_revenue full = totalPaid - taxes - commission - fee
        // (we don't actually need it here -- the operator already
        // entered the per-month installment_revenue, so we just
        // pro-rate the fee by share)
        void effCommission;
      }

      const allForCode = await getAllInstallmentsForCode(installment.confirmation_code);
      const denom = allForCode.reduce((s, i) => s + (Number(i.installment_revenue) || 0), 0);
      const monthRev = Number(installment.installment_revenue) || 0;
      const proratedFee = denom > 0
        ? Math.round((bookingStripeFee * (monthRev / denom)) * 100) / 100
        : 0;

      totalRevenue += monthRev;
      totalStripeFees += proratedFee;

      processedReservations.push({
        guest_name: synth.guest_name || 'Guest',
        confirmation_code: installment.confirmation_code,
        check_in: synth.check_in,
        check_out: synth.check_out,
        nights: installment.installment_nights ?? 0,
        platform,
        guesty_rental_income: monthRev,
        stripe_fee: proratedFee,
        adjusted_revenue: monthRev,
        bank_deposit_amount: null,
        // Mark synthetic non-final installment rows so the UI doesn't
        // flag "missing bank deposit" -- the deposit (Stripe Payment
        // Link for SCA Direct, channel ACH for Airbnb/VRBO/Booking) lands
        // once, attached to the checkout-month statement only.
        bank_match_status: 'installment_no_bank_event',
      });
    }

    // 5. Calculate totals.
    //
    // Add-on revenue: bank_deposit_attributions rows already marked
    // 'attributed' by the operator (from a prior ingest's review queue --
    // pet fees, late checkouts, etc.) fold into rental_revenue and, when
    // apply_mgmt_fee=true (the default), into the management-fee base.
    // Linked by property_id + month so they survive the wholesale
    // delete-and-replace re-ingest pattern below.
    totalRevenue = Math.round(totalRevenue * 100) / 100;
    // Read the attributed add-on totals through the shared helper, the same
    // one every other recompute site uses. This file used to hand-roll the
    // read and omitted the `direction` column, so an attributed DEBIT was
    // added as add-on revenue instead of subtracted from the payout, and
    // attributed_debits_total was never written. The helper keeps the
    // migration-unrun tolerance (a missing table returns zeros, any other
    // read error throws rather than silently zeroing real totals).
    const { addOnsRevenue, addOnsMgmtBase, attributedDebits } = await loadAddOnTotals(
      supabase,
      propertyId,
      month,
    );
    const feeBase = Math.round((totalRevenue + addOnsMgmtBase) * 100) / 100;
    const managementFee = Math.round(feeBase * (propConfig.fee_pct / 100) * 100) / 100;
    // Owner payout deducts reserve_holdback last -- placeholder here; the
    // actual value is preserved from any existing property_statement row
    // (see section 8) and applied when we recompute after the delete-then-
    // insert. Baseline (before reserve) is captured here for clarity.
    const ownerPayoutBeforeReserve = Math.round((totalRevenue + addOnsRevenue - managementFee - cleaningTotal - repairsTotal - attributedDebits) * 100) / 100;

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

    // 8. Delete existing data for this property/period (re-upload support).
    // Also grab reserve_holdback so the operator's owner-reserve setting
    // survives the wipe-and-rebuild -- otherwise re-uploading a bank CSV
    // would silently drop a $2000 reserve back to $0. Tolerates the
    // reserve_holdback migration not having run yet: query wraps in a
    // try/catch and falls back to 0.
    const { data: existingStmt } = await supabase
      .from('property_statements')
      .select('id, reserve_holdback')
      .eq('period_id', period.id)
      .eq('property_id', propertyId)
      .single();

    const preservedReserveHoldback = Number((existingStmt as { reserve_holdback?: number } | null)?.reserve_holdback ?? 0);
    const ownerPayout = Math.round((ownerPayoutBeforeReserve - preservedReserveHoldback) * 100) / 100;

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
        add_ons_revenue: addOnsRevenue,
        attributed_debits_total: attributedDebits,
        management_fee: managementFee,
        cleaning_total: cleaningTotal,
        repairs_total: repairsTotal,
        tax_remittance: 0,
        reserve_holdback: preservedReserveHoldback,
        owner_payout: ownerPayout,
        // num_stays counts a booking ONCE on its checkout month, not on
        // every month an installment lands. Synthetic non-final-month
        // rows have check_out outside `month`, so the slice excludes them.
        num_stays: processedReservations.filter(r => r.adjusted_revenue > 0 && (r.check_out || '').slice(0, 7) === month).length,
        nights_booked: processedReservations.reduce((s, r) => s + (r.nights || 0), 0),
        has_guesty_statement: hasGuesty,
        has_platform_csv: hasPlatform,
        has_bank_csv: hasBank,
        confidence,
      })
      .select()
      .single();

    if (stmtErr) throw stmtErr;

    // The wipe above (step 8) deleted the old statement's data_gaps,
    // including the post_send_write audit row assertStatementWritable just
    // filed. A forced re-ingest of a sent/finalized month is the single
    // most destructive gated action; re-file the override on the NEW
    // statement so it stays a matter of record.
    if (finalityForced) {
      const { error: auditErr } = await supabase.from('data_gaps').insert({
        property_statement_id: stmt.id,
        gap_type: 'post_send_write',
        severity: 'warning',
        description: `Statement re-ingested (wipe and rebuild) after being marked sent or finalized. The owner's copy may no longer match Helm.`,
        expected_data: `forced ${new Date().toISOString()}`,
        resolved: false,
      });
      if (auditErr) console.error('ingest: post_send_write audit re-file failed', auditErr.message);
    }

    // 10. Insert reservations
    if (processedReservations.length > 0) {
      const { error: resErr } = await supabase
        .from('reservations')
        .insert(processedReservations.map(r => ({ property_statement_id: stmt.id, ...r })));
      if (resErr) throw resErr;
    }

    // 10b. Unmatched bank deposits -> queue for operator review.
    //
    // After the Airbnb 1:1 matcher above splices matched deposits out of
    // the `deposits` array, what's left is unmatched: Stripe batches (we
    // ignore those -- they're collectively covering Stripe-channel stays),
    // plus genuinely-off-Guesty money like a post-booking Airbnb pet fee
    // that lands in Chase but never makes it onto the Guesty statement.
    // Persist the non-Stripe leftovers as pending bank_deposit_attributions
    // so the operator can attribute them to a specific reservation (or
    // dismiss them) from the Statements page. `dedupe_key` makes re-uploads
    // idempotent; INSERT ON CONFLICT DO NOTHING preserves prior reviews.
    const monthOnly = month; // YYYY-MM
    // Inline MM/DD/YYYY -> YYYY-MM-DD here; the file's other `toISO` is
    // declared further down (cleaning-events section) so it's not visible
    // from this block.
    const depToISO = (s: string) => {
      const parts = s.split('/');
      if (parts.length !== 3) return '';
      return `${parts[2]}-${parts[0].padStart(2, '0')}-${parts[1].padStart(2, '0')}`;
    };
    // (code -> {check_out, platform}) -- check_OUT, not check_in, because
    // ancillary deposits (Airbnb pet fees, etc.) land on or right after
    // the guest leaves, so the most recently checked-out stay is the
    // intended target. Platform lets us prefer same-channel suggestions:
    // an Airbnb deposit should suggest an Airbnb guest, not the next
    // VRBO stay that happens to check in the soonest.
    const resByCode = new Map<string, { check_out: string; platform: string }>();
    for (const r of processedReservations) {
      if (r.confirmation_code) resByCode.set(r.confirmation_code, { check_out: r.check_out, platform: r.platform });
    }
    const reviewRows: Record<string, unknown>[] = [];
    for (const d of deposits) {
      if (d.source === 'stripe') continue;
      if (!(d.amount > 0)) continue;
      // Only queue deposits dated within the statement month -- a multi-
      // month Chase export carries unmatched Airbnb payouts from previous
      // months that would otherwise flood the review queue.
      if (!isInMonth(d.date, month)) continue;
      const isoDate = depToISO(d.date);
      if (!isoDate) continue;
      const depMs = new Date(isoDate + 'T00:00:00').getTime();
      const matchChannel = d.source === 'airbnb' ? 'Airbnb'
        : d.source === 'booking' ? 'Booking.com'
        : null;
      // Pass 1: closest check-out among same-channel reservations.
      let suggested: string | null = null;
      let bestDist = Infinity;
      if (matchChannel) {
        for (const [code, info] of resByCode) {
          if (info.platform !== matchChannel) continue;
          const ms = new Date(info.check_out + 'T00:00:00').getTime();
          const dist = Math.abs(ms - depMs);
          if (dist < bestDist) { bestDist = dist; suggested = code; }
        }
      }
      // Pass 2: fall back to any reservation if no same-channel match.
      if (!suggested) {
        for (const [code, info] of resByCode) {
          const ms = new Date(info.check_out + 'T00:00:00').getTime();
          const dist = Math.abs(ms - depMs);
          if (dist < bestDist) { bestDist = dist; suggested = code; }
        }
      }
      const safeDesc = (d.description || '').slice(0, 60);
      reviewRows.push({
        property_id: propertyId,
        month: monthOnly,
        deposit_date: isoDate,
        amount: Math.round(d.amount * 100) / 100,
        description: d.description || null,
        source: d.source,
        suggested_reservation_code: suggested,
        dedupe_key: `${propertyId}|${monthOnly}|${isoDate}|${Math.round(d.amount * 100) / 100}|${safeDesc}`,
      });
    }
    if (reviewRows.length > 0) {
      // Upsert with ignoreDuplicates so prior pending rows aren't disturbed
      // and existing attributed/dismissed rows survive a re-ingest.
      const { error: bdaErr } = await supabase
        .from('bank_deposit_attributions')
        .upsert(reviewRows, { onConflict: 'dedupe_key', ignoreDuplicates: true });
      if (bdaErr && bdaErr.code !== 'PGRST205' && !/does not exist|relation|Could not find the table/i.test(bdaErr.message || '')) {
        // Don't fail the whole ingest if the review queue insert errors --
        // log and continue (the statement totals are already correct).
        console.warn('bank_deposit_attributions insert failed:', bdaErr.message);
      }
    }

    // Internal sweeps: Rising Tide's own money leaving the property account.
    //
    // Occupancy tax goes to *9928 (the account MassTaxConnect pays from) and
    // the VRBO-commission and management-fee settlements go to *5130 (RT
    // operating). None is an owner expense -- the tax was never owner
    // revenue, and the commission and fee are already deducted on the
    // statement -- but all three look exactly like an unattributed charge,
    // so the operator has been dismissing them by hand every close.
    //
    // The sweep pays the PRIOR month's sheet: Massachusetts files room
    // occupancy 30 days after period end, and the operator moves tax and
    // commission together that day. Reading against the landing month ties
    // nothing; reading against M-1 ties to the cent.
    //
    // Ordering is safe. This route only ever rewrites THIS month's period,
    // so the M-1 rows read below are stable for the whole request and
    // cannot race the delete-and-replace further up.
    const debitDedupeKey = (isoDate: string, amount: number, desc: string) =>
      `${propertyId}|${monthOnly}|${isoDate}|${Math.round(amount * 100) / 100}|debit|${(desc || '').slice(0, 60)}`;
    const sweepVerdicts = new Map<string, SweepVerdict>();
    let taxSweepDrift: { moved: number; expected: number; month: string } | null = null;
    if (unmatchedDebits.length > 0) {
      const transferCandidates: TransferCandidate[] = [];
      for (const d of unmatchedDebits) {
        const t = parseInternalTransfer((d.description || '').toUpperCase());
        if (!t?.outbound) continue;
        const isoDate = depToISO(d.date);
        if (!isoDate) continue;
        transferCandidates.push({
          key: debitDedupeKey(isoDate, d.amount, d.description),
          last4: t.last4,
          amount: Math.round(d.amount * 100) / 100,
          date: isoDate,
        });
      }
      if (transferCandidates.length > 0) {
        const prevMonth = remittanceMonthFor(monthOnly);
        let expected: SweepExpectations | null = null;
        try {
          const [sheet, prevStmt] = await Promise.all([
            buildRemittanceSheet(supabase, prevMonth, { propertyId }),
            supabase
              .from('property_statements')
              .select('management_fee, statement_periods!inner(month)')
              .eq('property_id', propertyId)
              .eq('statement_periods.month', prevMonth)
              .maybeSingle(),
          ]);
          // Fail-visible: a PostgREST failure lands on .error, not as a
          // throw, so without this the management-fee leg would quietly
          // switch itself off and every month-start transfer would sit in
          // the queue with no clue why.
          if (prevStmt.error) {
            console.warn(`internal sweep: ${prevMonth} management fee unreadable for ${propertyId}: ${prevStmt.error.message}`);
          }
          const row = sheet.rows.find(r => r.propertyId === propertyId);
          if (row) {
            const fee = (prevStmt.data as { management_fee: number | string | null } | null)?.management_fee;
            expected = {
              taxToRemit: row.taxToRemit,
              vrboCommissionSweep: row.vrboCommissionSweep,
              managementFee: fee === null || fee === undefined ? null : Number(fee) || 0,
              sweepEstimated: row.sweepEstimated,
            };
          }
        } catch (err) {
          // A missing or unreadable prior sheet means "cannot evaluate",
          // which parks every *5130 row for the operator exactly as today.
          // It must never read as "not a sweep, therefore an expense".
          console.warn('internal sweep: prior-month sheet unavailable', err);
        }
        const verdicts = classifyInternalTransfers(transferCandidates, expected, {
          tax: TAX_REMITTANCE_ACCOUNT,
          operating: RT_OPERATING_ACCOUNT,
        });
        for (const v of verdicts) sweepVerdicts.set(v.key, v);
        const taxLeg = verdicts.filter(v => v.kind === 'tax-sweep');
        if (taxLeg.length > 0 && taxLeg[0].evaluated && !taxLeg[0].reconciles) {
          const movedKeys = new Set(taxLeg.map(v => v.key));
          taxSweepDrift = {
            moved: Math.round(transferCandidates
              .filter(c => movedKeys.has(c.key))
              .reduce((sum, c) => sum + c.amount, 0) * 100) / 100,
            expected: taxLeg[0].expected ?? 0,
            month: prevMonth,
          };
        }
      }
    }

    // Same idea for the unmatched-debit side. We share the same table with
    // direction='debit' so the UI can render both queues from one source,
    // and so a future "what's pending across this month" view can JOIN once.
    if (unmatchedDebits.length > 0) {
      const debitReviewRows = unmatchedDebits.map(d => {
        const isoDate = depToISO(d.date);
        const dedupe_key = debitDedupeKey(isoDate, d.amount, d.description);
        return {
          property_id: propertyId,
          month: monthOnly,
          direction: 'debit',
          deposit_date: isoDate,
          amount: Math.round(d.amount * 100) / 100,
          description: d.description || null,
          // A recognized internal sweep is filed out of the operator's way
          // by its source; it still lands as status='pending', which every
          // payout recompute site ignores, so nothing here moves money.
          source: sweepVerdicts.get(dedupe_key)?.source ?? 'other',
          suggested_reservation_code: null,
          // Direction baked into the key so a deposit and a debit of the
          // same date / amount / description don't collide.
          dedupe_key,
        };
      }).filter(r => r.deposit_date);
      if (debitReviewRows.length > 0) {
        const { error: bdaDebitErr } = await supabase
          .from('bank_deposit_attributions')
          .upsert(debitReviewRows, { onConflict: 'dedupe_key', ignoreDuplicates: true });
        if (bdaDebitErr && bdaDebitErr.code !== 'PGRST205' && !/does not exist|relation|Could not find the table|direction/i.test(bdaDebitErr.message || '')) {
          // Tolerate the table-doesn't-exist and direction-column-missing
          // states gracefully; statement totals are unaffected either way.
          console.warn('bank_deposit_attributions (debit) insert failed:', bdaDebitErr.message);
        }
      }
    }

    // Vendor refunds that could NOT be auto-netted (no same-month exact-
    // amount charge: partial refund, refund of a prior month's charge, or a
    // maintenance vendor). Park them in the review queue -- they also raise
    // a critical data gap in section 12 so nobody has to scan line items to
    // notice a vendor sent money back.
    if (unmatchedVendorCredits.length > 0) {
      const creditReviewRows = unmatchedVendorCredits.map(c => {
        const isoDate = depToISO(c.date);
        const safeDesc = (c.description || '').slice(0, 60);
        return {
          property_id: propertyId,
          month: monthOnly,
          direction: 'deposit',
          deposit_date: isoDate,
          amount: Math.round(c.amount * 100) / 100,
          description: c.description || null,
          source: 'vendor-refund',
          suggested_reservation_code: null,
          dedupe_key: `${propertyId}|${monthOnly}|${isoDate}|${Math.round(c.amount * 100) / 100}|${safeDesc}`,
        };
      }).filter(r => r.deposit_date);
      if (creditReviewRows.length > 0) {
        const { error: bdaCreditErr } = await supabase
          .from('bank_deposit_attributions')
          .upsert(creditReviewRows, { onConflict: 'dedupe_key', ignoreDuplicates: true });
        if (bdaCreditErr && bdaCreditErr.code !== 'PGRST205' && !/does not exist|relation|Could not find the table|direction/i.test(bdaCreditErr.message || '')) {
          console.warn('bank_deposit_attributions (vendor refund) insert failed:', bdaCreditErr.message);
        }
      }
    }

    // 11. Insert cleaning events. Cape Ann Elite cleanings get the 1:1
    //     reservation-checkout match (see matchCleaningsToReservations).
    //     Nor'East linen charges are appended as additive, vendor-tagged
    //     rows that are NOT matched to a checkout -- a linen pickup isn't a
    //     turnover, so it must not consume a match slot or inflate the
    //     "N turns" count. Both vendors land in cleaning_total.
    const toISO = (d: string) => {
      const parts = d.split('/');
      if (parts.length !== 3) return '';
      return `${parts[2]}-${parts[0].padStart(2, '0')}-${parts[1].padStart(2, '0')}`;
    };
    type CleaningEventInsert = {
      property_statement_id: string;
      guest_name: string | null;
      checkout_date: string | null;
      bank_charge_amount: number;
      bank_charge_date: string | null;
      amount: number;
      source: string;
      vendor: string;
      // Auto-netted vendor refund (same fields Mark Duplicate writes).
      credit_amount?: number;
      credit_reason?: string;
    };
    const creditFields = (c: VendorCharge) =>
      c.credit_amount ? { credit_amount: c.credit_amount, credit_reason: c.credit_reason } : {};
    const cleaningInserts: CleaningEventInsert[] = [];
    if (cleaningCharges.length > 0) {
      for (const m of matchCleaningsToReservations(cleaningCharges, processedReservations)) {
        cleaningInserts.push({
          property_statement_id: stmt.id,
          guest_name: m.matchedGuest,
          checkout_date: m.matchedCheckout,
          bank_charge_amount: m.charge.amount,
          bank_charge_date: toISO(m.charge.date) || null,
          amount: m.charge.amount,
          source: m.matchedGuest ? 'matched' : 'bank',
          vendor: CLEANING_VENDOR_DEFAULT,
          ...creditFields(m.charge),
        });
      }
    }
    for (const c of linenCharges) {
      cleaningInserts.push({
        property_statement_id: stmt.id,
        guest_name: null,
        checkout_date: null,
        bank_charge_amount: c.amount,
        bank_charge_date: toISO(c.date) || null,
        amount: c.amount,
        source: 'bank-linen',
        vendor: LINEN_VENDOR_NAME,
        ...creditFields(c),
      });
    }
    // Laundry Plus charges. Additive to cleaning_total (owner-facing single
    // "Cleaning" line stays folded). Attribute each charge to the nearest
    // Cape Ann Elite cleaning by bank_charge_date if one is within 7 days,
    // so the dashboard groups the laundry row next to the associated
    // turnover. If nothing is within range (all-direct property, or laundry
    // billed with no cleaning that month), leave checkout_date + guest_name
    // null -- displays as a standalone "Laundry service" row like linens.
    for (const c of laundryCharges) {
      const cIsoStr = toISO(c.date);
      const cMs = cIsoStr ? new Date(cIsoStr + 'T00:00:00Z').getTime() : null;
      let nearest: { guest: string | null; checkout: string | null; deltaMs: number } | null = null;
      if (cMs !== null) {
        for (const ins of cleaningInserts) {
          if (ins.source !== 'matched' && ins.source !== 'bank') continue;
          if (!ins.bank_charge_date) continue;
          const insMs = new Date(ins.bank_charge_date + 'T00:00:00Z').getTime();
          const deltaMs = Math.abs(insMs - cMs);
          if (!nearest || deltaMs < nearest.deltaMs) {
            nearest = { guest: ins.guest_name, checkout: ins.checkout_date, deltaMs };
          }
        }
      }
      const withinWindow = nearest && nearest.deltaMs <= 7 * 24 * 60 * 60 * 1000;
      cleaningInserts.push({
        property_statement_id: stmt.id,
        guest_name: withinWindow ? nearest!.guest : null,
        checkout_date: withinWindow ? nearest!.checkout : null,
        bank_charge_amount: c.amount,
        bank_charge_date: cIsoStr || null,
        amount: c.amount,
        source: 'bank-laundry',
        vendor: LAUNDRY_VENDOR_NAME,
        ...creditFields(c),
      });
    }
    await insertCleaningEvents(supabase, cleaningInserts);

    // 11b. Insert repair events: handyman / vendor charges from the bank,
    // plus one mirror row per active receipt (source='receipt') so the
    // dashboard's Repairs & Maintenance section shows receipt line items.
    // Mirror rows are rebuilt after the wholesale delete in section 8, same
    // as bank rows, so they can never double-count. Tolerance also matches
    // PostgREST's missing-COLUMN message ("Could not find the '...' column")
    // so a half-applied schema (repair_events exists, receipt_id missing)
    // degrades instead of 500ing -- same precedent as the direction-column
    // tolerance on the debit upsert above.
    {
      type RepairEventInsert = {
        property_statement_id: string;
        vendor_name: string | null;
        description: string | null;
        bank_charge_date: string | null;
        bank_charge_amount: number;
        source: string;
        receipt_id?: string;
      };
      const repairInserts: RepairEventInsert[] = repairCharges.map(c => {
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
      for (const r of activeReceipts) {
        repairInserts.push({
          property_statement_id: stmt.id,
          vendor_name: r.vendor_name,
          description: r.description,
          bank_charge_date: r.expense_date,
          bank_charge_amount: Math.round((Number(r.amount) || 0) * 100) / 100,
          source: 'receipt',
          receipt_id: r.id,
        });
      }
      if (repairInserts.length > 0) {
        const { error: repErr } = await supabase
          .from('repair_events')
          .insert(repairInserts);
        if (repErr && repErr.code !== 'PGRST205' && !/does not exist|relation|Could not find the table|Could not find the '.*' column/i.test(repErr.message || '')) throw repErr;
        if (repErr) console.warn('repair_events insert skipped (schema missing -- run supabase-schema-repairs.sql + the property_receipts migration):', repErr.message);
      }
    }

    // 12. Data gap flags
    const gaps: { gap_type: string; description: string; severity: string; expected_data: string }[] = [];
    // `foreignPdfSection` also lands here as !hasGuesty (it books zero
    // reservations, which is what drives confidence to red -- and red keeps
    // it out of Draft All). Skip the vague "none provided" gap in that case;
    // the specific wrong-property gap below says the useful thing.
    if (!hasGuesty && !foreignPdfSection) gaps.push({ gap_type: 'missing_guesty', description: 'No Guesty owner statement provided', severity: 'critical', expected_data: `Guesty owner statement for ${propConfig.name} - ${month}` });
    if (!hasPlatform) gaps.push({ gap_type: 'no_platform_match', description: 'No platform CSV -- cannot determine booking channels', severity: 'warning', expected_data: `Platform CSV from Guesty for ${month}` });
    if (!hasBank) gaps.push({ gap_type: 'missing_bank_csv', description: 'No bank statement for deposit/cleaning verification', severity: 'warning', expected_data: `Chase bank CSV for ...${propConfig.bank_last4}` });

    // The uploaded owner statement describes a different property, so no
    // revenue was taken from it. Either the wrong PDF was picked, or it is
    // the right owner's PDF in a month where this house had no bookings.
    // Both need a human; booking the other house's revenue here would have
    // applied THIS property's management fee to it.
    if (foreignPdfSection) {
      gaps.push({
        gap_type: 'guesty_pdf_wrong_property',
        description: `The uploaded owner statement's only section is "${foreignPdfSection.listing}", which belongs to ${foreignPdfSection.property_id}, not ${propConfig.name}. No reservations were taken from it. If ${propConfig.name} genuinely had no bookings this month, resolve this gap; otherwise re-upload the correct PDF.`,
        severity: 'critical',
        expected_data: `Guesty owner statement covering ${propConfig.name} - ${month}`,
      });
    }

    // Vendors never pay us -- a vendor credit is always a refund. When one
    // can't be netted automatically (no same-month exact-amount charge), it
    // must be resolved by hand, so make it impossible to miss.
    for (const c of unmatchedVendorCredits) {
      gaps.push({
        gap_type: 'vendor_refund_unapplied',
        description: `${c.vendor} sent money BACK: $${c.amount.toFixed(2)} credit on ${c.date} with no same-amount ${c.kind} charge this month to net it against. If it refunds a prior month's charge, apply a credit on that statement's row (Mark Duplicate); the credit is also parked in the bank review queue.`,
        severity: 'critical',
        expected_data: `Matching ${c.vendor} charge for $${c.amount.toFixed(2)}`,
      });
    }

    // The tax sweep is provably occupancy tax -- it went to the tax-only
    // account -- so when Helm cannot reproduce the amount, the missing
    // piece is Helm's, not the wire's. A sweep larger than the computed
    // tax means reservations for that month never made it in. 16 Waterman
    // moved $504.04 against a computed $0, which at the 11.7% Cape Ann rate
    // implies a ~$4,308 VRBO stay that was never ingested. Raised as a
    // warning rather than parked in the review queue, because the money
    // itself needs no operator decision -- the missing stay does.
    if (taxSweepDrift) {
      const { moved, expected: due, month: taxMonth } = taxSweepDrift;
      gaps.push({
        gap_type: 'tax_sweep_unreconciled',
        description: `Occupancy tax swept to *${TAX_REMITTANCE_ACCOUNT} was $${moved.toFixed(2)}, but the ${taxMonth} remittance sheet computes $${due.toFixed(2)} for this property (difference $${Math.abs(moved - due).toFixed(2)}). The wire is real money that left the account, so the gap is almost always a stay Helm never ingested for ${taxMonth} -- check that month's reservations before filing.`,
        severity: 'warning',
        expected_data: `${taxMonth} reservations reconciling to $${moved.toFixed(2)} of occupancy tax`,
      });
    }

    for (const r of recognizedElsewhere) {
      gaps.push({
        gap_type: 'installment_recognized_elsewhere',
        description: `${r.guest} (${r.code}) is on this month's Guesty statement at full value but was excluded here: the booking is split via installments and its slices (${r.months.join(', ')}, $${r.amount.toFixed(2)} total) recognize it fully in those months. Adding it here too would pay the owner twice. This is expected for a long stay checking out on the 1st.`,
        severity: 'info',
        expected_data: `No action needed unless the split is wrong -- edit the installments for ${r.code} if so`,
      });
    }

    for (const m of installmentSpanMismatches) {
      gaps.push({
        gap_type: 'installment_outside_stay_span',
        description: `Installment slice ${m.code} / ${m.month} for $${m.amount.toFixed(2)} was NOT added to this statement: the booking stays ${m.checkIn} to ${m.checkOut} and never touches ${m.month}, so it isn't a cross-month split. If this money belongs here it is almost certainly already on the statement as an attributed add-on -- injecting it too would double-count it.`,
        severity: 'warning',
        expected_data: `Delete the reservation_installments row ${m.code}|${m.month}, or re-slice the split so every month falls inside ${m.checkIn} to ${m.checkOut}`,
      });
    }

    if (unresolvedNameCodes.length > 0) {
      gaps.push({
        gap_type: 'unresolved_guest_names',
        description: `${unresolvedNameCodes.length} reservation${unresolvedNameCodes.length === 1 ? '' : 's'} couldn't resolve a guest name from the platform CSV or guesty_reservations table`,
        severity: 'warning',
        expected_data: `Upload the Guesty reservations CSV (covers ${unresolvedNameCodes.join(', ')})`,
      });
    }

    // Bookings the PDF listed that check out in another month. Held out of
    // the payout by the statement-month gate; named here so the operator
    // sees what Guesty tried to bill this month and can confirm each one
    // lands on its real month instead of falling through the cracks.
    //
    // Deliberately a GAP and not a refusal. An earlier draft returned 400
    // when every parsed row was out of month, on the theory that this can
    // only mean the wrong PDF. It can also mean an ordinary shoulder-season
    // month whose single booking checks out on the 2nd of the next one, and
    // refusing there blocks the whole property-month -- cleaning, repairs,
    // add-ons and any synthetic installment slice included -- while telling
    // the operator to re-download the file they already attached correctly.
    // That is the same trade the foreignSingleSection guard above resolves
    // the same way: ingest, recognize nothing, and say so loudly.
    //
    // Protecting an already-sent statement is not this guard's job either;
    // that is the finality freeze, which now covers every month.
    if (outOfMonthRows.length > 0) {
      const allOutOfMonth = outOfMonthRows.length === reservations.length;
      const pdfMonths = [...new Set(outOfMonthRows.map(r => r.checkOut.slice(0, 7)))].sort();
      gaps.push({
        gap_type: 'out_of_month_reservation',
        description:
          `${outOfMonthRows.length} booking${outOfMonthRows.length === 1 ? '' : 's'} on Guesty's ${month} PDF `
          + `check${outOfMonthRows.length === 1 ? 's' : ''} out in another month and ${outOfMonthRows.length === 1 ? 'was' : 'were'} `
          + `NOT counted here (revenue is recognized at checkout): `
          + outOfMonthRows.map(r => `${r.guest || r.code} checks out ${r.checkOut} ($${r.amount})`).join('; ')
          + (allOutOfMonth
            ? `. NOTHING on this PDF checks out in ${month} -- it looks like ${pdfMonths.join(' / ')}'s owner `
              + `statement was attached to ${month}. Check the file before trusting this statement; `
              + `re-ingesting ${month} with the right PDF is safe.`
            : `. Confirm ${outOfMonthRows.length === 1 ? 'it lands' : 'they land'} on the right month's statement.`),
        severity: allOutOfMonth ? 'critical' : 'warning',
        expected_data: outOfMonthRows.map(r => `${r.code}:${r.checkOut}`).join(', '),
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

    // Cancellation guard. Airbnb / Booking.com ALWAYS pay a bank deposit, so
    // an unmatched-bank reservation on one of those channels is a strong
    // cancel tell (the leak that put a cancelled Christina Gagnon on 3 South's
    // June statement -- Guesty's PDF still listed her, our status cache was
    // frozen at "confirmed"). Live-check ONLY these bounded suspects against
    // Guesty (never per-reservation over the month) and raise a LOUD gap for
    // any that actually cancelled. Flag-only: the operator removes it with one
    // click. Wrapped so a Guesty outage/429 never breaks the ingest.
    //
    // A bank match does NOT clear a booking. The deposit scan searches every
    // date on purpose, so an unrelated payout landing within $5 can claim a
    // cancelled stay and lift it out of `unmatched` before this guard runs --
    // which is exactly how a cancelled Sarah Strickland rode 20 Enon's August
    // 2026 statement with bank_match_status 'matched' and zero gaps. So the
    // suspect set is the UNION of two sources:
    //   1. unmatched Airbnb/Booking rows -- the original bounded tell, still
    //      the only source that spends a live API call it didn't have to, and
    //   2. any row our own cache already calls cancelled, at ANY match status.
    //      The cache under-reports cancels (it freezes at "confirmed" when it
    //      synced before the cancel) but it never invents one, so a cached
    //      cancel is free, trustworthy, and needs no call at all.
    // Source 2 adds no Guesty traffic, which keeps the per-code live check
    // inside the bound its docblock demands.
    try {
      const isAlwaysPaysChannel = (platform: string) => {
        const p = (platform || '').toUpperCase();
        return p === 'AIRBNB' || p.includes('BOOKING');
      };
      const cancelSuspects = new Map<string, (typeof processedReservations)[number]>();
      for (const r of unmatched) {
        if (isAlwaysPaysChannel(r.platform)) cancelSuspects.set(r.confirmation_code, r);
      }
      for (const r of processedReservations) {
        if (r.adjusted_revenue <= 0) continue;
        if (isCancelledStatus(guestyLookupMap.get(r.confirmation_code)?.status)) {
          cancelSuspects.set(r.confirmation_code, r);
        }
      }
      if (cancelSuspects.size > 0) {
        const suspects = [...cancelSuspects.values()];
        const liveStatus = await checkLiveGuestyStatus(suspects.map(r => r.confirmation_code));
        for (const r of suspects) {
          // Either signal is enough. Live is authoritative when it answers;
          // when it doesn't (429 / network / no creds it returns nothing), a
          // cached cancel must still raise the flag rather than fall silent.
          const cached = guestyLookupMap.get(r.confirmation_code)?.status;
          if (!isCancelledStatus(liveStatus.get(r.confirmation_code)) && !isCancelledStatus(cached)) continue;
          const matchNote = r.bank_match_status === 'unmatched'
            ? ''
            : ` It carries a ${r.bank_match_status} bank match, which does NOT make it real -- check what that deposit actually belongs to.`;
          gaps.push({
            gap_type: 'cancelled_reservation',
            description: `${r.guest_name} CANCELLED in Guesty but is still on this statement at $${r.adjusted_revenue}. Remove it -- this booking never paid.${matchNote}`,
            severity: 'critical',
            // Carries the code so the Remove action can find the exact row.
            expected_data: `reservation:${r.confirmation_code}`,
          });
        }
      }
    } catch (err) {
      console.warn('cancel-check skipped:', err instanceof Error ? err.message : err);
    }

    // Revenue reconstruction gaps:
    //  - missing_guest_gross: one or more VRBO/Manual reservations don't
    //    have TOTAL_PAID in guesty_reservations, so Stripe fee fell back
    //    to the old approximation on Guesty's net. Usually fixes itself
    //    after a fresh Upload Reservations CSV run.
    //  - revenue_reconciliation: three things a VRBO/Manual stay can want
    //    to say. (a) TOTAL_PAID came in short of the booking's folio, so
    //    revenue was recognized on the folio instead. (b) The legacy 4.4%
    //    commission strip fired -- always announced, never silent, because
    //    a false positive there is otherwise invisible. (c) Our
    //    reconstructed pre-Stripe net diverges from Guesty's implied net by
    //    >$2 -- sometimes a discount, refund, or unusual commission that
    //    our formula didn't model.
    if (missingGrossCodes.length > 0) {
      gaps.push({
        gap_type: 'missing_guest_gross',
        description: `${missingGrossCodes.length} reservation${missingGrossCodes.length === 1 ? '' : 's'} without TOTAL_PAID in Guesty. Common for staycapeann.com bookings (payment goes through RT's Stripe directly, not Guesty). Helm will match these to Stripe by amount on the next "Sync Stripe" run and use the real fee; until then the stripe_fee is a 3.9% approximation.`,
        severity: 'info',
        expected_data: `Run Sync Stripe to match by amount (${missingGrossCodes.join(', ')})`,
      });
    }
    if (reconciliationGaps.length > 0) {
      gaps.push({
        gap_type: 'revenue_reconciliation',
        description: `Revenue reconstruction has something to declare on ${reconciliationGaps.length} stay${reconciliationGaps.length === 1 ? '' : 's'}: a partial TOTAL_PAID recognized on the folio instead, a legacy commission strip that fired, or a net that drifts from Guesty's implied net (usually a discount, refund, or non-standard commission). Each line says which.`,
        severity: 'info',
        expected_data: reconciliationGaps.join('; '),
      });
    }

    // Missed-Direct guard: a confirmed Direct/Manual stay in
    // guesty_reservations whose folio carries real accommodation fare but
    // which never landed on this statement. Guesty's owner statement PDF
    // omits stays with no owner revenue (Business model unset) and Refresh
    // skips Direct stays Guesty shows as unpaid, so a five-figure booking
    // can vanish with the statement still reading "0 gaps" -- Martha
    // Mazzone (GY-ZUnEnMgw, $29k, Aug 2026) did exactly that. Flag-only:
    // the operator decides; nothing is inserted and no payout math moves.
    // Runs after section 10 so the statement's reservation rows are
    // queryable; wrapped so a read failure never breaks the ingest.
    try {
      const missedDirect = await detectMissingDirectStays(supabase, {
        propertyStatementId: stmt.id,
        propertyId,
        month,
      });
      gaps.push(...missingDirectGapRows(missedDirect, month));
    } catch (err) {
      console.warn('missing-direct check skipped:', err instanceof Error ? err.message : err);
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
    // 9x. The single write path is the last word on every money column.
    //     Every child row is in place now, so it recomputes the statement
    //     from those rows exactly as any later writer will, with repairs and
    //     reserve passed as the owned terms this route computed. Its number
    //     should equal the one inserted above; if it does not, that is a
    //     live self-check failure worth a flag rather than a silent
    //     overwrite in either direction. The write path's value wins because
    //     it is the value every subsequent recompute would produce.
    const ingestTotals = await writeStatementTotals(supabase, stmt.id, {
      action: 'Ingest',
      repairsTotal,
      reserveHoldback: preservedReserveHoldback,
      assertedFreeze: finalityGate ?? undefined,
    });
    if (Math.abs(ingestTotals.after.owner_payout - ownerPayout) > 0.02) {
      const { error: selfErr } = await supabase.from('data_gaps').insert({
        property_statement_id: stmt.id,
        gap_type: 'ingest_recompute_mismatch',
        severity: 'warning',
        description: `Ingest computed an owner payout of $${ownerPayout.toFixed(2)} but recomputing from the rows it wrote gives $${ingestTotals.after.owner_payout.toFixed(2)}. The row-derived figure is what every later recompute will produce, so it is the one stored; the discrepancy itself is the thing to explain.`,
        expected_data: `ingest ${ownerPayout.toFixed(2)} vs rows ${ingestTotals.after.owner_payout.toFixed(2)} · ${new Date().toISOString()}`,
        resolved: false,
      });
      if (selfErr) console.error('ingest: self-check gap insert failed', selfErr.message);
    }

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
            reserve_holdback: preservedReserveHoldback,
          },
        });
        if (stripeSync.fee_updates.length > 0 || stripeSync.gross_reconstructions.length > 0) {
          // Sync just rewrote rental_revenue/management_fee/owner_payout.
          // Refetch so the response summary shows the post-sync numbers,
          // not the pre-sync estimates.
          const { data: refreshed } = await supabase
            .from('property_statements')
            .select('rental_revenue, management_fee, owner_payout')
            .eq('id', stmt.id)
            .single();
          if (refreshed) postSyncTotals = refreshed as PostSyncTotals;
          // Same for the per-reservation rows the response table renders:
          // fee corrections and gross reconstructions land on the DB rows
          // after processedReservations was built, so re-read the two
          // mutated columns and patch by confirmation code. Without this
          // the Parsed Reservations table shows pre-sync nets that no
          // longer add up to the summary totals.
          const { data: freshRows } = await supabase
            .from('reservations')
            .select('confirmation_code, stripe_fee, adjusted_revenue')
            .eq('property_statement_id', stmt.id);
          const freshByCode = new Map((freshRows || []).map(r => [r.confirmation_code, r]));
          for (const pr of processedReservations) {
            const fresh = freshByCode.get(pr.confirmation_code);
            if (fresh) {
              pr.stripe_fee = fresh.stripe_fee ?? pr.stripe_fee;
              pr.adjusted_revenue = fresh.adjusted_revenue ?? pr.adjusted_revenue;
            }
          }
        }
      } catch (err) {
        console.warn('Stripe auto-sync failed:', err);
        stripeSync = {
          property_id: propertyId,
          charges_found: 0, matched: 0,
          unmatched_charges: [], fee_updates: [], refunds_detected: [],
          gross_mismatches: [], gross_reconstructions: [], collected_rebuilds: [], reservations_missing_charge: [],
          error: err instanceof Error ? err.message : String(err),
        };
      }
    } else {
      // No Stripe key for this property. Airbnb/Booking-only listings
      // legitimately need none, but a property with VRBO/Direct stays is
      // simply never synced -- its fees keep the 3.9% estimate and nothing
      // said so. Filed HERE, at the end of ingest, because the wipe-and-
      // rebuild earlier in this route would have deleted an earlier row.
      try {
        const { raised, rtStays } = await reportMissingStripeKey(supabase, {
          propertyId, statementId: stmt.id, month,
        });
        if (raised) {
          stripeSync = {
            property_id: propertyId,
            charges_found: 0, matched: 0,
            unmatched_charges: [], fee_updates: [], refunds_detected: [],
            gross_mismatches: [], gross_reconstructions: [], collected_rebuilds: [], reservations_missing_charge: [],
            no_stripe_key: true,
            error: `No Stripe key configured for this property; ${rtStays} VRBO/Direct stay${rtStays === 1 ? '' : 's'} are on the 3.9% fee estimate.`,
          };
        }
      } catch (err) {
        // The check itself failed, so we do NOT know whether this property
        // needs a key. Report it on the response rather than let silence
        // read as "checked, nothing to flag".
        console.error('ingest: missing-key check failed', err);
        stripeSync = {
          property_id: propertyId,
          charges_found: 0, matched: 0,
          unmatched_charges: [], fee_updates: [], refunds_detected: [],
          gross_mismatches: [], gross_reconstructions: [], collected_rebuilds: [], reservations_missing_charge: [],
          error: `Could not check whether this property needs a Stripe key: ${err instanceof Error ? err.message : String(err)}`,
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
        // Post-sync figures first, then the write path's (the value actually
        // stored), never ingest's own pre-check locals: when the self-check
        // above overrode them, echoing them here would report a payout that
        // is not on the statement.
        total_revenue: postSyncTotals?.rental_revenue ?? ingestTotals.after.rental_revenue,
        stripe_fees: totalStripeFees,
        management_fee: postSyncTotals?.management_fee ?? ingestTotals.after.management_fee,
        cleaning_total: ingestTotals.after.cleaning_total,
        owner_payout: postSyncTotals?.owner_payout ?? ingestTotals.after.owner_payout,
        confidence,
        data_gaps: gaps.length + (stripeSync?.refunds_detected.length || 0) + (stripeSync?.gross_mismatches.length || 0) + (stripeSync?.reservations_missing_charge.length || 0),
      },
      stripe_sync: stripeSync,
      // Non-null when the uploaded PDF described a different property and no
      // revenue was taken from it. Surfaced here as well as in data_gaps so
      // the operator sees it on the upload screen, not just on the dashboard.
      wrong_property_pdf: foreignPdfSection,
      platform_csv_source: platformCsvSource,
      parsed_reservations: processedReservations,
      installments_recognized_elsewhere: recognizedElsewhere,
      debug: { pdf_text_preview: pdfDebug, bank_rows_in_month: bankRows.filter(r => isInMonth(r['Posting Date'] || '', month)).length },
    });
  } catch (err) {
    console.error('Ingest error:', err);
    return NextResponse.json({ error: err instanceof Error ? err.message : JSON.stringify(err) }, { status: 500 });
  }
}
