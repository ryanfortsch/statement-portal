/**
 * The quote-side tax fallback matrix, against an injected loader:
 *
 *   config row present            -> its rate, source 'config'
 *   no row, region cape_ann/null  -> owedOccupancyTaxRate, source 'ma_legacy'
 *   no row, any other region      -> TaxJurisdictionUnknownError
 *
 * Run: npm test   (node --test, native TypeScript, no bundler, no database)
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  shapeTaxConfig,
  taxRateForQuote,
  TaxJurisdictionUnknownError,
  type TaxConfigLoader,
  type TaxConfigRow,
} from '../tax-config.ts';

const ct: TaxConfigRow = {
  property_id: '65_calderwood',
  jurisdiction: 'CT',
  state_rate: 0.15,
  local_rate: 0,
  cif_rate: 0,
  applies_to: ['accommodation', 'cleaning'],
  long_stay_exempt_over_nights: 30,
  collected_by_channels: ['airbnb'],
};

const rows = new Map<string, TaxConfigRow>([[ct.property_id, ct]]);
const calls: string[] = [];
const loader: TaxConfigLoader = async (id) => {
  calls.push(id);
  return rows.get(id) ?? null;
};

describe('a config row wins', () => {
  test('Calderwood quotes CT at 15% from its row', async () => {
    const r = await taxRateForQuote('65_calderwood', 'bridgeport_ct', 3, 'direct', { loader });
    assert.deepEqual(r, { rate: 0.15, exempt: false, source: 'config', reason: null, taxes_cleaning: true });
    assert.ok(calls.includes('65_calderwood'), 'the loader was asked');
  });

  test('the row decides exemptions: 31 nights, or a channel that collects', async () => {
    assert.equal((await taxRateForQuote('65_calderwood', 'bridgeport_ct', 31, 'direct', { loader })).exempt, true);
    assert.equal((await taxRateForQuote('65_calderwood', 'bridgeport_ct', 31, 'direct', { loader })).reason, 'long_stay');
    assert.equal((await taxRateForQuote('65_calderwood', 'bridgeport_ct', 30, 'direct', { loader })).exempt, false);
    const airbnb = await taxRateForQuote('65_calderwood', 'bridgeport_ct', 3, 'airbnb', { loader });
    assert.equal(airbnb.exempt, true);
    assert.equal(airbnb.reason, 'collected_by_channel');
    assert.equal(airbnb.rate, 0.15, 'the jurisdiction rate is still reported');
  });

  test('a row on a Cape Ann home also wins over the MA table', async () => {
    const withMaRow: TaxConfigLoader = async () => ({ ...ct, property_id: '17_beach_rd', jurisdiction: 'MA', state_rate: 0.057, local_rate: 0.06, collected_by_channels: [], long_stay_exempt_over_nights: 31 });
    const r = await taxRateForQuote('17_beach_rd', 'cape_ann', 3, 'direct', { loader: withMaRow });
    assert.equal(r.source, 'config');
    assert.equal(r.rate, 0.117);
  });
});

describe('no row', () => {
  test('a cape_ann home falls back to the MA occupancy table, read only', async () => {
    const horton = await taxRateForQuote('21_horton', 'cape_ann', 3, 'direct', { loader });
    assert.deepEqual(horton, { rate: 0.117, exempt: false, source: 'ma_legacy', reason: null, taxes_cleaning: true });
    const main = await taxRateForQuote('79_main', 'cape_ann', 3, 'direct', { loader });
    assert.equal(main.rate, 0.147, '79 Main owes the CIF per occupancy-tax.ts');
    assert.equal(main.source, 'ma_legacy');
  });

  test('a null or missing region reads as Cape Ann, the same way the scope gate does', async () => {
    assert.equal((await taxRateForQuote('21_horton', null, 3, 'direct', { loader })).source, 'ma_legacy');
    assert.equal((await taxRateForQuote('21_horton', undefined, 3, 'direct', { loader })).source, 'ma_legacy');
  });

  test('the MA path carries the SCA 31-night exemption', async () => {
    assert.equal((await taxRateForQuote('21_horton', 'cape_ann', 32, 'direct', { loader })).exempt, true);
    assert.equal((await taxRateForQuote('21_horton', 'cape_ann', 31, 'direct', { loader })).exempt, false);
  });

  test('any other region throws rather than quoting 11.7%', async () => {
    await assert.rejects(
      taxRateForQuote('3246_ne_27th', 'lighthouse_point_fl', 3, 'direct', { loader }),
      (err: unknown) => err instanceof TaxJurisdictionUnknownError && err.propertyId === '3246_ne_27th' && err.region === 'lighthouse_point_fl',
    );
    await assert.rejects(
      taxRateForQuote('no_such_home', 'bridgeport_ct', 3, 'direct', { loader }),
      TaxJurisdictionUnknownError,
    );
  });
});

test('shapeTaxConfig coerces the numeric strings PostgREST returns', () => {
  const shaped = shapeTaxConfig({
    property_id: '65_calderwood',
    jurisdiction: 'CT',
    state_rate: '0.1500',
    local_rate: '0.0000',
    cif_rate: '0.0000',
    applies_to: ['accommodation', 'cleaning'],
    long_stay_exempt_over_nights: 30,
    collected_by_channels: ['airbnb'],
    effective_from: '2026-09-26',
    notes: null,
    updated_by: null,
  });
  assert.equal(shaped.state_rate, 0.15);
  assert.equal(typeof shaped.local_rate, 'number');
  assert.equal(shaped.long_stay_exempt_over_nights, 30);
  assert.deepEqual(shaped.collected_by_channels, ['airbnb']);
  const noOverride = shapeTaxConfig({ property_id: 'x', jurisdiction: 'MA', long_stay_exempt_over_nights: null });
  assert.equal(noOverride.long_stay_exempt_over_nights, null);
  assert.deepEqual(noOverride.applies_to, ['accommodation', 'cleaning'], 'the table default');
});
