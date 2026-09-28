import { NextResponse } from 'next/server';
import { authorizeStayConcierge } from '@/lib/stay-concierge-auth';
import { availabilityForBridge, rangeCheckForBridge, bridgeStatus, MAX_AVAILABILITY_DAYS } from '@/lib/pms-bridge';
import { shiftIsoDay, todayInEastern } from '@/lib/sca-quotes-types';

/**
 * /api/pms/availability
 *
 * Helm-native availability for a Helm-run home, in the exact shape
 * staycapeann.com's own /api/availability returns so the site's phase-2
 * provider switch is a URL change.
 *
 *   GET  ?property_id=65_calderwood&start=YYYY-MM-DD&end=YYYY-MM-DD
 *        (inclusive window, at most 400 days; defaults to today + 365)
 *        -> {listingId:'helm:<id>', property_id, days:[{date, available,
 *            price, minNights, reserved}], degraded:false,
 *            calendar_authority:'helm'}
 *   POST {property_id, check_in, check_out}
 *        -> {available, days, unavailableDates, reservedDates, degraded:false}
 *
 * 404 unknown property; 409 {error:'calendar_authority_guesty'} while
 * Guesty still runs the home (the site keeps reading Guesty for it).
 *
 * Auth: STAY_CONCIERGE_KEY in the x-stay-concierge-key header, never a
 * query string. Allowlisted under '/api/pms/' in src/proxy.ts.
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

function failure(f: { error: string } & Record<string, unknown>) {
  return NextResponse.json({ ok: false, ...f }, { status: bridgeStatus(f.error as Parameters<typeof bridgeStatus>[0]) });
}

export async function GET(req: Request) {
  const denied = authorizeStayConcierge(req);
  if (denied) return denied;

  const url = new URL(req.url);
  const propertyId = (url.searchParams.get('property_id') ?? '').trim();
  if (!propertyId) return NextResponse.json({ ok: false, error: 'invalid', detail: 'property_id is required' }, { status: 400 });
  const today = todayInEastern();
  const start = (url.searchParams.get('start') ?? today).trim();
  const end = (url.searchParams.get('end') ?? shiftIsoDay(start, Math.min(365, MAX_AVAILABILITY_DAYS - 1))).trim();

  try {
    const r = await availabilityForBridge(propertyId, start, end);
    if (!r.ok) return failure(r);
    return NextResponse.json({
      ok: true,
      listingId: `helm:${r.property.id}`,
      property_id: r.property.id,
      days: r.days,
      degraded: false,
      calendar_authority: 'helm',
    });
  } catch (err) {
    console.error('[pms/availability] GET failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ ok: false, error: 'unavailable_service' }, { status: 503 });
  }
}

export async function POST(req: Request) {
  const denied = authorizeStayConcierge(req);
  if (denied) return denied;

  let body: { property_id?: unknown; check_in?: unknown; check_out?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid', detail: 'body must be JSON' }, { status: 400 });
  }
  const propertyId = typeof body?.property_id === 'string' ? body.property_id.trim() : '';
  if (!propertyId) return NextResponse.json({ ok: false, error: 'invalid', detail: 'property_id is required' }, { status: 400 });

  try {
    const r = await rangeCheckForBridge(propertyId, String(body.check_in ?? ''), String(body.check_out ?? ''));
    if (!r.ok) return failure(r);
    return NextResponse.json({
      ok: true,
      available: r.available,
      days: r.days,
      unavailableDates: r.unavailableDates,
      reservedDates: r.reservedDates,
      degraded: false,
      calendar_authority: 'helm',
    });
  } catch (err) {
    console.error('[pms/availability] POST failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ ok: false, error: 'unavailable_service' }, { status: 503 });
  }
}
