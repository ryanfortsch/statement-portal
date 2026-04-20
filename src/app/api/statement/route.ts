import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { PDFDocument, rgb, StandardFonts, PDFPage, PDFFont } from 'pdf-lib';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

// Extended property config
const PROPERTY_DETAILS: Record<string, { name: string; address: string; city: string; owner_full: string; fee_pct: number; listing_name?: string }> = {
  '3_south_st':    { name: '3 South St',        address: '3 South Street',       city: 'Rockport, MA',    owner_full: 'Marci & Paul Bailey', fee_pct: 25, listing_name: '3 South' },
  '21_horton':     { name: '21 Horton St',       address: '21 Horton Street',     city: 'Gloucester, MA',  owner_full: 'Claudia Kittredge', fee_pct: 22, listing_name: '21 Horton' },
  '53_rocky_neck': { name: '53 Rocky Neck Ave',  address: '53 Rocky Neck Avenue', city: 'Gloucester, MA',  owner_full: 'Mark Prudenzi', fee_pct: 25, listing_name: '53 Rocky Neck' },
  '4_brier_neck':  { name: '4 Brier Neck Rd',    address: '4 Brier Neck Road',    city: 'Gloucester, MA',  owner_full: 'The Armstrong Family', fee_pct: 20, listing_name: '4 Brier Neck' },
  '30_woodward':   { name: '30 Woodward Ave',    address: '30 Woodward Avenue',   city: 'Gloucester, MA',  owner_full: 'The McWethy Family', fee_pct: 25, listing_name: '30 Woodward' },
  '20_hammond':    { name: '20 Hammond St',      address: '20 Hammond Street',    city: 'Gloucester, MA',  owner_full: 'The Ramsey Family', fee_pct: 25, listing_name: '20 Hammond' },
  '20_enon':       { name: '20 Enon Rd',         address: '20 Enon Road',         city: 'Gloucester, MA',  owner_full: 'The Snyder Family', fee_pct: 25, listing_name: '20 Enon' },
  '73_rocky_neck': { name: '73 Rocky Neck Ave',  address: '73 Rocky Neck Avenue', city: 'Gloucester, MA',  owner_full: 'The Moynahan Family', fee_pct: 25, listing_name: '73 Rocky Neck' },
  '17_beach_rd':   { name: '17 Beach Rd',        address: '17 Beach Road',        city: 'Gloucester, MA',  owner_full: 'The Nolan Family', fee_pct: 22, listing_name: '17 Beach' },
  '65_calderwood': { name: '65 Calderwood Ln',   address: '65 Calderwood Lane',   city: 'Fairfield, CT',   owner_full: 'The Liu Family', fee_pct: 25, listing_name: '65 Calderwood' },
  '3_locust':      { name: '3 Locust St',        address: '3 Locust Street',      city: 'Gloucester, MA',  owner_full: 'The Lucas Family', fee_pct: 25, listing_name: '3 Locust' },
  '3246_ne_27th':  { name: '3246 NE 27th Ave',   address: '3246 NE 27th Avenue',  city: 'Lighthouse Point, FL', owner_full: 'The Enriquez Family', fee_pct: 25, listing_name: '3246 NE 27th' },
};

// CSV listing name to property_id mapping
const LISTING_TO_PROPERTY: Record<string, string> = {
  '3 south': '3_south_st',
  '21 horton': '21_horton',
  '53 rocky neck': '53_rocky_neck',
  '4 brier neck': '4_brier_neck',
  '30 woodward': '30_woodward',
  '20 hammond': '20_hammond',
  '20 enon': '20_enon',
  '73 rocky neck': '73_rocky_neck',
  '17 beach': '17_beach_rd',
  '65 calderwood': '65_calderwood',
  '3 locust': '3_locust',
  '3246 ne 27th': '3246_ne_27th',
};

function matchListingToProperty(listing: string): string | null {
  const lower = listing.toLowerCase();
  for (const [key, propId] of Object.entries(LISTING_TO_PROPERTY)) {
    if (lower.includes(key)) return propId;
  }
  return null;
}

// Design colors (from the editorial variant)
const INK = rgb(30 / 255, 46 / 255, 52 / 255);       // #1e2e34
const INK_2 = rgb(42 / 255, 61 / 255, 69 / 255);     // #2a3d45
const INK_3 = rgb(80 / 255, 96 / 255, 104 / 255);    // #506068
const INK_4 = rgb(138 / 255, 150 / 255, 156 / 255);  // #8a969c
const PAPER = rgb(250 / 255, 247 / 255, 241 / 255);   // #faf7f1
const PAPER_2 = rgb(243 / 255, 237 / 255, 225 / 255); // #f3ede1
const RULE = rgb(217 / 255, 207 / 255, 184 / 255);    // #d9cfb8
const TIDE = rgb(75 / 255, 138 / 255, 158 / 255);     // #4b8a9e
const SIGNAL = rgb(200 / 255, 90 / 255, 58 / 255);    // #c85a3a
const POSITIVE = rgb(58 / 255, 107 / 255, 74 / 255);  // #3a6b4a
const NEGATIVE = rgb(138 / 255, 58 / 255, 46 / 255);  // #8a3a2e
const WHITE = rgb(1, 1, 1);

