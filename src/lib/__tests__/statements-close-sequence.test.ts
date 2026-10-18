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

describe('the close strip is the sequence', () => {
  const dashboard = fn('DashboardContent');
  const card = fn('PropertyCard');
  const strip = dashboard.slice(dashboard.indexOf('THE CLOSE, IN ORDER'), dashboard.indexOf('MONTHLY INPUTS'));

  test('five fixed steps, in order', () => {
    const labels = [...strip.matchAll(/label: '([^']+)',\n\s+done:/g)].map(m => m[1]);
    assert.deepEqual(labels, ['Inputs on file', 'Synced', 'Reviewed', 'Drafted', 'Sent']);
  });

  test('ready to draft is its own count, not done', () => {
    assert.match(strip, /const readyToDraft = props\.filter\(p => !drafted\(p\) && inputsOk\(p\) && syncedOk\(p\) && reviewedOk\(p\)\);/);
    assert.ok(strip.includes('ready to draft'), 'the Drafted step no longer says how many are ready');
  });

  test('Open lands on the bank rows with the queue unfolded, not just the card', () => {
    assert.match(strip, /bankRows\(p\) > 0 \? 'bank'/, 'Reviewed no longer lands on the bank section first');
    assert.match(card, /if \(focusSection === 'bank'\) setBankOpenToken\(focusToken\);/);
    assert.match(card, /openToken=\{bankOpenToken\}/, 'the card no longer unfolds its bank queue');
    for (const section of ['sources', 'drift', 'recon', 'bank', 'flags', 'send']) {
      assert.ok(card.includes(`stmt-\${prop.property_id}-${section}`), `the card lost its ${section} anchor`);
    }
    const review = read('src/components/BankDepositReview.tsx');
    assert.match(review, /useState\(openToken > 0\)/, 'the queue mounts folded even when the strip asked it open');
  });

  test('the duplicate status line, the Performance block and the tile captions are gone', () => {
    assert.ok(!/of \{props\.length\} drafted/.test(dashboard), 'the status line under the tiles is back');
    assert.ok(!card.includes('title="Performance"'), 'the Performance block is back');
    for (const tile of ['Properties', 'Stays', 'Revenue', 'Mgmt Fees', 'Cleaning', 'Owner Payouts']) {
      const line = dashboard.split('\n').find(l => l.includes(`<Insight label="${tile}"`));
      assert.ok(line, `the ${tile} tile is gone`);
      assert.ok(!line.includes('sub='), `the ${tile} tile has its caption back`);
    }
  });
});
