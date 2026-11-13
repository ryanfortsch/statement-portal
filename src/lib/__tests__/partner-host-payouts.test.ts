/**
 * A partner home's host sees their money on staycapeann.com/host/payouts
 * (src/lib/partner-host-payouts.ts, hostPayouts and hostSetupLink in
 * partner-host-db.ts, the routes under src/app/api/pms/host/payouts/).
 *
 * These hold:
 *   - each home's Stripe standing reads in the host's words, and the page
 *     offers to start or finish with Stripe only while there is something to do;
 *   - only a booked stay is listed; what reaches the host is the charge less
 *     our fee, and a stay settled by hand claims no money it does not know;
 *   - the year's total counts only what Stripe charged, by the Eastern year;
 *   - the guards spread across files: the bridge key and the session header on
 *     both routes, never a query string; a setup link only for the host's own
 *     home, through the office's writer, recorded as the host; nothing here
 *     writes a stay or says a payout happened.
 *
 * Run: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  HOST_PAYOUT_STAYS,
  STRIPE_DASHBOARD_URL,
  easternYear,
  hostPayoutHome,
  hostPayoutStay,
  hostPayoutsView,
  hostStripeLine,
  hostStripeState,
  payoutYears,
  sortPayoutStays,
  type HostPayoutStay,
} from '../partner-host-payouts.ts';
import { respondByFor, type BookingRequestRow } from '../booking-requests.ts';
import type { PartnerPaymentAccount } from '../partner-payments.ts';

const root = new URL('../../../', import.meta.url);
const read = (p: string): string => readFileSync(new URL(p, root), 'utf8');
const code = (p: string): string =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

const NOW = new Date('2026-11-13T15:00:00Z');

function account(over: Partial<PartnerPaymentAccount> = {}): PartnerPaymentAccount {
  return {
    property_id: 'partner_home',
    stripe_account_id: 'acct_123456',
    fee_pct: 10,
    charges_enabled: true,
    payouts_enabled: true,
    details_submitted: true,
    requirements_due: 0,
    status_checked_at: NOW.toISOString(),
    setup_token_expires_at: null,
    setup_token_created_by: null,
    created_at: NOW.toISOString(),
    updated_at: NOW.toISOString(),
    ...over,
  };
}

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
    message: null,
    quoted_total_cents: 412_500,
    currency: 'USD',
    quote: {},
    status: 'accepted',
    respond_by: respondByFor(NOW),
    host_told_at: null,
    host_told_by: null,
    host_emailed_at: null,
    decided_at: NOW.toISOString(),
    decided_by: 'host:sam@example.com',
    decline_reason: null,
    receipt_emailed_at: null,
    outcome_emailed_at: null,
    stripe_account_id: 'acct_123456',
    payment_intent_id: 'pi_123456',
    hold_cents: 412_500,
    fee_cents: 37_500,
    hold_status: 'captured',
    hold_placed_at: NOW.toISOString(),
    captured_at: '2026-11-14T17:05:00Z',
    released_at: null,
    charge_id: 'ch_123456',
    hold_error: null,
    confirmation_emailed_at: NOW.toISOString(),
    cancellation_terms: 'Full refund up to 30 days before arrival.',
    house_rules: 'No parties.',
    terms_version: '2026-11-12',
    created_at: NOW.toISOString(),
    updated_at: NOW.toISOString(),
    ...over,
  };
}

describe('the Stripe standing, in the host\'s words', () => {
  test('each account reads as one state', () => {
    assert.equal(hostStripeState(null), 'not_set_up');
    assert.equal(hostStripeState(account({ stripe_account_id: null })), 'not_set_up');
    assert.equal(hostStripeState(account({ charges_enabled: false, payouts_enabled: false, details_submitted: false, requirements_due: 4 })), 'started');
    assert.equal(hostStripeState(account({ charges_enabled: false, payouts_enabled: false, details_submitted: true, requirements_due: 0 })), 'reviewing');
    assert.equal(hostStripeState(account({ charges_enabled: false, payouts_enabled: false, details_submitted: true, requirements_due: 2 })), 'started');
    assert.equal(hostStripeState(account({ payouts_enabled: false })), 'needs_bank');
    assert.equal(hostStripeState(account()), 'ready');
  });

  test('the lines say what is next and never claim a payout', () => {
    const all = [
      hostStripeLine('not_set_up', null),
      hostStripeLine('started', account({ requirements_due: 3 })),
      hostStripeLine('started', account({ requirements_due: 1 })),
      hostStripeLine('started', account({ requirements_due: 0 })),
      hostStripeLine('reviewing', account()),
      hostStripeLine('needs_bank', account()),
      hostStripeLine('ready', account()),
    ];
    assert.match(all[1], /3 more things/);
    assert.match(all[2], /1 more thing from you/);
    assert.match(all[5], /Add your bank in Stripe/);
    for (const line of all) {
      assert.doesNotMatch(line, /—/);
      assert.doesNotMatch(line, /paid out on|we paid|was paid/i);
    }
  });

  test('the page offers Stripe setup only while there is something to do', () => {
    const home = { id: 'partner_home', title: 'Stay at the Point' };
    assert.equal(hostPayoutHome(home, null).can_set_up, true);
    assert.equal(hostPayoutHome(home, null).has_dashboard, false);
    assert.equal(hostPayoutHome(home, account({ charges_enabled: false, payouts_enabled: false, details_submitted: false, requirements_due: 4 })).can_set_up, true);
    assert.equal(hostPayoutHome(home, account({ charges_enabled: false, payouts_enabled: false, details_submitted: true })).can_set_up, false, 'Stripe is reviewing: nothing for the host to do');
    assert.equal(hostPayoutHome(home, account({ payouts_enabled: false })).can_set_up, false, 'the bank goes in their own dashboard');
    assert.equal(hostPayoutHome(home, account({ payouts_enabled: false })).has_dashboard, true);
    assert.equal(hostPayoutHome(home, account()).can_set_up, false);
  });

  test('the fee line names our fee and leaves the tax out of it', () => {
    const home = { id: 'partner_home', title: 'Stay at the Point' };
    assert.equal(hostPayoutHome(home, account({ fee_pct: 10 })).fee_line, 'Our fee is 10% of each stay, not counting occupancy tax.');
    assert.equal(hostPayoutHome(home, account({ fee_pct: 8.5 })).fee_line, 'Our fee is 8.5% of each stay, not counting occupancy tax.');
    assert.equal(hostPayoutHome(home, account({ fee_pct: null })).fee_line, null);
    assert.equal(hostPayoutHome({ id: 'x', title: null }, null).title, 'Your home');
  });

  test('the dashboard is Stripe\'s own, over https', () => {
    assert.match(STRIPE_DASHBOARD_URL, /^https:\/\/dashboard\.stripe\.com\//);
  });
});

describe('booked stays and their money', () => {
  test('only a booked stay is listed', () => {
    assert.equal(hostPayoutStay(row({ status: 'pending', hold_status: 'held', captured_at: null }), 'Home', NOW), null);
    assert.equal(hostPayoutStay(row({ status: 'declined', hold_status: 'released' }), 'Home', NOW), null);
    assert.equal(hostPayoutStay(row({ status: 'withdrawn', hold_status: 'released' }), 'Home', NOW), null);
    assert.ok(hostPayoutStay(row(), 'Home', NOW));
  });

  test('a charged stay: the charge less our fee, with the day it was charged', () => {
    const s = hostPayoutStay(row(), 'Stay at the Point', NOW)!;
    assert.equal(s.state, 'charged');
    assert.equal(s.total_cents, 412_500);
    assert.equal(s.fee_cents, 37_500);
    assert.equal(s.payout_cents, 375_000);
    assert.equal(s.state_line, 'Charged November 14');
    assert.equal(s.guest_name, 'Jamie Rivera', 'the stay is booked: the whole name');
    assert.equal(s.nights, 7);
    assert.equal(s.charged_at, '2026-11-14T17:05:00Z');
  });

  test('a card still being charged, or one that failed', () => {
    const charging = hostPayoutStay(row({ hold_status: 'held', captured_at: null }), 'Home', NOW)!;
    assert.equal(charging.state, 'charging');
    assert.equal(charging.payout_cents, 375_000);
    assert.equal(charging.charged_at, null);
    const failed = hostPayoutStay(row({ hold_status: 'failed', captured_at: null }), 'Home', NOW)!;
    assert.equal(failed.state, 'failed');
    assert.equal(failed.charged_at, null);
  });

  test('a stay the office settled by hand claims no fee or payout', () => {
    const s = hostPayoutStay(row({ hold_status: 'none', hold_cents: null, fee_cents: null, captured_at: null, payment_intent_id: null }), 'Home', NOW)!;
    assert.equal(s.state, 'arranged');
    assert.equal(s.total_cents, 412_500, 'the quoted total');
    assert.equal(s.fee_cents, null);
    assert.equal(s.payout_cents, null);
    assert.equal(s.state_line, 'Settled with Stay Cape Ann');
  });

  test('upcoming, staying and past, by the Eastern day', () => {
    assert.equal(hostPayoutStay(row({ check_in: '2026-11-20', check_out: '2026-11-23' }), 'Home', NOW)!.when, 'upcoming');
    assert.equal(hostPayoutStay(row({ check_in: '2026-11-12', check_out: '2026-11-15' }), 'Home', NOW)!.when, 'staying');
    assert.equal(hostPayoutStay(row({ check_in: '2026-11-10', check_out: '2026-11-13' }), 'Home', NOW)!.when, 'past', 'checkout day is past');
  });

  test('stays ahead first, soonest first; then past ones, latest first', () => {
    const mk = (id: string, check_in: string, check_out: string) => hostPayoutStay(row({ id, check_in, check_out }), 'Home', NOW)!;
    const sorted = sortPayoutStays([mk('a', '2026-10-01', '2026-10-04'), mk('b', '2027-07-01', '2027-07-05'), mk('c', '2026-11-25', '2026-11-28'), mk('d', '2026-11-01', '2026-11-05')]);
    assert.deepEqual(
      sorted.map((s) => s.id),
      ['c', 'b', 'd', 'a'],
    );
  });

  test('the view lists only the host\'s own homes', () => {
    const view = hostPayoutsView(
      [{ id: 'partner_home', title: 'Stay at the Point' }],
      new Map([['partner_home', account()]]),
      [row(), row({ id: 'other', property_id: 'someone_else' })],
      NOW,
    );
    assert.deepEqual(
      view.stays.map((s) => s.id),
      [row().id],
    );
    assert.equal(view.homes.length, 1);
    assert.equal(view.dashboard_url, STRIPE_DASHBOARD_URL);
  });
});

describe('the year so far', () => {
  test('only what Stripe charged counts, by the Eastern year of the charge', () => {
    const stays = [
      hostPayoutStay(row({ id: 'a', captured_at: '2026-11-14T17:05:00Z' }), 'Home', NOW)!,
      // 11:30 PM Eastern on December 31 is already January 1 in UTC.
      hostPayoutStay(row({ id: 'b', captured_at: '2027-01-01T04:30:00Z', hold_cents: 100_000, fee_cents: 9_000 }), 'Home', NOW)!,
      hostPayoutStay(row({ id: 'c', hold_status: 'held', captured_at: null }), 'Home', NOW)!,
      hostPayoutStay(row({ id: 'd', hold_status: 'none', hold_cents: null, fee_cents: null, captured_at: null }), 'Home', NOW)!,
    ];
    const years = payoutYears(stays);
    assert.deepEqual(years, [{ year: 2026, stays: 2, charged_cents: 512_500, fee_cents: 46_500, payout_cents: 466_000, currency: 'USD' }]);
    assert.equal(easternYear('2027-01-01T04:30:00Z'), 2026);
    assert.equal(easternYear('2027-01-01T05:30:00Z'), 2027);
  });

  test('two currencies never add up in one row', () => {
    const stays: HostPayoutStay[] = [hostPayoutStay(row({ id: 'a' }), 'Home', NOW)!, hostPayoutStay(row({ id: 'b', currency: 'CAD' }), 'Home', NOW)!];
    assert.equal(payoutYears(stays).length, 2);
  });
});

describe('the guards', () => {
  const payouts = code('src/app/api/pms/host/payouts/route.ts');
  const setup = code('src/app/api/pms/host/payouts/setup/route.ts');

  test('both routes take the bridge key first and the session from its header', () => {
    for (const src of [payouts, setup]) {
      const auth = src.indexOf('authorizeStayConcierge(req)');
      assert.ok(auth > 0, 'checks the bridge key');
      assert.ok(src.indexOf('hostForSession(') > auth, 'then reads the session');
      assert.match(src, /req\.headers\.get\(HOST_SESSION_HEADER\)/);
      assert.doesNotMatch(src, /searchParams|nextUrl|new URL\(req\.url/, 'nothing rides a query string');
      assert.match(src, /'Cache-Control': 'no-store'/);
    }
    assert.match(payouts, /export async function GET/);
    assert.doesNotMatch(payouts, /export async function (POST|PUT|PATCH|DELETE)/);
    assert.match(setup, /export async function POST/);
    assert.doesNotMatch(setup, /export async function GET/);
  });

  test('the setup token is answered once and never logged', () => {
    assert.doesNotMatch(setup, /console\.\w+\([^)]*token/);
  });

  test('a setup link only for the host\'s own home, through the office\'s writer, as the host', () => {
    const db = code('src/lib/partner-host-db.ts');
    const fn = db.slice(db.indexOf('export async function hostSetupLink'));
    const own = fn.indexOf('session.homes.find(');
    const write = fn.indexOf('makeSetupLink(');
    assert.ok(own > 0 && write > own, 'checks the home is theirs before minting');
    assert.match(fn, /makeSetupLink\(home\.id, hostActor\(session\.email\)/);
  });

  test('the payouts read lists booked stays at the host\'s homes only, and writes nothing', () => {
    const db = code('src/lib/partner-host-db.ts');
    const fn = db.slice(db.indexOf('export async function hostPayouts'), db.indexOf('export type HostSetupLinkResult'));
    assert.match(fn, /session\.homes\.map\(\(h\) => h\.id\)/);
    assert.match(fn, /\.in\('property_id', ids\)/);
    assert.match(fn, /\.eq\('status', 'accepted'\)/);
    assert.match(fn, /\.limit\(HOST_PAYOUT_STAYS\)/);
    assert.doesNotMatch(fn, /\.(insert|update|upsert|delete)\(/);
    assert.ok(HOST_PAYOUT_STAYS > 0 && HOST_PAYOUT_STAYS <= 1000, 'under PostgREST\'s 1000-row cap');
  });

  test('the pure module reads no env, no database and no money writer', () => {
    const src = code('src/lib/partner-host-payouts.ts');
    assert.doesNotMatch(src, /process\.env|supabase|server-only|owner_payout|writeStatementTotals/);
  });
});
