import { generateObject } from 'ai';
import { z } from 'zod';
import type { ProjectionRow } from '@/lib/projections-types';

/**
 * AI-driven contract redline engine for the Prospects module.
 *
 * Why this exists: owners routinely want to negotiate management-contract
 * terms before signing — "knock the management fee to 22%", "add a 'no
 * weddings' clause", "push the term start back to May 1". Previously the
 * only path was a Word doc round-trip, which (a) lost the brand language
 * of the printed PDF, and (b) split the source of truth across staff
 * laptops. This module replaces that flow.
 *
 * How it works:
 *   1. Staff pastes the owner's email / SMS / call notes into the panel
 *      on /projections/<id>.
 *   2. interpretContractRedlines() sends the current contract state +
 *      the requested edits to Claude via the Vercel AI Gateway. Claude
 *      returns a structured edit set (field changes + clause add/remove
 *      + unsupported requests for human handling).
 *   3. Panel renders a preview ("Min availability days: 180 → 120") with
 *      Apply / Reject buttons.
 *   4. On Apply, the action persists the field changes + clause edits to
 *      the projection record. The PDF is data-driven, so the next time
 *      someone clicks "Open Contract" or "Download Contract" the new
 *      values are baked in.
 *
 * Conservative bias: anything ambiguous — or anything that would touch
 * the hard-coded legal boilerplate (Force Majeure, Liability, Governing
 * Law, etc.) — gets surfaced in `unsupported_requests` rather than
 * silently applied. Staff handles those out of band.
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

const FieldChange = z.object({
  field: z.enum(EDITABLE_FIELDS),
  new_value: z
    .union([z.string(), z.number()])
    .nullable()
    .describe(
      'New value for the field. Dates are YYYY-MM-DD strings. mgmt_fee_pct is a decimal (0.22 for 22%). All other numbers are plain numbers. null means clear the field.',
    ),
  reason: z.string().describe('Why this change is being made, in one short sentence.'),
});

const ClauseAdd = z.object({
  title: z.string().describe('A short title for the clause, sentence case. Example: "No weddings".'),
  body: z
    .string()
    .describe(
      'The clause body in 1-3 sentences. Write in formal contract voice: third-person, no "you / I", future-tense obligations.',
    ),
  reason: z.string().describe('Why this clause is being added, in one short sentence.'),
});

const ClauseEdit = z.object({
  index: z
    .number()
    .int()
    .describe('Zero-based index into projection.custom_clauses to edit.'),
  title: z.string().nullable().describe('New title; null to keep current.'),
  body: z.string().nullable().describe('New body; null to keep current.'),
  reason: z.string(),
});

const ClauseRemove = z.object({
  index: z.number().int().describe('Zero-based index into projection.custom_clauses to remove.'),
  reason: z.string(),
});

export const ContractRedlineEdits = z.object({
  field_changes: z.array(FieldChange),
  clauses_to_add: z.array(ClauseAdd),
  clauses_to_edit: z.array(ClauseEdit),
  clauses_to_remove: z.array(ClauseRemove),
  unsupported_requests: z
    .array(z.string())
    .describe(
      'Anything the owner asked for that does not map to an editable field or clause — e.g. "remove the force majeure section", "change the governing law to New York". These need legal-review handling out of band and should NOT be silently dropped.',
    ),
  summary: z
    .string()
    .describe('1-2 sentence plain-English summary of the changes being proposed.'),
});

export type ContractRedlineEdits = z.infer<typeof ContractRedlineEdits>;

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
    system: `You are processing owner-requested edits to a Rising Tide STR management contract. The contract is a draft heading toward e-signature; the requested edits are the owner's redlines.

Today is ${today}. Your job: map the owner's request to a structured edit set that Rising Tide staff will review before applying to the database. The PDF re-renders automatically once edits are persisted, so accuracy matters.

Editable fields and their units:
- term_start, term_end: YYYY-MM-DD date strings.
- initial_deposit, min_account_balance, reputation_fee: dollar amounts as numbers (no $ sign).
- min_availability_days, sale_notification_days: integers (days).
- mgmt_fee_pct: decimal (0.22 = 22%, not 22).

Custom clauses: an ordered array of {title, body}. You can add, edit, or remove. Bodies should be in formal contract voice — third person, future-tense, no first person.

Hard rules:
- Do not modify the hard-coded legal boilerplate (Liability and Indemnification, Insurance, Force Majeure, Dispute Resolution, Severability, Governing Law, Termination). If the owner asks for changes to those sections, put the request in unsupported_requests so legal can handle out of band.
- Do not invent edits the owner did not ask for. If they say "knock the mgmt fee to 22%", only change mgmt_fee_pct — do not also adjust other terms to "rebalance."
- If a number lacks a unit (e.g. "lower the deposit to 5000" vs "lower the deposit to 5 thousand"), interpret in dollars or days based on the field's type.
- Always populate reason with a one-sentence explanation grounded in the owner's words.`,
    prompt: `CURRENT CONTRACT STATE
======================
Owner: ${ownerName}
Property: ${propertyAddress}

Current terms:
${currentTerms}

Current custom clauses (0-indexed):
${currentClauses || '(none yet)'}


OWNER'S REQUESTED EDITS (raw text):
===================================
${requested}


Produce a structured edit set. If the owner asked for nothing actionable, return empty arrays and surface any blocked requests in unsupported_requests.`,
  });

  return object;
}

/**
 * Apply a previously-interpreted edit set to a projection record. Pure
 * write — does not call the LLM. Returns the new custom_clauses array
 * (helpful for the audit log) and a count of field changes applied.
 */
export function applyEditsToProjection(args: {
  projection: ProjectionRow;
  edits: ContractRedlineEdits;
}): {
  fieldUpdates: Partial<Record<EditableField, string | number | null>>;
  newClauses: ProjectionRow['custom_clauses'];
} {
  const { projection, edits } = args;

  // Build the field updates payload.
  const fieldUpdates: Partial<Record<EditableField, string | number | null>> = {};
  for (const change of edits.field_changes) {
    fieldUpdates[change.field] = coerceFieldValue(change.field, change.new_value);
  }

  // Clauses — start from the current array, apply edits, then add/remove.
  // Order matters: edits first (by current index), then removes (by current
  // index, reverse order so indices stay valid), then adds (appended).
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

/**
 * Coerce the LLM's new_value to the right type for the column. The Zod
 * schema lets the LLM return either string or number; this normalizes.
 */
function coerceFieldValue(
  field: EditableField,
  raw: string | number | null,
): string | number | null {
  if (raw == null) return null;
  const kind = FIELD_DESCRIPTORS[field].kind;
  if (kind === 'date') {
    // Already YYYY-MM-DD per the prompt; pass through.
    return String(raw);
  }
  const n = typeof raw === 'number' ? raw : Number(String(raw).replace(/[^0-9.\-]/g, ''));
  if (!Number.isFinite(n)) return null;
  if (kind === 'integer') return Math.round(n);
  if (kind === 'percent') {
    // Defensive: if the LLM returned 22 instead of 0.22, normalize.
    return n > 1 ? n / 100 : n;
  }
  return n;
}

// ─── Preview formatters (used by the UI) ────────────────────────────────────

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
