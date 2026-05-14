import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { getCachedPlatformCSV } from '@/lib/platform-csv-cache';

/**
 * Lightweight metadata lookup for the cached Platform CSV in a given
 * month. The upload page calls this when the operator picks a month so
 * it can pre-satisfy the Platform CSV file slot with "Using cached:
 * filename · uploaded X" instead of asking for the same file again.
 *
 * GET /api/platform-csv-status?month=YYYY-MM
 *   -> { exists: false } when no upload yet
 *   -> { exists: true, filename, uploaded_at, size } otherwise
 */

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

export async function GET(request: NextRequest): Promise<NextResponse> {
  const month = request.nextUrl.searchParams.get('month') || '';
  if (!/^\d{4}-\d{2}$/.test(month)) {
    return NextResponse.json({ error: 'month is required (YYYY-MM)' }, { status: 400 });
  }
  try {
    const cached = await getCachedPlatformCSV(supabase, month);
    if (!cached) {
      return NextResponse.json({ exists: false, month });
    }
    return NextResponse.json({
      exists: true,
      month,
      filename: cached.original_filename,
      uploaded_at: cached.uploaded_at,
      size: cached.size,
    });
  } catch (err) {
    console.error('platform-csv-status error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
