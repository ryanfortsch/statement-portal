/**
 * The October 2026 rerack of the card side of /forecast.
 *
 * September 2026 was the first month after the summer onboarding wave and
 * it came in at a quarter of what the supplies rate projected: the summer
 * was eleven outfittings, not a run rate. So outfitting is a one-time
 * charge in a new home's start month, the per-home supplies rate is fitted
 * without the linen orders, the photographer on the card rides the
 * Onboarding line (a bench line from 2026-10-15 to 2026-11-07), the
 * landscapers ride Repairs, and a month the operating export has not
 * reached projects its operating lines instead of reading them as $0.
 *
 * Run: npm test   (node --test, native TypeScript, no bundler, no database)
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  calcYear,
  ccOperatingDetail,
  contractorCost,
  creativeCost,
  listingCost,
  payrollCost,
  rentCost,
  BANK_FEES_MONTHLY,
  CC_LISTING_ANNUAL,
  CC_REPAIRS_SHARE,
  CC_SUPPLY_ANNUAL_PER_PROP,
  CC_SUPPLY_SEASON,
  NEW_ORDER_2026,
  OFFICE_RENT_MONTHLY,
  OFFICE_START_MONTH,
  ONBOARDING_COST,
  ONBOARDING_OUTFIT_COST,
  ONBOARDING_PHOTO_COST,
  SEASON,
} from '../forecast-model.ts';
import { routeCardRow } from '../forecast-card-detail.ts';
import { canonicalVendor, categorizeOverhead } from '../overhead-categories.ts';

describe('the vendors September 2026 brought to the card', () => {
  test('the photographer is a contractor in the ledger and onboarding on the forecast', () => {
    assert.equal(
      categorizeOverhead({ account: 'card', description: 'LIGHTSHED PHOTOGRAPHY', amount: -415, chaseCategory: 'Merchandise & Inventory' }),
      'Contractors',
    );
    assert.equal(routeCardRow('Contractors', 'LIGHTSHED PHOTOGRAPHY'), 'onboarding');
    assert.equal(canonicalVendor('LIGHTSHED PHOTOGRAPHY'), 'Lightshed Photography');
  });

  test('yard work on a home is a repair, not Other', () => {
    assert.equal(
      categorizeOverhead({ account: 'card', description: 'WOLF HILL LANDSCAPING &amp;', amount: -302.76, chaseCategory: 'Repair & Maintenance' }),
      'Repairs & upkeep',
    );
    assert.equal(
      categorizeOverhead({ account: 'card', description: 'IN *SP PROPERTIES', amount: -367, chaseCategory: 'Repair & Maintenance' }),
      'Repairs & upkeep',
    );
    assert.equal(canonicalVendor('IN *SP PROPERTIES'), 'SP Properties');
    assert.equal(canonicalVendor('WOLF HILL LANDSCAPING &amp;'), 'Wolf Hill Landscaping');
  });

  test('the hiring run and the van group under one name each', () => {
    assert.equal(canonicalVendor('Indeed USI26-06395781'), canonicalVendor('Indeed USI26-08491544'));
    assert.equal(canonicalVendor('CHECKR  INC CHECKR.COM'), 'Checkr (background checks)');
    assert.equal(canonicalVendor('WF *WAYFAIR4757584061'), 'Wayfair');
    assert.equal(canonicalVendor('WAGNERS DETAILING INC'), 'Wagners Detailing');
  });
});

describe('outfitting is charged once, in the start month', () => {
  test('the charge is real and the supplies rate no longer carries it', () => {
    assert.ok(ONBOARDING_COST > 0);
    assert.ok(CC_SUPPLY_ANNUAL_PER_PROP < 8360, 'the rate fitted with the linen orders in was 8,360');
    // September 2026 at sixteen homes: the rate projects well under the
    // $11,900 the old one did, and repairs ride the same curve.
    const sep = ccOperatingDetail(16, 2026, 9);
    const variable = CC_SUPPLY_ANNUAL_PER_PROP * CC_SUPPLY_SEASON[8] * 16;
    assert.ok(Math.abs(sep.supplies + sep.repairs - variable) < 1e-6);
    assert.ok(Math.abs(sep.repairs / variable - CC_REPAIRS_SHARE) < 1e-9);
    assert.ok(variable < 7000, `September 2026 variable card spend projects ${variable.toFixed(0)}`);
  });

  test('a slider home pays it in its start month and never again', () => {
    const one = calcYear(1, 2026);
    const start = NEW_ORDER_2026[0];
    for (const m of one.monthly) {
      assert.equal(m.exp_onboard_new, m.month === start ? ONBOARDING_COST : 0, `2026-${m.month}`);
      assert.equal(m.exp_onboard_presigned, 0);
    }
    // Rolled into 2027 it is a full-year home that was outfitted last year.
    const rolled = calcYear(0, 2027, undefined, undefined, undefined, undefined, 1);
    assert.ok(rolled.monthly.every((m) => m.exp_onboard_new === 0 && m.exp_onboard_presigned === 0));
    // And the row foots: the charge is inside exp_total.
    const july = one.monthly[start - 1];
    const sum =
      july.exp_office + july.exp_software + july.exp_debt + july.exp_insurance + july.exp_accounting +
      july.exp_bank + july.exp_cc_ops + july.exp_contractors + july.exp_payroll +
      july.exp_onboard_presigned + july.exp_onboard_new;
    assert.ok(Math.abs(sum - july.exp_total) < 1e-6);
  });
});

describe('the second Furnished Finder listing', () => {
  test('renews in August and September, nowhere else', () => {
    for (let m = 1; m <= 12; m++) {
      assert.equal(listingCost(m), m === 8 || m === 9 ? CC_LISTING_ANNUAL : 0, `month ${m}`);
    }
    assert.ok(ccOperatingDetail(16, 2027, 9).marketing > ccOperatingDetail(16, 2027, 10).marketing);
  });
});

describe('the listing shoot is part of onboarding', () => {
  test('one shoot per new home, inside the start-month charge', () => {
    assert.equal(ONBOARDING_PHOTO_COST, 400);
    assert.equal(ONBOARDING_COST, ONBOARDING_OUTFIT_COST + ONBOARDING_PHOTO_COST);
    // Nothing recurs with the month: the bench from November 2026 is the
    // misc blend alone, in every year.
    assert.equal(contractorCost(2026, 11, 16, SEASON.CA[10]), 250);
    assert.equal(contractorCost(2028, 6, 24, SEASON.CA[5]), 250);
  });
});

describe('a month the operating export has not reached', () => {
  // September 2026 as it first arrived: the card's Lightshed shoots ($757)
  // on the Onboarding line, nothing on the bench, Cooper absent because the
  // operating export stops before the month.
  const cardOnly = {
    month: '2026-09', revenue: 40000,
    exp_office: 471, exp_software: 2952, exp_debt: 0, exp_insurance: 0, exp_accounting: 0, exp_bank: 0,
    exp_cc_ops: 5503, exp_contractors: 0, exp_payroll: 0, exp_onboard_presigned: 0, exp_onboard_new: 757,
    cc_detail: { supplies: 2892, repairs: 1037, vehicle_insurance: 518.56, travel_other: 365.47, marketing: 577, telecom: 112.97 },
    operating_covered: false,
  };

  test('projects rent, the operating bench, Cooper, payroll and bank fees; keeps the card as measured', () => {
    const acts = [] as (typeof cardOnly)[];
    acts[8] = cardOnly;
    const r = calcYear(0, 2026, acts, 9);
    const sep = r.monthly[8];
    assert.equal(sep.is_actual, true);
    assert.equal(sep.actual_card_only, true);
    assert.equal(sep.exp_office, 471 + rentCost(2026, 9, OFFICE_START_MONTH));
    assert.equal(rentCost(2026, 9, OFFICE_START_MONTH), OFFICE_RENT_MONTHLY);
    const n = sep.active_count;
    const wantBench = contractorCost(2026, 9, n, SEASON.CA[8]);
    assert.ok(Math.abs(sep.exp_contractors - wantBench) < 1e-6, `${sep.exp_contractors} vs ${wantBench}`);
    assert.equal(sep.exp_payroll, payrollCost(2026, 9));
    assert.equal(sep.exp_bank, BANK_FEES_MONTHLY);
    assert.equal(sep.exp_software, 2952);
    assert.equal(sep.exp_onboard_new, 757, 'the measured shoots stay on the Onboarding line');
    // Cooper is paid from the operating account, so his projected term is
    // added to the measured card marketing, in the bucket and in the total.
    const creative = creativeCost(2026, 9, n);
    assert.ok(creative > 0);
    assert.ok(Math.abs(sep.exp_cc_ops - (5503 + creative)) < 1e-6, `${sep.exp_cc_ops} vs ${5503 + creative}`);
    assert.ok(sep.cc_detail);
    assert.ok(Math.abs(sep.cc_detail.marketing - (577 + creative)) < 1e-6);
    assert.deepEqual({ ...sep.cc_detail, marketing: 577 }, cardOnly.cc_detail, 'every other bucket is the card as measured');
    const sum =
      sep.exp_office + sep.exp_software + sep.exp_debt + sep.exp_insurance + sep.exp_accounting +
      sep.exp_bank + sep.exp_cc_ops + sep.exp_contractors + sep.exp_payroll +
      sep.exp_onboard_presigned + sep.exp_onboard_new;
    assert.ok(Math.abs(sum - sep.exp_total) < 1e-6);
    assert.ok(Math.abs(sep.net_business - (40000 - sep.exp_total)) < 1e-6);
  });

  test('a covered month, flagged or not, reads its operating lines as given', () => {
    const acts = [] as (typeof cardOnly)[];
    acts[7] = { ...cardOnly, month: '2026-08', exp_office: 1221, exp_contractors: 11188, operating_covered: true };
    const { operating_covered: _dropped, ...unflagged } = { ...cardOnly, month: '2026-07', exp_office: 750, exp_contractors: 4890 };
    void _dropped;
    acts[6] = unflagged as typeof cardOnly;
    const r = calcYear(0, 2026, acts, 8);
    assert.equal(r.monthly[7].actual_card_only, false);
    assert.equal(r.monthly[7].exp_office, 1221);
    assert.equal(r.monthly[7].exp_contractors, 11188);
    assert.equal(r.monthly[7].exp_cc_ops, 5503, 'a covered month reads Cooper from the bank, never the model');
    assert.deepEqual(r.monthly[7].cc_detail, cardOnly.cc_detail);
    assert.equal(r.monthly[6].actual_card_only, false);
    assert.equal(r.monthly[6].exp_office, 750);
    assert.equal(r.monthly[6].exp_contractors, 4890);
    assert.equal(r.monthly[9].actual_card_only, false, 'a projected month is never card-only');
  });
});
