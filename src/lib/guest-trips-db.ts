/**
 * A guest on staycapeann.com/trips: sign-in codes, sessions, their trips and
 * a withdrawn request. The rules are src/lib/guest-trips.ts.
 *
 *   requestTripCode   POST /api/pms/trips/code. Answers the same whether or
 *                     not the email has a trip, so the form tells no one who
 *                     stays with us. Five codes an hour per email.
 *   startTripSession  POST /api/pms/trips/session. The newest code only, ten
 *                     minutes, five tries; a match is claimed once.
 *   tripForSession    every trips call: the token's session, live.
 *   listTrips         their partner home requests and direct stays, read by
 *                     the email; fails closed (a failed read is never "no
 *                     trips").
 *   guestWithdraw     withdraw a request still waiting, through the office's
 *                     own writer, after checking it is theirs.
 *
 * Helm keeps sha256 hashes of codes and tokens, never the values.
 */
import 'server-only';
import { supabaseAdmin, isServiceConfigured } from '@/lib/supabase-admin';
import { withdrawBookingRequest } from '@/lib/booking-requests-db';
import { BOOKING_REQUEST_COLS, type BookingRequestRow } from '@/lib/booking-requests';
import { sendFromHello } from '@/lib/partner-host-email';
import { ensureStayLink } from '@/lib/guest-app-stays-db';
import { easternIsoDay } from '@/lib/partner-host-calendar';
import { threadCountsFor } from '@/lib/partner-messages-db';
import {
  TRIP_CODE_MINUTES,
  TRIP_CODE_TRIES,
  TRIP_CODES_PER_HOUR,
  TRIP_PAST_DAYS,
  TRIP_SESSION_DAYS,
  daysBefore,
  guestActor,
  keepTrip,
  makeTripCode,
  makeTripSessionToken,
  normalizeTripCode,
  normalizeTripEmail,
  parseTripSessionToken,
  sortTrips,
  tripCodeEmail,
  tripCodeHash,
  tripCodeMatches,
  tripFromBooking,
  tripFromRequest,
  tripSessionHash,
  type TripBookingRow,
  type TripView,
} from '@/lib/guest-trips';

const CODES = 'guest_trip_codes';
const SESSIONS = 'guest_trip_sessions';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BOOKING_COLS = 'id, property_id, check_in, check_out, status, num_guests, currency';

/** The trips Helm can find by this email, back as far as the list reaches. */
async function readTrips(email: string, today: string) {
  const since = daysBefore(today, TRIP_PAST_DAYS);
  const [requests, stays] = await Promise.all([
    supabaseAdmin
      .from('booking_requests')
      .select(BOOKING_REQUEST_COLS)
      .eq('guest_email', email)
      .gte('check_out', since)
      .order('created_at', { ascending: false })
      .limit(200),
    supabaseAdmin
      .from('bookings')
      .select(BOOKING_COLS)
      .eq('guest_email', email)
      .eq('channel', 'direct')
      .is('duplicate_of', null)
      .in('status', ['confirmed', 'completed', 'cancelled'])
      .gte('check_out', since)
      .order('check_in', { ascending: false })
      .limit(200),
  ]);
  if (requests.error) throw new Error(`trip requests read failed: ${requests.error.message}`);
  if (stays.error) throw new Error(`trip stays read failed: ${stays.error.message}`);
  return {
    requests: (requests.data ?? []) as BookingRequestRow[],
    stays: (stays.data ?? []) as Array<TripBookingRow & { property_id: string }>,
  };
}

export type TripCodeResult = { ok: true } | { ok: false; reason: 'invalid' | 'not_configured' };

