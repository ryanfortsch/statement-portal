/**
 * Property Facts after Delaney's walk of 17 Beach (2026-11-10): an oil
 * shutoff, the extinguishers' inspection date, TVs and sofa beds by room,
 * notes with photos, one photo button.
 *
 * Run: npm test
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { captureColumn, parseFactDate } from '../property-capture-catalog.ts';

const read = (repoPath: string) => readFileSync(new URL(`../../../${repoPath}`, import.meta.url), 'utf8');

test('a typed date reads as YYYY-MM-DD; anything else is refused', () => {
  assert.equal(parseFactDate('2026-03-14'), '2026-03-14');
  assert.equal(parseFactDate('3/14/2026'), '2026-03-14');
  assert.equal(parseFactDate('3/14/26'), '2026-03-14');
  assert.equal(parseFactDate(' 2026/3/4 '), '2026-03-04');
  assert.equal(parseFactDate('2/30/2026'), null);
  assert.equal(parseFactDate('March 2026'), null);
  assert.equal(parseFactDate('Samsung Smart TV'), null);
});

test('the new safety facts are editable in place', () => {
  assert.equal(captureColumn('oil_shutoff_location')?.section, 'Safety and permits');
  assert.equal(captureColumn('fire_extinguisher_inspected_on')?.type, 'date');
  const page = read('src/app/properties/[id]/page.tsx');
  assert.match(page, /label: 'Oil shutoff', value: p\.oil_shutoff_location, col: 'oil_shutoff_location'/);
  assert.match(page, /label: 'Extinguishers inspected', value: p\.fire_extinguisher_inspected_on, col: 'fire_extinguisher_inspected_on'/);
  const form = read('src/app/properties/[id]/edit/page.tsx');
  assert.match(form, /name="oil_shutoff_location"/);
  assert.match(form, /name="fire_extinguisher_inspected_on"[\s\S]{0,80}type="date"|type="date"[\s\S]{0,80}defaultValue=\{p\.fire_extinguisher_inspected_on\}/);
  const migration = read('supabase/migrations/20261110200000_property_facts_oil_shutoff_extinguisher_date.sql');
  assert.match(migration, /oil_shutoff_location text/);
  assert.match(migration, /fire_extinguisher_inspected_on date/);
});

test('a sentence typed into a number field says the field takes a number', () => {
  const actions = read('src/app/properties/actions.ts');
  assert.match(actions, /takes a number/);
});

test('TVs and sofa beds are listed by room on the fact sheet', () => {
  const page = read('src/app/properties/[id]/page.tsx');
  assert.match(page, /label: 'TVs by room'/);
  assert.match(page, /label: 'Sofa beds by room'/);
});

test('What we know sits directly under the fact sheet and carries photos', () => {
  const page = read('src/app/properties/[id]/page.tsx');
  const sheet = page.indexOf('<FactSheet p={p}');
  const notes = page.indexOf('title="What we know"');
  const policy = page.indexOf('title="House policy"');
  assert.ok(sheet > 0 && notes > sheet && policy > notes, 'fact sheet, then What we know, then House policy');
  assert.match(read('src/components/properties/NoteEditorForm.tsx'), /<NotePhotosField/);
});

test('one photo button: the phone picker already offers the camera', () => {
  const uploader = read('src/components/PhotoUploader.tsx');
  assert.doesNotMatch(uploader, />Take photo</);
  assert.doesNotMatch(uploader, /capture="environment"/);
});

test('the slip page edits its details', () => {
  const page = read('src/app/work/[id]/page.tsx');
  assert.match(page, /<SlipDetailsEditor/);
  assert.match(read('src/app/work/actions.ts'), /export async function updateWorkSlipDetails/);
});
