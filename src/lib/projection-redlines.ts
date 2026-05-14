import { generateObject } from 'ai';
import { z } from 'zod';
import type { ProjectionRow } from '@/lib/projections-types';

/**
 * AI-driven contract redline engine for the Prospects module.
 *
 * Operating philosophy (per 36 Granite St / Bethany Giblin retro, May 2026):
 *   The tool drafts a candidate for every change implied by the owner's
 *   input. Sensitivity is a review-priority flag on the change, NOT a
 *   reason to skip. Owners get one document with everything in it,
 *   marked draft, that staff + counsel review together.
 *
 * That means: do not produce an "unsupported / out-of-band" output.
 * If the owner's request touches the hard-coded legal sections
 * (Liability, Force Majeure, Governing Law, Dispute Resolution,
 * Severability) — Claude drafts a Rider clause that captures the spirit
 * of the request, sets sensitiveSection: true + reviewPriority: 'high',
 * and the preview surfaces those at the top under an "Attorney review
 * recommended" header.
 *
 * Each change carries a three-field rationale instead of a single
 * conflated reason:
 *   ownerAsk        — what the owner asked for (verbatim or paraphrase)
 *   ourPosition     — accept / accept-with-modification / counter / hold / restructure
 *   positionDetail  — plain-language explanation of our response
 *
 * This shape is what feeds the summary view ("accepted X, countered Y,
 * held Z") and, eventually, the cover letter back to the owner.
 *
 * Note on scope (May 2026): the contract is still mostly hard-coded in
 * ContractDocument.tsx, so today's applyEditsToProjection can persist:
 *   - field changes on the projection record
 *   - add/edit/remove on custom_clauses (the Rider page)
 * A separate PR (contract-overrides infra) will enable modify/replace/
 * rename/delete on hard-coded sections. Until then, sensitive-section
 * requests land as flagged Rider clauses.
 */

/** Fields on the projection record that the engine is allowed to mutate. */
const EDITABLE_FIELDS = [
  'term_start',
  'term_end',
  'initial_deposit',
  'min_account_balance',
  'min_availability_days',
  'sale_notification_days',
  'reputation_fee',
  'mgmt_fee_pct',
] as const;
export type EditableField = (typeof EDITABLE_FIELDS)[number];

/** Human-readable label + unit hint for the preview UI + the LLM prompt. */
export const FIELD_DESCRIPTORS: Record<
  EditableField,
  { label: string; kind: 'date' | 'money' | 'integer' | 'percent' }
> = {
  term_start: { label: 'Term start date', kind: 'date' },
  term_end: { label: 'Term end date', kind: 'date' },
  initial_deposit: { label: 'Initial deposit', kind: 'money' },
  min_account_balance: { label: 'Minimum account balance', kind: 'money' },
  min_availability_days: { label: 'Minimum availability (days)', kind: 'integer' },
  sale_notification_days: { label: 'Sale notification (days)', kind: 'integer' },
  reputation_fee: { label: 'Reputation damages fee', kind: 'money' },
  mgmt_fee_pct: { label: 'Management fee (%)', kind: 'percent' },
};

const POSITIONS = ['accept', 'accept-with-modification', 'counter', 'hold', 'restructure'] as const;
export type RedlinePosition = (typeof POSITIONS)[number];

export const POSITION_LABELS: Record<RedlinePosition, string> = {
  accept: 'Accept',
  'accept-with-modification': 'Accept w/ mod',
  counter: 'Counter',
  hold: 'Hold',
  restructure: 'Restructure',
};

