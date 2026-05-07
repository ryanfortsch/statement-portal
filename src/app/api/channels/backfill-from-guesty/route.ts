import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import type { BookingChannel, BookingStatus } from '@/lib/channels-types';

export const maxDuration = 300;
export const dynamic = 'force-dynamic';

/**
 * POST /api/channels/backfill-from-guesty
 *
 * One-time backfill: copies every row from `guesty_reservations` into
 * the new `bookings` table so /channels/bookings has data on day one.
 *
 * Idempotent: matches on (channel, external_booking_id=guesty_reservation_id).
 * Safe to re-run; only inserts rows that aren't already present.
 *
 * Body (optional): { dryRun?: boolean }
 */
export async function POST(request: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return NextResponse.json({ error: 'service-role env not set' }, { status: 500 });
  }
  const sb = createClient(url, key, { auth: { persistSession: false } });

  const isJson = (request.headers.get('content-type') ?? '').includes('application/json');
  const body = isJson ? await request.json().catch(() => ({})) : {};
  const dryRun = body?.dryRun === true;
  const isHtmlForm = !isJson;

  // Pull every guesty_reservation
  const { data: gr, error: grErr } = await sb
    .from('guesty_reservations')
    .select('guesty_reservation_id, listing_id, property_id, guest_name, confirmation_code, check_in, check_out, nights, channel, status, host_payout');
  if (grErr) {
    return NextResponse.json({ error: `read guesty_reservations: ${grErr.message}` }, { status: 500 });
  }

  // Pull every existing bookings row that already came from a Guesty backfill
  const { data: existing, error: exErr } = await sb
    .from('bookings')
    .select('external_booking_id')
    .eq('source', 'guesty_legacy');
  if (exErr) {
    return NextResponse.json({ error: `read bookings: ${exErr.message}` }, { status: 500 });
  }
  const haveIds = new Set((existing ?? []).map((r) => r.external_booking_id as string));

  type Row = {
    property_id: string;
    channel: BookingChannel;
    source: 'guesty_legacy';
    external_booking_id: string;
    external_confirmation_code: string | null;
    check_in: string;
    check_out: string;
    nights: number | null;
    status: BookingStatus;
    guest_name: string | null;
    payout: number | null;
  };

  const rows: Row[] = [];
  let skippedExisting = 0;
  let skippedInvalid = 0;

  for (const r of (gr ?? [])) {
    const id = r.guesty_reservation_id as string | null;
    if (!id) { skippedInvalid++; continue; }
    if (haveIds.has(id)) { skippedExisting++; continue; }
    if (!r.property_id || !r.check_in || !r.check_out) { skippedInvalid++; continue; }

    const channel = mapChannel(r.channel as string | null);
    rows.push({
      property_id: r.property_id as string,
      channel,
      source: 'guesty_legacy',
      external_booking_id: id,
      external_confirmation_code: (r.confirmation_code as string | null) ?? null,
      check_in: (r.check_in as string).slice(0, 10),
      check_out: (r.check_out as string).slice(0, 10),
      nights: (r.nights as number | null) ?? null,
      status: mapStatus(r.status as string | null),
      guest_name: (r.guest_name as string | null) ?? null,
      payout: r.host_payout != null ? Number(r.host_payout) : null,
    });
  }

  if (dryRun) {
    return NextResponse.json({
      ok: true,
      dryRun: true,
      total_guesty_reservations: gr?.length ?? 0,
      already_backfilled: skippedExisting,
      skipped_invalid: skippedInvalid,
      to_insert: rows.length,
    });
  }

  let inserted = 0;
  if (rows.length > 0) {
    const chunkSize = 500;
    for (let i = 0; i < rows.length; i += chunkSize) {
      const chunk = rows.slice(i, i + chunkSize);
      const { error: insErr } = await sb.from('bookings').insert(chunk);
      if (insErr) {
        return NextResponse.json({
          error: `insert chunk ${i / chunkSize}: ${insErr.message}`,
          inserted_so_far: inserted,
        }, { status: 500 });
      }
      inserted += chunk.length;
    }
  }

  if (isHtmlForm) {
    return NextResponse.redirect(new URL(`/channels?backfilled=${inserted}`, request.url), 303);
  }

  return NextResponse.json({
    ok: true,
    total_guesty_reservations: gr?.length ?? 0,
    already_backfilled: skippedExisting,
    skipped_invalid: skippedInvalid,
    inserted,
  });
}

function mapChannel(raw: string | null): BookingChannel {
  if (!raw) return 'other';
  const c = raw.toLowerCase();
  if (c.includes('airbnb')) return 'airbnb';
  if (c.includes('vrbo') || c.includes('homeaway')) return 'vrbo';
  if (c.includes('booking')) return 'booking_com';
  if (c.includes('manual') || c.includes('direct')) return 'direct';
  return 'other';
}

function mapStatus(raw: string | null): BookingStatus {
  if (!raw) return 'confirmed';
  const s = raw.toLowerCase();
  if (s.includes('cancel')) return 'cancelled';
  if (s.includes('inquiry')) return 'inquiry';
  if (s.includes('pending')) return 'pending';
  if (s.includes('completed')) return 'completed';
  return 'confirmed';
}