export async function requestTripCode(rawEmail: unknown, now: Date = new Date()): Promise<TripCodeResult> {
  const email = normalizeTripEmail(rawEmail);
  if (!email) return { ok: false, reason: 'invalid' };
  if (!isServiceConfigured) return { ok: false, reason: 'not_configured' };

  // No trip under this email: the same answer as a send.
  const { requests, stays } = await readTrips(email, easternIsoDay(now));
  if (requests.length === 0 && stays.length === 0) return { ok: true };

  const since = new Date(now.getTime() - 3600_000).toISOString();
  const { count, error: countErr } = await supabaseAdmin
    .from(CODES)
    .select('id', { count: 'exact', head: true })
    .eq('email', email)
    .gte('created_at', since);
  if (countErr) throw new Error(`trip code count failed: ${countErr.message}`);
  if ((count ?? 0) >= TRIP_CODES_PER_HOUR) return { ok: true };

  const code = makeTripCode();
  const { data, error } = await supabaseAdmin
    .from(CODES)
    .insert({
      email,
      code_hash: tripCodeHash(email, code),
      created_at: now.toISOString(),
      expires_at: new Date(now.getTime() + TRIP_CODE_MINUTES * 60_000).toISOString(),
    })
    .select('id')
    .single();
  if (error) throw new Error(`trip code insert failed: ${error.message}`);
  try {
    await sendFromHello(email, tripCodeEmail(code), `guest-trip-code:${(data as { id: string }).id}`);
  } catch (err) {
    console.warn('[guest-trips] code email failed:', err instanceof Error ? err.message : String(err));
  }
  return { ok: true };
}

export type TripSessionResult =
  | { ok: true; token: string; expires_at: string }
  | { ok: false; reason: 'invalid' | 'wrong_code' | 'expired' | 'too_many' | 'not_configured' };

export async function startTripSession(rawEmail: unknown, rawCode: unknown, now: Date = new Date()): Promise<TripSessionResult> {
  const email = normalizeTripEmail(rawEmail);
  const code = normalizeTripCode(rawCode);
  if (!email || !code) return { ok: false, reason: 'invalid' };
  if (!isServiceConfigured) return { ok: false, reason: 'not_configured' };

  const { data, error } = await supabaseAdmin
    .from(CODES)
    .select('id, code_hash, expires_at, attempts, used_at')
    .eq('email', email)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`trip code read failed: ${error.message}`);
  const row = data as { id: string; code_hash: string; expires_at: string; attempts: number; used_at: string | null } | null;
  if (!row || row.used_at || Date.parse(row.expires_at) <= now.getTime()) return { ok: false, reason: 'expired' };
  if (row.attempts >= TRIP_CODE_TRIES) return { ok: false, reason: 'too_many' };

  if (!tripCodeMatches(email, code, row.code_hash)) {
    await supabaseAdmin.from(CODES).update({ attempts: row.attempts + 1 }).eq('id', row.id).eq('attempts', row.attempts);
    return { ok: false, reason: row.attempts + 1 >= TRIP_CODE_TRIES ? 'too_many' : 'wrong_code' };
  }

  // The claim: one session per code, even when two taps race.
  const { data: claimed, error: claimErr } = await supabaseAdmin
    .from(CODES)
    .update({ used_at: now.toISOString() })
    .eq('id', row.id)
    .is('used_at', null)
    .lt('attempts', TRIP_CODE_TRIES)
    .select('id')
    .maybeSingle();
  if (claimErr) throw new Error(`trip code claim failed: ${claimErr.message}`);
  if (!claimed) return { ok: false, reason: 'expired' };

  const token = makeTripSessionToken();
  const expires = new Date(now.getTime() + TRIP_SESSION_DAYS * 86_400_000).toISOString();
  const { error: insErr } = await supabaseAdmin.from(SESSIONS).insert({
    token_hash: tripSessionHash(token),
    email,
    created_at: now.toISOString(),
    expires_at: expires,
    last_seen_at: now.toISOString(),
  });
  if (insErr) throw new Error(`trip session insert failed: ${insErr.message}`);
  return { ok: true, token, expires_at: expires };
}

export type TripSession = { email: string };

