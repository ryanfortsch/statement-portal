/**
 * The operator's "Special instructions" line on the cleaner schedule
 * digest: stored as typed, sent in Portuguese.
 *
 * The digest body itself is composed in Portuguese by cleaner-digest.ts,
 * because Rosa and Nina read Portuguese. The operator's note was the one
 * part that escaped that: it was appended verbatim at send time, so
 * "NOTE: YOU CAN DO 3 LOCUST, 19 RACKLIFFE, 225 WASHINGTON on MONDAY"
 * rode out in English, shouted, under an otherwise Portuguese text
 * (Dotti, 2026-09-26).
 *
 * So the note now gets the same treatment every other crew-facing string
 * gets: Portuguese first, English underneath so the operator can check the
 * translation, and both visible on the card BEFORE approval rather than
 * assembled inside the send.
 *
 * Two rules this module exists to hold:
 *
 *   - THE INSTRUCTION IS NEVER LOST. Every failure path falls back to the
 *     operator's own words. A model that is unreachable, slow, or refuses
 *     must degrade to "send it as typed", never to "send nothing".
 *   - NAMES, NUMBERS AND DAYS ARE NOT TRANSLATED. "3 Locust" is a house,
 *     not a phrase. The crew navigates by those strings and a helpfully
 *     localised one is a cleaner sent to the wrong door.
 */

import { generateObject } from 'ai';
import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';

/** Matches the `slice(0, 600)` the note write paths already enforce. */
export const MAX_NOTE_CHARS = 600;

export type RenderedNote = {
  /** What the operator typed, trimmed. The record of what she asked for. */
  raw: string;
  /** Brazilian Portuguese. What the cleaners actually read. */
  pt: string;
  /** Tidied English, printed under the Portuguese as a check. */
  en: string;
  /** False when the model could not be reached and `pt` is just `raw`. */
  translated: boolean;
};

const NoteSchema = z.object({
  pt: z
    .string()
    .describe(
      'The instruction in plain Brazilian Portuguese, addressed to the cleaning crew. Imperative and short.',
    ),
  en: z
    .string()
    .describe('The same instruction in plain English, sentence case. Not a transcript of the input.'),
});

/** An untranslated note: the operator's words standing in for both halves. */
function asTyped(raw: string): RenderedNote {
  return { raw, pt: raw, en: raw, translated: false };
}

/**
 * Turn the operator's typed instruction into the bilingual pair that goes
 * out. Fails soft: any model trouble returns the note as typed, which is
 * exactly what shipped before this module existed.
 */
export async function renderOperatorNote(note: string): Promise<RenderedNote> {
  const raw = (note ?? '').trim().slice(0, MAX_NOTE_CHARS);
  if (!raw) return { raw: '', pt: '', en: '', translated: false };

  try {
    const { object } = await generateObject({
      model: 'anthropic/claude-sonnet-4.5',
      schema: NoteSchema,
      system: `You prepare one short instruction from a vacation-rental operator for the housekeeping crew that cleans her properties in Gloucester, Massachusetts. The crew's first language is Brazilian Portuguese. Your output rides at the end of an SMS that is otherwise already in Portuguese.

Return the SAME instruction twice: once in Brazilian Portuguese (pt), once in plain English (en).

HARD RULES
1. Never change the meaning. Do not add a task, a house, a day, a time or a condition that is not in the input, and never drop one that is.
2. NEVER TRANSLATE OR REFORMAT A PROPERTY NAME. "3 Locust", "19 Rackliffe", "225 Washington", "53 Rocky Neck", "84 Thatcher" are addresses the crew navigates by. Copy them character for character into both languages. Do not translate "Beach", "Rocky Neck", "Horton" or any other street word.
3. Keep every number, date, time and quantity exactly as given.
4. Weekdays and ordinary words DO get translated: "on Monday" becomes "na segunda-feira".
5. Drop a redundant label the operator typed to mark the note as a note ("NOTE:", "NOTA:", "AVISO:", "IMPORTANT:"). The message prints its own heading.
6. Normalise shouting. ALL CAPS input comes back in sentence case, except for a genuine warning word the operator meant to shout, which becomes ATENCAO.
7. Address the crew directly and in the plural ("podem", "deixem", "levem"), the way the rest of the digest does. No greeting, no name, and NO SIGN-OFF: never end with a name, "obrigada", "thanks", "Allie" or "Ryan".
8. One or two sentences. This is a text message, not a memo.
9. If the input is already Portuguese, keep it as pt (tidied) and put the English in en.
10. Plain text only. No markdown, no emoji, no bullet characters.`,
      prompt: `OPERATOR'S INSTRUCTION, as typed:
${raw}

Return it as pt and en.`,
    });

    const pt = (object.pt ?? '').trim();
    const en = (object.en ?? '').trim();
    // A model that returned nothing usable is a model that failed, and the
    // instruction still has to reach the crew.
    if (!pt) return asTyped(raw);
    return { raw, pt, en: en || raw, translated: true };
  } catch {
    return asTyped(raw);
  }
}

