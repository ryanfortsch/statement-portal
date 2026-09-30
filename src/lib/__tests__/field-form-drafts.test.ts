import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFormDraft, clearFormDraft, markFormDraftSubmitted, clearSubmittedFormDraft, formDraftKey } from '../field-form-drafts.ts';
function storage() {
  const data = new Map<string, string>();
  return { getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v); }, removeItem: (k: string) => { data.delete(k); } };
}
const defaults = { note: '', expense: '', shared: false };
test('form drafts isolate actors and jobs and preserve exact text, decimal input and booleans', () => {
  const db = storage(), a = JSON.stringify(['a', 'job-1']);
  const value = { note: 'Line one\nLine two', expense: '27.60', shared: true };
  db.setItem(formDraftKey(a), JSON.stringify(value));
  assert.deepEqual(readFormDraft(db, a, defaults).value, value);
  assert.deepEqual(readFormDraft(db, JSON.stringify(['b', 'job-1']), defaults).value, defaults);
  assert.deepEqual(readFormDraft(db, JSON.stringify(['a', 'job-2']), defaults).value, defaults);
});
test('confirmed save cannot erase a newer draft from another tab', () => {
  const db = storage(), old = JSON.stringify({ ...defaults, note: 'submitted' });
  const newer = JSON.stringify({ ...defaults, note: 'still editing' });
  db.setItem(formDraftKey('job'), newer);
  clearFormDraft(db, 'job', old);
  assert.equal(db.getItem(formDraftKey('job')), newer);
  clearFormDraft(db, 'job', newer);
  assert.equal(db.getItem(formDraftKey('job')), null);
});
test('malformed drafts and unavailable storage cannot masquerade as recovered fields', () => {
  const db = storage();
  for (const invalid of ['{', 'null', '[]', '{}', JSON.stringify({ ...defaults, note: 42 })]) {
    db.setItem(formDraftKey('job'), invalid);
    assert.throws(() => readFormDraft(db, 'job', defaults));
  }
  assert.throws(() => readFormDraft({ ...db, getItem: () => { throw Error('blocked'); } }, 'job', defaults));
});

test('redirect completion clears the submitted draft, preserving edits made after submission', () => {
  const db = storage(), submitted = { ...defaults, note: 'done' }, newer = { ...defaults, note: 'another tab' };
  db.setItem(formDraftKey('job'), JSON.stringify(submitted));
  markFormDraftSubmitted(db, 'job', submitted);
  db.setItem(formDraftKey('job'), JSON.stringify(newer));
  clearSubmittedFormDraft(db, 'job');
  assert.deepEqual(readFormDraft(db, 'job', defaults).value, newer);
  markFormDraftSubmitted(db, 'job', newer);
  clearSubmittedFormDraft(db, 'job');
  assert.equal(db.getItem(formDraftKey('job')), null);
});
