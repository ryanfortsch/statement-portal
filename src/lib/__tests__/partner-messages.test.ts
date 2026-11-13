/**
 * Messages about a partner home's booking request (src/lib/partner-messages.ts,
 * partner-messages-db.ts, the routes under src/app/api/pms/host/messages/[id]
 * and src/app/api/pms/trips/messages/[id], the office's box on /guests/requests).
 *
 * These hold:
 *   - before the stay is booked, an email, phone number or link in a guest's
 *     or host's words is hidden before it is stored, and in the guest's
 *     request note as the host reads it, while dates, prices and codes are
 *     left alone; after booking nothing is hidden;
 *   - a conversation takes messages while the request waits and, once
 *     booked, until 14 days after checkout; a closed request takes none;
 *   - each reader sees who wrote what, what they have not opened, and the
 *     other side is emailed a link, with the note that a reply to the email
 *     reaches the office;
 *   - every read and write checks the request is the caller's first, the
 *     bridge key and the session header guard both routes, the office's
 *     verb is owners only, and a partner guest never reaches guest_threads;
 *   - the migration's grants.
 *
 * Run: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  HIDDEN,
  MESSAGE_DAYS_AFTER,
  MESSAGE_MAX,
  bodyToStore,
  canMessage,
  cleanMessageBody,
  closedLine,
  hostLabel,
  hostThreadUrl,
  isDuplicate,
  maskContact,
  newMessageEmail,
  owedTo,
  recipientsOf,
  threadCounts,
  threadView,
  tripThreadUrl,
  type PartnerMessageRow,
} from '../partner-messages.ts';
import { hostNewRequestEmail, hostRequestView } from '../partner-host.ts';
import { respondByFor, type BookingRequestRow } from '../booking-requests.ts';

const root = new URL('../../../', import.meta.url);
const read = (p: string): string => readFileSync(new URL(p, root), 'utf8');
const code = (p: string): string =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

const NOW = new Date('2026-11-13T15:00:00Z');
const TODAY = '2026-11-13';
const hours = (h: number) => new Date(NOW.getTime() + h * 3600_000);
const ID = '7f0c2d4e-1a2b-4c3d-8e9f-0a1b2c3d4e5f';

function row(over: Partial<BookingRequestRow> = {}): BookingRequestRow {
  return {
    id: ID,
    request_key: 'k1',
    source: 'sca',
    property_id: 'partner_home',
    check_in: '2026-12-04',
    check_out: '2026-12-07',
    guests: 4,
    guest_first_name: 'Jamie',
    guest_last_name: 'Rivera',
    guest_email: 'jamie@example.com',
    guest_phone: '+1 555 0100',
    message: 'Celebrating a birthday. Text me at 978-555-0142.',
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
    decline_reason: null,
    receipt_emailed_at: null,
    outcome_emailed_at: null,
    stripe_account_id: null,
    payment_intent_id: null,
    hold_cents: 400_000,
    fee_cents: 26_250,
    hold_status: 'held',
    hold_placed_at: NOW.toISOString(),
    captured_at: null,
    released_at: null,
    charge_id: null,
    hold_error: null,
    confirmation_emailed_at: null,
    cancellation_terms: null,
    house_rules: null,
    terms_version: null,
    created_at: hours(-2).toISOString(),
    updated_at: NOW.toISOString(),
    ...over,
  };
}

function msg(over: Partial<PartnerMessageRow> = {}): PartnerMessageRow {
  return {
    id: 'm1',
    request_id: ID,
    author: 'guest',
    author_email: 'jamie@example.com',
    body: 'Is there a crib?',
    masked: false,
    created_at: hours(-1).toISOString(),
    guest_read_at: hours(-1).toISOString(),
    host_read_at: null,
    guest_emailed_at: null,
    host_emailed_at: null,
    ...over,
  };
}

const NAMES = { guest: 'Jamie R.', host: 'Sam' };

describe('contact stays on the site until the stay is booked', () => {
  const hidden = [
    'Email me at jamie.rivera+cape@gmail.com',
    'jamie (at) gmail (dot) com',
    'Call 978-555-0142',
    'Call (978) 555-0142',
    'Call +1 978 555 0142',
    'Call 9785550142',
    'Call 555-0142',
    'Book direct at https://example-rentals.com/harbor',
    'See www.harborhouse.net',
    'airbnb.com/rooms/12345',
  ];
  for (const s of hidden) {
    test(`hidden: ${s}`, () => {
      const m = maskContact(s);
      assert.ok(m.masked, s);
      assert.ok(m.body.includes(HIDDEN), m.body);
      assert.doesNotMatch(m.body, /0142|gmail|example-rentals|harborhouse|airbnb/i);
    });
  }

  const kept = [
    'Arriving 2026-12-04 around 4',
    'Arriving 12/04, leaving 12/07',
    'The door code is 4821',
    'Total was $4,125.00 for 3 nights',
    'We are coming from 01930',
    'Check-in at 3:00, 4 guests and a dog',
    'Is the beach 0.5 miles away?',
  ];
  for (const s of kept) {
    test(`left alone: ${s}`, () => {
      assert.deepEqual(maskContact(s), { body: s, masked: false });
    });
  }

  test('the sentence around a hidden number survives', () => {
    assert.equal(maskContact('Call 978 555 0142 tonight.').body, `Call ${HIDDEN} tonight.`);
  });

  test('only the two sides are held to it, and only before booking', () => {
    const words = 'Reach me at 978-555-0142';
    assert.ok(bodyToStore(words, false, 'guest').masked);
    assert.ok(bodyToStore(words, false, 'host').masked);
    assert.deepEqual(bodyToStore(words, true, 'guest'), { body: words, masked: false }, 'booked: both have each other');
    assert.deepEqual(bodyToStore(words, false, 'office'), { body: words, masked: false }, 'the office writes as itself');
  });

  test("the host reads the guest's request note hidden too, and whole once booked", () => {
    const open = hostRequestView(row(), 'Stay at the Harbor House', NOW);
    assert.ok(open.message?.includes(HIDDEN));
    assert.doesNotMatch(open.message ?? '', /0142/);
    const booked = hostRequestView(row({ status: 'accepted', decided_at: NOW.toISOString() }), 'Stay at the Harbor House', NOW);
    assert.match(booked.message ?? '', /978-555-0142/);
    const email = hostNewRequestEmail(row(), 'Stay at the Harbor House', 'https://staycapeann.com');
    assert.doesNotMatch(email.text + email.html, /0142/);
  });

  test('a message is cleaned and capped', () => {
    assert.equal(cleanMessageBody('  \n\n '), null);
    assert.equal(cleanMessageBody(7), null);
    assert.equal(cleanMessageBody('Hi\r\n\r\n\r\n\r\nthere\u0007'), 'Hi\n\nthere');
    assert.equal(cleanMessageBody('x'.repeat(MESSAGE_MAX + 50))?.length, MESSAGE_MAX);
  });
});

describe('when a conversation takes messages', () => {
  test('while the request waits for an answer', () => {
    assert.ok(canMessage(row(), TODAY, NOW));
    assert.ok(!canMessage(row({ respond_by: hours(-1).toISOString() }), TODAY, NOW), 'a passed clock is closed');
  });

  test('never on a declined, expired or withdrawn request', () => {
    for (const status of ['declined', 'expired', 'withdrawn'] as const) {
      assert.ok(!canMessage(row({ status }), TODAY, NOW), status);
      assert.match(closedLine(row({ status }), NOW), /request is closed/);
    }
  });

  test(`once booked, until ${MESSAGE_DAYS_AFTER} days after checkout`, () => {
    const booked = row({ status: 'accepted', check_out: '2026-12-07' });
    assert.ok(canMessage(booked, '2026-12-21', NOW));
    assert.ok(!canMessage(booked, '2026-12-22', NOW));
    assert.match(closedLine(booked, NOW), /stay is over/);
  });
});

describe('what each reader sees', () => {
  const rows = [
    msg(),
    msg({ id: 'm2', author: 'host', author_email: 'sam@example.com', body: 'Yes, a pack and play.', created_at: hours(-0.5).toISOString(), guest_read_at: null, host_read_at: hours(-0.5).toISOString() }),
    msg({ id: 'm3', author: 'office', author_email: 'dotti@example.com', body: 'We can bring a high chair.', created_at: hours(-0.2).toISOString(), guest_read_at: null, host_read_at: null }),
  ];

  test("the guest's note opens it, then every message oldest first", () => {
    const g = threadView(row(), rows.slice().reverse(), 'guest', NAMES, NOW);
    assert.deepEqual(
      g.map((m) => [m.label, m.mine]),
      [
        ['You', true],
        ['You', true],
        ['Sam', false],
        ['Stay Cape Ann', false],
      ],
    );
    assert.deepEqual(
      g.map((m) => m.unread),
      [false, false, true, true],
    );
    assert.match(g[0].body, /978-555-0142/, 'the guest reads their own note whole');
  });

  test('the host sees the guest as first name and initial, and their own as You', () => {
    const h = threadView(row(), rows, 'host', NAMES, NOW);
    assert.deepEqual(
      h.map((m) => m.label),
      ['Jamie R.', 'Jamie R.', 'You', 'Stay Cape Ann'],
    );
    assert.ok(h[0].masked && !h[0].body.includes('0142'), "the note's number is hidden from the host");
    assert.deepEqual(
      h.map((m) => m.unread),
      [false, true, false, true],
    );
  });

  test('the office sees every side and nothing as unread', () => {
    const o = threadView(row(), rows, 'office', { guest: 'Jamie Rivera', host: 'Sam' }, NOW);
    assert.deepEqual(
      o.map((m) => m.label),
      ['Jamie Rivera', 'Jamie Rivera', 'Host', 'You'],
    );
    assert.ok(o.every((m) => !m.unread));
  });

  test('the counts on a list row', () => {
    assert.deepEqual(threadCounts(rows, 'guest').get(ID), { messages: 3, unread: 2 });
    assert.deepEqual(threadCounts(rows, 'host').get(ID), { messages: 3, unread: 2 });
  });

  test("the host's name for the guest is a first name, else the role", () => {
    assert.equal(hostLabel('Sam Morgan'), 'Sam');
    assert.equal(hostLabel('Sam and Pat Morgan'), 'Your host');
    assert.equal(hostLabel('Morgan Family Trust'), 'Your host');
    assert.equal(hostLabel(null), 'Your host');
  });
});

describe('telling the other side', () => {
  test('a guest writes to the host, a host to the guest, the office to both', () => {
    assert.deepEqual(recipientsOf('guest'), ['host']);
    assert.deepEqual(recipientsOf('host'), ['guest']);
    assert.deepEqual(recipientsOf('office'), ['guest', 'host']);
  });

  test('only what is not theirs, not opened and not emailed is owed', () => {
    const rows = [
      msg({ id: 'a', author: 'host', guest_read_at: null }),
      msg({ id: 'b', author: 'host', guest_read_at: hours(-0.1).toISOString() }),
      msg({ id: 'c', author: 'host', guest_read_at: null, guest_emailed_at: hours(-0.1).toISOString() }),
      msg({ id: 'd', author: 'guest' }),
      msg({ id: 'e', author: 'office', guest_read_at: null }),
    ];
    assert.deepEqual(
      owedTo(rows, 'guest').map((m) => m.id),
      ['a', 'e'],
    );
    assert.deepEqual(
      owedTo(rows, 'host').map((m) => m.id),
      ['d', 'e'],
    );
  });

  test('a double tap is one message', () => {
    const recent = [msg({ created_at: hours(-0.01).toISOString() })];
    assert.ok(isDuplicate(recent, 'guest', 'Is there a crib?', NOW));
    assert.ok(!isDuplicate(recent, 'host', 'Is there a crib?', NOW));
    assert.ok(!isDuplicate([msg({ created_at: hours(-1).toISOString() })], 'guest', 'Is there a crib?', NOW));
  });

  test('the email carries the words, the link, and where a reply goes', () => {
    const toHost = newMessageEmail({
      to: 'host',
      homeTitle: 'Stay at the Harbor House',
      messages: [{ label: 'Jamie R.', body: 'Is there a <b>crib</b>?' }],
      link: hostThreadUrl('https://staycapeann.com/', ID),
      other: 'Jamie R.',
    });
    assert.equal(toHost.subject, 'Jamie R. wrote about The Harbor House');
    assert.match(toHost.text, new RegExp(`https://staycapeann.com/host/requests/${ID}`));
    assert.match(toHost.text, /Replies to this email reach the Stay Cape Ann office, not Jamie R\./);
    assert.ok(toHost.html.includes('&lt;b&gt;crib&lt;/b&gt;') && !toHost.html.includes('<b>crib'), 'the words are escaped');

    const toGuest = newMessageEmail({
      to: 'guest',
      homeTitle: 'Stay at the Harbor House',
      messages: [{ label: 'Sam', body: 'Yes.' }],
      link: tripThreadUrl('https://staycapeann.com', ID),
      other: 'Sam',
    });
    assert.equal(toGuest.subject, 'A message about your trip to The Harbor House');
    assert.match(toGuest.text, new RegExp(`https://staycapeann.com/trips/${ID}`));
    assert.doesNotMatch(toGuest.text + toGuest.html, /—/, 'no em dashes');
  });
});

describe('guards in the source', () => {
  const db = code('src/lib/partner-messages-db.ts');

  test('every read and write checks the request is the caller’s before anything else', () => {
    for (const fn of ['hostThread', 'hostPost']) {
      const body = db.slice(db.indexOf(`export async function ${fn}`));
      const check = body.indexOf('session.homes');
      assert.ok(check > 0 && check < body.indexOf('homeOf('), `${fn} checks the home first`);
    }
    for (const fn of ['guestThread', 'guestPost']) {
      const body = db.slice(db.indexOf(`export async function ${fn}`));
      const check = body.indexOf('!== session.email');
      assert.ok(check > 0 && check < body.indexOf('homeOf('), `${fn} checks the email first`);
    }
  });

  test('a write is checked open and hidden before it is stored', () => {
    const post = db.slice(db.indexOf('async function post('), db.indexOf('export async function hostPost'));
    const insert = post.indexOf('.insert(');
    assert.ok(post.indexOf('canMessage(') > 0 && post.indexOf('canMessage(') < insert);
    assert.ok(post.indexOf('bodyToStore(') > 0 && post.indexOf('bodyToStore(') < insert);
    assert.match(post, /body: stored\.body/);
  });

  test('a partner guest never reaches the Messaging inbox or the concierge', () => {
    assert.doesNotMatch(db, /guest_threads|guest_messages|stay-concierge|quo/i);
  });

  test('both routes take the bridge key first and the session from its header', () => {
    for (const [p, header] of [
      ['src/app/api/pms/host/messages/[id]/route.ts', 'HOST_SESSION_HEADER'],
      ['src/app/api/pms/trips/messages/[id]/route.ts', 'TRIP_SESSION_HEADER'],
    ] as const) {
      const src = code(p);
      for (const verb of ['GET', 'POST']) {
        const body = src.slice(src.indexOf(`export async function ${verb}`));
        assert.ok(body.indexOf('authorizeStayConcierge(req)') > 0 && body.indexOf('authorizeStayConcierge(req)') < body.indexOf('ForSession('), `${p} ${verb}`);
      }
      assert.match(src, new RegExp(`req\\.headers\\.get\\(${header}\\)`));
      assert.doesNotMatch(src, /searchParams/, 'the id rides in the path, the session in its header');
    }
  });

  test("the office's verb is owners only, and the hourly sweep retries the emails", () => {
    const actions = code('src/app/guests/requests/actions.ts');
    const fn = actions.slice(actions.indexOf('export async function postOfficeMessageAction'));
    assert.ok(fn.indexOf('requireOwnerEmail()') > 0 && fn.indexOf('requireOwnerEmail()') < fn.indexOf('officePost('));
    assert.match(code('src/app/api/cron/booking-requests/route.ts'), /retryMessageEmails\(\)/);
  });

  test('the migration keeps the table to the service role', () => {
    const sql = read('supabase/migrations/20261113233000_partner_messages.sql');
    assert.match(sql, /alter table public\.partner_messages enable row level security/);
    assert.match(sql, /grant select, insert, update, delete on public\.partner_messages to service_role/);
    assert.match(sql, /revoke all on public\.partner_messages from anon, authenticated/);
    assert.match(sql, /references public\.booking_requests\(id\) on delete cascade/);
  });
});
