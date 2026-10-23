// Paid payment links in the Revenue page and the forecast (2026-10-22).
//
// Dotti: "do the payment links feed through money estimates" -> they did not.
// Brian Nugent paid $900 + tax for two more nights at 17 Beach on 10/22 and
// October did not move; the nights he paid for read as a calendar block.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  extensionNightCount,
  foldAddOnsIntoForecast,
  foldPaidAddOns,
  isStayPrincipalLink,
  preTaxCents,
  reservationIdFor,
  statementMonthWithAddOns,
  toPaidAddOn,
  type ForecastCell,
  type PaidAddOn,
  type PaidLinkRow,
} from '../paid-addons-core.ts';
import { resolveManagementFee } from '../revenue-statement-fee.ts';

const read = (repoPath: string): string => readFileSync(new URL(`../../../${repoPath}`, import.meta.url), 'utf8');

const BRIAN: PaidLinkRow = {
  request_key: 'addon:6acb6f1c1715d4c48e01a3c0:extended-stay-2-nights:90000',
  label: 'Extended stay (2 nights)',
  property_id: '17_beach_rd',
  amount_cents: 100530,
  base_cents: 90000,
  tax_cents: 10530,
  paid_at: '2026-10-22T20:54:22+00:00',
  reservation_id: null,
};
const BRIAN_STAY = { checkIn: '2026-10-18', checkOut: '2026-10-25', channel: 'Airbnb' };

function addOn(over: Partial<PaidAddOn> = {}): PaidAddOn {
  return {
    requestKey: 'k',
    propertyId: '17_beach_rd',
    label: 'Extended stay (2 nights)',
    revenue: 900,
    month: '2026-10',
    recognizedOn: '2026-10-25',
    channel: 'Airbnb',
    extensionDates: ['2026-10-25', '2026-10-26'],
    ...over,
  };
}

const OCTOBER = {
  basis: 'checkout' as const,
  rangeStart: '2026-10-01',
  periodEndExclusive: '2026-11-01',
  propStart: '2026-10-01',
  activatedAt: null,
  bookedDates: new Set<string>(),
  heldDates: new Set(['2026-10-25', '2026-10-26']),
  heldFrom: '2026-10-01',
  heldTo: '2026-10-31',
};

describe('which paid links count, and for how much', () => {
  test('a far-future deposit or balance is stay principal, never an add-on', () => {
    assert.equal(isStayPrincipalLink('ffdeposit:abc'), true);
    assert.equal(isStayPrincipalLink('ffbalcharge:abc'), true);
    assert.equal(isStayPrincipalLink('addon:6acb6f1c1715d4c48e01a3c0:pet-fee:20000'), false);
    assert.equal(toPaidAddOn({ ...BRIAN, request_key: 'ffdeposit:x' }, BRIAN_STAY), null);
  });

  test('the stay comes from the column, else from the concierge key', () => {
    assert.equal(reservationIdFor(BRIAN), '6acb6f1c1715d4c48e01a3c0');
    assert.equal(reservationIdFor({ ...BRIAN, reservation_id: 'res-direct' }), 'res-direct');
    assert.equal(reservationIdFor({ request_key: 'helm:abc', reservation_id: null }), null);
  });

  test('the pre-tax amount: base when stamped, amount less tax on older links', () => {
    assert.equal(preTaxCents(BRIAN), 90000);
    assert.equal(preTaxCents({ base_cents: null, amount_cents: 46000, tax_cents: 0 }), 46000);
    assert.equal(preTaxCents({ base_cents: null, amount_cents: 22940, tax_cents: 2940 }), 20000);
  });

  test('extension nights read off every label on file, never guessed', () => {
    const cases: Array<[string, number]> = [
      ['Extended stay (2 nights)', 2],
      ['Extra night', 1],
      ['1 extra night (Fri Aug 29) - 225 Washington', 1],
      ['Extended night stay', 1],
      ['Extra nights extension', 0], // a count it does not state
      ['Extension fee', 0],
      ['Pet fee', 0],
      ['Boat docking fee', 0],
      ['Late checkout fee', 0],
      ['pet fee for both dogs', 0],
    ];
    for (const [label, n] of cases) assert.equal(extensionNightCount(label), n, label);
  });

  test('unpaid, zero and propertyless links do not count', () => {
    assert.equal(toPaidAddOn({ ...BRIAN, paid_at: null }, BRIAN_STAY), null);
    assert.equal(toPaidAddOn({ ...BRIAN, base_cents: 0, amount_cents: 0, tax_cents: 0 }, BRIAN_STAY), null);
    assert.equal(toPaidAddOn({ ...BRIAN, property_id: null }, BRIAN_STAY), null);
  });
});

