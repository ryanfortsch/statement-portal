import { generateObject } from 'ai';
import { z } from 'zod';
import type { ProjectionRow } from '@/lib/projections-types';
import { listContractIds } from '@/lib/contract-base';
import type { ContractOverride, OverrideMeta } from '@/lib/contract-overrides';

/**
 * AI-driven contract redline engine for the Prospects module.
 *
 * Per the 36 Granite St May-2026 retro, the previous implementation
 * collapsed every owner-requested edit into a "Rider — Additional Terms"
 * appendix because the apply step couldn't identify clauses in the
 * contract body. This file drives the new action-aware path:
 *
 *   1. listContractIds() exposes every section + clause ID from
 *      src/lib/contract-base.ts
 *   2. The LLM prompt embeds those IDs so Claude can target specific
 *      clauses by ID using replace / modify / rename / delete / add
 *   3. The output is a list of ContractOverride objects that the
 *      apply step persists to projections.contract_overrides
 *   4. The contract renderer (ContractDocument.tsx) applies the
 *      overrides to CONTRACT_BASE at render time — edits land in place
 *
 * Field changes (column-level: term_start, mgmt_fee_pct, etc.) are kept
 * as a separate array because they don't go through the override engine.
 */

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

const RichMetaShape = {
  ownerAsk: z.string().describe("What the owner asked for, verbatim or close paraphrase."),
  ourPosition: z.enum(POSITIONS).describe(
    "Our response: 'accept' (yes as asked); 'accept-with-modification' (small tweak); 'counter' (different value/text proposed back); 'hold' (no change — kept the original); 'restructure' (substantively different approach to the same intent).",
  ),
  positionDetail: z.string().describe('Plain-language explanation of our response.'),
  reviewPriority: z
    .enum(['normal', 'high'])
    .describe("'high' for changes touching sensitive sections or keywords; 'normal' otherwise."),
  sensitiveSection: z
    .boolean()
    .describe('True when the change touches a sensitive legal section (Liability, Force Majeure, etc.) or involves indemnification / liability limitation / governing law keywords.'),
};

const FieldChange = z.object({
  field: z.enum(EDITABLE_FIELDS),
  new_value: z.union([z.string(), z.number()]).nullable().describe(
    'New value. Dates YYYY-MM-DD; mgmt_fee_pct decimal (0.22 = 22%); others plain numbers.',
  ),
  ...RichMetaShape,
});

// Action-aware contract overrides. The shape mirrors ContractOverride in
// contract-overrides.ts but with the rich metadata flattened so the LLM
// produces it inline rather than nested under `meta`.

const ReplaceOverride = z.object({
  action: z.literal('replace'),
  targetId: z.string().describe('Clause ID to swap entirely (see CLAUSE_INVENTORY in the prompt).'),
  newText: z.string().describe('Full replacement template. Use {{varName}} for deal-specific values that should stay dynamic (e.g. {{minDays}}, {{repFee}}).'),
  boldPrefix: z.string().nullable().describe("Optional new bold prefix label (e.g. 'Notification Requirement:'). Null to keep current."),
  ...RichMetaShape,
});

const ModifyOverride = z.object({
  action: z.literal('modify'),
  targetId: z.string().describe('Clause ID containing the span to edit.'),
  find: z.string().describe('Exact substring (case-sensitive) to locate inside that clause. Must appear verbatim in the clause template.'),
  replaceWith: z.string().describe('Text that replaces the found span.'),
  ...RichMetaShape,
});

const RenameOverride = z.object({
  action: z.literal('rename'),
  targetId: z.string().describe('Section ID whose title changes.'),
  newTitle: z.string().describe('New section title.'),
  ...RichMetaShape,
});

const DeleteOverride = z.object({
  action: z.literal('delete'),
  targetId: z.string().describe('Clause ID to remove from the rendered contract.'),
  ...RichMetaShape,
});

const AddOverride = z.object({
  action: z.literal('add'),
  newId: z
    .string()
    .describe("Unique kebab-case ID for the new clause (e.g. 'protection-airbnb-only')."),
  title: z.string().nullable().describe('Optional bold prefix label.'),
  body: z.string().describe('Clause body template. Use {{varName}} for dynamic values.'),
  anchor: z
    .object({
      insertAfter: z.string().nullable().describe('Existing clause ID to insert after.'),
      insertBefore: z.string().nullable().describe('Existing clause ID to insert before.'),
      inSection: z.string().nullable().describe('Section ID to insert into.'),
      position: z.enum(['first', 'last']).nullable().describe("When inSection is set, position determines first or last."),
    })
    .describe('Exactly ONE of insertAfter / insertBefore / inSection+position must be set. Others must be null.'),
  ...RichMetaShape,
});

const ContractOverrideSchema = z.discriminatedUnion('action', [
  ReplaceOverride,
  ModifyOverride,
  RenameOverride,
  DeleteOverride,
  AddOverride,
]);

