import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { cachePlatformCSV } from '@/lib/platform-csv-cache';

/**
 * Home-page upload entry point for the Guesty Platform CSV (the monthly
 * reservations spreadsheet).
 *
 * Does ONLY two things, both of which already happen today inside the
 * per-property /api/ingest flow -- this is just the same writes triggered
 * from one upload instead of needing to navigate into a property first:
 *   1. Cache the CSV file to the `platform-csvs` Storage bucket via
 *      lib/platform-csv-cache.cachePlatformCSV. After this, every property's
 *      upload page for the chosen month shows "Platform CSV · ON FILE" and
 *      the cached bytes are what /api/ingest reads.
 *   2. Forward the CSV text to /api/ingest-guesty-csv so the per-stay
 *      `guesty_reservations` cache (channels, TOTAL_PAID, taxes, commission)
 *      is freshened across every listing in the file.
 *
 * EXPLICITLY DOES NOT touch `property_statements`, `reservations`, or
 * `owner_payout`. /api/ingest stays the only path to statement totals.
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

    // 1. Cache to Storage -- same write /api/ingest does when a Platform CSV
    //    is uploaded via the per-property page.
    const cached = await cachePlatformCSV(supabase, month, file);

    // 2. Freshen the guesty_reservations cache by handing the same CSV text
    //    to the existing /api/ingest-guesty-csv route. Server-side fetch so
    //    the work happens in the same request.
    const csvText = await file.text();
    const origin = request.nextUrl.origin;
    const ingestRes = await fetch(`${origin}/api/ingest-guesty-csv`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ csv: csvText }),
    });
    const ingestSummary = await ingestRes.json().catch(() => ({}));

    return NextResponse.json({
      success: true,
      month,
      cached: cached
        ? { filename: cached.original_filename, path: cached.path, size: cached.size, uploaded_at: cached.uploaded_at }
        : null,
      reservations: ingestRes.ok && ingestSummary.success ? {
        parsed: ingestSummary.parsed,
        unmatched_listings: ingestSummary.unmatched_listings,
        reservations_upserted: ingestSummary.reservations_upserted,
        api_rows_backfilled: ingestSummary.api_rows_backfilled,
        reviews_upserted: ingestSummary.reviews_upserted,
      } : null,
      reservations_error: ingestRes.ok && ingestSummary.success ? null : (ingestSummary.error || 'reservations cache update failed'),
    });
  } catch (err) {
    console.error('upload-platform-csv error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