/**
 * The block that rides at the end of the digest, after the schedule and
 * before each cleaner's own live-schedule link.
 *
 * Portuguese on its own line, English parenthesised underneath -- the same
 * `pt / en` posture as the digest's own day label, stacked because an
 * instruction is longer than a date. When the two are the same string
 * (nothing was translated), it prints once rather than twice.
 */
export function formatOperatorNote(pt: string | null | undefined, en?: string | null): string {
  const p = (pt ?? '').trim();
  if (!p) return '';
  const e = (en ?? '').trim();
  const head = 'AVISO / NOTE:';
  if (!e || e.toLowerCase() === p.toLowerCase()) return `${head}\n${p}`;
  return `${head}\n${p}\n(${e})`;
}

/**
 * The rendered note rides AFTER the schedule and BEFORE each cleaner's
 * live link, so the schedule can keep recomposing while the instruction
 * survives.
 *
 * `block` is the RENDERED bilingual note from `formatOperatorNote`, never
 * the raw text the operator typed. That distinction is the whole feature:
 * a send path that passes raw text here puts an English sentence back on
 * the end of a Portuguese message, and nothing downstream would notice.
 */
export function withOperatorNote(body: string, block: string | null | undefined): string {
  const n = (block ?? '').trim();
  return n ? `${body}\n\n${n}` : body;
}

/** The stored trio, as the digest row carries it. */
export type StoredNote = {
  operator_note: string;
  operator_note_pt: string;
  operator_note_en: string;
  operator_note_src: string;
};

/** True when the stored rendering was derived from some OTHER text than
 *  the note currently on the row, so it must not be sent. */
export function noteRenderingIsStale(row: Partial<StoredNote> | null | undefined): boolean {
  const note = (row?.operator_note ?? '').trim();
  if (!note) return false;
  if (!(row?.operator_note_pt ?? '').trim()) return true;
  return (row?.operator_note_src ?? '').trim() !== note;
}

/**
 * Persist a note and its rendering together. Every write path goes through
 * here so the three columns can never drift apart: the moment one of them
 * is written alone, the card starts showing a translation of text nobody
 * typed.
 */
export async function saveOperatorNote(
  supabase: SupabaseClient,
  digestId: string,
  note: string,
  /** The row as it stands, when the caller already has it. Lets an
   *  unchanged note skip the model call entirely. */
  existing?: Partial<StoredNote> | null,
): Promise<RenderedNote> {
  const raw = (note ?? '').trim().slice(0, MAX_NOTE_CHARS);

  let rendered: RenderedNote;
  if (!raw) {
    rendered = { raw: '', pt: '', en: '', translated: false };
  } else if (
    existing &&
    (existing.operator_note_src ?? '').trim() === raw &&
    (existing.operator_note_pt ?? '').trim()
  ) {
    rendered = {
      raw,
      pt: (existing.operator_note_pt ?? '').trim(),
      en: (existing.operator_note_en ?? '').trim(),
      translated: true,
    };
  } else {
    rendered = await renderOperatorNote(raw);
  }

  await supabase
    .from('cleaner_schedule_digests')
    .update({
      operator_note: rendered.raw,
      operator_note_pt: rendered.pt,
      operator_note_en: rendered.en,
      // An untranslated note is stamped as unrendered, so the next send (or
      // the next save) tries the model again instead of treating the
      // English fallback as a finished translation.
      operator_note_src: rendered.translated ? rendered.raw : '',
      updated_at: new Date().toISOString(),
    })
    .eq('id', digestId);

  return rendered;
}

/**
 * Read the row's note and hand back the block to append, re-deriving the
 * rendering first if it is missing or stale. Used by every send path,
 * including the unattended 6 PM one where nobody is there to notice that
 * the note never got translated.
 */
export async function resolveNoteBlock(
  supabase: SupabaseClient,
  digestId: string,
  /** The note as submitted by the form, when a form was involved. */
  submitted?: string | null,
): Promise<string> {
  const { data } = await supabase
    .from('cleaner_schedule_digests')
    .select('operator_note, operator_note_pt, operator_note_en, operator_note_src')
    .eq('id', digestId)
    .maybeSingle();
  const row = (data ?? null) as StoredNote | null;

  const note = submitted === undefined || submitted === null
    ? (row?.operator_note ?? '').trim()
    : submitted.trim().slice(0, MAX_NOTE_CHARS);
  if (!note) {
    // The operator cleared the note. Clear the rendering with it, or the
    // next send appends an instruction she deleted.
    if (row && (row.operator_note || row.operator_note_pt)) {
      await saveOperatorNote(supabase, digestId, '', row);
    }
    return '';
  }

  const fresh =
    row &&
    (row.operator_note_src ?? '').trim() === note &&
    (row.operator_note_pt ?? '').trim();
  if (fresh) return formatOperatorNote(row!.operator_note_pt, row!.operator_note_en);

  const rendered = await saveOperatorNote(supabase, digestId, note, row);
  return formatOperatorNote(rendered.pt, rendered.en);
}
