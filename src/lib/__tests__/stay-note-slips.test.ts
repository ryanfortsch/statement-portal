import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stayNoteIsPast } from '../stay-note-slips.ts';

const note = (scheduled_date: string | null, key = 'staycontact:6a8f08d94c9065d58b24e3f7:guest-arrives-6pm') => ({
  from_guest_request_key: key,
  scheduled_date,
});

test("last week's arrival note is off today's packet (3 Locust, 2026-10-06)", () => {
  assert.equal(stayNoteIsPast(note('2026-10-01'), '2026-10-06'), true);
});

test('a stay note still shows on its own day and before it', () => {
  assert.equal(stayNoteIsPast(note('2026-10-06'), '2026-10-06'), false);
  assert.equal(stayNoteIsPast(note('2026-10-07'), '2026-10-06'), false);
});

test('an undated stay note is left alone', () => {
  assert.equal(stayNoteIsPast(note(null), '2026-10-06'), false);
});

test('overdue work from every other rail still shows: gear, repairs, office slips', () => {
  assert.equal(stayNoteIsPast(note('2026-10-01', 'gear:6a8f08d94c9065d58b24e3f7'), '2026-10-06'), false);
  assert.equal(stayNoteIsPast(note('2026-10-01', 'cleaner:approval:abc'), '2026-10-06'), false);
  assert.equal(stayNoteIsPast({ from_guest_request_key: null, scheduled_date: '2026-10-01' }, '2026-10-06'), false);
});

test('the Field packet pool actually applies the rule', () => {
  // Guards the wiring, not just the predicate: deleting the filter (or the
  // column it reads) from loadOpenSlipsForStops must fail here.
  const src = readFileSync(new URL('../field-packets.ts', import.meta.url), 'utf8');
  const fn = src.slice(src.indexOf('export async function loadOpenSlipsForStops'));
  const body = fn.slice(0, fn.indexOf('\n}\n'));
  assert.match(body, /from_guest_request_key/);
  assert.match(body, /!stayNoteIsPast\(w, visitDate\)/);
});
