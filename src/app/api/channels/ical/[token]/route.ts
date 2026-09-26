import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin, isServiceConfigured } from '@/lib/supabase-admin';
import { buildIcalExport, EXPORTABLE_STATUSES, isToolUserAgent, resolveExportAudience, type ExportBooking } from '@/lib/ical-export';
import { recordExportPull } from '@/lib/ical-export-pulls';
import { selectAllPaged } from '@/lib/paged-select';

export const dynamic = 'force-dynamic';
// Public-facing feed. No maxDuration override needed; the query is fast.

/**
 * GET /api/channels/ical/[token]
 *
 * Public-facing master availability feed for a single property. The
 * `token` matches `properties.ical_export_token` and is the only auth.
 * Returns iCalendar text suitable for Airbnb / VRBO / Booking.com to
 * subscribe to as an "import" feed, so a stay booked on one channel
 * blocks the matching dates on the others.
 *
 * Exports only what holds nights: rows in status confirmed / completed /
 * block, canonical (duplicate_of null) except a Booking.com closure, which
 * is forwarded whatever its duplicate mark. Airbnb, VRBO and 'other'
 * closures go to no feed; lib/ical-export.ts says why that one rule keeps
 * the export free of loops. The old feed sent every non-cancelled row, so an
 * inquiry or a pending request, and every duplicate of a stay, blocked the
 * dates on the other OTAs; and it printed the guest's name and the
 * operator's notes into DESCRIPTION. The builder writes channel + Helm id
 * only.
 *
 * Each OTA imports its own URL (?for=airbnb|vrbo|booking_com, or
 * ?listing=<channel_listings id>, the only form for an 'other' platform).
 * Its feed leaves out that OTA's own rows, so an owner block lifted in the
 * Airbnb app never comes back to Airbnb from Helm. A URL whose for=
 * disagrees with the puller's user agent is served unfiltered and logged as
 * a mismatch; a bare URL is attributed by user agent.
 *
 * The window is by OVERLAP (check_out after today-90, check_in before
 * today+540), not by check-in: a 120-night winter let that began four
 * months ago is still in the house, and windowed by check-in it dropped off
 * every feed while the guest was there.
 *
 * Every pull is logged to ical_export_pulls (recordExportPull), and the
 * response is `no-store`: the old `public, s-maxage=300` let the CDN answer
 * an OTA's pull without this function running, so the log under-counted
 * and a fresh booking could sit behind a stale edge copy.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  if (!token) return new NextResponse('Not found', { status: 404 });

  // Was a hand-rolled client that fell back to the anon key when
  // SUPABASE_SERVICE_ROLE_KEY was unset -- reuse the canonical service-role
  // singleton, so a missing env var fails loudly rather than silently
  // downgrading to the (soon to be locked down) anon key.
  if (!isServiceConfigured) return new NextResponse('Server misconfigured', { status: 500 });
  const sb = supabaseAdmin;

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

  // Who this feed is for (lib/ical-export resolveExportAudience): the URL's
  // listing= or for=, checked against the user agent. A feed for a named
  // OTA leaves out that OTA's own rows; a mismatched pull (the Airbnb line
  // pasted into VRBO) is served for nobody, every row.
  const userAgent = request.headers.get('user-agent');
  const { data: listingRows } = await sb.from('channel_listings').select('id, channel').eq('property_id', prop.id);
  const audience = resolveExportAudience({
    forParam: request.nextUrl.searchParams.get('for'),
    listingParam: request.nextUrl.searchParams.get('listing'),
    userAgent,
    listings: (listingRows ?? []) as Array<{ id: string; channel: string }>,
  });

  // Every row that holds nights in the window, duplicates included; the
  // builder's exportableBooking is the one gate (audience, duplicate mark,
  // which OTA closures travel). Paged: a busy home's history outgrows
  // PostgREST's silent 1000-row cap, and a short read here is a night some
  // OTA could sell.
  let bookings: ExportBooking[];
  try {
    bookings = await selectAllPaged<ExportBooking>(
      (from, to) =>
        sb
          .from('bookings')
          .select('*')
          .eq('property_id', prop.id)
          .gt('check_out', fromIso)
          .lte('check_in', toIso)
          .in('status', [...EXPORTABLE_STATUSES])
          .order('check_in', { ascending: true })
          .order('id', { ascending: true })
          .range(from, to),
      { label: `ical export ${prop.id}` },
    );
  } catch (err) {
    return new NextResponse(`db error: ${err instanceof Error ? err.message : String(err)}`, { status: 500 });
  }

  const body = buildIcalExport({
    propertyName: prop.name,
    propertyAddress: prop.address,
    bookings,
    forChannel: audience.channel,
    forListingId: audience.listingId,
  });

  // The pull is the evidence the OTA is subscribed; log it before the body
  // goes out so a client that hangs up early is still counted. An operator
  // checking a line (a browser signed in to Helm, or curl and friends) is
  // recorded but credited to nobody: counted as the OTA's pull, it turned
  // the preflight green for an OTA that had imported nothing. The feed it
  // was served is unchanged.
  const operatorClient =
    !!request.cookies.get('authjs.session-token') ||
    !!request.cookies.get('__Secure-authjs.session-token') ||
    isToolUserAgent(userAgent);
  await recordExportPull(prop.id, {
    userAgent,
    channel: operatorClient ? null : audience.mismatch ? audience.uaGuess : audience.channel,
    requestedFor: audience.requestedFor,
    uaGuess: audience.uaGuess,
  });

  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Content-Disposition': `inline; filename="${prop.id}.ics"`,
      'Cache-Control': 'no-store',
    },
  });
}