/** Shared three-field rationale + sensitivity metadata on every change. */
const RichMetaShape = {
  ownerAsk: z
    .string()
    .describe(
      "What the owner asked for, verbatim or close paraphrase. NOT our response — the request itself.",
    ),
  ourPosition: z
    .enum(POSITIONS)
    .describe(
      "Our response: 'accept' (yes as asked); 'accept-with-modification' (close to what they asked, with a small tweak); 'counter' (different value/text we're proposing back); 'hold' (no change — we kept the original term); 'restructure' (substantively different approach to the same intent).",
    ),
  positionDetail: z
    .string()
    .describe(
      "Plain-language explanation of our response. For 'accept': brief 'going along with the request.' For 'counter' / 'hold' / 'restructure': the business reason and what we're proposing instead. For 'accept-with-modification': what the tweak is and why.",
    ),
  reviewPriority: z
    .enum(['normal', 'high'])
    .describe(
      "'high' when the change touches a sensitive section (Liability, Force Majeure, Governing Law, Dispute Resolution, Severability) or contains sensitive keywords (indemnify, liquidated damages, release, waive, limitation of liability). Otherwise 'normal'.",
    ),
  sensitiveSection: z
    .boolean()
    .describe(
      "True when the change is a Rider clause that effectively modifies the spirit of a hard-coded legal section, OR when it directly involves indemnification, liability limitation, governing law, etc. Forces the change to the top of the preview under 'Attorney review recommended'.",
    ),
};

const FieldChange = z.object({
  field: z.enum(EDITABLE_FIELDS),
  new_value: z
    .union([z.string(), z.number()])
    .nullable()
    .describe(
      'New value for the field. Dates are YYYY-MM-DD strings. mgmt_fee_pct is a decimal (0.22 for 22%). All other numbers are plain numbers.',
    ),
  ...RichMetaShape,
});

const ClauseAdd = z.object({
  title: z.string().describe('Short sentence-case title for the clause.'),
  body: z
    .string()
    .describe(
      'Clause body in formal contract voice — third person, future-tense obligations, no "you / I". 1-3 sentences typical.',
    ),
  ...RichMetaShape,
});

const ClauseEdit = z.object({
  index: z.number().int().describe('Zero-based index into projection.custom_clauses to edit.'),
  title: z.string().nullable().describe('New title; null to keep current.'),
  body: z.string().nullable().describe('New body; null to keep current.'),
  ...RichMetaShape,
});

const ClauseRemove = z.object({
  index: z.number().int().describe('Zero-based index into projection.custom_clauses to remove.'),
  ...RichMetaShape,
});

export const ContractRedlineEdits = z.object({
  field_changes: z.array(FieldChange),
  clauses_to_add: z.array(ClauseAdd),
  clauses_to_edit: z.array(ClauseEdit),
  clauses_to_remove: z.array(ClauseRemove),
  summary: z
    .string()
    .describe(
      'A position-framed 1-3 sentence summary of all proposed changes. Phrase using our positions, NOT the owner\'s requests. Example: "Owner requested 5 changes. Property Manager accepted 2 outright, accepted 1 with modification, countered on 1, and held on 1. Notable hold: 185-day sale notice period."',
    ),
});

export type ContractRedlineEdits = z.infer<typeof ContractRedlineEdits>;
export type FieldChangeT = z.infer<typeof FieldChange>;
export type ClauseAddT = z.infer<typeof ClauseAdd>;
export type ClauseEditT = z.infer<typeof ClauseEdit>;
export type ClauseRemoveT = z.infer<typeof ClauseRemove>;

const SENSITIVE_KEYWORDS = [
  'indemnif',
  'liquidated damages',
  'release',
  'waive',
  'waiver',
  'limitation of liability',
  'force majeure',
  'governing law',
  'arbitration',
  'attorneys\' fees',
  'severability',
];

const SENSITIVE_SECTION_NAMES = [
  'Liability and Indemnification',
  'Insurance & Liability Coverage',
  'Force Majeure',
  "Dispute Resolution & Attorneys' Fees",
  'Severability',
  'Governing Law & Entire Agreement',
];

/**
 * Send the current contract state + the owner's requested edits to Claude
 * and get back a structured edit proposal. Pure read — does NOT mutate
 * the projection record.
 */