describe('the month a paid link lands in is the statement\'s month', () => {
  test('Brian: October, on his checkout, with the two nights he bought', () => {
    const a = toPaidAddOn(BRIAN, BRIAN_STAY)!;
    assert.equal(a.revenue, 900);
    assert.equal(a.month, '2026-10');
    assert.equal(a.recognizedOn, '2026-10-25');
    assert.deepEqual(a.extensionDates, ['2026-10-25', '2026-10-26']);
    assert.equal(a.channel, 'Airbnb');
  });

  test('a pet fee paid in September for a November stay belongs to November', () => {
    const a = toPaidAddOn(
      { ...BRIAN, label: 'Pet fee', base_cents: 20000, paid_at: '2026-09-04T15:00:00Z' },
      { checkIn: '2026-11-20', checkOut: '2026-11-27', channel: 'VRBO' },
    )!;
    assert.equal(a.month, '2026-11');
    assert.equal(a.recognizedOn, '2026-11-27');
    assert.deepEqual(a.extensionDates, []);
  });

  test('a charge after checkout stays in the month it was paid', () => {
    const a = toPaidAddOn(
      { ...BRIAN, label: 'Damage', base_cents: 15000, paid_at: '2026-11-03T15:00:00Z' },
      BRIAN_STAY,
    )!;
    assert.equal(a.month, '2026-11');
    assert.equal(a.recognizedOn, '2026-11-03');
  });

  test('with no stay on file, the paid month, and no nights', () => {
    const a = toPaidAddOn({ ...BRIAN, request_key: 'helm:x' }, null)!;
    assert.equal(a.month, '2026-10');
    assert.equal(a.recognizedOn, '2026-10-22');
    assert.deepEqual(a.extensionDates, []);
  });
});

describe('the Revenue page', () => {
  test('Brian\'s extension is October revenue and two sold, slept-in nights', () => {
    const f = foldPaidAddOns({ ...OCTOBER, addOns: [addOn()] });
    assert.equal(f.revenue, 900);
    assert.equal(f.nights, 2);
    assert.equal(f.extras, 0);
    assert.deepEqual(f.sleptNights, ['2026-10-25', '2026-10-26']);
    const oct = f.byMonth.get('2026-10')!;
    assert.deepEqual(oct.mix, [{ channel: 'Airbnb', revenue: 900, nights: 2 }]);
  });

  test('a fee is revenue with no nights, so it stays out of ADR', () => {
    const f = foldPaidAddOns({
      ...OCTOBER,
      addOns: [addOn(), addOn({ label: 'Pet fee', revenue: 200, extensionDates: [] })],
    });
    assert.equal(f.revenue, 1100);
    assert.equal(f.nights, 2);
    assert.equal(f.extras, 200);
    // Per month too: the pacing pass prices October's open nights off it.
    assert.equal(f.byMonth.get('2026-10')!.extras, 200);
  });

  test('a night a reservation already holds, or the calendar does not, is never counted twice', () => {
    const booked = foldPaidAddOns({ ...OCTOBER, addOns: [addOn()], bookedDates: new Set(['2026-10-26']) });
    assert.equal(booked.nights, 1);
    assert.deepEqual(booked.sleptNights, ['2026-10-25']);
    // The hold was lifted (the stay itself was extended) or never placed.
    const unheld = foldPaidAddOns({ ...OCTOBER, addOns: [addOn()], heldDates: new Set() });
    assert.equal(unheld.nights, 0);
    assert.equal(unheld.revenue, 900);
    assert.equal(unheld.extras, 900, 'money with no counted nights stays out of ADR');
    assert.deepEqual(unheld.sleptNights, []);
    // Outside the window the calendar was read over, the link is trusted.
    const beyond = foldPaidAddOns({ ...OCTOBER, addOns: [addOn()], heldDates: new Set(), heldTo: '2026-10-24' });
    assert.equal(beyond.nights, 2);
  });

  test('the same window a stay\'s checkout must fall in', () => {
    const onStart = foldPaidAddOns({ ...OCTOBER, addOns: [addOn({ recognizedOn: '2026-10-01', extensionDates: [] })] });
    assert.equal(onStart.revenue, 0);
    const onEnd = foldPaidAddOns({ ...OCTOBER, addOns: [addOn({ recognizedOn: '2026-11-01', month: '2026-11', extensionDates: [] })] });
    assert.equal(onEnd.revenue, 900);
    const preActivation = foldPaidAddOns({ ...OCTOBER, activatedAt: '2026-10-26', addOns: [addOn()] });
    assert.equal(preActivation.revenue, 0);
  });

  test('nights slept count where they fall even when the money is another month\'s', () => {
    const november = foldPaidAddOns({
      ...OCTOBER,
      rangeStart: '2026-11-01',
      periodEndExclusive: '2026-12-01',
      propStart: '2026-11-01',
      heldDates: new Set(['2026-11-01']),
      heldFrom: '2026-11-01',
      heldTo: '2026-11-30',
      addOns: [addOn({ recognizedOn: '2026-10-31', extensionDates: ['2026-10-31', '2026-11-01'] })],
    });
    assert.equal(november.revenue, 0, 'the money is October\'s');
    assert.deepEqual(november.sleptNights, ['2026-11-01']);
  });

  test('on the nights basis the money follows the nights it bought', () => {
    const f = foldPaidAddOns({
      ...OCTOBER,
      basis: 'nights',
      periodEndExclusive: '2026-12-01',
      heldTo: '2026-11-30',
      heldDates: new Set(['2026-10-31', '2026-11-01']),
      addOns: [addOn({ recognizedOn: '2026-10-31', extensionDates: ['2026-10-31', '2026-11-01'] })],
    });
    assert.equal(f.byMonth.get('2026-10')!.revenue, 450);
    assert.equal(f.byMonth.get('2026-11')!.revenue, 450);
    assert.equal(f.nights, 2);
  });
});

