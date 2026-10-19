/**
 * The owner composers work on a phone (2026-10-17 UI/UX audit).
 *
 * The quote composer, the agreement form and the campaign editor were laid
 * out with fixed inline grids, so on a 375px screen the quote form shared
 * the width with a 340px summary and three-up field rows squeezed to 100px.
 * Each grid now carries a class the phone rules in globals.css collapse.
 * This checks the classes are on the grids and the rules are still there.
 *
 * Run: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../../../', import.meta.url);
const read = (repoPath: string): string => readFileSync(new URL(repoPath, root), 'utf8');

test('the quote composer is one column under 880px, the summary under the form', () => {
  const src = read('src/app/guests/quotes/QuoteComposer.tsx');
  assert.ok(src.includes(`<div className="rt-composer" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 340px'`));
  assert.ok(src.includes('<aside className="rt-composer-aside"'), 'the summary can unpin');
  assert.ok(src.indexOf('<aside') > src.indexOf('<FormBlock title="Property">'), 'the summary follows the form');
});

test('every three-up field row on the quote and agreement forms stacks', () => {
  for (const file of ['src/app/guests/quotes/QuoteComposer.tsx', 'src/app/guests/agreements/AgreementForm.tsx']) {
    const src = read(file);
    const rows = src.match(/style=\{(\{ \.\.\.)?grid3/g) ?? [];
    const classed = src.match(/className="rt-form-grid3" style=\{(\{ \.\.\.)?grid3/g) ?? [];
    assert.ok(rows.length > 0, `${file} has grid3 rows`);
    assert.equal(classed.length, rows.length, `${file}: a grid3 row without rt-form-grid3`);
  }
});

test('the campaign editor stacks above its preview, sized to the screen', () => {
  const src = read('src/app/guests/campaigns/[id]/page.tsx');
  assert.ok(src.includes('<div className="rt-composer"'));
  assert.ok(!src.includes('height: 720,'), 'the preview is not a fixed 720px');
  assert.ok(src.includes("height: 'min(720px, 75svh)'"));
});

test('the phone rules are in globals.css', () => {
  const css = read('src/app/globals.css');
  assert.match(css, /@media \(max-width: 879px\) \{\s*\.rt-composer \{ grid-template-columns: minmax\(0, 1fr\) !important;/);
  assert.match(css, /\.rt-composer-aside \{ position: static !important; \}/);
  assert.match(css, /\.rt-form-grid3,\s*\.rt-form-pair \{ grid-template-columns: minmax\(0, 1fr\) !important; \}/);
});

test('the competitor inventory is a list on a phone, its numbers labelled', () => {
  const inv = read('src/components/competitors/CompetitorInventory.tsx');
  assert.ok(inv.includes('className="rt-comp-head"') && inv.includes('className="rt-comp-row"'));
  for (const label of ['BR', 'BA', 'Sleeps', 'Pets']) {
    assert.ok(inv.includes(`data-label="${label}"`), `the ${label} cell carries its label`);
  }
  const detail = read('src/app/competitors/[id]/page.tsx');
  assert.ok(detail.includes('className="rt-comp-coverage"') && detail.includes('rt-comp-breakdowns'));
  assert.ok(read('src/app/competitors/page.tsx').includes('className="rt-comp-index-row"'));
  const css = read('src/app/globals.css');
  assert.match(css, /\.rt-comp-row \{\s*display: flex !important;/);
  assert.match(css, /\.rt-comp-row > \[data-label\]::before \{\s*content: attr\(data-label\)/);
});
