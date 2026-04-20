import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

// Extended property config with addresses and full owner names
const PROPERTY_DETAILS: Record<string, { name: string; address: string; city: string; owner_full: string }> = {
  '3_south_st':    { name: '3 South St',        address: '3 South Street',       city: 'Rockport, MA',    owner_full: 'Marci & Paul Bailey' },
  '21_horton':     { name: '21 Horton St',       address: '21 Horton Street',     city: 'Gloucester, MA',  owner_full: 'Claudia Kittredge' },
  '53_rocky_neck': { name: '53 Rocky Neck Ave',  address: '53 Rocky Neck Avenue', city: 'Gloucester, MA',  owner_full: 'Mark Prudenzi' },
  '4_brier_neck':  { name: '4 Brier Neck Rd',    address: '4 Brier Neck Road',    city: 'Gloucester, MA',  owner_full: 'The Armstrong Family' },
  '30_woodward':   { name: '30 Woodward Ave',    address: '30 Woodward Avenue',   city: 'Gloucester, MA',  owner_full: 'The McWethy Family' },
  '20_hammond':    { name: '20 Hammond St',      address: '20 Hammond Street',    city: 'Gloucester, MA',  owner_full: 'The Ramsey Family' },
  '20_enon':       { name: '20 Enon Rd',         address: '20 Enon Road',         city: 'Gloucester, MA',  owner_full: 'The Snyder Family' },
  '73_rocky_neck': { name: '73 Rocky Neck Ave',  address: '73 Rocky Neck Avenue', city: 'Gloucester, MA',  owner_full: 'The Moynahan Family' },
  '17_beach_rd':   { name: '17 Beach Rd',        address: '17 Beach Road',        city: 'Gloucester, MA',  owner_full: 'The Nolan Family' },
};

function fmtCurrency(amount: number): string {
  const abs = Math.abs(amount);
  const formatted = '$' + abs.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return amount < 0 ? '-' + formatted : formatted;
}

