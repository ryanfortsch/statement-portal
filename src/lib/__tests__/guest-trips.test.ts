/**
 * A guest's trips on staycapeann.com/trips (src/lib/guest-trips.ts and
 * guest-trips-db.ts, the routes under src/app/api/pms/trips/).
 *
 * A guest signs in with a code Helm emails and sees the requests and direct
 * stays under their email. These hold:
 *   - a guest's code is salted apart from a host's, and kept as a hash;
 *   - an email with no trip gets the answer a send gets, and no code;
 *   - a guest sees where each trip stands, the total and the terms they
 *     agreed to, never the host's contact or the office's decline reason;
 *   - only a request still waiting can be withdrawn, through the office's
 *     own writer, after a check that it is theirs;
 *   - the list reads only direct stays, canonical rows, and fails closed;
 *   - the bridge key and the session header on every route, never a query
 *     string; the migration's grants.
 *
 * Run: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  GUEST_ACTOR_PREFIX,
  TRIP_CLOSED_DAYS,
  TRIP_CODE_MINUTES,
  TRIP_CODE_TRIES,
  TRIP_CODES_PER_HOUR,
  TRIP_PAST_DAYS,
  TRIP_SESSION_DAYS,
  TRIP_SESSION_HEADER,
  daysBefore,
  guestActor,
  keepTrip,
  sortTrips,
  tripCodeEmail,
  tripCodeHash,
  tripCodeMatches,
  tripFromBooking,
  tripFromRequest,
  type TripView,
} from '../guest-trips.ts';
import { HOST_SESSION_HEADER, hostCodeHash } from '../partner-host.ts';
import { respondByFor, type BookingRequestRow } from '../booking-requests.ts';
import { receiptEmail, confirmedEmail, tripsLink } from '../booking-request-copy.ts';

const root = new URL('../../../', import.meta.url);
const read = (p: string): string => readFileSync(new URL(p, root), 'utf8');
const code = (p: string): string =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

const NOW = new Date('2026-11-13T15:00:00Z');
const TODAY = '2026-11-13';
const hours = (h: number) => new Date(NOW.getTime() + h * 3600_000);

function row(over: Partial<BookingRequestRow> = {}): BookingRequestRow {
  return {
    id: '7f0c2d4e-1a2b-4c3d-8e9f-0a1b2c3d4e5f',
    request_key: 'k1',
    source: 'sca',
    property_id: 'partner_home',
    check_in: '2027-07-03',
    check_out: '2027-07-10',
    guests: 4,
    guest_first_name: 'Jamie',
    guest_last_name: 'Rivera',
    guest_email: 'jamie@example.com',
    guest_phone: '+1 555 0100',
    message: 'Celebrating a birthday.',
    quoted_total_cents: 412_500,
    currency: 'USD',
    quote: {},
    status: 'pending',
    respond_by: respondByFor(NOW),
    host_told_at: null,
    host_told_by: 'office@example.com',
    host_emailed_at: null,
    decided_at: null,
    decided_by: null,
    decline_reason: 'The office typed this.',
    receipt_emailed_at: null,
    outcome_emailed_at: null,
    stripe_account_id: 'acct_123456',
    payment_intent_id: 'pi_123456',
    hold_cents: 400_000,
    fee_cents: 26_250,
    hold_status: 'held',
    hold_placed_at: NOW.toISOString(),
    captured_at: null,
    released_at: null,
    charge_id: null,
    hold_error: null,
    confirmation_emailed_at: null,
    cancellation_terms: 'Full refund up to 30 days before arrival.',
    house_rules: 'No parties.',
    terms_version: '2026-11-12',
    created_at: NOW.toISOString(),
    updated_at: NOW.toISOString(),
    ...over,
  };
}

const stay = (over: Partial<{ id: string; check_in: string; check_out: string; status: string; num_guests: number | null; currency: string | null }> = {}) => ({
  id: 'b1',
  check_in: '2026-12-04',
  check_out: '2026-12-07',
  status: 'confirmed',
  num_guests: 2,
  currency: 'USD',
  ...over,
});

describe('sign-in', () => {
  test("a guest's code hash is salted apart from a host's", () => {
    const h = tripCodeHash('jamie@example.com', '123456');
    assert.match(h, /^[0-9a-f]{64}$/);
    assert.notEqual(h, hostCodeHash('jamie@example.com', '123456'), "a host's code never opens a guest's trips");
    assert.ok(tripCodeMatches('jamie@example.com', '123456', h));
    assert.ok(!tripCodeMatches('jamie@example.com', '123457', h));
    assert.ok(!tripCodeMatches('other@example.com', '123456', h), 'tied to its email');
  });

  test('the limits, the header and the actor', () => {
    assert.equal(TRIP_CODE_MINUTES, 10);
    assert.equal(TRIP_CODE_TRIES, 5);
    assert.equal(TRIP_CODES_PER_HOUR, 5);
    assert.equal(TRIP_SESSION_DAYS, 30);
    assert.equal(TRIP_SESSION_HEADER, 'x-trip-session');
    assert.notEqual(TRIP_SESSION_HEADER, HOST_SESSION_HEADER);
    assert.equal(guestActor('jamie@example.com'), 'guest:jamie@example.com');
    assert.equal(GUEST_ACTOR_PREFIX, 'guest:');
  });

  test('the code email carries the code and nothing else', () => {
    const e = tripCodeEmail('123456');
    assert.match(e.text, /123 456/);
    assert.ok(!/https?:\/\//.test(e.text), 'no link in a code email');
  });
});

describe('what a guest sees', () => {
  test('a request waiting: its clock, the hold, the terms, and Withdraw', () => {
    const t = tripFromRequest(row(), 'Stay at the Harbor House', TODAY, NOW);
    assert.equal(t.kind, 'request');
    assert.equal(t.status, 'waiting');
    assert.equal(t.group, 'waiting');
    assert.equal(t.home_title, 'The Harbor House');
    assert.equal(t.nights, 7);
    assert.ok(t.clock && t.respond_by_label);
    assert.equal(t.total_cents, 400_000, 'the hold, not the quote, once a card is held');
    assert.equal(t.hold_status, 'held');
    assert.equal(t.can_withdraw, true);
    assert.equal(t.cancellation_terms, 'Full refund up to 30 days before arrival.');
    assert.equal(t.closed_at, null);
  });

  test('never the office decline reason, the host, or the card ids', () => {
    for (const r of [row(), row({ status: 'declined', decided_at: NOW.toISOString(), decided_by: 'host:owner@example.com' })]) {
      const all = JSON.stringify(tripFromRequest(r, 'Stay at the Harbor House', TODAY, NOW));
      for (const word of ['The office typed this', 'office@example.com', 'owner@example.com', 'acct_', 'pi_', 'Birthday', 'birthday']) {
        assert.ok(!all.includes(word), word);
      }
    }
  });

  test('booked, to come or past; closed with when', () => {
    const booked = tripFromRequest(row({ status: 'accepted', hold_status: 'captured' }), null, TODAY, NOW);
    assert.equal(booked.status, 'booked');
    assert.equal(booked.group, 'upcoming');
    assert.equal(booked.can_withdraw, false);
    assert.equal(booked.home_title, 'Your home');
    const past = tripFromRequest(row({ status: 'accepted', check_in: '2026-08-01', check_out: '2026-08-05' }), null, TODAY, NOW);
    assert.equal(past.group, 'past');
    const declined = tripFromRequest(row({ status: 'declined', decided_at: '2026-11-12T10:00:00Z' }), null, TODAY, NOW);
    assert.equal(declined.group, 'closed');
    assert.equal(declined.closed_at, '2026-11-12T10:00:00Z');
    assert.equal(declined.clock, null);
    // A pending row whose clock ran out reads as expired, closed when the clock ended.
    const ran = tripFromRequest(row(), null, TODAY, hours(25));
    assert.equal(ran.status, 'expired');
    assert.equal(ran.closed_at, row().respond_by);
    assert.equal(ran.can_withdraw, false);
  });

  test('a direct stay: its link only while it is to come', () => {
    const t = tripFromBooking(stay(), 'Stay at Rocky Neck', TODAY, 'https://staycapeann.com/s/abc');
    assert.equal(t.kind, 'stay');
    assert.equal(t.status, 'booked');
    assert.equal(t.group, 'upcoming');
    assert.equal(t.stay_url, 'https://staycapeann.com/s/abc');
    assert.equal(t.total_cents, null);
    const done = tripFromBooking(stay({ check_in: '2026-10-01', check_out: '2026-10-04', status: 'completed' }), null, TODAY, 'https://staycapeann.com/s/abc');
    assert.equal(done.group, 'past');
    assert.equal(done.stay_url, null);
    const off = tripFromBooking(stay({ status: 'cancelled' }), null, TODAY, 'https://staycapeann.com/s/abc');
    assert.equal(off.status, 'cancelled');
    assert.equal(off.group, 'closed');
    assert.equal(off.stay_url, null);
  });

  test('what stays on the list', () => {
    assert.equal(daysBefore(TODAY, 60), '2026-09-14');
    const at = (t: Partial<TripView>) => keepTrip({ group: 'closed', kind: 'request', check_out: '2027-01-01', closed_at: null, ...t }, TODAY);
    assert.ok(at({ group: 'waiting' }) && at({ group: 'upcoming' }));
    assert.ok(at({ group: 'past', check_out: daysBefore(TODAY, TRIP_PAST_DAYS) }));
    assert.ok(!at({ group: 'past', check_out: daysBefore(TODAY, TRIP_PAST_DAYS + 1) }));
    assert.ok(at({ closed_at: `${daysBefore(TODAY, TRIP_CLOSED_DAYS)}T12:00:00Z` }));
    assert.ok(!at({ closed_at: `${daysBefore(TODAY, TRIP_CLOSED_DAYS + 1)}T12:00:00Z` }));
    assert.ok(at({ kind: 'stay', check_out: '2026-11-20' }), 'a cancelled stay until its dates pass');
    assert.ok(!at({ kind: 'stay', check_out: TODAY }));
  });

  test('waiting, then to come soonest first, then closed newest first, then past latest first', () => {
    const t = (id: string, group: TripView['group'], check_in: string, closed_at: string | null = null) =>
      ({ ...tripFromBooking(stay(), null, TODAY, null), id, group, check_in, closed_at }) as TripView;
    const order = sortTrips([
      t('past-old', 'past', '2026-06-01'),
      t('soon', 'upcoming', '2026-12-01'),
      t('closed-old', 'closed', '2027-01-01', '2026-10-01T00:00:00Z'),
      t('waiting', 'waiting', '2027-07-03'),
      t('later', 'upcoming', '2027-02-01'),
      t('past-new', 'past', '2026-09-01'),
      t('closed-new', 'closed', '2027-01-01', '2026-11-10T00:00:00Z'),
    ]).map((x) => x.id);
    assert.deepEqual(order, ['waiting', 'soon', 'later', 'closed-new', 'closed-old', 'past-new', 'past-old']);
  });
});

describe('the emails point at the trips page', () => {
  const ctx = { title: 'Stay at the Harbor House', siteOrigin: 'https://staycapeann.com/' };
  test('the receipt and the confirmation link /trips', () => {
    assert.equal(tripsLink(ctx.siteOrigin), 'https://staycapeann.com/trips');
    for (const e of [receiptEmail(row(), ctx), confirmedEmail({ ...row({ status: 'accepted' }), charged_cents: 400_000 }, ctx)]) {
      assert.ok(e.text.includes('https://staycapeann.com/trips'));
      assert.ok(e.html.includes('href="https://staycapeann.com/trips"') && e.html.includes('>Your trips</a>'));
    }
  });
});

describe('the guards', () => {
  const routes = ['src/app/api/pms/trips/code/route.ts', 'src/app/api/pms/trips/session/route.ts', 'src/app/api/pms/trips/route.ts'];

  test('every route takes the bridge key, and no secret rides a query string', () => {
    for (const f of routes) {
      const src = code(f);
      const handlers = (src.match(/export async function (GET|POST|DELETE)\(/g) ?? []).length;
      assert.ok(handlers > 0, f);
      assert.equal((src.match(/authorizeStayConcierge\(req\)/g) ?? []).length, handlers, `${f}: every handler checks the key`);
      assert.ok(!src.includes('searchParams') && !src.includes('nextUrl'), `${f} reads the URL`);
    }
    assert.ok(read('src/proxy.ts').includes('"/api/pms/",'), 'the bridge prefix is the public one the handlers guard');
  });

  test('the session is the trips header, checked before any read or write', () => {
    const src = code('src/app/api/pms/trips/route.ts');
    assert.equal((src.match(/tripForSession\(req\.headers\.get\(TRIP_SESSION_HEADER\)\)/g) ?? []).length, 2);
    assert.ok(!src.includes('HOST_SESSION_HEADER') && !src.includes('hostForSession'), "a host's session never opens trips");
    const get = src.slice(src.indexOf('export async function GET('), src.indexOf('export async function POST('));
    assert.ok(get.indexOf('if (!session) return signedOut()') < get.indexOf('listTrips('));
    const post = src.slice(src.indexOf('export async function POST('));
    assert.ok(post.indexOf('if (!session) return signedOut()') < post.indexOf('guestWithdraw('));
  });

  test('only an email with a trip gets a code, and the limit answers like a send', () => {
    const db = code('src/lib/guest-trips-db.ts');
    const ask = db.slice(db.indexOf('export async function requestTripCode('), db.indexOf('export type TripSessionResult'));
    const none = ask.indexOf('if (requests.length === 0 && stays.length === 0) return { ok: true }');
    assert.ok(none > 0 && none < ask.indexOf('.insert('), 'no trip, no code, the same answer');
    assert.ok(ask.includes('>= TRIP_CODES_PER_HOUR) return { ok: true }'));
    assert.ok(ask.includes('code_hash: tripCodeHash(email, code)'));
    assert.ok(db.includes("const CODES = 'guest_trip_codes'") && db.includes("const SESSIONS = 'guest_trip_sessions'"));
    assert.ok(!db.includes('partner_host_'), 'the guest tables only');
  });

  test('a code: the newest only, five tries, claimed once, the token as its hash', () => {
    const db = code('src/lib/guest-trips-db.ts');
    const start = db.slice(db.indexOf('export async function startTripSession('), db.indexOf('export type TripSession ='));
    assert.ok(start.includes(".order('created_at', { ascending: false })") && start.includes('.limit(1)'));
    assert.ok(start.includes('row.attempts >= TRIP_CODE_TRIES'));
    assert.ok(start.indexOf('tripCodeMatches(') < start.indexOf(".update({ used_at: now.toISOString() })"));
    assert.ok(start.includes(".is('used_at', null)"), 'the claim');
    assert.ok(start.includes('token_hash: tripSessionHash(token)'));
    assert.ok(!/insert\(\{[^}]*\btoken\b[,:]/.test(start.replace(/\s+/g, ' ')), 'never the token itself');
  });

  test('the list: the email, direct canonical stays, and a failed read throws', () => {
    const db = code('src/lib/guest-trips-db.ts');
    const reads = db.slice(db.indexOf('async function readTrips('), db.indexOf('export type TripCodeResult'));
    assert.equal((reads.match(/\.eq\('guest_email', email\)/g) ?? []).length, 2);
    assert.ok(reads.includes(".eq('channel', 'direct')"), 'never an OTA stay');
    assert.ok(reads.includes(".is('duplicate_of', null)"), 'the canonical row');
    assert.ok(reads.includes('if (requests.error) throw') && reads.includes('if (stays.error) throw'), 'a failed read is never "no trips"');
    const list = db.slice(db.indexOf('export async function listTrips('), db.indexOf('export type GuestWithdrawResult'));
    assert.ok(/await ensureStayLink\([^)]*\)\.catch\(/.test(list), 'a failed mint never takes the trip with it');
    assert.ok(!db.includes('getLiveStayCode') && !db.includes('property_access'), 'no door code passes through trips');
  });

  test("a withdrawal is checked against the guest's email, then goes through the office's writer", () => {
    const db = code('src/lib/guest-trips-db.ts');
    const w = db.slice(db.indexOf('export async function guestWithdraw('));
    const check = w.indexOf('normalizeTripEmail(found.guest_email) !== session.email');
    const write = w.indexOf('withdrawBookingRequest(id, guestActor(session.email), now)');
    assert.ok(check > 0 && write > check, 'the email check comes before the write');
    const flat = db.replace(/\s+/g, ' ');
    assert.ok(!/from\('booking_requests'\)[^;]*\.update\(/.test(flat), 'the trips module writes no request itself');
    assert.ok(!/from\('bookings'\)[^;]*\.(update|insert|delete)\(/.test(flat), 'nor a booking');
    for (const f of ['src/lib/guest-trips.ts', 'src/lib/guest-trips-db.ts', ...routes]) {
      assert.ok(!/acceptBookingRequest|declineBookingRequest/.test(code(f)), `${f}: a guest only withdraws`);
    }
  });

  test('the migration keeps hashes and grants service_role only', () => {
    const sql = read('supabase/migrations/20261113210000_guest_trips_access.sql');
    for (const t of ['guest_trip_codes', 'guest_trip_sessions']) {
      assert.ok(sql.includes(`alter table public.${t} enable row level security;`), t);
      assert.ok(sql.includes(`grant select, insert, update, delete on public.${t} to service_role;`), t);
      assert.ok(sql.includes(`revoke all on public.${t} from anon, authenticated;`), `${t}: the clients get nothing`);
    }
    assert.ok(sql.includes('code_hash text not null') && sql.includes('token_hash text primary key'));
    assert.ok(!/\bcode text\b|\btoken text\b/.test(sql), 'no column holds a code or token');
  });
});
