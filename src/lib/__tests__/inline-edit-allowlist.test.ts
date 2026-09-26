/**
 * Inline editing writes only what the capture catalog allows.
 *
 * The fact sheet can now fill a blank in place. It does that through
 * applyPropertyCaptureAction, the same server action Quick Capture uses,
 * precisely so there is ONE allowlist, one type coercion and one decision
 * about whether a column lives on `properties` or on the RLS-locked
 * `property_access`. A second writer would have had to get all four right
 * again, and the access upsert's docblock records an incident where column
 * writes were silently dropped.
 *
 * What this guards is the boundary: the columns deliberately kept OUT of the
 * capture catalog are the ones with guarded edit paths, and a click-to-edit
 * control on the busiest tab must never become a side door into them.
 *
 * Run: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CAPTURE_COLUMN_KEYS, captureColumn } from '../property-capture-catalog.ts';

const read = (repoPath: string): string =>
  readFileSync(new URL(`../../../${repoPath}`, import.meta.url), 'utf8');

const PAGE = 'src/app/properties/[id]/page.tsx';

/** Every `col: '...'` the fact sheet attaches to a row. */
function inlineColumns(src: string): string[] {
  return [...src.matchAll(/\bcol: '([a-z_0-9]+)'/g)].map((m) => m[1]);
}

describe('inline editing on the fact sheet', () => {
  test('every inline-editable row names a real catalog column', () => {
    const cols = inlineColumns(read(PAGE));
    assert.ok(cols.length > 0, 'no inline-editable rows at all; did the col: keys get dropped?');
    for (const c of cols) {
      assert.ok(
        CAPTURE_COLUMN_KEYS.has(c),
        `the fact sheet offers inline editing for '${c}', which the capture catalog does not allow. ` +
          'applyPropertyCaptureAction would skip it, so the control would look live and save nothing.',
      );
    }
  });

  test('identity and money columns are not inline-editable', () => {
    // These are excluded from the capture catalog on purpose: too
    // consequential for a one-field control on the busiest tab. Asserted
    // directly rather than trusting the catalog to keep excluding them.
    const guarded = [
      'id',
      'name',
      'address',
      'title',
      'management_fee_pct',
      'owner_emails',
      'owner_full',
      'bank_last4',
      'tax_cert_id',
      'is_active',
      'guesty_listing_id',
    ];
    const cols = new Set(inlineColumns(read(PAGE)));
    for (const g of guarded) {
      assert.ok(!cols.has(g), `'${g}' is inline-editable on the fact sheet; it has a guarded edit path`);
      assert.ok(!CAPTURE_COLUMN_KEYS.has(g), `'${g}' has entered the capture catalog, which opens it to dictation too`);
    }
  });

  test('the inline control routes through the shared action, not its own writer', () => {
    const src = read('src/app/properties/[id]/InlineField.tsx');
    assert.ok(
      src.includes('applyPropertyCaptureAction'),
      'InlineField no longer uses the shared apply action, so it now owns its own allowlist, ' +
        'type coercion and properties-vs-property_access routing',
    );
    for (const banned of ["from('properties')", "from('property_access')", 'getServiceClient']) {
      assert.ok(!src.includes(banned), `InlineField talks to the database directly (${banned})`);
    }
  });

  test('a high-stakes column still warns when edited in place', () => {
    // The capture review UI refuses to auto-apply these. Typing one by hand
    // is a deliberate act so it is allowed, but not silently.
    const entry = inlineColumns(read(PAGE)).filter((c) => captureColumn(c)?.highStakes);
    assert.ok(entry.length > 0, 'no high-stakes columns are inline-editable; this test guards nothing');
    assert.ok(
      read('src/app/properties/[id]/InlineField.tsx').includes('isHighStakesColumn'),
      'InlineField stopped warning on entry fields, which are the instruction a cleaner follows',
    );
  });
});
