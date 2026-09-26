import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { formatOperatorNote, noteRenderingIsStale, withOperatorNote } from '../cleaner-note.ts';

// ─── the rendered tail ────────────────────────────────────────────────

test('what goes out is Portuguese and nothing else', () => {
  // The crew speaks Portuguese, so we speak Portuguese to them. The
  // English rendering exists for the operator to check the translation on
  // the card; putting it in the message too is noise on the phone of
  // someone who was never going to read it (Dotti, 2026-09-26).
  const pt = 'Podem fazer 3 Locust, 19 Rackliffe e 225 Washington na segunda-feira.';
  const block = formatOperatorNote(pt);
  assert.equal(block, `AVISO:\n${pt}`);
  assert.ok(!/NOTE/.test(block), 'the heading is Portuguese too');
  assert.ok(!/You can do/.test(block), 'the English must never reach the crew');
});

test('no note means no block at all', () => {
  assert.equal(formatOperatorNote(''), '');
  assert.equal(formatOperatorNote(null), '');
  assert.equal(formatOperatorNote('   '), '');
});

test('the block rides after the schedule, separated by a blank line', () => {
  const body = 'Rising Tide - limpezas\nseg, 28 set / Mon, Sep 28';
  assert.equal(withOperatorNote(body, 'AVISO:\nteste'), `${body}\n\nAVISO:\nteste`);
  assert.equal(withOperatorNote(body, ''), body);
  assert.equal(withOperatorNote(body, null), body);
});

// ─── staleness ────────────────────────────────────────────────────────

test('a rendering derived from other text is stale', () => {
  const fresh = {
    operator_note: 'do 3 Locust on Monday',
    operator_note_pt: 'Podem fazer 3 Locust na segunda-feira.',
    operator_note_en: 'You can do 3 Locust on Monday.',
    operator_note_src: 'do 3 Locust on Monday',
  };
  assert.equal(noteRenderingIsStale(fresh), false);
  // She edited the note after saving: the stored Portuguese is now a
  // translation of a sentence nobody is sending.
  assert.equal(noteRenderingIsStale({ ...fresh, operator_note: 'do 3 Locust on Tuesday' }), true);
  // Never rendered at all.
  assert.equal(noteRenderingIsStale({ ...fresh, operator_note_pt: '', operator_note_src: '' }), true);
  // No note is not a stale note.
  assert.equal(noteRenderingIsStale({ operator_note: '', operator_note_pt: '' }), false);
  assert.equal(noteRenderingIsStale(null), false);
});

// ─── the invariant ────────────────────────────────────────────────────

/** The argument list of every `withOperatorNote(...)` call in a file,
 *  read by balancing parentheses rather than by regex -- a lazy pattern
 *  happily spans two call sites and reports the pair as one clean call,
 *  which is exactly how this guard first passed a deliberate break. */
function withOperatorNoteCalls(src: string): string[] {
  const calls: string[] = [];
  const needle = 'withOperatorNote(';
  let from = 0;
  for (;;) {
    const at = src.indexOf(needle, from);
    if (at === -1) return calls;
    let depth = 0;
    let i = at + needle.length - 1;
    for (; i < src.length; i++) {
      if (src[i] === '(') depth++;
      else if (src[i] === ')' && --depth === 0) break;
    }
    calls.push(src.slice(at + needle.length, i));
    from = i + 1;
  }
}

test('no send path appends the raw typed note', () => {
  // The whole point of this module: the digest body is Portuguese, so the
  // operator's note must be rendered before it is appended. Every call to
  // withOperatorNote has to pass a formatted block -- from resolveNoteBlock
  // on a send path, or formatOperatorNote on a preview -- and never the
  // operator_note column or a raw form field. Breaking this puts an
  // English sentence back on the end of a Portuguese text, silently.
  const sources = ['src/app/turnovers/schedule/actions.ts', 'src/lib/cleaner-digest.ts'];
  let seen = 0;
  for (const path of sources) {
    const src = readFileSync(new URL(`../../../${path}`, import.meta.url), 'utf8');
    const calls = withOperatorNoteCalls(src);
    assert.ok(calls.length > 0, `${path} no longer calls withOperatorNote`);
    for (const call of calls) {
      seen++;
      assert.ok(
        /resolveNoteBlock|formatOperatorNote|noteBlock/.test(call),
        `${path}: withOperatorNote called with an unrendered note: withOperatorNote(${call})`,
      );
    }
  }
  assert.equal(seen, 3, 'a send path was added or removed; check it renders the note');
});