export async function interpretContractRedlines(args: {
  projection: ProjectionRow;
  requested: string;
}): Promise<ContractRedlineEdits> {
  const { projection, requested } = args;

  const ownerName = projection.prospect_full_legal || projection.prospect_name || '(unfilled)';
  const propertyAddress =
    `${projection.property_address}${projection.property_city ? `, ${projection.property_city}` : ''}` ||
    '(unfilled)';

  const currentTerms = formatCurrentTerms(projection);
  const currentClauses = formatCurrentClauses(projection);

  const today = new Date().toISOString().slice(0, 10);

  const { object } = await generateObject({
    model: 'anthropic/claude-sonnet-4.5',
    schema: ContractRedlineEdits,
    system: `You are processing owner-requested edits to a Rising Tide STR management contract.

Today is ${today}.

OPERATING PHILOSOPHY
Draft a candidate for EVERY change implied by the owner's input. Do not skip changes because they touch legal boilerplate. The tool's job is to produce one complete draft that staff and counsel review together; partial drafts ("we have some of your changes, others are pending") destroy trust with the owner.

When the owner asks for changes that map cleanly to editable contract fields or to a custom Rider clause, propose them directly.

When the owner asks for changes that would normally require editing hard-coded legal sections (Liability, Force Majeure, Governing Law, Dispute Resolution, Severability, etc.), DO NOT refuse. Draft a Rider clause that captures the spirit of the request. The Rider sits after Sale Protection and overrides / supplements the standard terms when the parties have explicitly agreed. Mark such changes \`sensitiveSection: true\` and \`reviewPriority: 'high'\` so staff sees them at the top of the preview under "Attorney review recommended."

THREE-FIELD RATIONALE
Every change carries:
  ownerAsk        — verbatim or close paraphrase of what the owner asked for
  ourPosition     — accept | accept-with-modification | counter | hold | restructure
  positionDetail  — plain-language explanation of our response

Use 'hold' when we keep the original term unchanged (e.g. owner asked for 90 days, we kept 185). Even on a 'hold' you still emit a change record — the change is "no change," but the ownerAsk + positionDetail document our position. Without this, the audit trail looks like the owner asked for what we proposed.

EDITABLE FIELDS (units)
- term_start, term_end: YYYY-MM-DD
- initial_deposit, min_account_balance, reputation_fee: dollars (plain number)
- min_availability_days, sale_notification_days: integer days
- mgmt_fee_pct: decimal (0.22 = 22%)

CUSTOM CLAUSES
An ordered array of { title, body }. Add / edit / remove freely. Bodies in formal contract voice — third person, future-tense, no first person.

SENSITIVE-SECTION FLAGGING
Mark \`sensitiveSection: true\` AND \`reviewPriority: 'high'\` when the change touches any of:
${SENSITIVE_SECTION_NAMES.map((s) => `  - ${s}`).join('\n')}
…or when its body contains any of these keywords: ${SENSITIVE_KEYWORDS.join(', ')}.

SUMMARY
Frame using OUR positions, not the owner's requests. Example:
  "Owner requested 18 changes. Property Manager accepted 8 outright,
   accepted 4 with modifications, countered on 2, held on 3, and
   restructured 1. Notable holds: the 185-day sale notice period and
   the $5,000 reputation damages fee. Notable restructure: the
   cancellation compensation provision, now tied to 50% of Gross
   Rental Income."

HARD RULES
- Do not invent edits the owner did not ask for, even to "rebalance."
- Always populate ownerAsk grounded in the owner's actual words.
- If the owner is silent on a topic, do not emit a change for it.`,
    prompt: `CURRENT CONTRACT STATE
======================
Owner: ${ownerName}
Property: ${propertyAddress}

Current contract values:
${currentTerms}

Current custom clauses (0-indexed):
${currentClauses || '(none yet)'}


OWNER'S REQUESTED EDITS (raw text):
===================================
${requested}


Produce a structured edit set per the schema, with three-field rationale on every change. Flag sensitive items per the rules above. Write the summary using OUR positions.`,
  });

  return object;
}

/**
 * Apply a previously-interpreted (or precise-mode authored) edit set to a
 * projection record. Pure write — does not call the LLM. Returns the
 * field payload and the new custom_clauses array.
 *
 * Note: the rich metadata (ownerAsk, ourPosition, positionDetail,
 * reviewPriority, sensitiveSection) is informational only — it's
 * displayed in the preview and surfaces in the post-apply confirmation,
 * but it isn't persisted on the projection record itself in this phase.
 * A follow-on PR will add a redline audit log table.
 */
