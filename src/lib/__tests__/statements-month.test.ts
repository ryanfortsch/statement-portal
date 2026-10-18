/**
 * The statement month is a link.
 *
 * /statements kept the month in React state only, so the home feed card,
 * the nav pill and the upload page's "View Statements" could all point at a
 * month the page was not showing, and "+ New month…" opened the upload
 * page on the current month while both inputs cards defaulted to the
 * previous one. The helper is pure and tested directly; the wiring is read
 * from the source, because a door that drops its month still compiles.
 *
 * Run: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isStatementMonth, previousCalendarMonth, statementsHref, statementsUploadHref } from '../statements-month.ts';

const read = (repoPath: string): string =>
  readFileSync(new URL(`../../../${repoPath}`, import.meta.url), 'utf8');

describe('the month helper', () => {
  test('a statement month is YYYY-MM with a real month', () => {
    assert.equal(isStatementMonth('2026-09'), true);
    assert.equal(isStatementMonth('2026-13'), false);
    assert.equal(isStatementMonth('2026-9'), false);
    assert.equal(isStatementMonth('September'), false);
    assert.equal(isStatementMonth(null), false);
  });

  test('the previous calendar month is read in Eastern time and wraps the year', () => {
    // 1 AM UTC on Oct 1 is still Sept 30 in Gloucester: the close is August's.
    assert.equal(previousCalendarMonth(new Date('2026-10-01T01:00:00Z')), '2026-08');
    assert.equal(previousCalendarMonth(new Date('2026-10-02T15:00:00Z')), '2026-09');
    assert.equal(previousCalendarMonth(new Date('2027-01-03T15:00:00Z')), '2026-12');
  });

  test('links carry the month, and only a real one', () => {
    assert.equal(statementsHref('2026-09'), '/statements?month=2026-09');
    assert.equal(statementsHref(null), '/statements');
    assert.equal(statementsHref('garbage'), '/statements');
    assert.equal(statementsUploadHref('2026-09'), '/statements/upload?month=2026-09');
    assert.equal(statementsUploadHref('2026-09', '21_horton'), '/statements/upload?month=2026-09&property=21_horton');
    assert.equal(statementsUploadHref(null), '/statements/upload');
  });
});

describe('every door names its month', () => {
  const page = read('src/app/statements/page.tsx');

  test('the select writes the URL and the page loads what the URL names', () => {
    assert.match(page, /window\.history\.pushState\(null, '', statementsHref\(e\.target\.value\)\)/, 'the month select no longer writes ?month=');
    assert.match(page, /window\.location\.assign\(statementsUploadHref\(previousCalendarMonth\(\)\)\)/, '"+ New month…" no longer carries the previous calendar month');
    // The live address bar, not the hook snapshot (#1200's flicker).
    assert.match(page, /const live = new URLSearchParams\(window\.location\.search\)\.get\('month'\);/);
    assert.match(page, /\}, \[urlMonth, periods, loadPeriod\]\);/, 'the URL effect no longer re-runs when the URL month changes');
  });

  test('the month is written with the native history API, never an async router navigation', () => {
    // A router.push/replace dispatched while a server action is pending can
    // be undone when a later action finishes with the pre-navigation state;
    // Next's patched pushState/replaceState restore synchronously.
    assert.ok(!/\brouter\.(push|replace)\(/.test(page), 'the page navigates through the router again');
    assert.ok(!page.includes('useRouter'), 'the page holds a router again');
  });

  test('the upload page defaults to the previous calendar month and returns to the month it processed', () => {
    const upload = read('src/app/statements/upload/page.tsx');
    assert.match(upload, /return previousCalendarMonth\(\);/);
    assert.ok(!upload.includes('currentMonthString'), 'the upload page defaults to the current month again');
    assert.match(upload, /<Link href=\{statementsHref\(result\.month\)\}/, '"View Statements" no longer returns to the processed month');
  });

  test('the inputs cards and the upload page share one default', () => {
    for (const card of ['src/components/PlatformCSVUploadCard.tsx', 'src/components/BookingDepositsUploadCard.tsx']) {
      assert.match(read(card), /useState\(defaultMonth \|\| previousCalendarMonth\(\)\)/, `${card} computes its own default month again`);
    }
  });

  test('the feed card, the nav pill and the close board link their month', () => {
    assert.match(read('src/components/ForMeFeed.tsx'), /id: 'queue-statements', href: statementsHref\(period\.month\)/);
    assert.match(read('src/app/api/nav-counts/route.ts'), /statementsReview, statementsReviewMonth \}/);
    assert.match(read('src/components/NavTabCount.tsx'), /statementsHref\(month\)/);
    assert.match(read('src/components/FinancialsTabs.tsx'), /badgeOutside: true, badge: <NavTabCount kind="statementsReview" \/>/,
      'the pill is a link of its own; inside the tab link it would nest one anchor in another');
    assert.match(read('src/app/fieldwork/close/CloseHandoffBoard.tsx'), /<Link href=\{statementsHref\(month\)\}/);
  });
});
