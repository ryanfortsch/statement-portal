import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { SupabaseClient } from '@supabase/supabase-js';
import { formatOperatorNote, noteRenderingIsStale, resolveNoteBlocks, withOperatorNote } from '../cleaner-note.ts';

// ─── the rendered tail ────────────────────────────────────────────────

const PT = 'Podem fazer 3 Locust, 19 Rackliffe e 225 Washington na segunda-feira.';
const EN = 'You can do 3 Locust, 19 Rackliffe and 225 Washington on Monday.';

test('the crew gets the note in Portuguese and nothing else', () => {
  // "they speak portuguese so we speak to them in portuguese. it's helpful
  // for me internally but i dont need the english version on the final
  // comms that go to them" (Dotti, 2026-09-26). The English is the
  // operator's check on the card, never part of the crew's text.
  const block = formatOperatorNote({ pt: PT, en: EN }, 'pt');
  assert.equal(block, `AVISO:\n${PT}`);
  assert.ok(!block.includes(EN), 'the English sentence must never reach a Portuguese text');
  assert.ok(!/NOTE|\(/.test(block), 'no English heading and no parenthesised translation');
});

test('a recipient marked English gets the English and nothing else', () => {
  const block = formatOperatorNote({ pt: PT, en: EN }, 'en');
  assert.equal(block, `NOTE:\n${EN}`);
  assert.ok(!block.includes(PT) && !block.includes('AVISO'), 'one language per text, either way');
});

test('an untranslated note prints as typed, once', () => {
  // The model was unreachable, so pt and en are both the operator's own
  // words. Each text carries them once.
  const raw = 'Leve toalhas extras para 3 Locust';
  assert.equal(formatOperatorNote({ pt: raw, en: raw }, 'pt'), `AVISO:\n${raw}`);
  assert.equal(formatOperatorNote({ pt: raw, en: raw }, 'en'), `NOTE:\n${raw}`);
});

test('an English recipient with no stored English still gets the instruction', () => {
  // The instruction is never lost: an older row with no English falls
  // back to the Portuguese rather than to nothing.
  assert.equal(formatOperatorNote({ pt: PT, en: '' }, 'en'), `NOTE:\n${PT}`);
  assert.equal(formatOperatorNote({ pt: PT, en: null }, 'en'), `NOTE:\n${PT}`);
});

test('no note means no block at all', () => {
  for (const language of ['pt', 'en'] as const) {
    assert.equal(formatOperatorNote({ pt: '', en: '' }, language), '');
    assert.equal(formatOperatorNote(null, language), '');
    assert.equal(formatOperatorNote({ pt: '   ', en: 'something' }, language), '');
  }
});

test('the block rides after the schedule, separated by a blank line', () => {
  const body = 'Rising Tide - limpezas\nseg, 28 set / Mon, Sep 28';
  assert.equal(withOperatorNote(body, 'AVISO:\nteste'), `${body}\n\nAVISO:\nteste`);
  assert.equal(withOperatorNote(body, ''), body);
  assert.equal(withOperatorNote(body, null), body);
});

test('the send path hands back one block per language, neither carrying the other', async () => {
  // resolveNoteBlocks is what every send appends from (the composed send,
  // the update, the evening autosend, the edited-body approve). A stored,
  // fresh rendering is read back with no model call.
  const row = {
    operator_note: 'do 3 Locust, 19 Rackliffe, 225 Washington on Monday',
    operator_note_pt: PT,
    operator_note_en: EN,
    operator_note_src: 'do 3 Locust, 19 Rackliffe, 225 Washington on Monday',
  };
  const supabase = {
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row }) }) }) }),
  } as unknown as SupabaseClient;
  const blocks = await resolveNoteBlocks(supabase, 'digest-1');
  assert.equal(blocks.pt, `AVISO:\n${PT}`);
  assert.equal(blocks.en, `NOTE:\n${EN}`);
  assert.ok(!blocks.pt.includes(EN), 'the Portuguese text carries no English');
  assert.ok(!blocks.en.includes(PT), 'the English text carries no Portuguese');
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
  // withOperatorNote has to pass a formatted block -- from resolveNoteBlocks
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
        /resolveNoteBlocks|formatOperatorNote|noteBlocks/.test(call),
        `${path}: withOperatorNote called with an unrendered note: withOperatorNote(${call})`,
      );
    }
  }
  // Two since the per-region digest (PMS branch): sendDigest renders the
  // note for every composed send (manual, update and the evening autosend),
  // and the approve action for an edited, verbatim body.
  assert.equal(seen, 2, 'a send path was added or removed; check it renders the note');
});

test('each send picks the note in its own text\'s language', () => {
  // The composed send writes one text per recipient in that recipient's
  // language; its note has to be the block for the same language, or a
  // Portuguese text ends in English (or the reverse). The edited-body
  // approve sends the Portuguese draft as one text to everyone, so its
  // note is the Portuguese block.
  const digest = readFileSync(new URL('../../../src/lib/cleaner-digest.ts', import.meta.url), 'utf8');
  const [composed] = withOperatorNoteCalls(digest);
  assert.ok(/noteBlocks\?\.\[language\]$/.test(composed.trim()), `sendDigest: withOperatorNote(${composed})`);
  const actions = readFileSync(new URL('../../../src/app/turnovers/schedule/actions.ts', import.meta.url), 'utf8');
  const [verbatim] = withOperatorNoteCalls(actions);
  assert.equal(verbatim.trim(), 'body, noteBlocks.pt');
});