describe('a closed month takes the statement\'s add-ons', () => {
  test('the fee is the statement\'s fee, never charged on the add-ons twice', () => {
    // 17 Beach at 22%: $10,000 of stays and $870 of attributed extension
    // (the $900 link, net of its Stripe fee). The statement billed 22% of both.
    const statementFee = 2391.4;
    const m = statementMonthWithAddOns({
      rentalRevenue: 10000, nightsBooked: 20, addOnsRevenue: 870,
      linkRevenue: 900, linkNights: 2, linkExtras: 0,
    });
    assert.equal(m.revenue, 10870);
    assert.equal(m.nights, 22);
    assert.equal(m.feeRevenue, 10870);
    const fee = resolveManagementFee({
      segmentMonths: ['2026-10'], statementMonths: ['2026-10'], pacedMonths: [], bookedMonths: [],
      statementFee, statementRevenue: m.feeRevenue, totalRevenue: m.revenue, mgmtFraction: 0.22,
    });
    assert.equal(fee.fee, statementFee);
    // Reconciling against the stays alone would have billed $191.40 again.
    const doubled = resolveManagementFee({
      segmentMonths: ['2026-10'], statementMonths: ['2026-10'], pacedMonths: [], bookedMonths: [],
      statementFee, statementRevenue: 10000, totalRevenue: m.revenue, mgmtFraction: 0.22,
    });
    assert.ok(Math.abs(doubled.fee - (statementFee + 870 * 0.22)) < 1e-9);
  });

  test('a dismissed add-on buys no nights, and the fee share follows the links', () => {
    const dismissed = statementMonthWithAddOns({
      rentalRevenue: 5000, nightsBooked: 10, addOnsRevenue: 0, linkRevenue: 900, linkNights: 2, linkExtras: 0,
    });
    assert.equal(dismissed.nights, 10);
    assert.equal(dismissed.revenue, 5000);
    const mixed = statementMonthWithAddOns({
      rentalRevenue: 5000, nightsBooked: 10, addOnsRevenue: 1070, linkRevenue: 1100, linkNights: 2, linkExtras: 200,
    });
    assert.ok(Math.abs(mixed.extras - (1070 * 200) / 1100) < 1e-9);
    const unknown = statementMonthWithAddOns({
      rentalRevenue: 5000, nightsBooked: 10, addOnsRevenue: 300, linkRevenue: 0, linkNights: 0, linkExtras: 0,
    });
    assert.equal(unknown.extras, 300, 'add-ons with no link on file are treated as fees');
  });

  test('the page reconciles the fee against the add-ons too', () => {
    const src = read('src/lib/revenue-snapshot.ts');
    assert.match(src, /statementFeeRevenue \+= withAddOns\.feeRevenue;/);
    assert.ok(!/statementFeeRevenue \+= Number\(stmt\.rental_revenue\)/.test(src));
    assert.match(src, /add_ons_revenue, management_fee/);
  });
});

describe('the forecast', () => {
  test('extension nights are booked nights; a fee is set aside so it is never scaled', () => {
    const booked = new Map<string, Map<string, ForecastCell>>([
      ['17_beach_rd', new Map([['2026-10', { nights: 20, revenue: 9000 }]])],
    ]);
    foldAddOnsIntoForecast(
      booked,
      [
        addOn(),
        addOn({ label: 'Pet fee', revenue: 200, extensionDates: [], month: '2026-11', recognizedOn: '2026-11-27' }),
        addOn({ propertyId: 'rt_owned_home' }),
        addOn({ extensionDates: ['2027-03-01'], month: '2027-03' }),
      ],
      new Set(['2026-10', '2026-11']),
      (pid) => pid !== 'rt_owned_home',
    );
    assert.deepEqual(booked.get('17_beach_rd')!.get('2026-10'), { nights: 22, revenue: 9900 });
    assert.deepEqual(booked.get('17_beach_rd')!.get('2026-11'), { nights: 0, revenue: 0, extras: 200 });
    assert.equal(booked.has('rt_owned_home'), false);
    assert.equal(booked.get('17_beach_rd')!.has('2027-03'), false, 'outside the forecast window');
  });

  test('the forecast adds the fee after its projection and its floor', () => {
    const src = read('src/lib/forecast-smart.ts');
    const floor = src.indexOf('if (bookedFloor > projectedGross) projectedGross = bookedFloor;');
    const extras = src.indexOf('projectedGross += extras;');
    assert.ok(floor > 0 && extras > floor, 'extras land after the floor');
    assert.match(src, /bookedRevenue: cell\.revenue \+ extras,/);
    assert.match(src, /foldAddOnsIntoForecast\(/);
  });
});
