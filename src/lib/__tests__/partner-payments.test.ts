/**
 * Partner home payments: Stripe Connect (src/lib/partner-payments.ts).
 *
 * A partner home's host is paid on their own Stripe account. The site places
 * a hold when a guest sends a request, charges it when Helm says the host
 * accepted, and releases it otherwise. These hold the fee arithmetic, the
 * readiness rules, the setup link, the settle queue, the guest's words about
 * the card, and the guards spread across files:
 *
 *   - Helm never holds a Stripe secret or calls Stripe;
 *   - a hold must be the stay's total and our fee on the home's account;
 *   - a settle report only ever moves a hold forward, and a charge needs an
 *     accepted request, in code and in the database;
 *   - the guest is told they are booked only after the charge;
 *   - an accepted request holds its nights only on the partner home's own
 *     calendar, never as a bookings row ops would read;
 *   - the bridge routes take the header key and the setup token in a body.
 *
 * Run: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  accountStatusLabel,
  hashSetupToken,
  holdLine,
  holdMismatch,
  holdStatusAfter,
  holdsAccepted,
  isSetupToken,
  newSetupToken,
  parseFeePct,
  partnerFeeCents,
  paymentsReady,
  settleActionFor,
  settleQueue,
  setupLinkFor,
  setupTokenExpiry,
  shapeAccount,
  validateAccountStatus,
  validateHold,
  validateSettleReport,
  type PartnerPaymentAccount,
  type SettleRow,
} from '../partner-payments.ts';
import { validateRequestInput, type BookingRequestRow } from '../booking-requests.ts';
import { confirmedEmail, declinedEmail, expiredEmail, receiptEmail } from '../booking-request-copy.ts';

const repo = fileURLToPath(new URL('../../../', import.meta.url));
const read = (p: string): string => readFileSync(join(repo, p), 'utf8');
const code = (p: string): string => read(p).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

const NOW = new Date('2026-11-13T15:00:00Z');
const ACCT = 'acct_1QhostAbCdEf';
const PI = 'pi_3QholdAbCdEf';

function account(over: Partial<PartnerPaymentAccount> = {}): PartnerPaymentAccount {
  return {
    property_id: 'partner_home',
    stripe_account_id: ACCT,
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

describe('the fee', () => {
  test('is a percent of everything but the occupancy tax, to the cent', () => {
    // $4,125 total with $400 of tax at 10%: $372.50.
    assert.equal(partnerFeeCents(412_500, 40_000, 10), 37_250);
    assert.equal(partnerFeeCents(100_001, 0, 8.5), 8_500);
    assert.equal(partnerFeeCents(50_000, 60_000, 10), 0, 'never negative');
    assert.equal(partnerFeeCents(50_000, 0, 0), 0);
  });

  test('the office types a percent from 0 to 30', () => {
    assert.equal(parseFeePct('10'), 10);
    assert.equal(parseFeePct(' 8.5% '), 8.5);
    assert.equal(parseFeePct(9.999), 10);
    assert.equal(parseFeePct('31'), null);
    assert.equal(parseFeePct('-1'), null);
    assert.equal(parseFeePct('ten'), null);
    assert.equal(parseFeePct(''), null, 'an empty answer is no fee, never zero');
    assert.equal(parseFeePct('0'), 0);
  });

  test('a numeric column from PostgREST reads as a number', () => {
    const a = shapeAccount({ property_id: 'p', fee_pct: '9.50', charges_enabled: true, requirements_due: '2' });
    assert.equal(a.fee_pct, 9.5);
    assert.equal(a.requirements_due, 2);
    assert.equal(shapeAccount({ property_id: 'p', fee_pct: null }).fee_pct, null);
  });
});

describe('when a home takes cards', () => {
  test('ready means an account Stripe lets charge and a fee', () => {
    assert.equal(paymentsReady(account()), true);
    assert.equal(paymentsReady(account({ charges_enabled: false })), false);
    assert.equal(paymentsReady(account({ fee_pct: null })), false);
    assert.equal(paymentsReady(account({ stripe_account_id: null })), false);
    assert.equal(paymentsReady(null), false);
  });

  test('a hold is accepted once there is an account and a fee, before Helm hears Stripe said yes', () => {
    assert.equal(holdsAccepted(account({ charges_enabled: false })), true);
    assert.equal(holdsAccepted(account({ fee_pct: null })), false);
    assert.equal(holdsAccepted(account({ stripe_account_id: null })), false);
  });

  test('the office reads one line about where the host stands', () => {
    const later = new Date(NOW.getTime() + 86_400_000).toISOString();
    assert.equal(accountStatusLabel(null, NOW), 'Not set up');
    assert.equal(accountStatusLabel(account({ stripe_account_id: null, setup_token_expires_at: later }), NOW), 'Setup link sent, the host has not opened it');
    assert.equal(accountStatusLabel(account({ stripe_account_id: null, setup_token_expires_at: '2026-11-01T00:00:00Z' }), NOW), 'Setup link expired');
    assert.equal(accountStatusLabel(account(), NOW), 'Taking payments');
    assert.equal(accountStatusLabel(account({ fee_pct: null }), NOW), 'Stripe is ready; set the fee');
    assert.equal(accountStatusLabel(account({ charges_enabled: false, payouts_enabled: false, details_submitted: false, requirements_due: 3 }), NOW), 'Stripe needs 3 more things from the host');
    assert.equal(accountStatusLabel(account({ charges_enabled: false, payouts_enabled: false }), NOW), 'Stripe is reviewing the host');
  });
});

describe('the setup link', () => {
  test('is 256 random bits, URL-safe, kept only as a hash', () => {
    const a = newSetupToken();
    const b = newSetupToken();
    assert.notEqual(a, b);
    assert.ok(isSetupToken(a), a);
    assert.match(hashSetupToken(a), /^[0-9a-f]{64}$/);
    assert.equal(hashSetupToken(a), hashSetupToken(a));
    assert.equal(isSetupToken('short'), false);
    assert.equal(isSetupToken('../../etc/passwd'.padEnd(44, 'a')), false);
  });

  test('works for 14 days and opens on staycapeann.com', () => {
    assert.equal(setupTokenExpiry(NOW), '2026-11-27T15:00:00.000Z');
    assert.equal(setupLinkFor('https://staycapeann.com/', 'abc'), 'https://staycapeann.com/host/payments/abc');
  });
});

describe('the hold on a request', () => {
  const hold = { stripe_account_id: ACCT, payment_intent_id: PI, amount_cents: 412_500, fee_cents: 37_250 };

  test('a hold has exactly this shape, or there is none', () => {
    assert.deepEqual(validateHold(undefined), { ok: true, hold: null });
    assert.deepEqual(validateHold(hold), { ok: true, hold });
    for (const bad of [
      { ...hold, stripe_account_id: 'acct' },
      { ...hold, payment_intent_id: 'ch_123456' },
      { ...hold, amount_cents: 0 },
      { ...hold, amount_cents: 12.5 },
      { ...hold, fee_cents: 412_501 },
      { ...hold, fee_cents: -1 },
      'held',
    ]) {
      assert.equal(validateHold(bad).ok, false, JSON.stringify(bad));
    }
  });

  test('the bridge body carries it through validation', () => {
    const v = validateRequestInput({
      request_key: 'sca-1234567890abcdef',
      property_id: 'partner_home',
      check_in: '2027-07-03',
      check_out: '2027-07-10',
      guests: 2,
      guest: { first_name: 'Jamie', last_name: 'Rivera', email: 'jamie@example.com' },
      hold,
    });
    assert.ok(v.ok);
    if (v.ok) assert.deepEqual(v.input.hold, hold);
    const bad = validateRequestInput({ request_key: 'k', property_id: 'p', check_in: '2027-07-03', check_out: '2027-07-10', guests: 2, guest: { first_name: 'J', email: 'j@x.co' }, hold: { ...hold, fee_cents: 'x' } });
    assert.equal(bad.ok, false);
  });

  test('must be the home account, the stay total and our fee, to the cent', () => {
    const expected = { stripe_account_id: ACCT, amount_cents: 412_500, fee_cents: 37_250 };
    assert.equal(holdMismatch(hold, expected), null);
    assert.match(holdMismatch({ ...hold, stripe_account_id: 'acct_1Qother1234' }, expected) ?? '', /another Stripe account/);
    assert.match(holdMismatch({ ...hold, amount_cents: 412_499 }, expected) ?? '', /412499 cents/);
    assert.match(holdMismatch({ ...hold, fee_cents: 37_249 }, expected) ?? '', /fee/);
  });
});

describe('settling holds', () => {
  const base: SettleRow = {
    request_key: 'k',
    status: 'pending',
    respond_by: new Date(NOW.getTime() + 3600_000).toISOString(),
    hold_status: 'held',
    stripe_account_id: ACCT,
    payment_intent_id: PI,
    hold_cents: 412_500,
  };

  test('accepted is charged; declined, withdrawn and closed are released; a live request waits', () => {
    assert.equal(settleActionFor({ ...base, status: 'accepted' }, NOW), 'capture');
    for (const s of ['declined', 'withdrawn', 'expired']) assert.equal(settleActionFor({ ...base, status: s }, NOW), 'release', s);
    assert.equal(settleActionFor(base, NOW), null);
    assert.equal(settleActionFor({ ...base, respond_by: NOW.toISOString() }, NOW), 'release', 'a clock that ran out cannot be accepted, so its hold goes');
  });

  test('only a live hold is ever settled', () => {
    for (const h of ['none', 'captured', 'released', 'failed']) assert.equal(settleActionFor({ ...base, status: 'accepted', hold_status: h }, NOW), null, h);
    assert.equal(settleActionFor({ ...base, status: 'accepted', payment_intent_id: null }, NOW), null);
  });

  test('charges go first', () => {
    const q = settleQueue(
      [
        { ...base, request_key: 'a', status: 'declined' },
        { ...base, request_key: 'b', status: 'accepted' },
        { ...base, request_key: 'c' },
      ],
      NOW,
    );
    assert.deepEqual(q.map((i) => [i.request_key, i.action]), [['b', 'capture'], ['a', 'release']]);
    assert.equal(q[0].amount_cents, 412_500);
  });

  test('a report names its intent and, for a charge, the charge and amount', () => {
    assert.ok(validateSettleReport({ request_key: 'k', payment_intent_id: PI, outcome: 'captured', charge_id: 'ch_3Qcharge1234', amount_cents: 412_500 }).ok);
    assert.equal(validateSettleReport({ request_key: 'k', payment_intent_id: PI, outcome: 'captured' }).ok, false);
    assert.ok(validateSettleReport({ request_key: 'k', payment_intent_id: PI, outcome: 'released' }).ok);
    assert.equal(validateSettleReport({ request_key: 'k', payment_intent_id: PI, outcome: 'refunded' }).ok, false);
    assert.equal(validateSettleReport({ request_key: 'k', payment_intent_id: 'nope', outcome: 'released' }).ok, false);
    const failed = validateSettleReport({ request_key: 'k', payment_intent_id: PI, outcome: 'capture_failed', detail: '  card   expired ' });
    assert.ok(failed.ok);
    if (failed.ok) assert.equal(failed.report.detail, 'card expired');
    assert.equal(holdStatusAfter('captured'), 'captured');
    assert.equal(holdStatusAfter('released'), 'released');
    assert.equal(holdStatusAfter('capture_failed'), 'failed');
  });

  test('a status report is for one account on one home', () => {
    assert.ok(validateAccountStatus({ property_id: 'p', stripe_account_id: ACCT, charges_enabled: true, requirements_due: 0 }).ok);
    assert.equal(validateAccountStatus({ property_id: 'p', stripe_account_id: 'x' }).ok, false);
    assert.equal(validateAccountStatus({ stripe_account_id: ACCT }).ok, false);
  });

  test('the office reads the card in one line', () => {
    const r = { hold_status: 'held', hold_cents: 412_500, fee_cents: 37_250, hold_error: null, status: 'pending' };
    assert.equal(holdLine(r), 'Card held $4,125 · our fee $372.50');
    assert.equal(holdLine({ ...r, status: 'accepted' }), 'Charging the card $4,125 · our fee $372.50');
    assert.equal(holdLine({ ...r, hold_status: 'captured', status: 'accepted' }), 'Charged $4,125 · our fee $372.50');
    assert.equal(holdLine({ ...r, hold_status: 'released' }), 'Hold released $4,125');
    assert.equal(holdLine({ ...r, hold_status: 'failed', hold_error: 'card expired' }), 'The card could not be charged: card expired');
    assert.equal(holdLine({ ...r, hold_status: 'none', hold_cents: null }), 'No card on file');
  });
});

describe('what the guest reads about the card', () => {
  const ctx = { title: 'Stay at Rocky Neck', siteOrigin: 'https://staycapeann.com' };
  const row = {
    guest_first_name: 'Jamie',
    check_in: '2027-07-03',
    check_out: '2027-07-10',
    guests: 4,
    respond_by: new Date(NOW.getTime() + 86_400_000).toISOString(),
    quoted_total_cents: 412_500,
    currency: 'USD',
    quote: { breakdown: { cleaning_cents: 25_000, tax_cents: 40_000 } },
    hold_status: 'held' as BookingRequestRow['hold_status'],
    hold_cents: 412_500,
  };

  test('the receipt says the card is held, not charged', () => {
    const e = receiptEmail(row, ctx);
    assert.match(e.text, /We placed a hold of \$4,125, cleaning and taxes included on your card\. You are charged only if the host says yes\./);
    assert.ok(!/Nothing has been charged/.test(e.text));
  });

  test('a closing email says the hold is released', () => {
    for (const e of [declinedEmail(row, ctx), expiredEmail(row, ctx)]) assert.match(e.text, /releasing the hold on your card/);
    assert.ok(!/hold/.test(declinedEmail({ ...row, hold_status: 'none', hold_cents: null }, ctx).text), 'no card, no hold to mention');
  });

  test('you are booked, with what was charged, and nothing about our systems', () => {
    const e = confirmedEmail({ ...row, charged_cents: 412_500 }, ctx);
    assert.equal(e.subject, "You're booked at Rocky Neck");
    assert.match(e.text, /the host said yes/);
    assert.match(e.text, /We charged \$4,125, cleaning and taxes included to your card\./);
    const all = `${e.subject}\n${e.text}\n${e.html}`;
    for (const word of ['Helm', 'Guesty', 'Stripe', 'partner_home', 'acct_', 'pi_']) assert.ok(!all.includes(word), word);
  });
});

describe('the guards across files', () => {
  const sources = (dir: string, out: string[] = []): string[] => {
    for (const name of readdirSync(join(repo, dir))) {
      const full = join(repo, dir, name);
      if (statSync(full).isDirectory()) {
        if (name !== '__tests__' && name !== 'node_modules') sources(relative(repo, full), out);
      } else if (/\.(ts|tsx)$/.test(name)) out.push(relative(repo, full));
    }
    return out;
  };
  const partnerFiles = [
    'src/lib/partner-payments.ts',
    'src/lib/partner-payments-db.ts',
    'src/lib/booking-requests.ts',
    'src/lib/booking-requests-db.ts',
    'src/app/api/pms/connect/route.ts',
    'src/app/api/pms/requests/route.ts',
    'src/app/api/pms/requests/settle/route.ts',
    'src/app/api/pms/quote/route.ts',
    'src/lib/partner-host.ts',
    'src/lib/partner-host-db.ts',
    'src/lib/partner-host-email.ts',
    ...sources('src/app/api/pms/host'),
    ...sources('src/app/guests/requests'),
  ];

  test('Helm never holds the platform key or calls Stripe for a partner home', () => {
    for (const f of partnerFiles) {
      const src = code(f);
      assert.ok(!/from ['"]stripe['"]|require\(['"]stripe['"]\)/.test(src), `${f} imports stripe`);
      assert.ok(!/process\.env\.STRIPE/.test(src), `${f} reads a Stripe secret`);
      assert.ok(!/getStripeKeysMap|stripe-keys/.test(src), `${f} reaches for a home's Stripe key`);
    }
    for (const f of sources('src')) assert.ok(!code(f).includes('STRIPE_CONNECT'), `${f} names the Connect platform key`);
  });

  test('a request is checked against its hold before it is written', () => {
    const db = code('src/lib/booking-requests-db.ts');
    const create = db.slice(db.indexOf('export async function createBookingRequest('), db.indexOf('export type RequestHome'));
    const priced = create.indexOf('quoteForBridge(property.id');
    const mismatch = create.indexOf("error: 'hold_mismatch'");
    const required = create.indexOf("error: 'hold_required'");
    const insert = create.indexOf('.insert(');
    assert.ok(priced > 0 && mismatch > priced && required > priced && insert > mismatch && insert > required, 'priced, then the hold, then the insert');
    assert.ok(create.includes('partnerFeeCents(totalCents, q.breakdown.tax_cents'), 'the fee is Helm’s own arithmetic on Helm’s own price');
    assert.ok(create.includes("hold_status: 'held'"));
  });

  test('a settle report only moves a live hold forward, and a charge needs an accepted request', () => {
    const db = code('src/lib/partner-payments-db.ts');
    const rec = db.slice(db.indexOf('export async function recordSettlement('), db.indexOf('async function emailConfirmation('));
    const update = rec.slice(rec.indexOf('.update(patch)'));
    assert.ok(update.includes(".eq('hold_status', 'held')"), 'forward only');
    assert.ok(update.includes(".eq('payment_intent_id', r.payment_intent_id)"), 'this intent only');
    assert.ok(rec.includes("if (r.outcome === 'captured') q = q.eq('status', 'accepted');"));
    assert.ok(rec.includes('r.amount_cents !== req.hold_cents'), 'the charge is the amount held');
    const sql = read('supabase/migrations/20261113010000_partner_payments.sql');
    assert.ok(sql.includes("check (hold_status <> 'captured' or status = 'accepted')"), 'the database says so too');
  });

  test('the guest is told they are booked only once the charge is reported', () => {
    const email = code('src/lib/booking-request-email.ts');
    assert.ok(email.includes("if (row.status !== 'accepted' || row.hold_status !== 'captured' || row.hold_cents == null) return false;"));
    const callers = sources('src').filter((f) => /sendRequestConfirmation\(/.test(code(f)));
    assert.deepEqual(callers.sort(), ['src/lib/booking-request-email.ts', 'src/lib/partner-payments-db.ts']);
  });

  test('an accepted request holds nights only on a partner home calendar', () => {
    const bridge = code('src/lib/pms-bridge.ts');
    assert.ok(bridge.includes('const partner = isPartnerHome(property);'));
    assert.ok(bridge.includes('partner ? acceptedRequestsInWindow(property.id, start, endExclusive) : Promise.resolve([])'));
    assert.ok(bridge.includes('partner ? partnerHoldsInWindow(property.id, start, endExclusive) : Promise.resolve([])'), "and the host's own nights from their calendars");
    const reader = bridge.slice(bridge.indexOf('async function acceptedRequestsInWindow('), bridge.indexOf('async function staysInWindow('));
    assert.ok(reader.includes(".eq('status', 'accepted')"));
    assert.ok(reader.includes('throw new Error'), 'a calendar that cannot see its accepted stays fails closed');
    const sql = read('supabase/migrations/20261113010000_partner_payments.sql');
    assert.ok(sql.includes("exclude using gist (property_id with =, daterange(check_in, check_out, '[)') with &&)"));
    assert.ok(sql.includes("where (status = 'accepted');"));
  });

  test('the bridge routes take the header key; the setup token rides in a body', () => {
    for (const f of ['src/app/api/pms/connect/route.ts', 'src/app/api/pms/requests/settle/route.ts']) {
      const src = code(f);
      assert.equal((src.match(/authorizeStayConcierge\(req\)/g) ?? []).length, (src.match(/export async function (GET|POST)/g) ?? []).length, f);
      assert.ok(!src.includes('searchParams'), `${f} reads a query string`);
    }
    assert.ok(read('src/proxy.ts').includes('"/api/pms/"'), 'the bridge prefix is public to the header check');
  });

  test('the new table grants service_role and locks the clients out', () => {
    const sql = read('supabase/migrations/20261113010000_partner_payments.sql');
    assert.ok(sql.includes('alter table public.partner_payment_accounts enable row level security;'));
    assert.ok(sql.includes('revoke all on public.partner_payment_accounts from public, anon, authenticated;'));
    assert.ok(sql.includes('grant select, insert, update, delete on public.partner_payment_accounts to service_role;'));
    assert.ok(sql.includes('setup_token_hash text unique'), 'only the hash of a setup link is stored');
  });

  test('the office verbs for host payments check the owner', () => {
    const actions = code('src/app/guests/requests/actions.ts');
    for (const fn of ['makeSetupLinkAction', 'setFeeAction', 'acceptRequestAction']) {
      const body = actions.slice(actions.indexOf(`export async function ${fn}(`));
      assert.ok(body.slice(0, 200).includes('await requireOwnerEmail()'), fn);
    }
  });
});