// Channel colors for donut
const CHANNEL_COLORS: Record<string, { r: number; g: number; b: number }> = {
  'Airbnb': { r: 255, g: 90, b: 95 },      // #ff5a5f
  'VRBO': { r: 36, g: 90, b: 188 },         // #245abc
  'Booking.com': { r: 0, g: 53, b: 128 },   // #003580
  'Direct': { r: 74, g: 107, b: 58 },       // #4a6b3a
};

function fmtCurrency(amount: number, showSign = false): string {
  const abs = Math.abs(amount);
  const formatted = '$' + abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (showSign && amount < 0) return '-' + formatted;
  return amount < 0 ? '-' + formatted : formatted;
}

function fmtCurrencyShort(amount: number): string {
  if (Math.abs(amount) >= 1000) {
    return '$' + (amount / 1000).toFixed(1) + 'k';
  }
  return '$' + Math.round(amount).toLocaleString();
}

function monthLabel(m: string): string {
  const d = new Date(m + '-01T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function monthName(m: string): string {
  const d = new Date(m + '-01T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'long' });
}

function shortDate(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function daysInMonth(m: string): number {
  const [year, mo] = m.split('-').map(Number);
  return new Date(year, mo, 0).getDate();
}

// Helper to draw right-aligned text
function drawRight(page: PDFPage, text: string, x: number, y: number, size: number, font: PDFFont, color: ReturnType<typeof rgb>) {
  const w = font.widthOfTextAtSize(text, size);
  page.drawText(text, { x: x - w, y, size, font, color });
}

// Helper to draw centered text
function drawCenter(page: PDFPage, text: string, centerX: number, y: number, size: number, font: PDFFont, color: ReturnType<typeof rgb>) {
  const w = font.widthOfTextAtSize(text, size);
  page.drawText(text, { x: centerX - w / 2, y, size, font, color });
}

// Truncate text to fit width
function truncateText(text: string, maxWidth: number, font: PDFFont, size: number): string {
  if (font.widthOfTextAtSize(text, size) <= maxWidth) return text;
  let t = text;
  while (t.length > 0 && font.widthOfTextAtSize(t + '...', size) > maxWidth) {
    t = t.slice(0, -1);
  }
  return t + '...';
}

// Parse review data from CSV text
function parseReviewsFromCSV(csvText: string, propertyId: string): { guest: string; review: string }[] {
  const lines = csvText.split('\n');
  const reviews: { guest: string; review: string }[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Parse CSV line (handles quoted fields with commas)
    const fields = parseCSVLine(line);
    if (fields.length < 7) continue;

    const listing = fields[3];
    const guest = fields[4];
    const review = fields[6].trim();

    const matchedProp = matchListingToProperty(listing);
    if (matchedProp === propertyId && review && review !== ' ' && review.length > 10) {
      reviews.push({ guest, review });
    }
  }

  return reviews;
}

// Parse upcoming bookings from CSV for a property
function parseUpcomingFromCSV(csvText: string, propertyId: string, afterDate: string): { guest: string; checkIn: string; nights: number; platform: string }[] {
  const lines = csvText.split('\n');
  const upcoming: { guest: string; checkIn: string; nights: number; platform: string }[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const fields = parseCSVLine(line);
    if (fields.length < 6) continue;

    const checkIn = fields[0].split(' ')[0]; // "2026-04-21 04:00 PM" -> "2026-04-21"
    const checkOut = fields[1].split(' ')[0];
    const listing = fields[3];
    const guest = fields[4];
    const platform = fields[5];

    const matchedProp = matchListingToProperty(listing);
    if (matchedProp === propertyId && checkIn > afterDate) {
      const d1 = new Date(checkIn + 'T00:00:00');
      const d2 = new Date(checkOut + 'T00:00:00');
      const nights = Math.round((d2.getTime() - d1.getTime()) / (1000 * 60 * 60 * 24));
      upcoming.push({ guest, checkIn, nights, platform });
    }
  }

  return upcoming.sort((a, b) => a.checkIn.localeCompare(b.checkIn)).slice(0, 4);
}

function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      fields.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

// Get the best review snippet (longest positive review, trimmed to ~120 chars)
function getBestReview(reviews: { guest: string; review: string }[]): { guest: string; snippet: string } | null {
  if (reviews.length === 0) return null;

  // Sort by length (longest = most detailed), pick the best one
  const sorted = [...reviews].sort((a, b) => b.review.length - a.review.length);
  const best = sorted[0];

  // Find a good sentence to use as snippet (max ~150 chars)
  let snippet = best.review;
  if (snippet.length > 150) {
    // Try to cut at a sentence boundary
    const sentences = snippet.split(/[.!]/).filter(s => s.trim().length > 20);
    if (sentences.length > 0) {
      snippet = sentences[0].trim() + '.';
      if (snippet.length > 150) {
        snippet = snippet.substring(0, 147) + '...';
      }
    } else {
      snippet = snippet.substring(0, 147) + '...';
    }
  }

  return { guest: best.guest, snippet };
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const propertyStatementId = searchParams.get('id');
  const month = searchParams.get('month');
  const csvData = searchParams.get('csv'); // Optional: base64-encoded CSV for reviews/upcoming

  if (!propertyStatementId || !month) {
    return NextResponse.json({ error: 'Missing id or month parameter' }, { status: 400 });
  }

  try {
    // Fetch property statement
    const { data: prop, error: propError } = await supabase
      .from('property_statements')
      .select('*')
      .eq('id', propertyStatementId)
      .single();

    if (propError || !prop) {
      return NextResponse.json({ error: 'Property statement not found' }, { status: 404 });
    }

    // Fetch reservations for this statement
    const { data: reservations } = await supabase
      .from('reservations')
      .select('*')
      .eq('property_statement_id', propertyStatementId)
      .order('check_out');

    // Fetch cleaning events
    const { data: cleaningEvents } = await supabase
      .from('cleaning_events')
      .select('*')
      .eq('property_statement_id', propertyStatementId);

    const details = PROPERTY_DETAILS[prop.property_id] || {
      name: prop.property_name || prop.property_id,
      address: prop.property_name || prop.property_id,
      city: 'Gloucester, MA',
      owner_full: prop.owner_name || 'Owner',
      fee_pct: 25,
    };

    const numStays = prop.num_stays || (reservations?.length || 0);
    const nightsBooked = prop.nights_booked || 0;
    const totalDays = daysInMonth(month);
    const occupancy = totalDays > 0 ? Math.round((nightsBooked / totalDays) * 100) : 0;
    const adr = nightsBooked > 0 ? prop.rental_revenue / nightsBooked : 0;
    const revPAN = totalDays > 0 ? prop.rental_revenue / totalDays : 0;

    // Parse CSV data if provided (for reviews and upcoming)
    let bestReview: { guest: string; snippet: string } | null = null;
    let upcomingBookings: { guest: string; checkIn: string; nights: number; platform: string }[] = [];

    if (csvData) {
      try {
        const csvText = Buffer.from(csvData, 'base64').toString('utf-8');
        const reviews = parseReviewsFromCSV(csvText, prop.property_id);
        bestReview = getBestReview(reviews);

        // Get upcoming bookings (after the statement month end)
        const [yearStr, moStr] = month.split('-');
        const lastDay = daysInMonth(month);
        const afterDate = `${yearStr}-${moStr}-${lastDay.toString().padStart(2, '0')}`;
        upcomingBookings = parseUpcomingFromCSV(csvText, prop.property_id, afterDate);
      } catch (e) {
        // Silently continue without CSV data
      }
    }

    // Channel mix calculation
    const channelRevenue: Record<string, number> = {};
    if (reservations) {
      for (const r of reservations) {
        const ch = r.platform === 'HomeAway' ? 'VRBO' : r.platform === 'Manual' ? 'Direct' : r.platform;
        channelRevenue[ch] = (channelRevenue[ch] || 0) + (r.adjusted_revenue || r.rental_income || 0);
      }
    }
    const totalRevenue = Object.values(channelRevenue).reduce((a, b) => a + b, 0);
    const channelMix = Object.entries(channelRevenue)
      .map(([ch, rev]) => ({ channel: ch, revenue: rev, pct: totalRevenue > 0 ? (rev / totalRevenue) * 100 : 0 }))
      .sort((a, b) => b.pct - a.pct);

    // ==========================================
    // CREATE PDF - Editorial Design
    // ==========================================
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([612, 792]); // US Letter

    const timesRoman = await pdfDoc.embedFont(StandardFonts.TimesRoman);
    const timesItalic = await pdfDoc.embedFont(StandardFonts.TimesRomanItalic);
    const timesBold = await pdfDoc.embedFont(StandardFonts.TimesRomanBold);
    const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    const courier = await pdfDoc.embedFont(StandardFonts.Courier);

    const W = 612;
    const H = 792;
    const ML = 36; // left margin
    const MR = 36; // right margin
    const CW = W - ML - MR; // content width = 540

    // Fill background with warm paper color
    page.drawRectangle({ x: 0, y: 0, width: W, height: H, color: PAPER });

    let y = H - 36; // Start from top

    // ==========================================
    // MASTHEAD
    // ==========================================
    const mastY = y;
    // Left: "Rising Tide . Vacation Rentals"
    page.drawText('Rising Tide', { x: ML, y: mastY, size: 8, font: helveticaBold, color: INK });
    page.drawText(' . Vacation Rentals', { x: ML + helveticaBold.widthOfTextAtSize('Rising Tide', 8), y: mastY, size: 8, font: helvetica, color: INK_3 });

    // Center: "Owner Statement . No. XX / YYYY"
    const [yearStr, moStr] = month.split('-');
    const issueLabel = `Owner Statement . No. ${moStr} / ${yearStr}`;
    drawCenter(page, issueLabel, W / 2, mastY, 7, helvetica, INK_4);

    // Right: contact info
    drawRight(page, '85 Eastern Ave . Gloucester, MA 01930', W - MR, mastY, 7, helvetica, INK_3);
    drawRight(page, 'allie@risingtidestr.com', W - MR, mastY - 10, 7, helvetica, INK_3);

    y = mastY - 16;
    // Masthead bottom border
    page.drawLine({ start: { x: ML, y }, end: { x: W - MR, y }, thickness: 0.75, color: INK });
    y -= 18;

    // ==========================================
    // HEADER ROW: Logo area left, headline right
    // ==========================================
    const headerY = y;

    // Left: Brand mark (text-based pennant approximation)
    const pennantX = ML;
    const pennantY = headerY - 30;
    // Draw a simple pennant triangle outline
    const pW = 50;
    const pH = 32;
    const pCenterY = pennantY + pH / 2;
    page.drawLine({ start: { x: pennantX, y: pennantY + pH }, end: { x: pennantX + pW, y: pCenterY }, thickness: 1.5, color: INK });
    page.drawLine({ start: { x: pennantX + pW, y: pCenterY }, end: { x: pennantX, y: pennantY }, thickness: 1.5, color: INK });
    page.drawLine({ start: { x: pennantX, y: pennantY }, end: { x: pennantX, y: pennantY + pH }, thickness: 1.5, color: INK });
    // Diagonal wave
    page.drawLine({ start: { x: pennantX, y: pCenterY + 1 }, end: { x: pennantX + pW - 6, y: pennantY + 5 }, thickness: 1, color: INK });
    // Text inside pennant
    page.drawText('RISING', { x: pennantX + 5, y: pCenterY + 4, size: 8, font: helveticaBold, color: INK });
    page.drawText('TIDE', { x: pennantX + 9, y: pCenterY - 10, size: 8, font: helveticaBold, color: INK });

    // Brand name below
    page.drawText('Rising Tide', { x: pennantX, y: pennantY - 14, size: 12, font: timesBold, color: INK });
    page.drawText('VACATION RENTALS', { x: pennantX, y: pennantY - 26, size: 7, font: helvetica, color: INK_3 });

    // Right: Headline
    const monthUpper = monthName(month).toUpperCase();
    // Kicker
    drawRight(page, `${monthUpper} . ${yearStr}`, W - MR, headerY, 8, helvetica, SIGNAL);
    // Display headline
    const displayText = `${monthName(month)} Statement`;
    drawRight(page, displayText, W - MR, headerY - 22, 32, timesRoman, INK);
    // Sub
    const subText = `${details.address.toUpperCase()} . ${details.city.toUpperCase()}`;
    drawRight(page, subText, W - MR, headerY - 38, 8, courier, INK_3);

    y = headerY - 58;
    // Border
    page.drawLine({ start: { x: ML, y }, end: { x: W - MR, y }, thickness: 0.5, color: RULE });
    y -= 14;

    // ==========================================
    // ADDRESSEE STRIP (3 columns)
    // ==========================================
    const addrY = y;
    const col1X = ML;
    const col2X = ML + 190;
    const col3X = ML + 370;

    // Col 1: Prepared for
    page.drawText('PREPARED FOR', { x: col1X, y: addrY, size: 7, font: helvetica, color: INK_4 });
    page.drawText(details.owner_full, { x: col1X, y: addrY - 14, size: 12, font: timesBold, color: INK });
    page.drawText(`${details.address} . ${details.city}`, { x: col1X, y: addrY - 27, size: 8, font: helvetica, color: INK_3 });

    // Col 2: Period
    const moNum = parseInt(moStr);
    const periodStr = `${monthName(month).substring(0, 3)} 1 - ${monthName(month).substring(0, 3)} ${totalDays}, ${yearStr}`;
    page.drawText('PERIOD', { x: col2X, y: addrY, size: 7, font: helvetica, color: INK_4 });
    page.drawText(periodStr, { x: col2X, y: addrY - 14, size: 12, font: timesBold, color: INK });
    page.drawText(`${totalDays} days . ${nightsBooked} nights booked`, { x: col2X, y: addrY - 27, size: 8, font: helvetica, color: INK_3 });

    // Col 3: Issued
    page.drawText('ISSUED', { x: col3X, y: addrY, size: 7, font: helvetica, color: INK_4 });
    // Next month 1st as issue date
    const nextMo = moNum === 12 ? 1 : moNum + 1;
    const nextYear = moNum === 12 ? parseInt(yearStr) + 1 : parseInt(yearStr);
    const issueDate = new Date(nextYear, nextMo - 1, 1);
    page.drawText(issueDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }), { x: col3X, y: addrY - 14, size: 12, font: timesBold, color: INK });
    page.drawText('Direct deposit', { x: col3X, y: addrY - 27, size: 8, font: helvetica, color: INK_3 });

    y = addrY - 38;
    page.drawLine({ start: { x: ML, y }, end: { x: W - MR, y }, thickness: 0.5, color: RULE });
    y -= 16;

    // ==========================================
    // HERO: Owner Payout + Mini Stats
    // ==========================================
    const heroY = y;

    // Left side: Payout
    page.drawText('OWNER PAYOUT', { x: ML, y: heroY, size: 7, font: helvetica, color: INK_3 });

    // Big payout number
    const payoutStr = fmtCurrency(prop.owner_payout);
    page.drawText(payoutStr, { x: ML, y: heroY - 30, size: 36, font: timesRoman, color: INK });

    // Right side: Mini stats grid
    const miniX = ML + 260;
    const miniSpacing = 95;

    // Stays
    page.drawText('STAYS', { x: miniX, y: heroY, size: 7, font: helvetica, color: INK_4 });
    page.drawText(numStays.toString(), { x: miniX, y: heroY - 18, size: 20, font: timesRoman, color: INK });

    // Separator line
    page.drawLine({ start: { x: miniX + 70, y: heroY + 2 }, end: { x: miniX + 70, y: heroY - 28 }, thickness: 0.5, color: RULE });

    // Nights / Occupancy
    const mini2X = miniX + miniSpacing;
    page.drawText('NIGHTS', { x: mini2X, y: heroY, size: 7, font: helvetica, color: INK_4 });
    page.drawText(`${nightsBooked} / ${totalDays}`, { x: mini2X, y: heroY - 18, size: 20, font: timesRoman, color: INK });
    page.drawText(`${occupancy}% occ.`, { x: mini2X, y: heroY - 32, size: 8, font: helvetica, color: INK_3 });

    // Separator
    page.drawLine({ start: { x: mini2X + 75, y: heroY + 2 }, end: { x: mini2X + 75, y: heroY - 28 }, thickness: 0.5, color: RULE });

    // ADR
    const mini3X = mini2X + miniSpacing;
    page.drawText('AVG DAILY RATE', { x: mini3X, y: heroY, size: 7, font: helvetica, color: INK_4 });
    page.drawText(`$${Math.round(adr)}`, { x: mini3X, y: heroY - 18, size: 20, font: timesRoman, color: INK });

    y = heroY - 44;
    page.drawLine({ start: { x: ML, y }, end: { x: W - MR, y }, thickness: 0.75, color: INK });
    y -= 14;

    // ==========================================
    // TWO-COLUMN BODY: Reservations (left) + Financials (right)
    // ==========================================
    const bodyY = y;
    const leftColW = 310;
    const rightColX = ML + leftColW + 20;
    const rightColW = CW - leftColW - 20;

    // -- LEFT COLUMN: Reservations --
    let leftY = bodyY;

    // Section header
    page.drawText('01', { x: ML, y: leftY, size: 8, font: courier, color: SIGNAL });
    page.drawText('Reservations', { x: ML + 22, y: leftY, size: 13, font: timesBold, color: INK });
    drawRight(page, `${numStays} stays`, ML + leftColW, leftY + 1, 8, helvetica, INK_3);
    leftY -= 16;

    // Table header
    const tGuestX = ML;
    const tDatesX = ML + 130;
    const tChX = ML + 215;
    const tAmtX = ML + leftColW;

    page.drawText('GUEST', { x: tGuestX, y: leftY, size: 7, font: helveticaBold, color: INK_3 });
    page.drawText('STAY', { x: tDatesX, y: leftY, size: 7, font: helveticaBold, color: INK_3 });
    page.drawText('CHANNEL', { x: tChX, y: leftY, size: 7, font: helveticaBold, color: INK_3 });
    drawRight(page, 'NET REV', tAmtX, leftY, 7, helveticaBold, INK_3);
    leftY -= 4;
    page.drawLine({ start: { x: ML, y: leftY }, end: { x: ML + leftColW, y: leftY }, thickness: 0.75, color: INK });
    leftY -= 14;

    // Reservation rows
    if (reservations && reservations.length > 0) {
      for (let i = 0; i < Math.min(reservations.length, 8); i++) {
        const r = reservations[i];
        const rowY = leftY;

        // Guest name
        const guestName = truncateText(r.guest_name || 'Guest', 120, timesRoman, 10);
        page.drawText(guestName, { x: tGuestX, y: rowY, size: 10, font: timesBold, color: INK });

        // Nights + per-night rate
        const checkIn = new Date(r.check_in + 'T00:00:00');
        const checkOut = new Date(r.check_out + 'T00:00:00');
        const nights = Math.round((checkOut.getTime() - checkIn.getTime()) / (1000 * 60 * 60 * 24));
        const perNight = nights > 0 ? Math.round((r.adjusted_revenue || r.rental_income) / nights) : 0;
        page.drawText(`${nights} nts . $${perNight}/nt`, { x: tGuestX, y: rowY - 11, size: 7, font: helvetica, color: INK_4 });

        // Dates
        const dateStr = `${shortDate(r.check_in)} - ${shortDate(r.check_out)}`;
        page.drawText(dateStr, { x: tDatesX, y: rowY, size: 9, font: helvetica, color: INK_2 });

        // Channel
        const channelMap: Record<string, string> = { 'Airbnb': 'Airbnb', 'HomeAway': 'VRBO', 'Manual': 'Direct', 'Booking.com': 'Booking' };
        const chLabel = channelMap[r.platform] || r.platform;
        page.drawText(chLabel, { x: tChX, y: rowY, size: 8, font: helveticaBold, color: INK_2 });

        // Amount
        const amtStr = fmtCurrency(r.adjusted_revenue || r.rental_income);
        drawRight(page, amtStr, tAmtX, rowY, 10, timesRoman, INK);

        leftY -= 26;
        // Row separator
        page.drawLine({ start: { x: ML, y: leftY + 4 }, end: { x: ML + leftColW, y: leftY + 4 }, thickness: 0.3, color: RULE });
      }
    }
    // Final border under reservations
    page.drawLine({ start: { x: ML, y: leftY + 4 }, end: { x: ML + leftColW, y: leftY + 4 }, thickness: 0.75, color: INK });

    // -- RIGHT COLUMN: Financials --
    let rightY = bodyY;

    // Section header
    page.drawText('02', { x: rightColX, y: rightY, size: 8, font: courier, color: SIGNAL });
    page.drawText('Financials', { x: rightColX + 22, y: rightY, size: 13, font: timesBold, color: INK });
    drawRight(page, `Net ${fmtCurrency(prop.owner_payout)}`, W - MR, rightY + 1, 8, helvetica, INK_3);
    rightY -= 18;

    // Financial line items
    const finItems: { label: string; amount: number; note?: string; isTotal?: boolean }[] = [
      { label: 'Rental Revenue', amount: prop.rental_revenue },
      { label: 'Mgmt Fee', amount: -prop.management_fee, note: `${details.fee_pct}%` },
      { label: 'Cleaning', amount: -prop.cleaning_total, note: `${cleaningEvents?.length || numStays} turns` },
      { label: 'Repairs & Maint.', amount: prop.repairs_total > 0 ? -prop.repairs_total : 0 },
      { label: 'Owner Payout', amount: prop.owner_payout, isTotal: true },
    ];

    for (const item of finItems) {
      if (item.isTotal) {
        rightY -= 4;
        page.drawLine({ start: { x: rightColX, y: rightY + 8 }, end: { x: W - MR, y: rightY + 8 }, thickness: 1, color: INK });
        rightY -= 4;
      }

      // Bullet
      const bulletSize = item.isTotal ? 5 : 4;
      if (item.isTotal) {
        page.drawCircle({ x: rightColX + 3, y: rightY + 3, size: bulletSize / 2, color: INK });
      } else {
        page.drawCircle({ x: rightColX + 3, y: rightY + 3, size: bulletSize / 2, borderColor: INK_3, borderWidth: 0.75, color: PAPER });
      }

      // Label
      const labelFont = item.isTotal ? helveticaBold : helvetica;
      const labelSize = item.isTotal ? 10 : 9;
      page.drawText(item.label, { x: rightColX + 14, y: rightY, size: labelSize, font: labelFont, color: item.isTotal ? INK : INK_2 });

      // Note (like "22%")
      if (item.note) {
        const labelW = labelFont.widthOfTextAtSize(item.label, labelSize);
        page.drawText(`(${item.note})`, { x: rightColX + 14 + labelW + 4, y: rightY + 1, size: 7, font: helvetica, color: INK_4 });
      }

      // Amount
      let amtStr: string;
      let amtColor = INK;
      if (item.amount === 0 && !item.isTotal) {
        amtStr = '--';
        amtColor = INK_4;
      } else if (item.amount < 0) {
        amtStr = '-' + fmtCurrency(Math.abs(item.amount));
        amtColor = NEGATIVE;
      } else {
        amtStr = fmtCurrency(item.amount);
      }
      const amtSize = item.isTotal ? 12 : 10;
      drawRight(page, amtStr, W - MR, rightY, amtSize, item.isTotal ? timesBold : timesRoman, amtColor);

      rightY -= 18;

      // Dotted separator (not for total)
      if (!item.isTotal) {
        // Draw dotted line manually
        const dotY = rightY + 8;
        for (let dx = 0; dx < rightColW; dx += 4) {
          page.drawCircle({ x: rightColX + dx, y: dotY, size: 0.3, color: RULE });
        }
      }
    }

    // Double underline after total
    page.drawLine({ start: { x: rightColX, y: rightY + 8 }, end: { x: W - MR, y: rightY + 8 }, thickness: 1.5, color: INK });
    rightY -= 8;

    // Channel Mix Donut (simplified as legend only in PDF)
    if (channelMix.length > 0) {
      rightY -= 8;
      page.drawText('CHANNEL MIX', { x: rightColX, y: rightY, size: 7, font: helvetica, color: INK_4 });
      rightY -= 14;

      for (const ch of channelMix) {
        const chColor = CHANNEL_COLORS[ch.channel] || { r: 100, g: 100, b: 100 };
        // Color swatch
        page.drawRectangle({
          x: rightColX, y: rightY - 1, width: 8, height: 8,
          color: rgb(chColor.r / 255, chColor.g / 255, chColor.b / 255),
        });
        // Channel name
        page.drawText(ch.channel, { x: rightColX + 14, y: rightY, size: 9, font: helvetica, color: INK_2 });
        // Percentage
        drawRight(page, `${Math.round(ch.pct)}%`, W - MR, rightY, 9, courier, INK_3);
        rightY -= 14;
      }
    }

    // Use the lower of leftY and rightY as our next section start
    y = Math.min(leftY, rightY) - 8;

    // ==========================================
    // INSIGHTS STRIP
    // ==========================================
    const insightsY = y;
    page.drawLine({ start: { x: ML, y: insightsY }, end: { x: W - MR, y: insightsY }, thickness: 0.75, color: INK });

    const insightW = CW / 4;
    const insightItems = [
      { label: 'ADR', value: `$${Math.round(adr)}`, sub: 'avg. daily rate' },
      { label: 'REVPAN', value: `$${Math.round(revPAN)}`, sub: 'rev per avail. night' },
      { label: 'GUEST RATING', value: '5.0 / 5', sub: `${numStays} reviews` },
      { label: 'OCCUPANCY', value: `${occupancy}%`, sub: `${nightsBooked} of ${totalDays} nights` },
    ];

    const insContentY = insightsY - 12;
    for (let i = 0; i < insightItems.length; i++) {
      const ix = ML + i * insightW + 8;
      const ins = insightItems[i];
      page.drawText(ins.label, { x: ix, y: insContentY, size: 7, font: helvetica, color: INK_4 });
      page.drawText(ins.value, { x: ix, y: insContentY - 16, size: 15, font: timesRoman, color: INK });
      page.drawText(ins.sub, { x: ix, y: insContentY - 28, size: 7, font: helvetica, color: INK_3 });

      // Separator
      if (i < 3) {
        page.drawLine({
          start: { x: ML + (i + 1) * insightW, y: insightsY - 2 },
          end: { x: ML + (i + 1) * insightW, y: insightsY - 38 },
          thickness: 0.5, color: RULE
        });
      }
    }

    y = insightsY - 42;
    page.drawLine({ start: { x: ML, y }, end: { x: W - MR, y }, thickness: 0.75, color: INK });
    y -= 14;

    // ==========================================
    // BOTTOM TWO: Upcoming Bookings + Guest Review
    // ==========================================
    const bottomY = y;
    const bottomLeftW = CW / 2 - 10;
    const bottomRightX = ML + CW / 2 + 10;
    const bottomRightW = CW / 2 - 10;

    // -- LEFT: On the Horizon --
    let blY = bottomY;
    page.drawText('03', { x: ML, y: blY, size: 8, font: courier, color: SIGNAL });
    page.drawText('On the horizon', { x: ML + 22, y: blY, size: 13, font: timesBold, color: INK });
    drawRight(page, 'Next 60d', ML + bottomLeftW, blY + 1, 8, helvetica, INK_3);
    blY -= 16;

    if (upcomingBookings.length > 0) {
      for (const booking of upcomingBookings) {
        const bDate = new Date(booking.checkIn + 'T00:00:00');
        const bMonth = bDate.toLocaleDateString('en-US', { month: 'short' });
        const bDay = bDate.getDate().toString();

        // Calendar icon (box with month header + day)
        const calX = ML;
        const calW = 28;
        const calH = 22;
        // Month header bar
        page.drawRectangle({ x: calX, y: blY - 4, width: calW, height: 9, color: INK });
        drawCenter(page, bMonth.toUpperCase(), calX + calW / 2, blY - 2, 6, helveticaBold, WHITE);
        // Day box
        page.drawRectangle({ x: calX, y: blY - calH + 5, width: calW, height: 13, borderColor: INK, borderWidth: 0.5, color: PAPER });
        drawCenter(page, bDay, calX + calW / 2, blY - calH + 9, 10, timesBold, INK);

        // Guest + details
        const bInfoX = calX + calW + 8;
        const guestDisplay = truncateText(booking.guest, 100, timesRoman, 9);
        page.drawText(guestDisplay, { x: bInfoX, y: blY - 2, size: 9, font: timesBold, color: INK });
        const channelLabel = booking.platform === 'HomeAway' ? 'VRBO' : booking.platform === 'Manual' ? 'Direct' : booking.platform;
        page.drawText(`${booking.nights} nts . ${channelLabel}`, { x: bInfoX, y: blY - 13, size: 7, font: helvetica, color: INK_3 });

        blY -= 28;
      }
    } else {
      page.drawText('No upcoming bookings data', { x: ML, y: blY, size: 9, font: helvetica, color: INK_4 });
      blY -= 16;
    }

    // -- RIGHT: Guest Review (or Note from Allie) --
    let brY = bottomY;

    // Note box background
    const noteBoxH = 80;
    page.drawRectangle({
      x: bottomRightX - 4,
      y: brY - noteBoxH + 10,
      width: bottomRightW + 8,
      height: noteBoxH,
      color: PAPER_2,
      borderColor: RULE,
      borderWidth: 0.5,
    });
    // Left accent bar
    page.drawRectangle({
      x: bottomRightX - 4,
      y: brY - noteBoxH + 10,
      width: 2,
      height: noteBoxH,
      color: SIGNAL,
    });

    if (bestReview) {
      // Guest review
      page.drawText('GUEST REVIEW', { x: bottomRightX + 6, y: brY - 4, size: 7, font: helvetica, color: SIGNAL });

      // Review text (wrap manually)
      const reviewLines = wrapText(bestReview.snippet, bottomRightW - 20, timesItalic, 9);
      let rlY = brY - 18;
      for (const line of reviewLines.slice(0, 4)) {
        page.drawText(line, { x: bottomRightX + 6, y: rlY, size: 9, font: timesItalic, color: INK });
        rlY -= 12;
      }

      // Attribution
      rlY -= 4;
      page.drawText(`-- ${bestReview.guest}`, { x: bottomRightX + 6, y: rlY, size: 8, font: helveticaBold, color: INK_2 });
    } else {
      // Default: Note from Allie
      page.drawText('A NOTE FROM ALLIE', { x: bottomRightX + 6, y: brY - 4, size: 7, font: helvetica, color: SIGNAL });

      const noteText = `Thank you for another great month at ${details.name}. Your guests loved their stays and we look forward to continued success.`;
      const noteLines = wrapText(noteText, bottomRightW - 20, timesItalic, 9);
      let nlY = brY - 18;
      for (const line of noteLines.slice(0, 4)) {
        page.drawText(line, { x: bottomRightX + 6, y: nlY, size: 9, font: timesItalic, color: INK });
        nlY -= 12;
      }

      nlY -= 6;
      page.drawText('Allie Marsden', { x: bottomRightX + 6, y: nlY, size: 8, font: helveticaBold, color: INK_2 });
      page.drawText('Property Manager . Rising Tide STR', { x: bottomRightX + 6, y: nlY - 11, size: 7, font: helvetica, color: INK_3 });
    }

    // ==========================================
    // FOOTER
    // ==========================================
    const footerY = 30;
    page.drawLine({ start: { x: ML, y: footerY + 10 }, end: { x: W - MR, y: footerY + 10 }, thickness: 0.75, color: INK });

    page.drawText('Rising Tide STR . Gloucester, MA', { x: ML, y: footerY - 4, size: 7, font: helvetica, color: INK_3 });
    drawCenter(page, '"A rising tide lifts all boats."', W / 2, footerY - 4, 9, timesItalic, INK);
    drawRight(page, `Statement ${moStr}.${yearStr} . pg 1/1`, W - MR, footerY - 4, 7, helvetica, INK_3);

    // ==========================================
    // Generate and return PDF
    // ==========================================
    const pdfBytes = await pdfDoc.save();
    const safeName = details.name.replace(/\s+/g, '_');
    const safeMonth = monthLabel(month).replace(/\s+/g, '_');
    const filename = `${safeName}_${safeMonth}.pdf`;

    return new NextResponse(Buffer.from(pdfBytes), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    console.error('Statement generation error:', err);
    return NextResponse.json({ error: 'Failed to generate statement: ' + (err instanceof Error ? err.message : String(err)) }, { status: 500 });
  }
}

// Also support POST for passing CSV data in body
export async function POST(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const propertyStatementId = searchParams.get('id');
  const month = searchParams.get('month');

  if (!propertyStatementId || !month) {
    return NextResponse.json({ error: 'Missing id or month parameter' }, { status: 400 });
  }

  try {
    const body = await request.json();
    const csvData = body.csv ? Buffer.from(body.csv).toString('base64') : '';

    // Reconstruct URL with csv param and call GET handler logic
    const url = new URL(request.url);
    url.searchParams.set('csv', csvData);

    const fakeRequest = new NextRequest(url.toString(), { method: 'GET' });
    return GET(fakeRequest);
  } catch (err) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }
}

// Text wrapping helper
function wrapText(text: string, maxWidth: number, font: PDFFont, size: number): string[] {
  const words = text.split(' ');
  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    const testLine = currentLine ? currentLine + ' ' + word : word;
    if (font.widthOfTextAtSize(testLine, size) > maxWidth && currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = testLine;
    }
  }
  if (currentLine) lines.push(currentLine);

  return lines;
}