export const ContractRedlineEdits = z.object({
  field_changes: z.array(FieldChange),
  contract_overrides: z.array(ContractOverrideSchema),
  summary: z
    .string()
    .describe(
      'Position-framed 1-3 sentence summary phrased using our positions, not the owner\'s requests. Example: "Owner requested 18 changes. Property Manager accepted 8, accepted 4 with modifications, countered on 2, held on 3, and restructured 1. Notable holds: 185-day sale notice; $5,000 reputation fee. Notable restructure: cancellation compensation now 50% of GRI."',
    ),
});

export type ContractRedlineEdits = z.infer<typeof ContractRedlineEdits>;
export type FieldChangeT = z.infer<typeof FieldChange>;
export type ContractOverrideEditT = z.infer<typeof ContractOverrideSchema>;

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
  "attorneys' fees",
  'severability',
];

const SENSITIVE_SECTION_IDS = [
  'liability-and-indemnification',
  'insurance-and-liability-coverage',
  'force-majeure',
  'dispute-resolution',
  'severability',
  'governing-law',
];

// Contract-section taxonomy (per the 36 Granite spec, Section 2.6).
// The LLM uses this to label changes correctly — e.g. an auto-renewal
// notice change must NOT be labeled as "Termination."
const SECTION_TAXONOMY = `
TERM / AUTO-RENEWAL / NON-RENEWAL NOTICE  (the "term" section; distinct from Termination)
TERMINATION                                (material breach, cure periods, immediate triggers — "termination" section)
RENEWAL PERIOD                             (handled inside the TERM section, not its own section)
NOTICE OF SALE                             ("protection-against-sale" section; sale-notification-days field)
CANCELLATION COMPENSATION                  (inside protection-against-sale)
LIABILITY / INDEMNIFICATION                ("liability-and-indemnification" section)
INSURANCE OBLIGATIONS                      ("insurance-and-liability-coverage" section)
FORCE MAJEURE / CASUALTY                   ("force-majeure" section)
DISPUTE RESOLUTION                         ("dispute-resolution" section)
GOVERNING LAW                              ("governing-law" section)
SEVERABILITY                               ("severability" section)
`.trim();

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
  const inventory = formatClauseInventory();

  const today = new Date().toISOString().slice(0, 10);

  const { object } = await generateObject({
    model: 'anthropic/claude-sonnet-4.5',
    schema: ContractRedlineEdits,
    system: `You are processing owner-requested edits to a Rising Tide STR management contract.

Today is ${today}.

OPERATING PHILOSOPHY
Draft a candidate for EVERY change implied by the owner's input. Partial drafts ("we have some of your changes, others are pending") destroy trust. Sensitivity is a flag (reviewPriority + sensitiveSection), never a reason to skip.

OUTPUT STRUCTURE
You return two arrays:
  1. field_changes: edits to projection columns (term dates, fees, day-counts).
  2. contract_overrides: in-place edits to the contract body. Each override has an 'action':
       - replace  : swap a clause's full text. Use when most of the clause changes.
       - modify   : replace a specific span (substring) within a clause. Use when only part of the clause changes — e.g. changing "120 days" to "90 days" while leaving the surrounding sentence intact. PREFER modify over replace when only a span changes.
       - rename   : change a section's title.
       - delete   : remove a clause.
       - add      : insert a new clause at an anchor.

NEVER OUTPUT "ADD TO RIDER"
The contract body has stable clause IDs. Owner-requested edits to existing clauses must use replace / modify / rename / delete with the matching targetId. The "add" action exists only for NEW concepts with no existing equivalent — and every 'add' must have an anchor (insertAfter / insertBefore / inSection+position) pointing to an existing clause/section ID.

DEFAULT TO IN-PLACE
If the owner's request modifies language that already exists somewhere in the contract — even partially — use replace or modify on that clause, not add. Detect overlap: if the new text mentions a topic that the contract already covers (e.g. "Additional Insured," "$5,000 reputation fee," "Lost Gross Rental Income," "185 days notice"), it is a replace/modify on the existing clause, not a new add.

PRESERVE DUAL-PERIOD STRUCTURES
Some clauses contain multiple conditional rules. The TERM section's renewal-notice clause has TWO rules: 60 days for calendar year 2026, 120 days for renewal years thereafter. If the owner asks about the renewal-year period only, target the "120 days" span with modify and leave the 60-day variant intact.

CONTRACT-SECTION TAXONOMY (use the right labels)
${SECTION_TAXONOMY}
An auto-renewal-notice change is NON-RENEWAL NOTICE, not Termination. Use the section IDs above when targeting via targetId.

SENSITIVE SECTIONS
Sections whose ID is one of: ${SENSITIVE_SECTION_IDS.join(', ')} — set sensitiveSection: true, reviewPriority: 'high'.
Sensitive keywords in the body: ${SENSITIVE_KEYWORDS.join(', ')} — same flags.

THREE-FIELD RATIONALE
Every change carries ownerAsk + ourPosition + positionDetail. Use 'hold' (and emit a record) when we kept an original term against the owner's ask — silent drops destroy the audit trail.

ANCHOR RULES (for 'add' action only)
Set exactly ONE of insertAfter, insertBefore, inSection. The unused fields must be null. inSection requires position ('first' or 'last').

SUMMARY
Frame using OUR positions, e.g.:
  "Owner requested 18 changes. Property Manager accepted 8, accepted 4 with modifications, countered on 2, held on 3, restructured 1."`,
    prompt: `CURRENT CONTRACT STATE
======================
Owner: ${ownerName}
Property: ${propertyAddress}

Current projection fields:
${currentTerms}

CLAUSE INVENTORY (target these IDs with replace/modify/rename/delete; anchor 'add' to them):
${inventory}


OWNER'S REQUESTED EDITS (raw text):
===================================
${requested}


Produce the structured edit set. Default to modify or replace on existing clauses; never silently dump to a Rider.`,
  });

  return object;
}

