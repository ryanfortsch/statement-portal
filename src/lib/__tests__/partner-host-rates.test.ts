/**
 * A partner home's host sets their own prices on staycapeann.com/host/rates
 * (src/lib/partner-host-rates.ts, hostRates / hostSavePlan / hostSaveSeason
 * in partner-host-db.ts, the routes under src/app/api/pms/host/rates/).
 *
 * These hold:
 *   - a host's plan save names four plan lines and no other column, inside
 *     fixed bounds; a season is today or later, within about a year, at most
 *     366 nights, and sets a price, a minimum, or both, or clears them;
 *   - a season merges: a price keeps the day's minimum and the office's
 *     closed, arrival and departure flags and notes are never touched;
 *   - the page's seasons are runs of nights sharing one price and minimum;
 *   - the guards spread across files: the bridge key first and the session
 *     header on every route, never a query string; only one of the host's
 *     own homes, through the office's rate writers, recorded as the host.
 *
 * Run: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  HOST_RATE_LIMITS,
  hostPlanPatch,
  hostRatesHome,
  hostSeasonRows,
  hostSeasons,
  parseHostPlan,
  parseHostSeason,
} from '../partner-host-rates.ts';
import type { RateDayRow, RatePlanRow } from '../rate-plan.ts';

const root = new URL('../../../', import.meta.url);
const read = (p: string): string => readFileSync(new URL(p, root), 'utf8');
const code = (p: string): string =>
  read(p)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

const TODAY = '2026-11-13';

const day = (date: string, over: Partial<RateDayRow> = {}): RateDayRow => ({
  property_id: 'partner_home',
  date,
  nightly_cents: null,
  min_nights: null,
  cta: false,
  ctd: false,
  closed: false,
  note: null,
  source: 'operator',
  ...over,
});

const plan = (over: Partial<RatePlanRow> = {}): RatePlanRow =>
  ({
    property_id: 'partner_home',
    currency: 'USD',
    base_nightly_cents: 35_000,
    weekend_nightly_cents: 42_500,
    weekend_days: [6, 5],
    guests_included: 4,
    extra_guest_cents_per_night: 0,
    cleaning_fee_cents: 25_000,
    pet_fee_cents: null,
    security_deposit_cents: null,
    weekly_discount_pct: 0,
    monthly_discount_pct: 0,
    direct_markup_pct: 0,
    min_nights_default: 3,
    max_nights: null,
    advance_notice_hours: 24,
    booking_window_days: 365,
    turnover_buffer_days: 0,
    checkin_time: '16:00',
    checkout_time: '10:00',
    max_occupancy: 6,
    pets_allowed: false,
    quiet_hours: null,
    cancellation_policy_key: 'firm',
    cancellation_terms: null,
    house_rules: null,
    ...over,
  }) as RatePlanRow;

describe('a host saves their plan', () => {
  test('four lines, in cents and nights', () => {
    assert.deepEqual(parseHostPlan({ base_cents: 35_000, weekend_cents: 42_500, min_nights: 3, cleaning_cents: 25_000 }), {
      ok: true,
      value: { base_cents: 35_000, weekend_cents: 42_500, min_nights: 3, cleaning_cents: 25_000 },
    });
  });
  test('no weekend price means weekends cost the same; no cleaning fee is zero', () => {
    const p = parseHostPlan({ base_cents: 35_000, weekend_cents: null, min_nights: 2 });
    assert.ok(p.ok);
    assert.equal(p.value.weekend_cents, null);
    assert.equal(p.value.cleaning_cents, 0);
  });
  test('a nightly price is required and bounded', () => {
    for (const base_cents of [undefined, null, 0, HOST_RATE_LIMITS.minNightlyCents - 1, HOST_RATE_LIMITS.maxNightlyCents + 1, 350.5, '35000']) {
      assert.equal(parseHostPlan({ base_cents, min_nights: 2 }).ok, false, `base ${String(base_cents)}`);
    }
  });
  test('the weekend price, minimum and cleaning fee are bounded', () => {
    const ok = { base_cents: 35_000, min_nights: 2 };
    assert.equal(parseHostPlan({ ...ok, weekend_cents: 100 }).ok, false);
    assert.equal(parseHostPlan({ ...ok, min_nights: 0 }).ok, false);
    assert.equal(parseHostPlan({ ...ok, min_nights: HOST_RATE_LIMITS.maxMinNights + 1 }).ok, false);
    assert.equal(parseHostPlan({ ...ok, min_nights: null }).ok, false);
    assert.equal(parseHostPlan({ ...ok, cleaning_cents: HOST_RATE_LIMITS.maxCleaningCents + 1 }).ok, false);
    assert.equal(parseHostPlan({ ...ok, cleaning_cents: -1 }).ok, false);
  });
  test('the patch names the four plan columns and nothing else', () => {
    assert.deepEqual(Object.keys(hostPlanPatch('partner_home', { base_cents: 1, weekend_cents: null, min_nights: 2, cleaning_cents: 0 })).sort(), [
      'base_nightly_cents',
      'cleaning_fee_cents',
      'min_nights_default',
      'property_id',
      'weekend_nightly_cents',
    ]);
  });
});

describe('a host saves a season', () => {
  test('a price across nights', () => {
    assert.deepEqual(parseHostSeason({ from: '2027-07-01', to: '2027-08-31', nightly_cents: 55_000 }, TODAY), {
      ok: true,
      value: { from: '2027-07-01', to: '2027-08-31', nightly_cents: 55_000, min_nights: null, clear: false },
    });
  });
  test('a minimum alone', () => {
    const p = parseHostSeason({ from: '2027-07-01', to: '2027-07-07', min_nights: 7 }, TODAY);
    assert.ok(p.ok);
    assert.deepEqual([p.value.nightly_cents, p.value.min_nights], [null, 7]);
  });
  test('back to the plan', () => {
    const p = parseHostSeason({ from: TODAY, to: '2026-11-20', clear: true, nightly_cents: 99 }, TODAY);
    assert.ok(p.ok);
    assert.deepEqual([p.value.clear, p.value.nightly_cents, p.value.min_nights], [true, null, null]);
  });
  test('refused: nothing set, the past, backwards, too long, too far, a bad price', () => {
    const cases: Array<Record<string, unknown>> = [
      { from: '2027-07-01', to: '2027-07-07' },
      { from: '2026-11-12', to: '2026-11-20', nightly_cents: 50_000 },
      { from: '2027-07-07', to: '2027-07-01', nightly_cents: 50_000 },
      { from: '2026-12-01', to: '2027-12-02', nightly_cents: 50_000 },
      { from: '2027-12-01', to: '2027-12-31', nightly_cents: 50_000 },
      { from: '2027-07-01', to: '2027-07-07', nightly_cents: 100 },
      { from: '2027-07-01', to: '2027-07-07', min_nights: 0 },
      { from: '07/01/2027', to: '2027-07-07', nightly_cents: 50_000 },
    ];
    for (const c of cases) assert.equal(parseHostSeason(c, TODAY).ok, false, JSON.stringify(c));
  });
  test('a full year starting today is allowed', () => {
    assert.equal(parseHostSeason({ from: TODAY, to: '2027-11-13', nightly_cents: 50_000 }, TODAY).ok, true);
  });
});

describe('a season merges with the day rows', () => {
  const existing = [
    day('2027-07-01', { min_nights: 5, closed: true, cta: true, note: 'Owner week' }),
    day('2027-07-02', { nightly_cents: 40_000, ctd: true }),
  ];
  test('a price keeps the minimum and the office flags', () => {
    const rows = hostSeasonRows('partner_home', { from: '2027-07-01', to: '2027-07-03', nightly_cents: 55_000, min_nights: null, clear: false }, existing);
    assert.equal(rows.length, 3);
    assert.deepEqual(rows[0], {
      property_id: 'partner_home',
      date: '2027-07-01',
      nightly_cents: 55_000,
      min_nights: 5,
      cta: true,
      ctd: false,
      closed: true,
      note: 'Owner week',
      source: 'operator',
    });
    assert.deepEqual([rows[1].nightly_cents, rows[1].ctd], [55_000, true]);
    assert.deepEqual([rows[2].nightly_cents, rows[2].min_nights, rows[2].closed], [55_000, null, false]);
  });
  test('a minimum keeps the price', () => {
    const rows = hostSeasonRows('partner_home', { from: '2027-07-02', to: '2027-07-02', nightly_cents: null, min_nights: 4, clear: false }, existing);
    assert.deepEqual([rows[0].nightly_cents, rows[0].min_nights], [40_000, 4]);
  });
  test('clearing drops the price and the minimum, never the flags', () => {
    const rows = hostSeasonRows('partner_home', { from: '2027-07-01', to: '2027-07-02', nightly_cents: null, min_nights: null, clear: true }, existing);
    assert.deepEqual(
      rows.map((r) => [r.nightly_cents, r.min_nights, r.closed, r.cta, r.ctd, r.note]),
      [
        [null, null, true, true, false, 'Owner week'],
        [null, null, false, false, true, null],
      ],
    );
  });
  test('the last night is included, across a month end', () => {
    const rows = hostSeasonRows('partner_home', { from: '2027-01-30', to: '2027-02-02', nightly_cents: 30_000, min_nights: null, clear: false }, []);
    assert.deepEqual(
      rows.map((r) => r.date),
      ['2027-01-30', '2027-01-31', '2027-02-01', '2027-02-02'],
    );
  });
});

describe('the page lists seasons', () => {
  test('runs of nights sharing one price and minimum, from today on', () => {
    const days = [
      day('2026-11-10', { nightly_cents: 30_000 }),
      day('2027-07-01', { nightly_cents: 55_000 }),
      day('2027-07-02', { nightly_cents: 55_000 }),
      day('2027-07-03', { nightly_cents: 55_000, min_nights: 7 }),
      day('2027-07-05', { nightly_cents: 55_000, min_nights: 7 }),
      day('2027-07-06', { closed: true }),
    ];
    assert.deepEqual(hostSeasons(days, TODAY), [
      { from: '2027-07-01', to: '2027-07-02', nights: 2, nightly_cents: 55_000, min_nights: null },
      { from: '2027-07-03', to: '2027-07-03', nights: 1, nightly_cents: 55_000, min_nights: 7 },
      { from: '2027-07-05', to: '2027-07-05', nights: 1, nightly_cents: 55_000, min_nights: 7 },
    ]);
  });
  test('a home with no plan yet shows none; weekend nights read in order', () => {
    assert.equal(hostRatesHome({ id: 'partner_home', title: null }, null, [], TODAY).plan, null);
    const h = hostRatesHome({ id: 'partner_home', title: 'Stay at the Point' }, plan(), [], TODAY);
    assert.deepEqual(h.plan, { base_cents: 35_000, weekend_cents: 42_500, weekend_days: [5, 6], min_nights: 3, cleaning_cents: 25_000, currency: 'USD' });
  });
});

describe('guards across files', () => {
  const db = code('src/lib/partner-host-db.ts');
  const fn = (name: string) => {
    const start = db.indexOf(`export async function ${name}(`);
    assert.ok(start >= 0, name);
    const next = db.indexOf('\nexport ', start + 1);
    return db.slice(start, next < 0 ? undefined : next);
  };
  for (const name of ['hostSavePlan', 'hostSaveSeason']) {
    test(`${name} finds one of the host's own homes before it writes, and writes as the host`, () => {
      const body = fn(name);
      const own = body.indexOf('hostHomeOf(session, rawPropertyId)');
      const write = Math.max(body.indexOf('upsertRatePlan('), body.indexOf('setRateDays('));
      assert.ok(own > 0 && write > own, 'home check before the write');
      assert.match(body, /hostActor\(session\.email\)/);
      assert.match(body, /if \(!home\) return \{ ok: false/);
    });
  }
  test('the plan save writes only the host patch', () => {
    assert.match(fn('hostSavePlan'), /upsertRatePlan\(hostPlanPatch\(home\.id, parsed\.value\)/);
  });
  test('the season save writes only merged rows for its home', () => {
    assert.match(fn('hostSaveSeason'), /setRateDays\(hostSeasonRows\(home\.id, input, existing\)/);
  });
  test('the home lookup reads only the session', () => {
    assert.match(db, /function hostHomeOf\(session: HostSession, rawPropertyId: unknown\): HostHome \| undefined \{\s*return typeof rawPropertyId === 'string' \? session\.homes\.find/);
  });
  for (const route of ['src/app/api/pms/host/rates/route.ts', 'src/app/api/pms/host/rates/season/route.ts']) {
    test(`${route}: the bridge key first, the session from its header, no query string`, () => {
      const src = code(route);
      const verbs = src.match(/export async function (GET|POST)\(req: Request\) \{[\s\S]*?\n\}/g) ?? [];
      assert.ok(verbs.length > 0, 'found the handlers');
      for (const verb of verbs) {
        const key = verb.indexOf('authorizeStayConcierge(req)');
        const session = verb.indexOf('hostForSession(req.headers.get(HOST_SESSION_HEADER))');
        assert.ok(key > 0 && session > key, 'key, then session');
      }
      assert.doesNotMatch(src, /searchParams|nextUrl/);
      assert.doesNotMatch(src, /export async function (PUT|PATCH|DELETE)/);
    });
  }
});
