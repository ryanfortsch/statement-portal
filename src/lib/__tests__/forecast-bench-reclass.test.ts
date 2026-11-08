/**
 * The bench after 2026-11-07: Cooper is marketing, the listing shoot is
 * onboarding, and the Contractors line is the misc blend.
 *
 * Dotti, 2026-11-07, on the November to April projection: "it should just
 * be cooper's costs ... lightshed should be lumped into onboarding new
 * properties. Cooper's run rate looks right and maybe we put that into
 * marketing". So Cooper's $1,300/mo per 16 homes rides the Marketing &
 * advertising bucket, a Lightshed shoot is $400 inside the start-month
 * onboarding charge, and nothing but the one-off handymen is left on the
 * Contractors line from November 2026.
 *
 * The projection and the ACT mapping must agree, or the table changes
 * shape at the seam between a measured month and a projected one. Each
 * half is checked here: the model's terms, the card and operating-account
 * routes, and the DB mapping's use of them.
 *
 * Run: npm test   (node --test, native TypeScript, no bundler, no database)
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  calcYear,
  ccOperatingDetail,
  contractorCost,
  creativeCost,
  listingCost,
  marketingCost,
  CONTRACTOR_FIELD_PROP_COUNT,
  CONTRACTOR_MISC_MONTHLY,
  MARKETING_CREATIVE_MONTHLY,
  MARKETING_CREATIVE_START_MONTH_2026,
  ONBOARDING_COST,
  ONBOARDING_PHOTO_COST,
  SEASON,
} from '../forecast-model.ts';
import { isCreativeBench, isListingShoot, routeCardRow } from '../forecast-card-detail.ts';

const read = (rel: string) => readFileSync(join(process.cwd(), rel), 'utf8');

describe('the Contractors line from November 2026', () => {
  test('is the misc blend alone, in every year', () => {
    for (const [year, month] of [[2026, 11], [2026, 12], [2027, 7], [2028, 3]] as const) {
      const got = contractorCost(year, month, CONTRACTOR_FIELD_PROP_COUNT, SEASON.CA[month - 1]);
      assert.equal(got, CONTRACTOR_MISC_MONTHLY, `${year}-${month}`);
    }
    // And it no longer scales with the fleet: nothing per-home is left on it.
    assert.equal(contractorCost(2027, 8, 30, SEASON.CA[7]), contractorCost(2027, 8, 8, SEASON.CA[7]));
  });

  test('October 2026 still carries field labor on the curve', () => {
    assert.ok(contractorCost(2026, 10, CONTRACTOR_FIELD_PROP_COUNT, SEASON.CA[9]) > CONTRACTOR_MISC_MONTHLY);
  });
});

describe("Cooper's content work rides the marketing bucket", () => {
  test('$1,300 per 16 homes from July 2026, scaled to the live fleet', () => {
    assert.equal(MARKETING_CREATIVE_MONTHLY, 1300);
    assert.equal(MARKETING_CREATIVE_START_MONTH_2026, 7);
    assert.equal(creativeCost(2026, 6, 16), 0);
    assert.equal(creativeCost(2026, 7, 16), 1300);
    assert.equal(creativeCost(2027, 8, 8), 650);
    assert.equal(creativeCost(2028, 1, 16), 1300);
    // No off-season half on his line: the 2027 ruling stays with the bench.
    assert.equal(creativeCost(2027, 2, 16), 1300);
  });

  test('the projected marketing bucket is the ads, Furnished Finder and Cooper', () => {
    for (const [year, month, n] of [[2026, 11, 16], [2027, 3, 14], [2027, 8, 20], [2028, 9, 24]] as const) {
      const want = marketingCost(year, month) + listingCost(month) + creativeCost(year, month, n);
      assert.ok(Math.abs(ccOperatingDetail(n, year, month).marketing - want) < 1e-9, `${year}-${month}`);
    }
    // Before Cooper the bucket was the ads alone.
    assert.equal(ccOperatingDetail(16, 2026, 3).marketing, marketingCost(2026, 3) + listingCost(3));
  });

  test('calcYear puts him there and not on the bench, and the rows still foot', () => {
    const y = calcYear(0, 2026);
    for (const r of y.monthly) {
      if (r.is_actual) continue;
      assert.ok(r.cc_detail, `2026-${r.month} has card detail`);
      const wantMkt = marketingCost(2026, r.month) + listingCost(r.month) + creativeCost(2026, r.month, r.active_count);
      assert.ok(Math.abs(r.cc_detail.marketing - wantMkt) < 1e-6, `2026-${r.month} marketing`);
      if (r.month >= 11) assert.equal(r.exp_contractors, CONTRACTOR_MISC_MONTHLY, `2026-${r.month} bench`);
      const parts =
        r.exp_office + r.exp_software + r.exp_debt + r.exp_insurance + r.exp_accounting + r.exp_bank +
        r.exp_cc_ops + r.exp_contractors + r.exp_payroll + r.exp_onboard_presigned + r.exp_onboard_new;
      assert.ok(Math.abs(parts - r.exp_total) < 1e-6, `2026-${r.month} foots`);
      const detail = r.cc_detail;
      const detailSum = detail.supplies + detail.repairs + detail.vehicle_insurance + detail.travel_other + detail.marketing + detail.telecom;
      assert.ok(Math.abs(detailSum - r.exp_cc_ops) < 1e-6, `2026-${r.month} detail sums to the card line`);
    }
  });
});

describe('a Lightshed shoot is onboarding', () => {
  test('$400 inside the start-month charge, nothing monthly', () => {
    assert.equal(ONBOARDING_PHOTO_COST, 400);
    assert.ok(ONBOARDING_COST > ONBOARDING_PHOTO_COST);
    const one = calcYear(1, 2027);
    const charged = one.monthly.filter((m) => m.exp_onboard_new > 0);
    assert.equal(charged.length, 1, 'one slider home is charged once');
    assert.equal(charged[0].exp_onboard_new, ONBOARDING_COST);
  });
});

describe('the ACT months agree with the projection', () => {
  test('the routes name the payees', () => {
    assert.equal(isListingShoot('LIGHTSHED PHOTOGRAPHY'), true);
    assert.equal(isCreativeBench('Basic Online Payroll Payment 1234567 to #######4113'.toUpperCase()), true);
    assert.equal(isCreativeBench('ZELLE PAYMENT TO COOPER'), true);
    assert.equal(isCreativeBench('ZELLE PAYMENT TO NICOLE WHITTEN'), false);
    assert.equal(isListingShoot('ZELLE PAYMENT TO IAN DROMETER'), false);
    assert.equal(routeCardRow('Contractors', 'LIGHTSHED PHOTOGRAPHY'), 'onboarding');
    assert.equal(routeCardRow('Contractors', 'BASIC ONLINE PAYROLL PAYMENT TO #######4113'), 'marketing');
    assert.equal(routeCardRow('Contractors', 'SOME OTHER CARD CONTRACTOR'), 'contractors');
  });

  test('the DB mapping sends Cooper to marketing, the shoot to onboarding, and the rest to the bench', () => {
    const src = read('src/lib/forecast-actuals-from-db.ts');
    assert.ok(src.includes("else if (route === 'onboarding') ma.exp_onboard_new += amt;"), 'a Lightshed card row lands on the Onboarding line');
    assert.ok(src.includes("if (isCreativeBench(desc)) place('marketing');"), "Cooper's operating rows land in the marketing bucket");
    assert.ok(src.includes('else ma.exp_contractors += amt;'), 'everyone else on the operating bench stays on the Contractors line');
    assert.ok(!src.includes("case 'Contractors':     ma.exp_contractors += amt; break;"), 'the old unconditional route is gone');
  });

  test('the table reads the Marketing bucket and the Onboarding line unchanged', () => {
    const ui = read('src/app/forecast/ForecastClient.tsx');
    assert.ok(ui.includes('r.cc_detail ? r.cc_detail[cat.key]'), 'the six card rows read cc_detail');
    assert.ok(ui.includes('const onboarding = (r: MonthRow) => r.exp_onboard_presigned + r.exp_onboard_new;'), 'the Onboarding row sums both onboarding fields');
    assert.ok(ui.includes('values: monthly.map((r) => r.exp_contractors)'), 'the Contractors row reads exp_contractors');
  });
});
