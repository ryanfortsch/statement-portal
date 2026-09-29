import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeManualSync } from '../manual-sync-result.ts';

const gmail = { ok: true, inserted: 0, scanned: 4, skipped: 4, contacts: 2, mailboxes: ['synthetic'], errors: [] };
const quo = { ok: true, summary: { messages_inserted: 0, calls_inserted: 0, cleaning_completions_inserted: 0, errors: [] } };

describe('manual sync results', () => {
  test('a complete empty Gmail sync reports actual duplicates, not a nonexistent matched count', () => {
    assert.deepEqual(summarizeManualSync('gmail', gmail), { message: 'No new replies (4 scanned, 4 already on file).', warning: false, refresh: false });
  });
  test('new Gmail replies refresh without losing the scanned and already-recorded counts', () => {
    const result = summarizeManualSync('gmail', { ...gmail, scanned: 7, inserted: 3 });
    assert.match(result.message, /3 new replies.*7 scanned, 4 already on file/);
    assert.equal(result.refresh, true); assert.equal(result.warning, false);
  });
  test('Gmail mailbox and message errors cannot be called no new replies', () => {
    for (const inserted of [0, 2]) {
      const result = summarizeManualSync('gmail', { ...gmail, inserted, errors: [{ messageId: 'mailbox:synthetic', error: 'Unavailable' }] });
      assert.equal(result.warning, true); assert.equal(result.refresh, inserted > 0);
      assert.match(result.message, /Gmail sync incomplete/); assert.doesNotMatch(result.message, /No new replies/);
    }
  });
  test('an unconfigured or untargeted Gmail sync says it did not scan', () => {
    for (const patch of [{ mailboxes: [] }, { contacts: 0 }]) {
      const result = summarizeManualSync('gmail', { ...gmail, ...patch });
      assert.equal(result.warning, true); assert.match(result.message, /was not scanned/);
    }
  });
  test('complete empty Quo sync is distinct from an incomplete sync', () => {
    assert.deepEqual(summarizeManualSync('quo', quo), { message: 'No new activity from Quo (last 14 days).', warning: false, refresh: false });
    const result = summarizeManualSync('quo', { ...quo, summary: { ...quo.summary, errors: ['Synthetic phone failed'] } });
    assert.equal(result.warning, true); assert.match(result.message, /sync incomplete/); assert.doesNotMatch(result.message, /No new activity/);
  });
  test('partial Quo captures refresh even when another phone failed', () => {
    const result = summarizeManualSync('quo', { ...quo, summary: { messages_inserted: 2, calls_inserted: 1, cleaning_completions_inserted: 4, errors: ['failed'] } });
    assert.equal(result.warning, true); assert.equal(result.refresh, true); assert.match(result.message, /3 new touches and 4 cleaning signals/);
  });
  test('Quo reports messages, calls, and cleaning-only successes', () => {
    assert.equal(summarizeManualSync('quo', { ...quo, summary: { ...quo.summary, cleaning_completions_inserted: 1 } }).message, 'Captured 1 cleaning signal.');
    assert.equal(summarizeManualSync('quo', { ...quo, summary: { ...quo.summary, calls_inserted: 1 } }).message, 'Captured 1 new touch.');
  });
  test('contact suggestions distinguish generated candidates from saved rows', () => {
    assert.deepEqual(summarizeManualSync('contacts', { ok: true, suggestionsGenerated: 0, inserted: 0 }), { message: 'No new suggestions.', warning: false, refresh: true });
    assert.equal(summarizeManualSync('contacts', { ok: true, suggestionsGenerated: 3, inserted: 3 }).message, '3 suggestions generated.');
    const partial = summarizeManualSync('contacts', { ok: true, suggestionsGenerated: 3, inserted: 1 });
    assert.equal(partial.warning, true); assert.match(partial.message, /1 of 3 suggestions saved/);
  });
  test('missing, malformed, negative, and nonnumeric counts never become a clean zero', () => {
    for (const value of [null, {}, [], { ...gmail, ok: false }, { ...gmail, errors: undefined }, { ...gmail, inserted: '0' }, { ...gmail, scanned: -1 }, { ...gmail, skipped: NaN }, { ...gmail, mailboxes: null }]) {
      assert.throws(() => summarizeManualSync('gmail', value), /Could not confirm/);
    }
    for (const value of [{ ok: true }, { ...quo, summary: { ...quo.summary, errors: null } }, { ...quo, summary: { ...quo.summary, calls_inserted: Infinity } }]) {
      assert.throws(() => summarizeManualSync('quo', value), /Could not confirm/);
    }
    assert.throws(() => summarizeManualSync('contacts', { ok: true, suggestionsGenerated: 2 }), /Could not confirm/);
  });
});