export async function tripForSession(rawToken: unknown, now: Date = new Date()): Promise<TripSession | null> {
  const token = parseTripSessionToken(rawToken);
  if (!token || !isServiceConfigured) return null;
  const hash = tripSessionHash(token);
  const { data, error } = await supabaseAdmin
    .from(SESSIONS)
    .select('email, expires_at, ended_at, last_seen_at')
    .eq('token_hash', hash)
    .maybeSingle();
  if (error) throw new Error(`trip session read failed: ${error.message}`);
  const row = data as { email: string; expires_at: string; ended_at: string | null; last_seen_at: string | null } | null;
  if (!row || row.ended_at || Date.parse(row.expires_at) <= now.getTime()) return null;
  if (!row.last_seen_at || now.getTime() - Date.parse(row.last_seen_at) > 3600_000) {
    await supabaseAdmin.from(SESSIONS).update({ last_seen_at: now.toISOString() }).eq('token_hash', hash);
  }
  return { email: row.email };
}

export async function endTripSession(rawToken: unknown, now: Date = new Date()): Promise<void> {
  const token = parseTripSessionToken(rawToken);
  if (!token || !isServiceConfigured) return;
  await supabaseAdmin.from(SESSIONS).update({ ended_at: now.toISOString() }).eq('token_hash', tripSessionHash(token)).is('ended_at', null);
}

async function homeTitles(ids: string[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  if (ids.length === 0) return out;
  const { data, error } = await supabaseAdmin.from('properties').select('id, name, title').in('id', ids);
  if (error) throw new Error(`trip homes read failed: ${error.message}`);
  for (const p of (data ?? []) as Array<{ id: string; name: string | null; title: string | null }>) out.set(p.id, p.title || p.name);
  return out;
}

export async function listTrips(session: TripSession, now: Date = new Date()): Promise<{ today: string; trips: TripView[] }> {
  const today = easternIsoDay(now);
  const { requests, stays } = await readTrips(session.email, today);
  const titles = await homeTitles([...new Set([...requests.map((r) => r.property_id), ...stays.map((s) => s.property_id)])]);
  const by = guestActor(session.email);

  const counts = await threadCountsFor(
    requests.map((r) => r.id),
    'guest',
  );
  const trips: TripView[] = requests.map((r) => ({ ...tripFromRequest(r, titles.get(r.property_id) ?? null, today, now), ...counts.get(r.id) }));
  for (const s of stays) {
    const upcoming = s.status === 'confirmed' && s.check_out > today;
    // A failed mint leaves the trip without its link rather than the page without the trip.
    const link = upcoming
      ? await ensureStayLink(s.id, { by, now, propertyId: s.property_id }).catch((err: unknown) => {
          console.error('[guest-trips] stay link failed:', err instanceof Error ? err.message : String(err));
          return null;
        })
      : null;
    trips.push(tripFromBooking(s, titles.get(s.property_id) ?? null, today, link?.url ?? null));
  }
  return { today, trips: sortTrips(trips.filter((t) => keepTrip(t, today))) };
}

export type GuestWithdrawResult = { ok: true; trip: TripView } | { ok: false; reason: string; notFound?: boolean };

export async function guestWithdraw(session: TripSession, rawId: unknown, now: Date = new Date()): Promise<GuestWithdrawResult> {
  const id = typeof rawId === 'string' && UUID.test(rawId) ? rawId : null;
  if (!id) return { ok: false, reason: 'No such request.', notFound: true };
  const { data, error } = await supabaseAdmin.from('booking_requests').select('guest_email, property_id').eq('id', id).maybeSingle();
  if (error) throw new Error(`trip request read failed: ${error.message}`);
  const found = data as { guest_email: string; property_id: string } | null;
  if (!found || normalizeTripEmail(found.guest_email) !== session.email) return { ok: false, reason: 'No such request.', notFound: true };

  const r = await withdrawBookingRequest(id, guestActor(session.email), now);
  if (!r.ok) return { ok: false, reason: r.reason };
  const titles = await homeTitles([found.property_id]);
  return { ok: true, trip: tripFromRequest(r.row, titles.get(found.property_id) ?? null, easternIsoDay(now), now) };
}
