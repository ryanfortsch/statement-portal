import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { ingestBookingAccountCsv } from '@/lib/booking-deposits';

/**
 * Home-page upload entry point for the central "Bookingcom Deposits" Chase
 * account (...5623) activity CSV.
 *
 * Same global-upload pattern as /api/upload-platform-csv: one file a month,
 * on file for every property. Rows accumulate in booking_account_activity
 * (re-uploads and overlapping exports dedupe via hash), and /api/ingest
 * reads the transfers-out to corroborate Booking.com reservations.
 *
 * EXPLICITLY DOES NOT touch property_statements, reservations, or
 * owner_payout. /api/ingest stays the only path to statement totals.
 */

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const formData = await request.formData();
    const month = ((formData.get('month') as string) || '').trim();
    const file = formData.get('file') as File | null;
    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      return NextResponse.json({ error: 'month required (YYYY-MM)' }, { status: 400 });
    }
    if (!file || file.size === 0) {
      return NextResponse.json({ error: 'file required' }, { status: 400 });
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL || '',
      process.env.SUPABASE_SERVICE_ROLE_KEY || '',
    );

    const summary = await ingestBookingAccountCsv(supabase, await file.text(), month);

    return NextResponse.json({ success: true, month, ...summary });
  } catch (err) {
    console.error('upload-booking-deposits error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
