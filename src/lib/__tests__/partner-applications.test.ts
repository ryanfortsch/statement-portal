/**
 * A host applies to list their home on staycapeann.com/host/apply, and an
 * owner adds the home or declines it on /guests/requests
 * (src/lib/partner-applications.ts, partner-applications-db.ts, the route
 * src/app/api/pms/apply/, the Applications section and its actions).
 *
 * These hold:
 *   - the form is checked into the host's own sentences, and what a host
 *     reads names Stay Cape Ann, never Rising Tide;
 *   - who runs the home is asked every time and kept, because a home a
 *     management company runs is never offered our full management;
 *   - applying twice is the same application, and the answer never says
 *     whether someone applied before;
 *   - Add makes the home through the one writer Add a partner home uses,
 *     claims the application before it does, and hands it back on failure;
 *   - nothing here sends, lists, books or charges;
 *   - owners only on the Helm side; the bridge key on the route, no query
 *     string, no session.
 *
 * Run: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  APPLICATION_RECEIVED,
  LISTED_ON,
  RUN_BY,
  applicationQueueCard,
  homeFromApplication,
  listedOnLine,
  parseDeclineReason,
  parsePartnerApplication,
} from '../partner-applications.ts';

const root = new URL('../../../', import.meta.url);
const read = (p: string): string => readFileSync(new URL(p, root), 'utf8');
const code = (p: string): string =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

const LIB = 'src/lib/partner-applications.ts';
const DB = 'src/lib/partner-applications-db.ts';
const ROUTE = 'src/app/api/pms/apply/route.ts';
const MIGRATION = 'supabase/migrations/20261114040000_partner_applications.sql';
const ACTIONS = 'src/app/guests/requests/actions.ts';
const CONTROLS = 'src/app/guests/requests/ApplicationActions.tsx';
const PAGE = 'src/app/guests/requests/page.tsx';
const FEED = 'src/components/ForMeFeed.tsx';

const FORM = {
  name: '  Pat  Host ',
  email: 'Pat@Example.com',
  phone: '978 555 0100',
  address: '12 Main Street, Rockport MA',
  city: 'Rockport',
  bedrooms: '3',
  listed_on: ['vrbo', 'airbnb'],
  run_by: 'self',
  note: 'Booked most of the summer.',
};

describe('the form', () => {
  test('a good form, tidied', () => {
    const r = parsePartnerApplication(FORM);
    assert.ok(r.ok);
    assert.deepEqual(r.value, {
      name: 'Pat Host',
      email: 'pat@example.com',
      phone: '978 555 0100',
      address: '12 Main Street',
      city: 'Rockport',
      bedrooms: 3,
      listed_on: ['airbnb', 'vrbo'],
      run_by: 'self',
      note: 'Booked most of the summer.',
    });
  });

  test('the optional parts can be left out', () => {
    const r = parsePartnerApplication({ ...FORM, phone: '', bedrooms: '', listed_on: undefined, note: '' });
    assert.ok(r.ok);
    assert.equal(r.value.phone, null);
    assert.equal(r.value.bedrooms, null);
    assert.deepEqual(r.value.listed_on, []);
    assert.equal(r.value.note, null);
  });

  test('every refusal is a sentence the host reads', () => {
    const no = (over: Record<string, unknown>) => {
      const r = parsePartnerApplication({ ...FORM, ...over });
      assert.ok(!r.ok);
      return r.reason;
    };
    assert.equal(no({ name: ' ' }), 'Add your name.');
    assert.equal(no({ email: 'pat' }), 'Add the email we should write to.');
    assert.equal(no({ phone: 'call me' }), 'That phone number does not look right.');
    assert.equal(no({ address: 'Main Street' }), 'The street address starts with the house number, like 12 Main Street.');
    assert.equal(no({ city: '' }), 'Add the town.');
    assert.equal(no({ bedrooms: 'lots' }), 'Bedrooms is a number, like 3.');
    assert.equal(no({ bedrooms: '40' }), 'Bedrooms is a number, like 3.');
    assert.equal(no({ note: 'x'.repeat(1001) }), 'Keep the note under 1000 characters.');
    assert.equal(parsePartnerApplication(null).ok, false);
  });

  test('who runs the home is asked every time: the owner, or a management company', () => {
    assert.deepEqual(Object.keys(RUN_BY), ['self', 'manager']);
    for (const run_by of [undefined, '', 'both', 'us']) {
      const r = parsePartnerApplication({ ...FORM, run_by });
      assert.ok(!r.ok);
      assert.equal(r.reason, 'Say who runs the home day to day.');
    }
    const m = parsePartnerApplication({ ...FORM, run_by: 'manager' });
    assert.ok(m.ok);
    assert.equal(m.value.run_by, 'manager');
  });

  test('only the channels we name are kept, and "not listed yet" gives way to a channel', () => {
    const r = parsePartnerApplication({ ...FORM, listed_on: ['booking', 'myspace', 'not_yet', 'booking'] });
    assert.ok(r.ok);
    assert.deepEqual(r.value.listed_on, ['booking']);
    const n = parsePartnerApplication({ ...FORM, listed_on: ['not_yet'] });
    assert.ok(n.ok);
    assert.deepEqual(n.value.listed_on, ['not_yet']);
  });

  test('the menu of channels matches the database, in the same order', () => {
    const m = read(MIGRATION).match(/listed_on <@ array\[([^\]]*)\]/);
    assert.ok(m);
    assert.deepEqual(
      m[1].split(',').map((s) => s.trim().replace(/'/g, '')),
      LISTED_ON.map((o) => o.key),
    );
    assert.match(read(MIGRATION), /run_by text not null check \(run_by in \('self', 'manager'\)\)/);
  });

  test('what a host reads names Stay Cape Ann, never Rising Tide', () => {
    assert.doesNotMatch(code(LIB), /rising tide/i);
    assert.doesNotMatch(code(ROUTE), /rising tide/i);
    assert.equal(APPLICATION_RECEIVED, 'Thank you. We read every application and will write back by email.');
  });
});

describe('the office', () => {
  test('an application is the home Add a partner home makes, checked by the same rules', () => {
    const r = homeFromApplication({ name: 'Pat Host', email: 'pat@example.com', phone: null, address: '12 Main Street', city: 'Rockport' });
    assert.deepEqual(r, { ok: true, home: { address: '12 Main Street', city: 'Rockport', host_name: 'Pat Host', host_email: 'pat@example.com', host_phone: null } });
  });

  test('where it is listed reads as a line', () => {
    assert.equal(listedOnLine(['airbnb', 'own_site']), 'Airbnb, Its own website');
    assert.equal(listedOnLine([]), 'Did not say where it is listed');
  });

  test('a decline reason is optional and bounded', () => {
    assert.deepEqual(parseDeclineReason(''), { ok: true, value: null });
    assert.deepEqual(parseDeclineReason('  Not on Cape Ann '), { ok: true, value: 'Not on Cape Ann' });
    assert.equal(parseDeclineReason('x'.repeat(501)).ok, false);
  });

  test('the owners\' feed line names the town and nothing else about the host', () => {
    assert.equal(applicationQueueCard([]), null);
    assert.deepEqual(applicationQueueCard([{ city: 'Rockport' }]), { href: '/guests/requests#applications', text: 'A host applied to list a home in Rockport' });
    assert.deepEqual(applicationQueueCard([{ city: 'Rockport' }, { city: 'Essex' }]), { href: '/guests/requests#applications', text: '2 hosts applied to list a home' });
  });
});

describe('guards spread across files', () => {
  test('the route checks the bridge key first, takes no session and no query string', () => {
    const src = code(ROUTE);
    const body = src.slice(src.indexOf('export async function POST'));
    const key = body.indexOf('authorizeStayConcierge(req)');
    const submit = body.indexOf('submitPartnerApplication(');
    assert.ok(key > -1 && key < submit);
    assert.doesNotMatch(src, /searchParams|nextUrl|HOST_SESSION_HEADER|export async function GET/);
  });

  test('applying twice is the same application, and the answer never says which', () => {
    const src = code(DB);
    const body = src.slice(src.indexOf('export async function submitPartnerApplication'), src.indexOf('export async function newApplications'));
    assert.match(body, /error && error\.code !== UNIQUE_VIOLATION/);
    assert.match(body, /return \{ ok: true, message: APPLICATION_RECEIVED \}/);
    assert.match(read(MIGRATION), /unique index[\s\S]*\(lower\(email\), lower\(address\)\)[\s\S]*where status = 'new'/);
  });

  test('Add claims the application before it makes the home, through the one writer, and hands it back on failure', () => {
    const src = code(DB);
    const body = src.slice(src.indexOf('export async function addFromApplication'), src.indexOf('export async function declineApplication'));
    const claim = body.indexOf(".update({ status: 'added'");
    const make = body.indexOf('createPartnerHome(home.home, by)');
    const handBack = body.indexOf(".update({ status: 'new'");
    assert.ok(claim > -1 && claim < make && make < handBack, 'claim, make, hand back');
    assert.match(body.slice(claim, make), /\.eq\('status', 'new'\)/);
    assert.doesNotMatch(src, /from\('properties'\)\.insert/, 'the home is made by createPartnerHome only');
  });

  test('nothing here sends, lists, books or charges', () => {
    for (const f of [DB, ROUTE, LIB]) {
      const src = code(f);
      assert.doesNotMatch(src, /sendFromHello|sendEmail|resend|sendMessage|stripe|listPartnerHome|from\('(bookings|booking_requests|partner_listings)'\)/i, f);
    }
  });

  test('owners only on the Helm side', () => {
    const actions = code(ACTIONS);
    for (const fn of ['addApplicationAction', 'declineApplicationAction']) {
      const body = actions.slice(actions.indexOf(`export async function ${fn}`));
      const owner = body.indexOf('await requireOwnerEmail()');
      const write = body.search(/await (addFromApplication|declineApplication)\(/);
      assert.ok(owner > -1 && owner < write, fn);
    }
    assert.match(code(FEED), /owner \? loadApplicationQueue\(\) : null/);
    assert.match(code(PAGE), /<Applications rows=\{applications\} \/>/);
    assert.match(read('src/lib/helm-access.ts'), /'\/guests\/requests'/, '/guests/requests sits behind the owner gate');
  });

  test('the table is service role only', () => {
    const m = read(MIGRATION);
    assert.match(m, /enable row level security/);
    assert.match(m, /grant select, insert, update, delete on public\.partner_applications to service_role/);
    assert.match(m, /revoke all on public\.partner_applications from anon, authenticated/);
  });

  test('no em dashes in what this adds', () => {
    const dash = String.fromCharCode(0x2014);
    for (const f of [LIB, DB, ROUTE, MIGRATION, CONTROLS]) assert.ok(!read(f).includes(dash), f);
  });
});
