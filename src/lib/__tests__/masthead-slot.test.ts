/**
 * The masthead's slot (the /statements period select) never sits beside the
 * full module nav (walk of 2026-10-18: "HelmWORK" with no divider on a
 * narrow desktop, the select running into the wordmark on a phone). Reads
 * the masthead and globals.css for the pieces that keep them apart.
 *
 * Run: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (repoPath: string): string =>
  readFileSync(new URL(`../../../${repoPath}`, import.meta.url), 'utf8');

test('the slot is its own masthead item, and the wordmark never shrinks', () => {
  const src = read('src/components/HelmMasthead.tsx');
  assert.ok(src.includes('<div className="rt-masthead-slot">{rightContent}</div>'), 'the slot lost its wrapper');
  assert.ok(src.includes('rt-masthead-top flex flex-wrap'), 'the masthead row no longer wraps');
  assert.ok(src.includes("textDecoration: 'none', flexShrink: 0"), 'the wordmark link can shrink again');
  assert.ok(src.includes("background: 'var(--rule)', flexShrink: 0"), 'the divider can shrink again');
});

test('the slot takes its own line beside the full nav and on a phone', () => {
  const css = read('src/app/globals.css');
  assert.ok(css.includes('.rt-masthead-slot { order: 3; flex: 1 0 100%;'), 'the slot no longer drops to its own line');
  assert.ok(css.includes('.rt-masthead-slot { order: 0; flex: 0 0 auto; }'), 'the slot no longer sits inline where Menu replaces the nav');
});
