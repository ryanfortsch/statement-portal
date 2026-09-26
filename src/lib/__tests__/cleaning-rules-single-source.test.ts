/**
 * The cleaning rules stay single-sourced, and CLAUDE.md keeps saying so.
 *
 * CLAUDE.md told readers for a long time that `/api/fill-gap` carried "a
 * second full copy of the cleaning classification pipeline" and "does not
 * implement vendor-credit netting". Both were true once. Both were wrong by
 * 2026-09-26: `classifyBankRow` lives once in bank-charges.ts and both
 * routes call it, and fill-gap imports the shared netting module.
 *
 * A stale instruction is worse than a missing one. This exact failure mode
 * is on record: CLAUDE.md claimed there was no test runner, an agent
 * believed it, and shipped a duplicate test into scripts/ (#1599/#1600).
 * Here it would invite a vendor fix duplicated into a file that already
 * imports the rule, or warn somebody off editing the one place that owns it.
 *
 * So this asserts the code shape the doc describes. If the duplication ever
 * genuinely returns, this fails and whoever reintroduced it has to say so in
 * the doc rather than leaving the next reader to find out.
 *
 * Run: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (repoPath: string): string =>
  readFileSync(new URL(`../../../${repoPath}`, import.meta.url), 'utf8');

const INGEST = 'src/app/api/ingest/route.ts';
const FILL_GAP = 'src/app/api/fill-gap/route.ts';
const RULES = 'src/lib/bank-charges.ts';

describe('cleaning classification is single-sourced', () => {
  test('classifyBankRow is defined exactly once, in bank-charges', () => {
    const defs = [RULES, INGEST, FILL_GAP].filter((f) =>
      /(export )?function classifyBankRow\s*\(/.test(read(f)),
    );
    assert.deepEqual(
      defs,
      [RULES],
      'classifyBankRow is defined somewhere other than bank-charges.ts, so the vendor rules have ' +
        'forked and adding a vendor is no longer a one-file change',
    );
  });

  test('both routes call the shared rule rather than matching vendors themselves', () => {
    for (const f of [INGEST, FILL_GAP]) {
      const src = read(f);
      assert.ok(src.includes('classifyBankRow('), `${f} no longer calls classifyBankRow`);
      // The vendor lists belong to bank-charges. A route reaching for them
      // directly is the shape the old duplication took.
      for (const list of ['const LINEN_VENDORS', 'const LAUNDRY_VENDORS', 'const CLEANING_VENDORS']) {
        assert.ok(!src.includes(list), `${f} declares its own ${list}`);
      }
    }
  });

  test('fill-gap implements vendor-credit netting through the shared module', () => {
    const src = read(FILL_GAP);
    assert.ok(
      src.includes("from '@/lib/vendor-credit-netting'"),
      'fill-gap no longer imports the shared netting module, which is what CLAUDE.md once ' +
        'wrongly said was the case',
    );
    assert.ok(src.includes('netVendorCredits('), 'fill-gap imports the netting module but never nets');
  });

  test('CLAUDE.md does not claim a second copy exists', () => {
    const doc = read('CLAUDE.md');
    assert.ok(
      !/second full copy of the cleaning classification/.test(doc),
      'CLAUDE.md has gone back to claiming fill-gap holds a second copy of the rule',
    );
    assert.ok(
      !/does not implement vendor-credit netting/.test(doc),
      'CLAUDE.md has gone back to claiming fill-gap does not net vendor credits',
    );
  });
});
