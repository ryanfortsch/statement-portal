/**
 * Booking requests for partner homes (src/lib/booking-requests.ts and the
 * guest copy in src/lib/booking-request-copy.ts).
 *
 * A guest asks a partner home's host for dates on staycapeann.com, the host
 * has 24 hours, and the guest is emailed either way. These hold the clock,
 * the overlap check, validation, the guest copy (never an internal note or a
 * host contact), and the guards spread across files: Helm prices the stay
 * itself, only a partner home takes a request, every decision claims the row
 * while it is pending, and only Accept writes 'accepted', with a card on hold.
 * The money rules are partner-payments.test.ts.
 *
 * Run: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  BOOKING_REQUEST_STATUS_LABEL,
  RESPONSE_WINDOW_HOURS,
  cleanMessage,
  clockLabel,
  effectiveStatus,
  isOpen,
  isUrgent,
  nightsOf,
  oneLine,
  openOverlaps,
  requestQueueText,
  requestTerms,
  respondByFor,
  staysOverlap,
  toPublicRequest,
  validateRequestInput,
  type BookingRequestRow,
} from '../booking-requests.ts';
import { declinedEmail, expiredEmail, otherHomesUrl, receiptEmail, totalCovers } from '../booking-request-copy.ts';

const root = new URL('../../../', import.meta.url);
const read = (p: string): string => readFileSync(new URL(p, root), 'utf8');

const NOW = new Date('2026-11-12T15:00:00Z');

function row(over: Partial<BookingRequestRow> = {}): BookingRequestRow {
  return {
    id: 'r1',
    request_key: 'k1',
    source: 'sca',
    property_id: 'partner_home',
    check_in: '2027-07-03',
    check_out: '2027-07-10',
    guests: 4,
    guest_first_name: 'Jamie',
    guest_last_name: 'Rivera',
    guest_email: 'jamie@example.com',
    guest_phone: null,
    message: null,
    quoted_total_cents: 412_500,
    currency: 'USD',
    quote: { breakdown: { cleaning_cents: 25_000, tax_cents: 40_000 } },
    status: 'pending',
    respond_by: respondByFor(NOW),
    host_told_at: null,
    host_told_by: null,
    host_emailed_at: null,
    decided_at: null,
    decided_by: null,
    decline_reason: null,
    receipt_emailed_at: null,
    outcome_emailed_at: null,
    stripe_account_id: null,
    payment_intent_id: null,
    hold_cents: null,
    fee_cents: null,
    hold_status: 'none',
    hold_placed_at: null,
    captured_at: null,
    released_at: null,
    charge_id: null,
    hold_error: null,
    confirmation_emailed_at: null,
    cancellation_terms: 'Full refund up to 30 days before arrival.',
    house_rules: null,
    terms_version: '2026-11-12',
    created_at: NOW.toISOString(),
    updated_at: NOW.toISOString(),
    ...over,
  };
}

const hours = (h: number) => new Date(NOW.getTime() + h * 3600_000);

describe('the clock', () => {
  test('a host has 24 hours from the moment the request lands', () => {
    assert.equal(RESPONSE_WINDOW_HOURS, 24);
    assert.equal(respondByFor(NOW), '2026-11-13T15:00:00.000Z');
  });

  test('a pending request past its clock reads as closed before the cron runs', () => {
    const r = row();
    assert.equal(effectiveStatus(r, hours(23)), 'pending');
    assert.equal(effectiveStatus(r, hours(24)), 'expired');
    assert.equal(isOpen(r, hours(25)), false);
    assert.equal(effectiveStatus({ ...r, status: 'declined' }, hours(1)), 'declined');
  });

  test('the label counts down and goes urgent under four hours', () => {
    const r = row();
    assert.equal(clockLabel(r, NOW), '24 h left');
    assert.equal(clockLabel(r, hours(19.5)), '4 h left');
    assert.equal(isUrgent(r, hours(19.5)), false);
    assert.equal(isUrgent(r, hours(20.5)), true);
    assert.equal(clockLabel(r, hours(23.5)), '30 min left');
    assert.equal(clockLabel(r, hours(24)), 'Closed');
    assert.equal(isUrgent(r, hours(24)), false);
  });

  test('every status has a label', () => {
    for (const s of ['pending', 'accepted', 'declined', 'expired', 'withdrawn'] as const) assert.ok(BOOKING_REQUEST_STATUS_LABEL[s]);
  });
});

describe('overlaps', () => {
  test('stays are half-open: a checkout day is free for the next arrival', () => {
    assert.equal(staysOverlap({ check_in: '2027-07-03', check_out: '2027-07-10' }, { check_in: '2027-07-10', check_out: '2027-07-12' }), false);
    assert.equal(staysOverlap({ check_in: '2027-07-03', check_out: '2027-07-10' }, { check_in: '2027-07-09', check_out: '2027-07-12' }), true);
  });

  test('only open requests at the same home name each other', () => {
    const a = row({ id: 'a' });
    const b = row({ id: 'b', check_in: '2027-07-08', check_out: '2027-07-12' });
    const otherHome = row({ id: 'c', property_id: 'another_partner' });
    const declined = row({ id: 'd', status: 'declined', decided_at: NOW.toISOString() });
    const m = openOverlaps([a, b, otherHome, declined], NOW);
    assert.deepEqual(m.get('a'), ['b']);
    assert.deepEqual(m.get('b'), ['a']);
    assert.equal(m.has('c'), false);
    assert.equal(m.has('d'), false);
  });
});

describe('the home feed line', () => {
  test('counts the open clocks and names the first due, in Eastern time', () => {
    const t = requestQueueText(['2026-11-13T20:40:00Z', '2026-11-13T15:00:00Z', '2026-11-12T10:00:00Z'], NOW);
    assert.equal(t, 'Booking requests: 2 waiting · first answer due Fri 10:00 AM');
    assert.equal(requestQueueText(['2026-11-13T15:00:00Z'], NOW), 'Booking requests: 1 waiting · answer due Fri 10:00 AM');
    assert.equal(requestQueueText([], NOW), null);
    assert.equal(requestQueueText(['2026-11-12T10:00:00Z'], NOW), null);
  });
});

describe('validation', () => {
  const good = {
    request_key: 'sca-123',
    property_id: 'partner_home',
    check_in: '2027-07-03',
    check_out: '2027-07-10',
    guests: 4,
    guest: { first_name: 'Jamie', last_name: 'Rivera', email: 'Jamie@Example.com ', phone: '978 555 0100' },
    message: 'We have a dog.\n\n\n\nIs that ok?',
    quoted_total_cents: 412500,
  };

  test('a good body comes back cleaned', () => {
    const v = validateRequestInput(good);
    assert.ok(v.ok);
    if (!v.ok) return;
    assert.equal(v.input.guest.email, 'jamie@example.com');
    assert.equal(v.input.message, 'We have a dog.\n\nIs that ok?');
    assert.equal(v.input.source, 'sca');
    assert.equal(v.input.quoted_total_cents, 412500);
  });

  test('refuses what it cannot use', () => {
    const bad: Array<[string, unknown]> = [
      ['no key', { ...good, request_key: '' }],
      ['no home', { ...good, property_id: ' ' }],
      ['bad date', { ...good, check_in: '2027-02-30' }],
      ['backwards', { ...good, check_out: '2027-07-03' }],
      ['no guests', { ...good, guests: 0 }],
      ['half a guest', { ...good, guests: 2.5 }],
      ['no name', { ...good, guest: { ...good.guest, first_name: '', last_name: '' } }],
      ['no email', { ...good, guest: { ...good.guest, email: 'jamie' } }],
      ['fractional cents', { ...good, quoted_total_cents: 12.5 }],
      ['not an object', 'hello'],
    ];
    for (const [why, body] of bad) assert.equal(validateRequestInput(body).ok, false, why);
  });

  test('the terms version is a short label, or absent', () => {
    const with_ = validateRequestInput({ ...good, terms_version: '2026-11-12' });
    assert.ok(with_.ok && with_.input.terms_version === '2026-11-12');
    const without = validateRequestInput(good);
    assert.ok(without.ok && without.input.terms_version === null);
    for (const bad of ['', '   ', 'a b', 'x'.repeat(41), '<script>', 7]) {
      assert.equal(validateRequestInput({ ...good, terms_version: bad }).ok, false, String(bad));
    }
  });

  test('the policy a guest agrees to is the home\'s, and a home without one takes no request', () => {
    assert.deepEqual(requestTerms({ cancellation_policy: '  Full refund up to 30 days before.  ', house_rules: ' No parties. ' }), {
      cancellation_terms: 'Full refund up to 30 days before.',
      house_rules: 'No parties.',
    });
    assert.deepEqual(requestTerms({ cancellation_policy: 'Non-refundable.', house_rules: '  ' }), { cancellation_terms: 'Non-refundable.', house_rules: null });
    assert.equal(requestTerms({ cancellation_policy: ' ', house_rules: 'No parties.' }), null);
    assert.equal(requestTerms(null), null, 'a policy that cannot be read takes no request');
  });

  test('a name or phone can carry no line breaks or hidden characters', () => {
    assert.equal(oneLine('Jamie\n\n!! already paid'), 'Jamie !! already paid');
    assert.equal(oneLine('a\u0085b'), 'a b');
    assert.equal(cleanMessage('line one\u0007\nline two'), 'line one \nline two');
  });

  test('nights between two days', () => {
    assert.equal(nightsOf('2027-07-03', '2027-07-10'), 7);
    assert.equal(nightsOf('2027-03-13', '2027-03-15'), 2);
  });
});

describe('what the guest reads', () => {
  const ctx = { title: 'Stay at Rocky Neck', siteOrigin: 'https://staycapeann.com/' };

  test('the receipt names the clock, the total, and that nothing was charged', () => {
    const e = receiptEmail(row(), ctx);
    assert.equal(e.subject, 'We have your request for Rocky Neck');
    assert.match(e.text, /Hi Jamie,/);
    assert.match(e.text, /July 3 to July 10, 2027 \(7 nights, 4 guests\)/);
    assert.match(e.text, /within 24 hours/);
    assert.match(e.text, /by Friday, November 13 at 10:00 AM Eastern/);
    assert.match(e.text, /Nothing has been charged\. The quoted total is \$4,125, cleaning and taxes included\./);
    assert.ok(e.html.includes('Rocky Neck'));
  });

  test('a decline and a closed request both say nothing was charged and point at other homes', () => {
    for (const e of [declinedEmail(row({ status: 'declined' }), ctx), expiredEmail(row({ status: 'expired' }), ctx)]) {
      assert.equal(e.subject, 'About your request for Rocky Neck');
      assert.match(e.text, /Nothing was charged\./);
      assert.ok(e.text.includes('https://staycapeann.com/stays?checkIn=2027-07-03&checkOut=2027-07-10&guests=4'));
      assert.ok(e.html.includes('href="https://staycapeann.com/stays?checkIn=2027-07-03&amp;checkOut=2027-07-10&amp;guests=4"'));
    }
  });

  test('the guest never reads the office reason, a host contact, or our systems', () => {
    const r = row({ status: 'declined', decline_reason: 'Host cousin visiting that week', message: 'hi' });
    for (const e of [receiptEmail(r, ctx), declinedEmail(r, ctx), expiredEmail(r, ctx)]) {
      const all = `${e.subject}\n${e.text}\n${e.html}`;
      assert.ok(!all.includes('cousin'), 'the decline reason stays in Helm');
      for (const word of ['Helm', 'Guesty', 'Stripe', 'partner_home']) assert.ok(!all.includes(word), word);
    }
  });

  test('a total says only what it covers', () => {
    assert.equal(totalCovers({ breakdown: { cleaning_cents: 1, tax_cents: 0 } }), ', cleaning included');
    assert.equal(totalCovers({ breakdown: { cleaning_cents: 0, tax_cents: 1 } }), ', taxes included');
    assert.equal(totalCovers({}), '');
    assert.equal(otherHomesUrl('https://staycapeann.com', { check_in: '2027-07-03', check_out: '2027-07-10', guests: 2 }), 'https://staycapeann.com/stays?checkIn=2027-07-03&checkOut=2027-07-10&guests=2');
  });

  test('what goes back to the site is the request, not the office notes', () => {
    const p = toPublicRequest(row({ decline_reason: 'secret', host_told_by: 'dotti@risingtidestr.com' }), hours(25));
    assert.equal(p.status, 'expired');
    assert.ok(!JSON.stringify(p).includes('secret'));
    assert.ok(!JSON.stringify(p).includes('risingtidestr'));
    assert.ok(!('guest_email' in p));
  });
});

describe('the guards across files', () => {
  const db = read('src/lib/booking-requests-db.ts')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');
  const create = db.slice(db.indexOf('export async function createBookingRequest('), db.indexOf('export type RequestHome'));

  test('a request is idempotent, for a partner home only, and priced by Helm before it is written', () => {
    const key = create.indexOf('findByKey(input.request_key)');
    const partner = create.indexOf("error: 'books_instantly'");
    const priced = create.indexOf("quoteForBridge(property.id, input.check_in, input.check_out, input.guests, 'sca'");
    const insert = create.indexOf('.insert(');
    assert.ok(key > 0 && partner > key && priced > partner && insert > priced, 'key, then the partner gate, then the price, then the insert');
    assert.ok(create.includes('quoted_total_cents: totalCents'), 'the stored total is the one Helm priced');
    assert.ok(create.includes("error: 'quote_drift'"), 'a price that moved is a question, never a different total');
  });

  test('the request keeps the policy the guest agreed to, read before the price and refused without one', () => {
    const partner = create.indexOf("error: 'books_instantly'");
    const terms = create.indexOf('requestTerms(await getHousePolicy(property.id))');
    const refused = create.indexOf("if (!terms) return { ok: false, error: 'invalid'");
    const priced = create.indexOf("quoteForBridge(property.id, input.check_in, input.check_out, input.guests, 'sca'");
    assert.ok(terms > partner && refused > terms && priced > refused, 'the gate, then the policy, then the price');
    const insert = create.slice(create.indexOf('.insert('));
    for (const col of ['cancellation_terms: terms.cancellation_terms', 'house_rules: terms.house_rules', 'terms_version: input.terms_version']) {
      assert.ok(insert.includes(col), col);
    }
    const migration = read('supabase/migrations/20261113030000_booking_request_terms.sql');
    for (const col of ['cancellation_terms text', 'house_rules text', 'terms_version text']) assert.ok(migration.includes(col), col);
  });

  test('every decision claims the row while it is pending and its clock is live', () => {
    const decide = db.slice(db.indexOf('async function decide('), db.indexOf('async function emailOutcome('));
    assert.ok(decide.includes(".eq('status', 'pending')"));
    assert.ok(decide.includes(".gt('respond_by', now.toISOString())"));
    const sweep = db.slice(db.indexOf('export async function sweepBookingRequests('));
    assert.ok(sweep.includes(".update({ status: 'expired', decided_at: nowIso, decided_by: 'cron' })"));
    assert.ok(/\.update\(\{ status: 'expired'[^}]*\}\)\s*\.eq\('id', id\)\s*\.eq\('status', 'pending'\)/.test(sweep), 'the sweep claims each row as pending');
  });

  test('only Accept writes accepted, and only over a held card, a live clock and an open calendar', () => {
    for (const f of ['src/app/guests/requests/actions.ts', 'src/app/api/pms/requests/route.ts', 'src/lib/partner-payments-db.ts']) {
      assert.ok(!/status:\s*'accepted'/.test(read(f)), `${f} writes accepted`);
    }
    assert.equal((db.match(/status:\s*'accepted'/g) ?? []).length, 1, 'one writer of accepted');
    const accept = db.slice(db.indexOf('export async function acceptBookingRequest('), db.indexOf('export async function markHostTold('));
    assert.ok(/status:\s*'accepted'/.test(accept), 'the writer is acceptBookingRequest');
    const hold = accept.indexOf("row.hold_status !== 'held'");
    const cal = accept.indexOf('rangeCheckForBridge(row.property_id');
    const claim = accept.indexOf(".update({ status: 'accepted'");
    assert.ok(hold > 0 && cal > hold && claim > cal, 'the hold, then the calendar, then the claim');
    const chain = accept.slice(claim);
    for (const g of [".eq('status', 'pending')", ".eq('hold_status', 'held')", ".gt('respond_by', now.toISOString())"]) assert.ok(chain.includes(g), g);
    assert.ok(accept.includes("'23P01'"), 'the exclusion constraint answers as a sentence');
    // A partner guest never becomes a Rising Tide booking, and no email goes before the charge.
    assert.ok(!/createBooking\(|from\('bookings'\)/.test(db), 'accepting writes no bookings row');
    assert.ok(!/sendRequest/.test(accept), 'the guest is emailed after the charge, not at the yes');
  });

  test('the owner verbs check the owner, and the page is gated', () => {
    const actions = read('src/app/guests/requests/actions.ts');
    assert.equal((actions.match(/await requireOwnerEmail\(\)/g) ?? []).length, 7);
    assert.ok(read('src/lib/helm-access.ts').includes("'/guests/requests',"));
  });

  test('the bridge route takes the header key, never a query string', () => {
    const route = read('src/app/api/pms/requests/route.ts');
    assert.ok(route.includes('authorizeStayConcierge(req)'));
    assert.ok(!route.includes('searchParams'));
  });

  test('the migration grants service_role, locks the clients out and allows the five statuses', () => {
    const sql = read('supabase/migrations/20261112230000_booking_requests.sql');
    assert.ok(sql.includes('alter table public.booking_requests enable row level security;'));
    assert.ok(sql.includes('grant select, insert, update, delete on public.booking_requests to service_role;'));
    assert.ok(sql.includes("check (status in ('pending', 'accepted', 'declined', 'expired', 'withdrawn'))"));
    assert.ok(sql.includes('create unique index if not exists booking_requests_key_idx'));
  });

  test('the sweep runs every hour', () => {
    const crons = (JSON.parse(read('vercel.json')).crons as Array<{ path: string; schedule: string }>);
    assert.deepEqual(crons.find((c) => c.path === '/api/cron/booking-requests'), { path: '/api/cron/booking-requests', schedule: '25 * * * *' });
  });
});
