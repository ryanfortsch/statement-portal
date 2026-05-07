import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { buildIcalExport } from '@/lib/ical-export';
import type { Booking } from '@/lib/channels-types';

export const dynamic = 'force-dynamic';
// Public-facing feed — no maxDuration override needed; the query is fast.

/**
 * GET /api/channels/ical/[token]
 *
 * Public-facing master availability feed for a single property. The
 * `token` matches `properties.ical_export_token` and is the only auth.
 * Returns iCalendar text suitable for Airbnb / VRBO / Booking.com to
 * subscribe to as an "import" feed, so a stay booked on one channel
 * blocks the matching dates on the others.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  if (!token) return new NextResponse('Not found', { status: 404 });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return new NextResponse('Server misconfigured', { status: 500 });

  const sb = createClient(url, key, { auth: { persistSession: false } });

  const { data: prop, error: propErr } = await sb
    .from('properties')
    .select('id, name, address, ical_export_token')
    .eq('ical_export_token', token)
    .maybeSingle();
  if (propErr) return new NextResponse(`db error: ${propErr.message}`, { status: 500 });
  if (!prop) return new NextResponse('Not found', { status: 404 });

  // 18-month forward + 90 days back, plenty for OTA inbound subscriptions.
  const today = new Date();
  const fromIso = new Date(today.getTime() - 90 * 86400_000).toISOString().slice(0, 10);
  const toIso = new Date(today.getTime() + 540 * 86400_000).toISOString().slice(0, 10);

  const { data: bookings, error: bErr } = await sb
    .from('bookings')
    .select('*')
    .eq('property_id', prop.id)
    .gte('check_in', fromIso)
    .lte('check_in', toIso)
    .neq('status', 'cancelled');
  if (bErr) return new NextResponse(`db error: ${bErr.message}`, { status: 500 });

  const body = buildIcalExport({
    propertyName: prop.name,
    propertyAddress: prop.address,
    bookings: (bookings ?? []) as Booking[],
  });

  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `inline; filename="${prop.id}.ics"`,
      'Cache-Control': 'public, max-age=300, s-maxage=300',
    },
  });
}
