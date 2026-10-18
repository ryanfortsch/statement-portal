/**
 * A card action on /statements refreshes that card in place.
 *
 * The page loads its data client-side through server actions. Every card
 * action used to call loadPeriod, which set a page-wide loading flag and
 * replaced the whole page, masthead and month select included, with a
 * spinner while ten queries per statement ran again. When the tree came
 * back, every card opened by hand was closed and the operator was at the
 * top of a twenty-card page. This reads the source, the way
 * statement-unmark-sent.test.ts does, because what has to stay put is which
 * function a callback calls: losing it compiles cleanly and looks like it
 * works on a month with one statement.
 *
 * Run: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (repoPath: string): string =>
  readFileSync(new URL(`../../../${repoPath}`, import.meta.url), 'utf8');

/** One block of source: from the line holding `opener` to its closing brace at the same indent. */
function block(src: string, opener: string): string {
  const start = src.indexOf(opener);
  assert.ok(start >= 0, `not found: ${opener}`);
  const lineStart = src.lastIndexOf('\n', start) + 1;
  const indent = /^ */.exec(src.slice(lineStart, start))![0];
  const end = src.indexOf(`\n${indent}}`, start);
  assert.ok(end > start, `no closing brace for: ${opener}`);
  return src.slice(start, end);
}

describe('a card action re-reads one statement', () => {
  const page = read('src/app/statements/page.tsx');
  const actions = read('src/app/statements/actions.ts');

  test('the card refresh goes through refreshStatement, never the month load', () => {
    assert.match(
      page,
      /onRefresh=\{\(\) => \{ void refreshStatement\(prop\.id, prop\.property_name\); \}\}/,
      'PropertyCard.onRefresh no longer refreshes only its own statement',
    );
    assert.doesNotMatch(page, /onRefresh=\{\(\) => loadPeriod\(/, 'a card action reloads the whole month again');
  });

  test('refreshStatement replaces one statement and sets no page-wide loading state', () => {
    const fn = block(page, 'const refreshStatement = useCallback(');
    assert.ok(fn.includes('loadStatementData('), 'refreshStatement no longer reads the one statement');
    assert.ok(fn.includes('p.id === statementId ? fresh : p'), 'refreshStatement no longer swaps only the touched statement');
    for (const swap of ['setSwitchingMonth(', 'setInitialLoading(', 'setPeriod(null']) {
      assert.ok(!fn.includes(swap), `refreshStatement calls ${swap}, which blanks the page`);
    }
  });

  test('no full-page spinner on a refresh: the month load is quiet for the month on screen', () => {
    assert.ok(!/\bsetLoading\(/.test(page), 'a page-wide loading flag is back');
    const load = block(page, 'const loadPeriod = useCallback(');
    assert.match(load, /const quiet = !!opts\.quiet && shownMonthRef\.current === month;/);
    // Syncs, Check sent emails and Finalize refresh the month they ran on.
    const quietCalls = page.match(/loadPeriod\(selectedMonth, \{ quiet: true \}\)/g) || [];
    assert.ok(quietCalls.length >= 5, `expected the syncs, the email check and Finalize to reload quietly (found ${quietCalls.length})`);
    assert.doesNotMatch(page, /await loadPeriod\(selectedMonth\);/, 'a same-month reload blanks the page again');
  });

  test('the masthead and the month select render in the loading and error states', () => {
    const frameAt = page.indexOf('const frame = (');
    const gateAt = page.indexOf('if (loadError || initialLoading || switchingMonth || !period) {');
    assert.ok(frameAt >= 0 && gateAt > frameAt, 'the frame must be built before the loading/error gate');
    const gate = block(page, 'if (loadError || initialLoading || switchingMonth || !period) {');
    assert.ok(gate.includes('{frame}'), 'the loading/error state no longer keeps the masthead');
    assert.ok(/>\s*Retry\s*</.test(gate), 'the error state has no Retry');
  });

  test('a failed secondary read is a notice, not a dead page', () => {
    assert.ok(block(page, 'const reloadCloseState = useCallback(').includes('setCloseStateError('));
    assert.ok(block(page, 'const loadOwnerCfg = useCallback(').includes('setOwnerCfgError(true)'));
    // Unknown ticks must not read as "nothing drafted": Draft All waits.
    assert.match(page, /onClick=\{draftAll\}\s*disabled=\{[^}]*!!closeStateError\}/);
  });

  test('the month load and the one-statement load share one enrichment', () => {
    assert.ok(block(actions, 'export async function loadPeriodData(').includes('enrichStatement('));
    assert.ok(block(actions, 'export async function loadStatementData(').includes('enrichStatement('));
    // A failed close-state read is an error, never an empty list of ticks.
    assert.match(block(actions, 'export async function loadCloseState('), /error: tasksErr\?\.message/);
  });
});
