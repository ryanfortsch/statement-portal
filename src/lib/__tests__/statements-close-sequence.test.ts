/**
 * The close on /statements reads top to bottom as one sequence.
 *
 * Per-property work used to live in two zones: the expanded card in the
 * middle of the page, and a close-out row ten cards below it holding that
 * home's email template, Preview and the four ticks. This reads the source,
 * the way statement-unmark-sent.test.ts does, because what has to stay put
 * is WHERE a control renders: moving it back compiles cleanly.
 *
 * Run: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (repoPath: string): string =>
  readFileSync(new URL(`../../../${repoPath}`, import.meta.url), 'utf8');

const page = read('src/app/statements/page.tsx');

/** The source of one top-level function, up to the next top-level declaration. */
function fn(name: string): string {
  const start = page.indexOf(`\nfunction ${name}(`);
  assert.ok(start >= 0, `not found: function ${name}`);
  const next = page.slice(start + 1).search(/\n(function |const |export |type |\/\* ─)/);
  return page.slice(start, next < 0 ? undefined : start + 1 + next);
}

describe('one property is one place', () => {
  const card = fn('PropertyCard');
  const dashboard = fn('DashboardContent');
  const panel = dashboard.slice(dashboard.indexOf('CLOSE-OUT PANEL'));

  test('the card carries the Send section with every close-out control', () => {
    assert.match(card, /id=\{`stmt-\$\{prop\.property_id\}-send`\}/, 'the Send section lost its anchor');
    for (const control of ['aria-label="Email template"', 'label="Drafted"', 'label="Statement sent"', 'label="Owner paid"', 'label="Mgmt swept"', '>\n                Preview\n']) {
      assert.ok(card.includes(control), `the card's Send section is missing ${control.trim()}`);
    }
  });

  test('the bottom panel keeps only the month-level controls', () => {
    assert.ok(panel.length > 0, 'the close-out panel is gone');
    assert.ok(!/props\.map\(/.test(panel), 'the close-out panel lists one row per property again');
    for (const kept of ['type="date"', 'Remittance', 'Transfer List', 'Booking.com', 'Finalize Month']) {
      assert.ok(panel.includes(kept), `the close-out panel lost ${kept}`);
    }
    for (const moved of ['label="Drafted"', 'label="Owner paid"', 'Touch-base']) {
      assert.ok(!panel.includes(moved), `${moved} is back in the bottom panel`);
    }
  });
});
