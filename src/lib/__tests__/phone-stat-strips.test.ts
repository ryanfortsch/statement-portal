/**
 * Stat strips reflow on a phone (walk of 2026-10-18: the four-up strip on
 * /guests/contacts and the five-up strip on /channels ran off a 375px
 * screen). A strip is an inline `repeat(N, 1fr)` grid; on a phone only the
 * shared `rt-helm-stat-strip` class in globals.css turns it into two
 * columns. Reads each strip's source for the class, and the contact row for
 * its phone layout.
 *
 * Run: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (repoPath: string): string =>
  readFileSync(new URL(`../../../${repoPath}`, import.meta.url), 'utf8');

const STRIPS: Array<[string, number]> = [
  ['src/app/guests/contacts/page.tsx', 1],
  ['src/app/channels/page.tsx', 2],
  ['src/app/channels/[propertyId]/page.tsx', 1],
  ['src/app/channels/[propertyId]/calendar/page.tsx', 1],
  ['src/app/statements/upload/page.tsx', 1],
  ['src/app/competitors/[id]/page.tsx', 1],
  ['src/app/guests/[id]/page.tsx', 1],
  ['src/app/guests/quotes/[id]/page.tsx', 1],
  ['src/app/guests/agreements/[id]/page.tsx', 1],
  ['src/app/guests/campaigns/[id]/page.tsx', 1],
];

test('every operator stat strip carries the shared phone class', () => {
  for (const [path, count] of STRIPS) {
    const found = read(path).split('rt-helm-stat-strip').length - 1;
    assert.ok(found >= count, `${path}: ${found} of ${count} strips carry rt-helm-stat-strip`);
  }
});

test('the class still reflows to two columns on a phone', () => {
  const css = read('src/app/globals.css');
  assert.match(css, /\.rt-helm-stat-strip \{\s*grid-template-columns: repeat\(2, 1fr\) !important;/);
});

test('a contact row leads with the name and keeps the status on a phone', () => {
  const page = read('src/app/guests/contacts/page.tsx');
  for (const cls of ['rt-contact-row', 'rt-contact-who', 'rt-contact-status', 'rt-contact-tags', 'rt-contact-added']) {
    assert.ok(page.includes(cls), `the contact row lost ${cls}`);
  }
  const css = read('src/app/globals.css');
  assert.ok(css.includes('grid-template-areas: "who status" "tags added"'), 'the phone layout for contact rows is gone');
});
