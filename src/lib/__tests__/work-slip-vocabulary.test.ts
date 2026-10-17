/**
 * One vocabulary for a work slip's category, and one default.
 *
 * The UI/UX audit of 2026-10-17 found one stored column wearing three label
 * sets on one screen (Maintenance / Inventory / Owner / Other / Rising Tide
 * on the create modal and the slip header, Maintenance / Supply / Owner /
 * Office / Other on the same page's Lane chips), and a create modal that
 * defaulted to rising_tide so a plain repair filed from the board sat under
 * Office follow-through until the nightly organize pass moved it.
 *
 * The fix is one list in lib/work-types.ts that every picker renders, the
 * lane words as the labels, and Maintenance as the default everywhere a
 * slip can be filed by hand. Each guard below is a one-line choice in a
 * different file with nothing else holding it in place, so this reads the
 * source and asserts each one is still there.
 *
 * Run: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DEFAULT_WORK_SLIP_CATEGORY,
  WORK_SLIP_CATEGORY_HINTS,
  WORK_SLIP_CATEGORY_LABELS,
  WORK_SLIP_PICKER_CATEGORIES,
} from '../work-types.ts';

const read = (repoPath: string): string => readFileSync(new URL(`../../../${repoPath}`, import.meta.url), 'utf8');

/** The words a person reads: the board's lane headers group by these. */
const LANE_WORDS = ['Maintenance', 'Supply', 'Owner', 'Office', 'Other'];

/** The database names and the dead labels that used to leak into pickers. */
const RETIRED_WORDS = ['Rising Tide', 'Inventory', 'Vendor', 'One-off'];

/** Every surface where a person picks a category by hand. */
const PICKERS = [
  'src/app/work/QueueClient.tsx',
  'src/app/properties/[id]/PropertyAddSlipButton.tsx',
  'src/app/inspections/[id]/Stepper.tsx',
  'src/app/work/[id]/SlipCategoryEditor.tsx',
];

describe('a slip category has one vocabulary', () => {
  test('the picker offers the five lane words, in lane order', () => {
    assert.deepEqual(
      WORK_SLIP_PICKER_CATEGORIES.map((c) => WORK_SLIP_CATEGORY_LABELS[c]),
      LANE_WORDS,
    );
  });

  test('no retired word is a picker label', () => {
    for (const c of WORK_SLIP_PICKER_CATEGORIES) {
      assert.ok(!RETIRED_WORDS.includes(WORK_SLIP_CATEGORY_LABELS[c]), `${c} prints as "${WORK_SLIP_CATEGORY_LABELS[c]}"`);
    }
  });

  test('every picked category carries a printed hint', () => {
    for (const c of WORK_SLIP_PICKER_CATEGORIES) {
      assert.ok(WORK_SLIP_CATEGORY_HINTS[c].trim().length > 0, `${c} has no hint`);
    }
  });

  test('every picker renders the shared list, not its own options', () => {
    for (const path of PICKERS) {
      const src = read(path);
      assert.ok(src.includes('WORK_SLIP_PICKER_CATEGORIES'), `${path} does not read WORK_SLIP_PICKER_CATEGORIES`);
      assert.ok(
        !/<option value="(maintenance|inventory|owner|vendor|rising_tide|other|ad_hoc)">/.test(src),
        `${path} still hard-codes a category <option>`,
      );
      assert.ok(
        !/Object\.entries\(WORK_SLIP_CATEGORY_LABELS\)/.test(src),
        `${path} iterates the whole label record instead of the picker list (vendor and ad_hoc would be offered)`,
      );
      // A retired word as a whole label: a string literal or a JSX text
      // node. Comments are blanked first; a Field phrase such as the
      // stepper's "One-off job" eyebrow is a different word and passes.
      const code = src.replace(/\/\*[\s\S]*?\*\/|(^|\s)\/\/.*$/gm, '');
      for (const word of RETIRED_WORDS) {
        for (const form of [`'${word}'`, `"${word}"`, `>${word}<`]) {
          assert.ok(!code.includes(form), `${path} prints ${form}`);
        }
      }
    }
  });

  test('the slip page header pill reads the same label record as the chips', () => {
    const page = read('src/app/work/[id]/page.tsx');
    assert.ok(page.includes('WORK_SLIP_CATEGORY_LABELS[slip.category]'), 'the header pill no longer prints WORK_SLIP_CATEGORY_LABELS');
  });
});

describe('a board-filed slip defaults to Maintenance', () => {
  test('the shared default is maintenance', () => {
    assert.equal(DEFAULT_WORK_SLIP_CATEGORY, 'maintenance');
    assert.equal(WORK_SLIP_PICKER_CATEGORIES[0], 'maintenance');
  });

  test('the server falls back to maintenance', () => {
    assert.match(read('src/app/work/actions.ts'), /category: args\.category \?\? 'maintenance'/);
  });

  test('neither create modal overrides the server default', () => {
    for (const path of ['src/app/work/QueueClient.tsx', 'src/app/properties/[id]/PropertyAddSlipButton.tsx']) {
      const src = read(path);
      assert.ok(
        src.includes('useState<WorkSlipCategory>(DEFAULT_WORK_SLIP_CATEGORY)'),
        `${path} does not start its category on DEFAULT_WORK_SLIP_CATEGORY`,
      );
      assert.ok(!src.includes("useState<WorkSlipCategory>('rising_tide')"), `${path} still defaults to rising_tide`);
      assert.ok(!src.includes("setCategory('rising_tide')"), `${path} still resets to rising_tide`);
    }
  });

  test('the inspection stepper files a Maintenance slip by default', () => {
    assert.ok(read('src/app/inspections/[id]/Stepper.tsx').includes("category: 'maintenance' as WorkSlipCategory"));
  });
});
