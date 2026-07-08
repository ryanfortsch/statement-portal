/**
 * AI quick-capture for property pages.
 *
 * Operator types or dictates a free-form note ("gate code is 4455, trash
 * goes out Tuesday, downstairs shower runs hot for a minute warn guests")
 * and Claude routes each fragment to one of three destinations:
 *
 *   1. a specific structured column on public.properties (gate_code,
 *      trash_day, wifi_password, ...) — the "appropriate section"
 *   2. a guest-facing property note (the guest-messaging knowledge base)
 *   3. an internal-ops property note (quirks only staff need)
 *
 * Nothing writes automatically. parsePropertyCapture returns a proposal
 * the operator reviews, edits, and approves; the apply step does the
 * writes. This module owns the column catalog (single source of truth
 * for both the prompt and the apply-time coercion) and the parse call.
 */

import { generateObject } from 'ai';
import { z } from 'zod';
import {
  CAPTURE_COLUMNS,
  CAPTURE_COLUMN_KEYS,
  type CaptureItem,
  type CaptureProposal,
} from '@/lib/property-capture-catalog';

// Re-export the catalog surface so existing server imports from this
// module keep working.
export {
  CAPTURE_COLUMNS,
  CAPTURE_COLUMN_KEYS,
  captureColumn,
  type CaptureColumn,
  type CaptureItem,
  type CaptureProposal,
} from '@/lib/property-capture-catalog';

const ItemSchema = z.object({
  target: z.enum(['column', 'note']).describe('column = a structured property field; note = a property-notes entry'),
  column: z.string().nullable().describe('when target=column, the EXACT column key from the catalog (verbatim); otherwise null'),
  value: z.string().nullable().describe('when target=column, the cleaned value to store (just the value, no label); otherwise null'),
  noteTitle: z.string().nullable().describe('when target=note, a short title (<= 80 chars); otherwise null'),
  noteBody: z.string().nullable().describe('when target=note, the detail (1-3 sentences); otherwise null'),
  noteTag: z.string().nullable().describe('when target=note, a one-word lowercase tag (hvac, plumbing, parking, neighbor, vendor, access...) or null'),
  guestFacing: z.boolean().describe('when target=note: true if this is something a GUEST would be told (guest-messaging knowledge); false if it is internal ops knowledge only staff need. For target=column, set false.'),
  sourceText: z.string().describe('the exact fragment of the operator note this item was extracted from'),
  confidence: z.enum(['high', 'medium', 'low']).describe('how confident the routing is'),
});

const ProposalSchema = z.object({
  items: z.array(ItemSchema),
  unrouted: z.string().nullable().describe('any portion of the note that could not be confidently routed anywhere, verbatim; null if everything routed'),
});

function buildSystemPrompt(): string {
  const catalog = CAPTURE_COLUMNS
    .map((c) => `- ${c.key} (${c.section} · ${c.label}, ${c.type})${c.highStakes ? ' [HIGH-STAKES ENTRY FIELD]' : ''}: ${c.hints}`)
    .join('\n');
  const highStakesKeys = CAPTURE_COLUMNS.filter((c) => c.highStakes).map((c) => c.key).join(', ');
  return [
    'You route a property manager\'s free-form note about ONE vacation rental into structured destinations. The manager may have typed it or dictated it (so expect speech-to-text artifacts, run-ons, and filler).',
    'Split the note into discrete facts. Route EACH fact to exactly one destination:',
    '',
    '1. A structured COLUMN, when the fact is a single well-defined property attribute that matches a catalog key below. Put ONLY the value in `value` (e.g. for "gate code is 4455" -> column=gate_code, value="4455"). Never invent a column key; use the catalog keys verbatim.',
    '2. A property NOTE, when the fact is a quirk, instruction, workaround, vendor detail, or anything that does not map cleanly to one column. Give it a short title + body.',
    '',
    'For each NOTE, set guestFacing:',
    '- true  = something a guest would be told or benefit from (a quirk of using the home, a local tip, "the shower runs hot for a minute", "beach is a 4 min walk"). This is the guest-messaging knowledge base.',
    '- false = internal ops only (vendor phone numbers, "owner is picky about the lawn", maintenance history).',
    '',
    'Rules:',
    '- A code/password/number that clearly fits a column goes to the column, not a note.',
    '- One fact = one item. A note like "gate code 4455 and shower runs hot" = TWO items (a gate_code column + a guest note).',
    '- Keep values terse and clean; fix obvious dictation typos in values and notes.',
    '- No em dashes anywhere.',
    '- If a fragment is too vague to route, leave it in `unrouted`.',
    '',
    `HIGH-STAKES ENTRY FIELDS (${highStakesKeys}) need extra care. Downstream tools show these to cleaners and inspectors as THE way to get into the home, so a wrong value sends someone to the wrong entry method.`,
    '- Route a fact to one of these fields ONLY when it is plainly the PRIMARY, current, normal way in.',
    '- If the fact is about a SPARE, backup, extra, secondary, or emergency-only key/lockbox/code, or otherwise hedges that it is not the main way in ("just in case", "if the code fails", "we rarely use it"), it is NOT an entry field. Route it to an internal NOTE (target=note, guestFacing=false), never to a column.',
    '  Example: "we keep a spare emergency lockbox on the parking post" -> internal note titled "Spare emergency lockbox" (NOT key_code_location).',
    '- When you are unsure whether an access mention is the primary method, choose a note and set confidence "low". Never guess a high-stakes field into place.',
    '',
    'CATALOG OF COLUMN KEYS:',
    catalog,
  ].join('\n');
}

function stripEmDashes(s: string): string {
  return s.replace(/\s*—\s*/g, '. ').replace(/\.\s+\./g, '.');
}

/** Parse a raw capture into a reviewable proposal. Validates column keys
 *  against the catalog and demotes any hallucinated column to a note so
 *  a bad key never reaches the apply step. */
export async function parsePropertyCapture(args: {
  rawText: string;
  propertyName: string;
}): Promise<CaptureProposal> {
  const { object } = await generateObject({
    model: 'anthropic/claude-sonnet-4.5',
    schema: ProposalSchema,
    system: buildSystemPrompt(),
    prompt: `Property: ${args.propertyName}\n\nOperator note:\n${args.rawText}`,
  });

  const items: CaptureItem[] = object.items.map((raw) => {
    // Demote unknown/empty column keys to an internal note so a bad key
    // can't slip into the column write path.
    if (raw.target === 'column' && (!raw.column || !CAPTURE_COLUMN_KEYS.has(raw.column))) {
      return {
        target: 'note' as const,
        column: null,
        value: null,
        noteTitle: stripEmDashes((raw.value || raw.sourceText || 'Captured note').slice(0, 80)),
        noteBody: stripEmDashes(raw.value || raw.sourceText || ''),
        noteTag: raw.noteTag,
        guestFacing: false,
        sourceText: raw.sourceText,
        confidence: 'low' as const,
      };
    }
    return {
      target: raw.target,
      column: raw.column,
      value: raw.value ? stripEmDashes(raw.value.trim()) : null,
      noteTitle: raw.noteTitle ? stripEmDashes(raw.noteTitle.trim()) : null,
      noteBody: raw.noteBody ? stripEmDashes(raw.noteBody.trim()) : null,
      noteTag: raw.noteTag ? raw.noteTag.trim().toLowerCase() : null,
      guestFacing: raw.guestFacing,
      sourceText: raw.sourceText,
      confidence: raw.confidence,
    };
  });

  return { items, unrouted: object.unrouted ? object.unrouted.trim() : null };
}
