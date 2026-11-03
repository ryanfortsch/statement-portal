/**
 * Contracts that may end: the prospects pipeline in reverse.
 *
 * A home carries the chance its contract ends and the first month it would
 * be gone (properties.contract_end_pct / contract_end_month). From that month
 * the forecast's "Contracts that may end" row takes that share of the home's
 * projected fee off revenue, and the card and the bench scale on the share
 * expected to stay. Before the month, and with no chance entered, nothing
 * moves: a forecast with no endings is the forecast it was.
 *
 * Run: npm test   (node --test, native TypeScript, no bundler, no database)
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  defaultEndingMonth,
  endingsForYear,
  endingsFromRows,
  keepFn,
  keepShare,
  monthChoices,
  parseEnding,
  type ContractEnding,
} from '../forecast-contract-endings.ts';
import { calcYear, SEASON, type ManagedProperty } from '../forecast-model.ts';
import type { SmartForecast } from '../forecast-smart.ts';

const read = (repoPath: string): string => readFileSync(new URL(`../../../${repoPath}`, import.meta.url), 'utf8');

const ROCKY: ContractEnding = { propertyId: '73_rocky_neck', pct: 50, fromMonth: '2027-01' };
const GRANITE: ContractEnding = { propertyId: '36_granite', pct: 70, fromMonth: '2027-07' };

function smartFor(year: number, fees: Record<string, number>): SmartForecast {
  const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
  return {
    months,
    monthInputs: [],
    properties: Object.entries(fees).map(([id, fee]) => ({
      property: { id, name: id, mgmtFeePct: 25, isRtOwned: false, activatedAt: null, sharesInventoryWith: null },
      monthly: months.map((month) => ({
        month,
        bookedNights: 0,
        bookedRevenue: 0,
        projectedGross: fee * 4,
        projectedMgmtFee: fee,
        operating: true,
      })),
      totals: { bookedRevenue: 0, projectedGross: fee * 48, projectedMgmtFee: fee * 12 },
      annualGross: fee * 48,
      offSeasonFactor: 1,
      offSeasonMonth: null,
      annualBasis: 'pacing' as const,
    })),
    totals: { bookedRevenue: 0, projectedGross: 0, projectedMgmtFee: 0 },
  };
}

describe('reading a chance as typed', () => {
  test('a chance and a month save', () => {
    assert.deepEqual(parseEnding('50', '2027-01'), { ok: true, pct: 50, month: '2027-01' });
    assert.deepEqual(parseEnding(' 70% ', '2027-07'), { ok: true, pct: 70, month: '2027-07' });
    assert.deepEqual(parseEnding(33.4, '2028-12'), { ok: true, pct: 33, month: '2028-12' });
  });

  test('blank or zero clears the home, whatever the month says', () => {
    assert.deepEqual(parseEnding('', '2027-01'), { ok: true, pct: null, month: null });
    assert.deepEqual(parseEnding(null, null), { ok: true, pct: null, month: null });
    assert.deepEqual(parseEnding('0', 'nonsense'), { ok: true, pct: null, month: null });
  });

  test('out of range, a missing month or one past the forecast is refused', () => {
    assert.equal(parseEnding('101', '2027-01').ok, false);
    assert.equal(parseEnding('-5', '2027-01').ok, false);
    assert.equal(parseEnding('half', '2027-01').ok, false);
    assert.equal(parseEnding('50', '').ok, false);
    assert.equal(parseEnding('50', '2027-13').ok, false);
    assert.equal(parseEnding('50', '2029-01').ok, false);
  });

  test('registry rows that do not read cleanly are dropped, not guessed', () => {
    const rows = [
      { id: '73_rocky_neck', contract_end_pct: 50, contract_end_month: '2027-01' },
      { id: 'half_entered', contract_end_pct: 40, contract_end_month: null },
      { id: 'none', contract_end_pct: null, contract_end_month: null },
    ];
    assert.deepEqual(endingsFromRows(rows), [ROCKY]);
  });
});

describe('the share a home is expected to stay', () => {
  test('whole before its month, the remaining share from it on', () => {
    assert.equal(keepShare([ROCKY], '73_rocky_neck', '2026-12'), 1);
    assert.equal(keepShare([ROCKY], '73_rocky_neck', '2027-01'), 0.5);
    assert.equal(keepShare([ROCKY], '73_rocky_neck', '2028-08'), 0.5);
    assert.ok(Math.abs(keepShare([GRANITE], '36_granite', '2027-07') - 0.3) < 1e-9);
    assert.equal(keepShare([ROCKY], '21_horton', '2027-07'), 1, 'a home with no chance entered stays');
  });

  test('keepFn answers in calcYear terms', () => {
    const keep = keepFn([ROCKY, GRANITE]);
    assert.equal(keep('73_rocky_neck', 2027, 1), 0.5);
    assert.equal(keep('36_granite', 2027, 6), 1);
    assert.ok(Math.abs(keep('36_granite', 2027, 7) - 0.3) < 1e-9);
    assert.equal(keep('3_south_st', 2028, 3), 1);
  });
});

describe('the year\'s expected loss off the smart forecast', () => {
  const smart = smartFor(2027, { '73_rocky_neck': 2000, '36_granite': 1000, '21_horton': 3000 });

  test('each home from its own month, times its own chance', () => {
    const y = endingsForYear(smart, [ROCKY, GRANITE], 2027);
    const rocky = y.rows.find((r) => r.propertyId === '73_rocky_neck')!;
    const granite = y.rows.find((r) => r.propertyId === '36_granite')!;
    assert.equal(rocky.ifStays, 24000);
    assert.equal(rocky.expectedLoss, 12000);
    assert.equal(granite.ifStays, 6000, 'July to December only');
    assert.ok(Math.abs(granite.expectedLoss - 4200) < 1e-6);
    assert.equal(y.lossByMonth[0], 1000, 'January: only 73 Rocky Neck');
    assert.ok(Math.abs(y.lossByMonth[6] - 1700) < 1e-6, 'July: both');
    assert.ok(Math.abs(y.totalLoss - 16200) < 1e-6);
    assert.equal(y.count, 2);
  });

  test('a year before every month loses nothing and counts no one', () => {
    const y = endingsForYear(smartFor(2026, { '73_rocky_neck': 2000 }), [ROCKY], 2026);
    assert.equal(y.totalLoss, 0);
    assert.equal(y.count, 0);
    assert.equal(y.rows.length, 1, 'still listed, so it can be edited from any year');
  });

  test('no smart feed lists the homes with no loss', () => {
    const y = endingsForYear(null, [ROCKY], 2027, new Map([['73_rocky_neck', '73 Rocky Neck']]));
    assert.equal(y.rows[0].name, '73 Rocky Neck');
    assert.equal(y.totalLoss, 0);
  });
});

describe('calcYear carries it as one revenue line and an expected cost count', () => {
  const roster: ManagedProperty[] = [
    { id: '73_rocky_neck', name: '73 Rocky Neck', fee: 28000, type: 'CA', start: 1 },
    { id: '21_horton', name: '21 Horton', fee: 30000, type: 'CA', start: 1 },
  ];
  const smartMonthly = new Map(Array.from({ length: 12 }, (_, i) => [i + 1, 5000] as [number, number]));
  const loss = Array(12).fill(1000);
  const run = (endings?: Parameters<typeof calcYear>[12]) =>
    calcYear(0, 2027, undefined, undefined, smartMonthly, undefined, 0, undefined, undefined, undefined, undefined, roster, endings);

  test('no endings is the forecast it was', () => {
    const before = run();
    const empty = run({ keep: () => 1 });
    assert.deepEqual(before.monthly.map((r) => r.rev_ending), Array(12).fill(0));
    assert.equal(empty.totals.rev_total, before.totals.rev_total);
    assert.equal(empty.totals.exp_total, before.totals.exp_total);
  });

  test('the smart months take the loss as given and the total nets it', () => {
    const r = run({ lossByMonth: loss, keep: keepFn([ROCKY]) });
    assert.equal(r.monthly[0].rev_ending, -1000);
    assert.equal(r.monthly[0].rev_current, 5000, 'the Properties row stays what the homes earn if they stay');
    assert.equal(r.monthly[0].rev_total, 4000);
    assert.equal(r.totals.rev_ending, -12000);
  });

  test('a home half expected to leave costs half', () => {
    const base = run();
    const half = run({ lossByMonth: loss, keep: keepFn([ROCKY]) });
    const gone = run({ lossByMonth: loss, keep: keepFn([{ ...ROCKY, pct: 100 }]) });
    const saved = base.totals.exp_total - half.totals.exp_total;
    assert.ok(saved > 0, 'the card and the bench scale down');
    assert.ok(Math.abs((base.totals.exp_total - gone.totals.exp_total) - 2 * saved) < 1e-6, 'linear in the chance');
    assert.equal(half.monthly[0].active_count, base.monthly[0].active_count, 'the roster count is still whole homes');
  });

  test('a month smart cannot supply takes the loss from the roster on the seasonal curve', () => {
    const r = calcYear(0, 2027, undefined, undefined, undefined, undefined, 0, undefined, undefined, undefined, undefined, roster, { keep: keepFn([ROCKY]) });
    assert.ok(Math.abs(r.monthly[6].rev_ending - -(28000 * SEASON.CA[6] * 0.5)) < 1e-6);
  });

  test('a reconciled statement month carries no loss', () => {
    const stmt = new Map([[3, 9000]]);
    const r = calcYear(0, 2027, undefined, undefined, smartMonthly, undefined, 0, undefined, stmt, undefined, undefined, roster, { lossByMonth: loss, keep: keepFn([ROCKY]) });
    assert.equal(r.monthly[2].rev_ending, 0);
    assert.equal(r.monthly[2].rev_total, 9000);
  });
});

describe('the picker and the writer', () => {
  test('months run from next month to the end of the forecast', () => {
    const months = monthChoices(new Date(2026, 10, 3));
    assert.equal(months[0], '2026-12');
    assert.equal(months[months.length - 1], '2028-12');
    assert.equal(months.length, 25);
    assert.equal(defaultEndingMonth(new Date(2026, 10, 3)), '2027-01');
  });

  test('the save is owners only and goes through parseEnding', () => {
    const actions = read('src/app/forecast/actions.ts');
    assert.match(actions, /await requireOwnerEmail\(\)/);
    assert.match(actions, /parseEnding\(pctRaw, monthRaw\)/);
  });

  test('the loss is in the revenue total', () => {
    assert.match(read('src/lib/forecast-model.ts'), /const rev_total = rev_current \+ rev_presigned \+ rev_new \+ rev_ending;/);
  });
});