/**
 * Map an LLM-produced edit set into the persisted shapes:
 *   - field_changes  → column updates on the projection row
 *   - contract_overrides → JSONB array of ContractOverride for the renderer
 */
export function applyEditsToProjection(args: {
  projection: ProjectionRow;
  edits: ContractRedlineEdits;
}): {
  fieldUpdates: Partial<Record<EditableField, string | number | null>>;
  newContractOverrides: ContractOverride[];
} {
  const { projection, edits } = args;

  const fieldUpdates: Partial<Record<EditableField, string | number | null>> = {};
  for (const change of edits.field_changes) {
    fieldUpdates[change.field] = coerceFieldValue(change.field, change.new_value);
  }

  const existingOverrides = (projection.contract_overrides ?? []) as ContractOverride[];
  const newOverrides: ContractOverride[] = edits.contract_overrides
    .map(toContractOverride)
    .filter((o): o is ContractOverride => o != null);

  return {
    fieldUpdates,
    newContractOverrides: [...existingOverrides, ...newOverrides],
  };
}

/**
 * Convert an LLM ContractOverrideEditT into the typed ContractOverride
 * the renderer consumes. Validates the anchor shape for 'add' (exactly
 * one of insertAfter/insertBefore/inSection set) and drops the override
 * with a console.warn if the anchor is invalid — better to drop one
 * broken edit than to crash the whole apply step.
 */
function toContractOverride(edit: ContractOverrideEditT): ContractOverride | null {
  const meta: OverrideMeta = {
    ownerAsk: edit.ownerAsk,
    ourPosition: edit.ourPosition,
    positionDetail: edit.positionDetail,
    reviewPriority: edit.reviewPriority,
    sensitiveSection: edit.sensitiveSection,
  };
  if (edit.action === 'add') {
    const a = edit.anchor;
    const setCount = [a.insertAfter, a.insertBefore, a.inSection].filter(Boolean).length;
    if (setCount !== 1) {
      console.warn(`Dropping 'add' override "${edit.newId}": expected exactly one anchor; got ${setCount}.`);
      return null;
    }
    let anchor: ContractOverride extends { anchor: infer A } ? A : never;
    if (a.insertAfter) anchor = { insertAfter: a.insertAfter } as typeof anchor;
    else if (a.insertBefore) anchor = { insertBefore: a.insertBefore } as typeof anchor;
    else if (a.inSection) {
      if (a.position == null) {
        console.warn(`Dropping 'add' override "${edit.newId}": inSection requires position.`);
        return null;
      }
      anchor = { inSection: a.inSection, position: a.position } as typeof anchor;
    } else {
      return null;
    }
    return {
      action: 'add',
      newId: edit.newId,
      title: edit.title ?? undefined,
      body: edit.body,
      anchor,
      meta,
    };
  }
  if (edit.action === 'replace') {
    return {
      action: 'replace',
      targetId: edit.targetId,
      newText: edit.newText,
      boldPrefix: edit.boldPrefix,
      meta,
    };
  }
  if (edit.action === 'modify') {
    return {
      action: 'modify',
      targetId: edit.targetId,
      find: edit.find,
      replaceWith: edit.replaceWith,
      meta,
    };
  }
  if (edit.action === 'rename') {
    return { action: 'rename', targetId: edit.targetId, newTitle: edit.newTitle, meta };
  }
  if (edit.action === 'delete') {
    return { action: 'delete', targetId: edit.targetId, meta };
  }
  return null;
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

function formatClauseInventory(): string {
  const inv = listContractIds();
  const sectionsBlock = inv.sections
    .map((s) => `  [section] ${s.id}  →  "${s.title}"`)
    .join('\n');
  const clausesBlock = inv.clauses
    .map((c) => `  [clause]  ${c.id}  (in ${c.sectionId})  →  ${c.preview}`)
    .join('\n');
  return `SECTIONS:\n${sectionsBlock}\n\nCLAUSES:\n${clausesBlock}`;
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

export const ACTION_LABELS: Record<ContractOverrideEditT['action'], string> = {
  replace: 'Replace',
  modify: 'Modify',
  rename: 'Rename',
  delete: 'Delete',
  add: 'Add',
};
