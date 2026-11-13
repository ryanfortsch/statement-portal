/**
 * A partner home's host on staycapeann.com (src/lib/partner-host.ts and
 * partner-host-db.ts, the routes under src/app/api/pms/host/).
 *
 * A host signs in with a code Helm emails, answers their own booking
 * requests, and sees only their own homes. These hold:
 *   - codes and tokens are random, tied to their email, and kept as hashes;
 *   - a host sees a request's guest by first name and initial until the stay
 *     is booked, and the guest's contact only then;
 *   - Accept stays possible only over a held card on a live clock;
 *   - the code email carries the code and nothing else, and the request
 *     email carries no guest contact;
 *   - the guards spread across files: the bridge key and the session header
 *     on every route, never a query string; the host's answer goes through
 *     the office's own writers after a check that the request is theirs;
 *     codes per hour and tries per code; the migration's grants.
 *
 * Run: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  HOST_CODE_MINUTES,
  HOST_CODE_TRIES,
  HOST_CODES_PER_HOUR,
  HOST_SESSION_DAYS,
  HOST_SESSION_HEADER,
  homesForHost,
  hostActor,
  hostAreaUrl,
  hostCodeEmail,
  hostCodeHash,
  hostCodeMatches,
  hostEmailsOf,
  hostGuestName,
  hostNewRequestEmail,
  hostRequestView,
  hostSessionHash,
  makeHostCode,
  makeHostSessionToken,
  normalizeHostCode,
  normalizeHostEmail,
  parseHostSessionToken,
  sortHostRequests,
} from '../partner-host.ts';
import { respondByFor, type BookingRequestRow } from '../booking-requests.ts';
import { channelLabel, easternIsoDay, hostCalendarSpans, hostCalendarWindow, hostFeedView } from '../partner-host-calendar.ts';

const root = new URL('../../../', import.meta.url);
const read = (p: string): string => readFileSync(new URL(p, root), 'utf8');
const code = (p: string): string =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

const NOW = new Date('2026-11-13T15:00:00Z');
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
    host_told_by: null,
    host_emailed_at: null,
    decided_at: null,
    decided_by: null,
    decline_reason: 'The office typed this.',
    receipt_emailed_at: null,
    outcome_emailed_at: null,
    stripe_account_id: 'acct_123456',
    payment_intent_id: 'pi_123456',
    hold_cents: 412_500,
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

describe('sign-in', () => {
  test('emails and codes are read the way they are typed', () => {
    assert.equal(normalizeHostEmail('  Host@Example.COM '), 'host@example.com');
    assert.equal(normalizeHostEmail('not an email'), null);
    assert.equal(normalizeHostEmail(42), null);
    assert.equal(normalizeHostCode('123 456'), '123456');
    assert.equal(normalizeHostCode('12345'), null);
    assert.equal(normalizeHostCode('12a456'), null);
  });

  test('a code is six digits, and its hash belongs to one email', () => {
    for (let i = 0; i < 50; i++) assert.match(makeHostCode(), /^\d{6}$/);
    const h = hostCodeHash('host@example.com', '123456');
    assert.match(h, /^[0-9a-f]{64}$/);
    assert.notEqual(h, hostCodeHash('other@example.com', '123456'));
    assert.ok(hostCodeMatches('host@example.com', '123456', h));
    assert.ok(!hostCodeMatches('host@example.com', '123457', h));
    assert.ok(!hostCodeMatches('other@example.com', '123456', h));
  });

  test('a session token is 256 random bits, kept only as its hash', () => {
    const a = makeHostSessionToken();
    const b = makeHostSessionToken();
    assert.notEqual(a, b);
    assert.equal(parseHostSessionToken(a), a);
    assert.equal(parseHostSessionToken('short'), null);
    assert.equal(parseHostSessionToken(`${a}!`), null);
    assert.match(hostSessionHash(a), /^[0-9a-f]{64}$/);
    assert.notEqual(hostSessionHash(a), a);
  });

  test('the limits', () => {
    assert.equal(HOST_CODE_MINUTES, 10);
    assert.equal(HOST_CODE_TRIES, 5);
    assert.equal(HOST_CODES_PER_HOUR, 5);
    assert.equal(HOST_SESSION_DAYS, 30);
    assert.equal(HOST_SESSION_HEADER, 'x-host-session');
  });

  test('a host is the email on a partner home, in any case', () => {
    const homes = [
      { id: 'a', kind: 'partner', owner_emails: ['Host@Example.com'] },
      { id: 'b', kind: 'partner', owner_emails: ['someone@else.com', 'host@example.com'] },
      { id: 'c', kind: 'managed', owner_emails: ['host@example.com'] },
      { id: 'd', kind: 'partner', owner_emails: null },
    ];
    assert.deepEqual(homesForHost('host@example.com', homes).map((h) => h.id), ['a', 'b']);
    assert.deepEqual(hostEmailsOf({ owner_emails: ['A@B.co', 'nope', 7] }), ['a@b.co']);
    assert.equal(hostActor('host@example.com'), 'host:host@example.com');
  });
});

describe('what a host sees', () => {
  test('first name and initial until booked, then the whole name and the contact', () => {
    const open = hostRequestView(row(), 'Stay at Bass Rocks', NOW);
    assert.equal(open.guest_name, 'Jamie R.');
    assert.equal(open.contact, null);
    assert.equal(open.home_title, 'Bass Rocks');
    const booked = hostRequestView(row({ status: 'accepted', hold_status: 'captured' }), 'Stay at Bass Rocks', NOW);
    assert.equal(booked.guest_name, 'Jamie Rivera');
    assert.deepEqual(booked.contact, { email: 'jamie@example.com', phone: '+1 555 0100' });
    assert.equal(hostGuestName({ guest_first_name: '', guest_last_name: '' }, false), 'Guest');
  });

  test('never the office decline reason', () => {
    const v = hostRequestView(row({ status: 'declined' }), null, NOW) as Record<string, unknown>;
    assert.ok(!('decline_reason' in v));
    assert.ok(!JSON.stringify(v).includes('The office typed this.'));
  });

  test('the money: the hold, our fee, and what reaches the host', () => {
    const v = hostRequestView(row(), null, NOW);
    assert.equal(v.total_cents, 412_500);
    assert.equal(v.fee_cents, 26_250);
    assert.equal(v.payout_cents, 386_250);
    const noCard = hostRequestView(row({ hold_status: 'none', hold_cents: null, fee_cents: null }), null, NOW);
    assert.equal(noCard.total_cents, 412_500);
    assert.equal(noCard.payout_cents, null);
  });

  test('Accept only over a held card on a live clock; Decline while open', () => {
    assert.equal(hostRequestView(row(), null, NOW).can_accept, true);
    assert.equal(hostRequestView(row({ hold_status: 'none' }), null, NOW).can_accept, false);
    const late = hostRequestView(row(), null, hours(25));
    assert.equal(late.can_accept, false);
    assert.equal(late.can_decline, false);
    assert.equal(late.status, 'expired');
    assert.equal(late.clock, 'Closed');
  });

  test('open requests first, soonest clock first, then the newest', () => {
    const a = hostRequestView(row({ id: 'a', respond_by: hours(20).toISOString() }), null, NOW);
    const b = hostRequestView(row({ id: 'b', respond_by: hours(3).toISOString() }), null, NOW);
    const c = hostRequestView(row({ id: 'c', status: 'declined', created_at: hours(-50).toISOString() }), null, NOW);
    const d = hostRequestView(row({ id: 'd', status: 'accepted', created_at: hours(-10).toISOString() }), null, NOW);
    assert.deepEqual(sortHostRequests([c, a, d, b]).map((r) => r.id), ['b', 'a', 'd', 'c']);
  });
});

describe('email to the host', () => {
  test('the code email carries the code and nothing else', () => {
    const e = hostCodeEmail('123456');
    assert.ok(e.subject.includes('123 456'));
    assert.ok(e.text.includes('123 456') && e.html.includes('123 456'));
    assert.ok(e.text.includes(`${HOST_CODE_MINUTES} minutes`));
    assert.ok(!/https?:\/\//.test(e.text), 'no link in a code email');
  });

  test('the request email names the stay, the clock and the link, never the guest contact', () => {
    const e = hostNewRequestEmail(row(), 'Stay at Bass Rocks', 'https://staycapeann.com/');
    assert.ok(e.subject.includes('Bass Rocks'));
    assert.ok(e.text.includes('Jamie R.'));
    assert.ok(e.text.includes('Celebrating a birthday.'));
    assert.ok(e.text.includes('$4,125') && e.text.includes('$3,862.50'));
    assert.ok(e.text.includes(hostAreaUrl('https://staycapeann.com/')));
    assert.equal(hostAreaUrl('https://staycapeann.com/'), 'https://staycapeann.com/host');
    for (const s of ['jamie@example.com', '555 0100', 'Rivera', 'The office typed this.', 'Helm']) {
      assert.ok(!e.text.includes(s) && !e.html.includes(s), s);
    }
    assert.ok(!e.html.includes('<script'), 'a guest message is escaped');
    const hostile = hostNewRequestEmail(row({ message: '<img src=x onerror=alert(1)>' }), null, 'https://staycapeann.com');
    assert.ok(!hostile.html.includes('<img'));
  });
});

describe('the calendar', () => {
  test('the window is this Eastern month and the eleven after it', () => {
    assert.deepEqual(hostCalendarWindow(NOW), { today: '2026-11-13', from: '2026-11-01', to: '2027-11-01' });
    // 11 PM Eastern on Dec 31 is already Jan 1 in UTC; the window is still December's.
    assert.deepEqual(hostCalendarWindow(new Date('2027-01-01T04:00:00Z')), { today: '2026-12-31', from: '2026-12-01', to: '2027-12-01' });
    assert.equal(easternIsoDay(new Date('2026-11-14T03:30:00Z')), '2026-11-13');
  });

  test('four kinds of night, each named the way the host would say it', () => {
    const spans = hostCalendarSpans(
      {
        requests: [
          row({ status: 'accepted', check_in: '2027-07-03', check_out: '2027-07-10' }),
          row({ check_in: '2027-08-01', check_out: '2027-08-04', guest_first_name: 'Morgan', guest_last_name: 'Tate' }),
        ],
        holds: [
          { kind: 'stay', check_in: '2027-06-01', check_out: '2027-06-05', channel: 'airbnb' },
          { kind: 'block', check_in: '2027-07-03', check_out: '2027-07-10', channel: 'airbnb' },
          { kind: 'block', check_in: '2027-09-01', check_out: '2027-09-02', channel: 'other' },
        ],
        from: '2026-11-01',
        to: '2027-11-01',
      },
      NOW,
    );
    assert.deepEqual(
      spans.map((s) => [s.kind, s.check_in, s.label]),
      [
        ['elsewhere', '2027-06-01', 'Airbnb'],
        ['booked', '2027-07-03', 'Jamie Rivera'],
        ['blocked', '2027-07-03', 'Blocked on Airbnb'],
        ['request', '2027-08-01', 'Request from Morgan T.'],
        ['blocked', '2027-09-01', 'Blocked on your other calendar'],
      ],
    );
  });

  test('a booked night outranks the block Airbnb echoes back', () => {
    const spans = hostCalendarSpans(
      { requests: [row({ status: 'accepted' })], holds: [{ kind: 'block', check_in: '2027-07-03', check_out: '2027-07-10', channel: 'airbnb' }], from: '2026-11-01', to: '2027-11-01' },
      NOW,
    );
    assert.equal(spans[0].kind, 'booked');
  });

  test('a closed request holds nothing, and nothing leaves the window', () => {
    const spans = hostCalendarSpans(
      {
        requests: [
          row({ respond_by: hours(-1).toISOString() }),
          row({ status: 'declined' }),
          row({ status: 'accepted', check_in: '2026-10-28', check_out: '2026-11-03' }),
          row({ status: 'accepted', check_in: '2027-10-30', check_out: '2027-11-04' }),
          row({ status: 'accepted', check_in: '2027-12-01', check_out: '2027-12-03' }),
        ],
        holds: [],
        from: '2026-11-01',
        to: '2027-11-01',
      },
      NOW,
    );
    assert.deepEqual(spans.map((s) => [s.check_in, s.check_out]), [['2026-11-01', '2026-11-03'], ['2027-10-30', '2027-11-01']]);
  });

  test("a host's calendar shows when it was last read, never its link", () => {
    assert.deepEqual(hostFeedView({ channel: 'vrbo', last_synced_at: hours(-1).toISOString() }, NOW), { channel: 'vrbo', label: 'Vrbo', last_read_at: hours(-1).toISOString(), fresh: true });
    assert.equal(hostFeedView({ channel: 'airbnb', last_synced_at: hours(-7).toISOString() }, NOW).fresh, false);
    assert.equal(hostFeedView({ channel: 'airbnb', last_synced_at: null }, NOW).fresh, false);
    assert.equal(channelLabel('booking_com'), 'Booking.com');
    const db = code('src/lib/partner-host-db.ts');
    const cal = db.slice(db.indexOf('export async function hostCalendar('));
    assert.ok(cal.includes(".select('id, property_id, channel, last_synced_at')"), 'the feed read names its columns');
    assert.ok(!/\burl\b/.test(cal), 'the host calendar never reads a feed link');
  });

  test('the calendar reads only the signed-in host\'s homes, and fails closed', () => {
    const db = code('src/lib/partner-host-db.ts');
    const cal = db.slice(db.indexOf('export async function hostCalendar('));
    assert.equal((cal.match(/\.in\('property_id', ids\)/g) ?? []).length, 3);
    assert.ok(cal.includes('const ids = session.homes.map((h) => h.id)'));
    assert.ok(!/catch/.test(cal), 'a failed read throws rather than showing a night open');
    const route = code('src/app/api/pms/host/calendar/route.ts');
    assert.ok(route.indexOf("if (!session) return NextResponse.json({ ok: false, error: 'signed_out' }, { status: 401 })") < route.indexOf('hostCalendar(session)'));
  });
});

describe('the guards', () => {
  const routes = ['src/app/api/pms/host/code/route.ts', 'src/app/api/pms/host/session/route.ts', 'src/app/api/pms/host/requests/route.ts', 'src/app/api/pms/host/calendar/route.ts'];

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

  test('the session is the header, and every request call checks it first', () => {
    const src = code('src/app/api/pms/host/requests/route.ts');
    assert.equal((src.match(/hostForSession\(req\.headers\.get\(HOST_SESSION_HEADER\)\)/g) ?? []).length, 2);
    const get = src.slice(src.indexOf('export async function GET('), src.indexOf('export async function POST('));
    assert.ok(get.indexOf('if (!session) return signedOut()') < get.indexOf('listHostRequests('));
    const post = src.slice(src.indexOf('export async function POST('));
    assert.ok(post.indexOf('if (!session) return signedOut()') < post.indexOf('hostDecide('));
  });

  test("a host's answer is checked against their homes, then goes through the office's writers", () => {
    const db = code('src/lib/partner-host-db.ts');
    const decide = db.slice(db.indexOf('export async function hostDecide('));
    const check = decide.indexOf('session.homes.find(');
    const notFound = decide.indexOf("if (!home) return { ok: false, reason: 'No such request.', notFound: true }");
    const write = decide.indexOf('acceptBookingRequest(id, by, now)');
    assert.ok(check > 0 && notFound > check && write > notFound, 'the home check comes before the write');
    const noHold = decide.indexOf("if (decision === 'accept' && found?.hold_status !== 'held') return { ok: false, reason: HOST_NO_HOLD }");
    assert.ok(noHold > notFound && noHold < write, 'a host books only over a card on hold');
    assert.ok(decide.includes('declineBookingRequest(id, by, reason, now)'));
    assert.ok(decide.includes('const by = hostActor(session.email)'));
    for (const f of ['src/lib/partner-host.ts', 'src/lib/partner-host-db.ts', 'src/lib/partner-host-email.ts', ...routes]) {
      assert.ok(!/status:\s*'accepted'/.test(code(f)), `${f} writes accepted`);
    }
    const hostDb = code('src/lib/partner-host-db.ts').replace(/\s+/g, ' ');
    assert.ok(!/from\('booking_requests'\)[^;]*\.update\(/.test(hostDb), 'the host module writes no request itself');
  });

  test('a code: the newest only, counted per hour, five tries, claimed once', () => {
    const db = code('src/lib/partner-host-db.ts');
    const ask = db.slice(db.indexOf('export async function requestHostCode('), db.indexOf('export type HostSessionResult'));
    assert.ok(ask.indexOf('homesForHost(email') < ask.indexOf('.insert('), 'only a host gets a code');
    assert.ok(ask.includes('>= HOST_CODES_PER_HOUR) return { ok: true }'), 'the limit answers like a send');
    const start = db.slice(db.indexOf('export async function startHostSession('), db.indexOf('export type HostSession ='));
    assert.ok(start.includes(".order('created_at', { ascending: false })") && start.includes('.limit(1)'));
    assert.ok(start.includes('row.attempts >= HOST_CODE_TRIES'));
    assert.ok(start.indexOf('hostCodeMatches(') < start.indexOf(".update({ used_at: now.toISOString() })"));
    assert.ok(start.includes(".is('used_at', null)"), 'the claim');
    assert.ok(start.includes('token_hash: hostSessionHash(token)'), 'the token is stored as its hash');
    assert.ok(!/insert\(\{[^}]*\btoken\b[,:]/.test(start.replace(/\s+/g, ' ')), 'never the token itself');
  });

  test('the request email goes on creation and the sweep retries it', () => {
    const db = code('src/lib/booking-requests-db.ts');
    const create = db.slice(db.indexOf('export async function createBookingRequest('), db.indexOf('export type RequestHome'));
    assert.ok(create.includes('emailHostAboutRequest(row)'));
    const sweep = db.slice(db.indexOf('export async function sweepBookingRequests('));
    assert.ok(sweep.includes(".is('host_emailed_at', null)") && sweep.includes('emailHostAboutRequest(row)'));
    const mail = code('src/lib/partner-host-email.ts');
    assert.ok(mail.includes(".eq('kind', 'partner')"), 'only a partner home emails a host');
    assert.ok(mail.includes(".is('host_emailed_at', null)"), 'stamped once');
  });

  test('the migration keeps hashes, grants service_role and adds the stamp', () => {
    const sql = read('supabase/migrations/20261113060000_partner_host_access.sql');
    for (const t of ['partner_host_codes', 'partner_host_sessions']) {
      assert.ok(sql.includes(`alter table public.${t} enable row level security;`), t);
      assert.ok(sql.includes(`grant select, insert, update, delete on public.${t} to service_role;`), t);
      assert.ok(sql.includes(`revoke all on public.${t} from anon, authenticated;`), `${t}: the clients get nothing`);
    }
    assert.ok(sql.includes('code_hash text not null') && sql.includes('token_hash text primary key'));
    assert.ok(!/\bcode text\b|\btoken text\b/.test(sql), 'no column holds a code or token');
    assert.ok(sql.includes('add column if not exists host_emailed_at timestamptz'));
  });
});
