/**
 * Facts opens readable, in one vocabulary (UI/UX audit 2026-10-17, Properties,
 * Phase 3).
 *
 * The same fifty columns used to be grouped three ways: the Facts tab, the
 * edit form ("03 Utilities", "07 Inspection & safety") and the capture review
 * chip ("Utilities · Wi-Fi password"). And the fact sheet was a fold of folds
 * whose inline editor mounted only on blanks. This reads the source and holds
 * all three to the Facts names, and the sheet to plain lists that edit in
 * place.
 *
 * Run: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CAPTURE_COLUMNS } from '../property-capture-catalog.ts';

const read = (repoPath: string): string =>
  readFileSync(new URL(`../../../${repoPath}`, import.meta.url), 'utf8');

const page = read('src/app/properties/[id]/page.tsx');
const edit = read('src/app/properties/[id]/edit/page.tsx');

/** [title, editAnchor] for every fact sheet group. */
const factGroups = [...page.matchAll(/\{ title: '([^']+)', rows: \w+, editAnchor: '([a-z-]+)' \}/g)].map((m) => [m[1], m[2]] as const);
/** title by id for every edit form group. */
const editGroups = new Map([...edit.matchAll(/<Group eyebrow="\d+" id="([a-z-]+)" title="([^"]+)">/g)].map((m) => [m[1], m[2]]));

test('the fact sheet has its seven groups', () => {
  assert.deepEqual(
    factGroups.map(([t]) => t),
    ['Entry and credentials', 'Connectivity', 'House and systems', 'Trash, parking and civic', 'Safety and permits', 'Emergency contact', 'Listing'],
  );
});

test('every fact sheet group is an edit form group of the same name, at its anchor', () => {
  for (const [title, anchor] of factGroups) {
    assert.equal(editGroups.get(anchor), title, `edit#${anchor} should be titled "${title}"`);
  }
  // Owner, House policy and Billing are the form's only other groups.
  const others = [...editGroups.values()].filter((t) => !factGroups.some(([f]) => f === t));
  assert.deepEqual(others.sort(), ['Billing', 'House policy', 'Owner']);
});

test('the anchors other pages link to still land', () => {
  for (const id of ['owner', 'access', 'utilities', 'specs', 'str', 'safety', 'emergency', 'billing', 'policy-group', 'wifi', 'arrival', 'trash', 'parking', 'permit', 'times', 'policy', 'bank', 'cleaning']) {
    assert.match(edit, new RegExp(`id="${id}"`), `edit#${id} no longer exists`);
  }
});

test('the capture chip speaks the same group names', () => {
  const allowed = new Set([...factGroups.map(([t]) => t), 'Owner']);
  for (const c of CAPTURE_COLUMNS) {
    assert.ok(allowed.has(c.section), `${c.key} is filed under "${c.section}"`);
  }
});

test('the fact sheet is plain lists that edit in place, blank or not', () => {
  assert.doesNotMatch(page, /CollapsibleSubSection/, 'the fact sheet is folded again');
  assert.match(page, /<FactSheet p=\{p\}/);
  // The inline editor gets the value on file, so a populated row corrects.
  assert.match(page, /current=\{has \? String\(r\.value\) : null\}/);
  assert.match(read('src/app/properties/[id]/InlineField.tsx'), /current\?: string \| null/);
});