function monthLabel(m: string): string {
  const d = new Date(m + '-01T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function monthDates(m: string): { start: string; end: string } {
  const [year, mo] = m.split('-').map(Number);
  const lastDay = new Date(year, mo, 0).getDate();
  const pad = (n: number) => n.toString().padStart(2, '0');
  return {
    start: `${pad(mo)}/01/${year}`,
    end: `${pad(mo)}/${pad(lastDay)}/${year}`,
  };
}

// Colors
const NAVY = rgb(30 / 255, 46 / 255, 52 / 255);
const GOLD = rgb(201 / 255, 168 / 255, 76 / 255);
const WHITE = rgb(1, 1, 1);
const GRAY_BG = rgb(0.95, 0.95, 0.95);
const GRAY_TEXT = rgb(0.4, 0.4, 0.4);
const BLACK = rgb(0, 0, 0);

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const propertyStatementId = searchParams.get('id');
  const month = searchParams.get('month');

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

    // Fetch reservations
    const { data: reservations } = await supabase
      .from('reservations')
      .select('*')
      .eq('property_statement_id', propertyStatementId)
      .order('check_out');

    const details = PROPERTY_DETAILS[prop.property_id] || {
      name: prop.property_name,
      address: prop.property_name,
      city: 'Gloucester, MA',
      owner_full: prop.owner_name,
    };

    const dates = monthDates(month);

    // Create PDF
    const pdfDoc = await PDFDocument.create();
    const page = pdfDoc.addPage([612, 792]);
    const helvetica = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const helveticaBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    const W = 612;
    const H = 792;
    const SIDEBAR_W = 160;
    const CONTENT_LEFT = SIDEBAR_W + 30;
    const CONTENT_RIGHT = W - 40;
    const CONTENT_W = CONTENT_RIGHT - CONTENT_LEFT;

    // =====================
    // SIDEBAR
    // =====================
    page.drawRectangle({
      x: 0, y: 0, width: SIDEBAR_W, height: H,
      color: NAVY,
    });

    // Draw pennant flag logo
    const flagCx = SIDEBAR_W / 2;
    const flagTop = H - 60;
    const flagSize = 50;

    // White triangle pennant pointing right
    // Draw as a filled triangle using lines
    const triLeft = flagCx - flagSize * 0.45;
    const triRight = flagCx + flagSize * 0.5;
    const triTop = flagTop + flagSize * 0.35;
    const triBottom = flagTop - flagSize * 0.35;
    const triMidY = flagTop;

    // Draw triangle outline with thick white strokes
    page.drawLine({ start: { x: triLeft, y: triTop }, end: { x: triRight, y: triMidY }, thickness: 2.5, color: WHITE });
    page.drawLine({ start: { x: triRight, y: triMidY }, end: { x: triLeft, y: triBottom }, thickness: 2.5, color: WHITE });
    page.drawLine({ start: { x: triLeft, y: triBottom }, end: { x: triLeft, y: triTop }, thickness: 2.5, color: WHITE });

    // "RISING" and "TIDE" inside flag
    page.drawText('RISING', {
      x: flagCx - 24, y: flagTop + 4,
      size: 11, font: helveticaBold, color: WHITE,
    });
    page.drawText('TIDE', {
      x: flagCx - 17, y: flagTop - 11,
      size: 11, font: helveticaBold, color: WHITE,
    });

    // Diagonal line through pennant (like original logo)
    page.drawLine({
      start: { x: triLeft + 5, y: triTop - 8 },
      end: { x: triRight - 5, y: triBottom + 8 },
      thickness: 1.5, color: WHITE,
    });

    // Company name below logo
    const sidebarTextX = SIDEBAR_W / 2;
    const drawCenteredText = (text: string, y: number, size: number, font: typeof helvetica, color: typeof WHITE) => {
      const textWidth = font.widthOfTextAtSize(text, size);
      page.drawText(text, { x: sidebarTextX - textWidth / 2, y, size, font, color });
    };

    drawCenteredText('RISING TIDE', flagTop - flagSize - 15, 12, helveticaBold, WHITE);

    // Address lines
    const addrY = flagTop - flagSize - 45;
    drawCenteredText('3 Locust Lane', addrY, 8, helvetica, rgb(0.7, 0.7, 0.7));
    drawCenteredText('Gloucester, MA 01930', addrY - 13, 8, helvetica, rgb(0.7, 0.7, 0.7));
    drawCenteredText('allie@risingtidestr.com', addrY - 26, 8, helvetica, rgb(0.7, 0.7, 0.7));

    // =====================
    // MAIN CONTENT
    // =====================
    let y = H - 60;

    // Title
    page.drawText('OWNER', { x: CONTENT_LEFT, y, size: 36, font: helveticaBold, color: NAVY });
    y -= 40;
    page.drawText('STATEMENT', { x: CONTENT_LEFT, y, size: 36, font: helveticaBold, color: NAVY });
    y -= 35;

    // Dates
    page.drawText('Start Date:', { x: CONTENT_LEFT, y, size: 10, font: helveticaBold, color: NAVY });
    page.drawText(dates.start, { x: CONTENT_LEFT + 65, y, size: 10, font: helvetica, color: BLACK });
    y -= 16;
    page.drawText('End Date:', { x: CONTENT_LEFT, y, size: 10, font: helveticaBold, color: NAVY });
    page.drawText(dates.end, { x: CONTENT_LEFT + 65, y, size: 10, font: helvetica, color: BLACK });
    y -= 30;

    // TO section
    page.drawText('TO', { x: CONTENT_LEFT, y, size: 14, font: helveticaBold, color: NAVY });
    y -= 18;
    page.drawText(details.owner_full, { x: CONTENT_LEFT, y, size: 10, font: helvetica, color: BLACK });
    y -= 14;
    page.drawText(details.address, { x: CONTENT_LEFT, y, size: 10, font: helvetica, color: BLACK });
    y -= 14;
    page.drawText(details.city, { x: CONTENT_LEFT, y, size: 10, font: helvetica, color: BLACK });
    y -= 30;

    // =====================
    // OVERVIEW SECTION
    // =====================
    const drawSectionHeader = (title: string, yPos: number): number => {
      page.drawRectangle({
        x: CONTENT_LEFT, y: yPos - 4, width: CONTENT_W, height: 22,
        color: NAVY,
      });
      page.drawText(title, {
        x: CONTENT_LEFT + 10, y: yPos + 2, size: 10, font: helveticaBold, color: WHITE,
      });
      return yPos - 26;
    };

    const drawRow = (label: string, value: string, yPos: number, bold: boolean = false, shaded: boolean = false): number => {
      if (shaded) {
        page.drawRectangle({
          x: CONTENT_LEFT, y: yPos - 4, width: CONTENT_W, height: 22,
          color: GRAY_BG,
        });
      }
      // Bottom border
      page.drawLine({
        start: { x: CONTENT_LEFT, y: yPos - 5 },
        end: { x: CONTENT_RIGHT, y: yPos - 5 },
        thickness: 0.5, color: rgb(0.85, 0.85, 0.85),
      });

      const font = bold ? helveticaBold : helvetica;
      page.drawText(label, { x: CONTENT_LEFT + 10, y: yPos + 2, size: 10, font, color: BLACK });

      const valWidth = font.widthOfTextAtSize(value, 10);
      page.drawText(value, { x: CONTENT_RIGHT - 10 - valWidth, y: yPos + 2, size: 10, font, color: BLACK });

      return yPos - 24;
    };

    y = drawSectionHeader('OVERVIEW', y);
    y = drawRow('Owner Payout', fmtCurrency(prop.owner_payout), y, true, true);
    y = drawRow('Number of Stays', prop.num_stays.toString(), y, true, false);
    y = drawRow('Nights Booked', prop.nights_booked.toString(), y, true, true);
    y -= 15;

    // =====================
    // RESERVATIONS SECTION (new - shows detail)
    // =====================
    if (reservations && reservations.length > 0) {
      y = drawSectionHeader('RESERVATIONS', y);

      // Column headers
      const colGuest = CONTENT_LEFT + 10;
      const colDates = CONTENT_LEFT + 140;
      const colChannel = CONTENT_LEFT + 230;
      const colAmount = CONTENT_RIGHT - 10;

      page.drawRectangle({
        x: CONTENT_LEFT, y: y - 4, width: CONTENT_W, height: 20,
        color: GRAY_BG,
      });
      page.drawText('Guest', { x: colGuest, y: y + 2, size: 8, font: helveticaBold, color: GRAY_TEXT });
      page.drawText('Dates', { x: colDates, y: y + 2, size: 8, font: helveticaBold, color: GRAY_TEXT });
      page.drawText('Channel', { x: colChannel, y: y + 2, size: 8, font: helveticaBold, color: GRAY_TEXT });
      const amtHeader = 'Net Revenue';
      const amtHeaderW = helveticaBold.widthOfTextAtSize(amtHeader, 8);
      page.drawText(amtHeader, { x: colAmount - amtHeaderW, y: y + 2, size: 8, font: helveticaBold, color: GRAY_TEXT });
      y -= 22;

      for (let i = 0; i < reservations.length; i++) {
        const r = reservations[i];
        const shaded = i % 2 === 0;

        if (shaded) {
          page.drawRectangle({
            x: CONTENT_LEFT, y: y - 4, width: CONTENT_W, height: 20,
            color: rgb(0.98, 0.98, 0.98),
          });
        }

        // Guest name (truncate if needed)
        const guestName = r.guest_name.length > 22 ? r.guest_name.substring(0, 20) + '..' : r.guest_name;
        page.drawText(guestName, { x: colGuest, y: y + 2, size: 9, font: helvetica, color: BLACK });

        // Dates
        const checkIn = new Date(r.check_in + 'T00:00:00');
        const checkOut = new Date(r.check_out + 'T00:00:00');
        const dateStr = `${checkIn.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${checkOut.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;
        page.drawText(dateStr, { x: colDates, y: y + 2, size: 9, font: helvetica, color: GRAY_TEXT });

        // Channel
        const channelMap: Record<string, string> = { 'Airbnb': 'Airbnb', 'HomeAway': 'VRBO', 'Manual': 'Direct', 'Booking.com': 'Booking' };
        page.drawText(channelMap[r.platform] || r.platform, { x: colChannel, y: y + 2, size: 9, font: helvetica, color: GRAY_TEXT });

        // Amount
        const amtStr = fmtCurrency(r.adjusted_revenue);
        const amtW = helvetica.widthOfTextAtSize(amtStr, 9);
        page.drawText(amtStr, { x: colAmount - amtW, y: y + 2, size: 9, font: helvetica, color: BLACK });

        y -= 20;

        // Page break safety
        if (y < 180) break;
      }
      y -= 10;
    }

    // =====================
    // FINANCIALS SECTION
    // =====================
    y = drawSectionHeader('FINANCIALS', y);
    y = drawRow('Rental Revenue', fmtCurrency(prop.rental_revenue), y, true, true);
    y = drawRow('Management Fee', fmtCurrency(-prop.management_fee), y, false, false);
    y = drawRow('Cleaning', fmtCurrency(-prop.cleaning_total), y, false, true);
    if (prop.repairs_total > 0) {
      y = drawRow('Repairs & Maintenance', fmtCurrency(-prop.repairs_total), y, false, false);
    } else {
      y = drawRow('Repairs & Maintenance', '-', y, false, false);
    }
    y -= 20;

    // =====================
    // FOOTER
    // =====================
    const footerText = 'THANK YOU FOR YOUR BUSINESS!';
    const footerWidth = helveticaBold.widthOfTextAtSize(footerText, 14);
    const footerX = CONTENT_LEFT + (CONTENT_W - footerWidth) / 2;
    page.drawText(footerText, {
      x: footerX, y: Math.max(y, 60), size: 14, font: helveticaBold, color: NAVY,
    });

    // Generate PDF bytes
    const pdfBytes = await pdfDoc.save();

    // Build filename
    const safeName = details.name.replace(/\s+/g, '_');
    const safeMonth = monthLabel(month).replace(/\s+/g, '_');
    const filename = `${safeName}_${safeMonth}.pdf`;

    return new NextResponse(pdfBytes, {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    console.error('Statement generation error:', err);
    return NextResponse.json({ error: 'Failed to generate statement' }, { status: 500 });
  }
}