export function applyEditsToProjection(args: {
  projection: ProjectionRow;
  edits: ContractRedlineEdits;
}): {
  fieldUpdates: Partial<Record<EditableField, string | number | null>>;
  newClauses: ProjectionRow['custom_clauses'];
} {
  const { projection, edits } = args;

  const fieldUpdates: Partial<Record<EditableField, string | number | null>> = {};
  for (const change of edits.field_changes) {
    fieldUpdates[change.field] = coerceFieldValue(change.field, change.new_value);
  }

  const current = projection.custom_clauses ?? [];
  let working = current.map((c) => ({ ...c }));

  for (const e of edits.clauses_to_edit) {
    if (e.index >= 0 && e.index < working.length) {
      working[e.index] = {
        title: e.title ?? working[e.index].title,
        body: e.body ?? working[e.index].body,
      };
    }
  }
  const removeIndices = [...edits.clauses_to_remove.map((r) => r.index)].sort((a, b) => b - a);
  for (const idx of removeIndices) {
    if (idx >= 0 && idx < working.length) {
      working = [...working.slice(0, idx), ...working.slice(idx + 1)];
    }
  }
  for (const add of edits.clauses_to_add) {
    working.push({ title: add.title, body: add.body });
  }

  return {
    fieldUpdates,
    newClauses: working.length > 0 ? working : null,
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function formatCurrentTerms(p: ProjectionRow): string {
  const lines: string[] = [];
  for (const field of EDITABLE_FIELDS) {
    const v = (p as unknown as Record<string, unknown>)[field];
    const d = FIELD_DESCRIPTORS[field];
    lines.push(`- ${field} (${d.label}, ${d.kind}): ${formatValueForPrompt(v, d.kind)}`);
  }
  return lines.join('\n');
}

function formatCurrentClauses(p: ProjectionRow): string {
  const cl = p.custom_clauses ?? [];
  if (cl.length === 0) return '';
  return cl
    .map((c, i) => `[${i}] ${c.title}\n    ${c.body.replace(/\n+/g, ' ')}`)
    .join('\n');
}

function formatValueForPrompt(v: unknown, kind: 'date' | 'money' | 'integer' | 'percent'): string {
  if (v == null || v === '') return '(unfilled)';
  if (kind === 'percent' && typeof v === 'number') return `${(v * 100).toFixed(0)}% (${v})`;
  if (kind === 'money' && typeof v === 'number') return `$${v.toLocaleString()}`;
  if (kind === 'integer' && typeof v === 'number') return `${v}`;
  return String(v);
}

function coerceFieldValue(
  field: EditableField,
  raw: string | number | null,
): string | number | null {
  if (raw == null) return null;
  const kind = FIELD_DESCRIPTORS[field].kind;
  if (kind === 'date') return String(raw);
  const n = typeof raw === 'number' ? raw : Number(String(raw).replace(/[^0-9.\-]/g, ''));
  if (!Number.isFinite(n)) return null;
  if (kind === 'integer') return Math.round(n);
  if (kind === 'percent') return n > 1 ? n / 100 : n;
  return n;
}

export function formatFieldValueForPreview(
  field: EditableField,
  value: string | number | null,
): string {
  if (value == null) return '—';
  const kind = FIELD_DESCRIPTORS[field].kind;
  if (kind === 'money' && typeof value === 'number') return `$${value.toLocaleString()}`;
  if (kind === 'percent' && typeof value === 'number') return `${(value * 100).toFixed(0)}%`;
  if (kind === 'integer' && typeof value === 'number') return `${value.toLocaleString()}`;
  return String(value);
}

/**
 * Compute counts by position for the preview pill row.
 */
export function countPositions(edits: ContractRedlineEdits): Record<RedlinePosition, number> {
  const counts: Record<RedlinePosition, number> = {
    accept: 0,
    'accept-with-modification': 0,
    counter: 0,
    hold: 0,
    restructure: 0,
  };
  const allChanges = [
    ...edits.field_changes,
    ...edits.clauses_to_add,
    ...edits.clauses_to_edit,
    ...edits.clauses_to_remove,
  ];
  for (const c of allChanges) counts[c.ourPosition]++;
  return counts;
}
