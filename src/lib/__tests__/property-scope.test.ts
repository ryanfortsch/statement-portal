/**
 * The scope gate and the guard that keeps the literal exclusion sets from
 * creeping back into the four files that used to carry them.
 *
 * Run: npm test   (node --test, native TypeScript, no bundler, no database)
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  capeAnnIds,
  helmRunIds,
  isCapeAnnOps,
  isGuestyRun,
  isHelmRun,
  regionLabel,
  SCOPE_COLS,
} from '../property-scope.ts';

describe('isCapeAnnOps', () => {
  test('cape_ann and a missing region both read as Cape Ann ops', () => {
    assert.equal(isCapeAnnOps({ region: 'cape_ann' }), true);
    assert.equal(isCapeAnnOps({ region: null }), true);
    assert.equal(isCapeAnnOps({ region: undefined }), true);
    assert.equal(isCapeAnnOps({}), true);
  });

  test('an out-of-region home is not Cape Ann ops', () => {
    assert.equal(isCapeAnnOps({ region: 'bridgeport_ct' }), false);
    assert.equal(isCapeAnnOps({ region: 'lighthouse_point_fl' }), false);
  });
});

describe('calendar authority', () => {
  test('only an explicit helm reads as Helm-run', () => {
    assert.equal(isHelmRun({ calendar_authority: 'helm' }), true);
    assert.equal(isHelmRun({ calendar_authority: 'guesty' }), false);
    assert.equal(isHelmRun({ calendar_authority: null }), false);
    assert.equal(isHelmRun({}), false);
    assert.equal(isGuestyRun({ calendar_authority: null }), true);
    assert.equal(isGuestyRun({ calendar_authority: 'helm' }), false);
  });
});

describe('id sets', () => {
  const rows = [
    { id: '21_horton', region: 'cape_ann', calendar_authority: 'guesty' },
    { id: '65_calderwood', region: 'bridgeport_ct', calendar_authority: 'helm' },
    { id: '3246_ne_27th', region: 'lighthouse_point_fl', calendar_authority: 'guesty' },
    { id: '7_sumac', region: null, calendar_authority: null },
  ];
  test('capeAnnIds keeps cape_ann and null-region rows', () => {
    assert.deepEqual([...capeAnnIds(rows)].sort(), ['21_horton', '7_sumac']);
  });
  test('helmRunIds keeps only the flipped home', () => {
    assert.deepEqual([...helmRunIds(rows)], ['65_calderwood']);
  });
});

test('regionLabel falls back to the key', () => {
  assert.equal(regionLabel('cape_ann'), 'Cape Ann');
  assert.equal(regionLabel(null), 'Cape Ann');
  assert.equal(regionLabel('somewhere_else'), 'somewhere_else');
});

test('SCOPE_COLS names the columns the gate reads', () => {
  for (const col of ['id', 'region', 'calendar_authority', 'is_active', 'kind']) {
    assert.ok(SCOPE_COLS.includes(col), `SCOPE_COLS is missing ${col}`);
  }
});

// The guard. These files used to hide Ryan's out-of-region homes with a
// literal id set each; the sets drifted and the cleaner digest, Field and
// the turnover rail could disagree about the fleet. The registry column is
// the only gate now. If one of these files grows the literal back, this
// fails before it ships.
describe('no file re-grows a literal exclusion set', () => {
  const root = join(import.meta.dirname, '..', '..');
  const files = [
    'lib/operations.ts',
    'lib/field-packets.ts',
    'lib/checkout-schedule.ts',
    'app/turnovers/page.tsx',
    'app/turnovers/schedule/page.tsx',
    'app/guests/marketing/page.tsx',
    'lib/ai/campaign-context.ts',
    'app/inspections/page.tsx',
    'lib/vendor-schedule.ts',
  ];
  for (const rel of files) {
    test(rel, () => {
      const src = readFileSync(join(root, rel), 'utf8');
      assert.ok(!src.includes("'65_calderwood'"), `${rel} names 65_calderwood by id`);
      assert.ok(!src.includes("'3246_ne_27th'"), `${rel} names 3246_ne_27th by id`);
      assert.ok(!/NON_OPERATIONS_PROPERTY_IDS\s*=/.test(src), `${rel} redefines NON_OPERATIONS_PROPERTY_IDS`);
      assert.ok(!/SCHEDULE_EXCLUDED_PROPERTY_IDS\s*=\s*new Set<string>\(\[/.test(src), `${rel} redefines a populated SCHEDULE_EXCLUDED_PROPERTY_IDS`);
    });
  }
});
