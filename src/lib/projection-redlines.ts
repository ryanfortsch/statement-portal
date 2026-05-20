import { generateObject } from 'ai';
import { z } from 'zod';
import type { ProjectionRow } from '@/lib/projections-types';
import { listContractIds, CONTRACT_BASE, type ContractPage } from '@/lib/contract-base';
import { applyContractOverrides, type ContractOverride, type OverrideMeta } from '@/lib/contract-overrides';

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
  // Build the clause inventory from the CURRENT contract — base plus any
  // overrides already applied to this projection — so Claude can see and
  // target clauses that previous redlines added (to delete, modify, or
  // anchor to them). applyContractOverrides is fail-soft, so a bad
  // existing override won't break the inventory; the tree reflects what's
  // actually rendered today.
  const existingOverrides = (projection.contract_overrides ?? []) as ContractOverride[];
  const { pages: currentTree } = applyContractOverrides(existingOverrides, CONTRACT_BASE);
  const inventory = formatClauseInventory(currentTree);

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

STRONGLY PREFER MODIFY OVER REPLACE
Use modify (find / replaceWith on a span) whenever the change is local to part of a clause. Modify is span-level — it touches only the matched substring and leaves the rest of the clause stable. Replace overwrites the whole template. Default to modify for any number, name, day-count, or phrase swap.

DUAL-PERIOD CLAUSES — MODIFY EACH PERIOD INDEPENDENTLY
The TERM section's renewal-notice clause (\`term-renewal-notice\`) contains two notice-period rules in a single paragraph:
  - 60 days for calendar year 2026
  - 120 days for renewal years thereafter

Both are editable independently with modify. Use modify even if it feels like a "big" clause — the dual structure is a feature, not a reason to refuse the edit.

WORKED EXAMPLES (apply these patterns, don't paraphrase them):

  Owner: "Reduce the renewal notice period from 120 to 90 days."
  →  ONE modify on term-renewal-notice:
       { action: "modify",
         targetId: "term-renewal-notice",
         find: "120 days",
         replaceWith: "90 days",
         ourPosition: "accept" (or counter/restructure as the deal calls for),
         ... }
     The 60-day calendar-year-2026 variant is preserved automatically
     because modify only touches the matched span. Do NOT use replace;
     that would drop the 60-day rule.

  Owner: "Make both notice periods 60 days."
  →  ZERO edits to the 60-day variant (already 60). ONE modify changing
     "120 days" → "60 days" on term-renewal-notice. Two separate modify
     actions are fine if you prefer to be explicit.

  Owner: "Additional Insured should be reciprocal."
  →  modify on insurance-additional-insured spanning just the wording
     that changes, OR replace if you're rewriting the whole clause.

  Owner: "Drop the reputation damages fee."
  →  modify on protection-comp-reputation, find: "$5,000", replaceWith:
     "an amount mutually agreed" — span-level. If you're rewriting the
     bullet's entire framing, use replace on the same target.

The dual-period clause is NOT a do-not-touch zone. The "preserve" framing only means: don't use REPLACE when only ONE of the two rules is changing (replace would clobber the other). Modify is always available and is the correct action for span swaps.

HIERARCHY: NEW CLAUSE LEVEL MATCHES ANCHOR LEVEL
The clause inventory below lists every clause with [d=N] showing its nesting depth (0 = top-level bullet in a section, 1 = sub-bullet, etc.). When you anchor an 'add' to a clause at depth N, the new clause appears at depth N. To insert a new top-level bullet, anchor to another top-level bullet. To insert a sub-bullet, anchor to a sub-bullet.

Examples of common mistakes:
  WRONG: To insert a new "Owner Approval Required" bullet as a peer of "rental-income-notice" (depth 0), anchoring with insertAfter: rental-income-extra-emergency (depth 1, under "Examples include:"). Result: new clause appears as a SUB-bullet, not a top-level peer.
  RIGHT: insertAfter: rental-income-extra-services (depth 0 — the "Examples include:" parent), or insertBefore: rental-income-notice (depth 0).

  WRONG: To add new top-level bullets to protection-against-sale (Carve-Out, Additional Platform Penalties) anchoring with insertAfter: protection-comp-reputation (depth 1, a sub-bullet under "Compensation for Cancellations:"). Result: new clauses get nested under Cancellation Compensation instead of being peers of Notification Requirement / Existing Reservations / Binding Obligation.
  RIGHT: insertBefore: protection-binding (depth 0) for a new top-level bullet placed just before Binding Obligation. Or insertAfter: protection-compensation (depth 0).

REPLACE PRESERVES CHILDREN — DON'T DELETE COLLATERALLY
A replace swaps a clause's template/title but keeps its children intact. To swap out a single bullet (e.g. "written notice and an estimate"), use replace on THAT specific bullet's ID. Do NOT delete the parent ("Examples include:") just to remove the child — deleting a parent deletes its sub-bullets too, taking unrelated content with it.

FIND STRINGS TARGET THE TEMPLATE LITERAL, NOT THE RENDERED TEXT
Clause templates contain {{varName}} placeholders for deal-specific values: {{ownerName}}, {{propertyAddress}}, {{propertyType}}, {{mgmtPct}}, {{deposit}}, {{minBalance}}, {{minDays}}, {{saleDays}}, {{repFee}}, {{termStartShort}}, {{termEndShort}}, {{termStartLong}}, {{termEndLong}}. The variables get substituted at render time; they are NOT in the template literal.

Your modify's \`find\` string must match the TEMPLATE LITERAL, not the rendered output. If you write \`find: "185 days' written notice"\` the renderer can never match because the template has \`{{saleDays}} written notice\` — not the string "185 days'".

Examples:

  Clause protection-notification's template (visible in the inventory):
    "The Owner shall provide the Property Manager with {{saleDays}} written notice of intent to sell the Property."

  WRONG: \`find: "185 days' written notice"\` → fails ("185 days'" is not in the template)
  RIGHT: \`find: "{{saleDays}} written notice"\` → matches the placeholder span

  Owner: "Spell out the 185 days in words."
  →  modify protection-notification:
       find: "{{saleDays}} written notice",
       replaceWith: "one hundred eighty-five (185) days' written notice"
     (This drops the {{saleDays}} substitution in favor of literal text — fine when the deal value is now fixed by the contract language itself.)

  Owner: "Change the sale notification period from 185 to 90 days."
  →  This is a FIELD CHANGE, not a contract override. Emit:
       field_changes: [{ field: "sale_notification_days", new_value: 90, ... }]
     The clause template stays as {{saleDays}} and the renderer substitutes the new value.

Rule of thumb:
  - Number/date/dollar amount change with no surrounding-text change → \`field_changes\`.
  - Anything that changes surrounding language, even if it also embeds a number → \`contract_overrides\` modify with the template literal (including any {{varName}} placeholders).

ONE OVERRIDE PER CLAUSE (for the same conceptual change)
If a clause is being modified by the owner's request, emit ONE override for it, not several. Multiple modifies on the same clauseId are processed in order, and the second one can't find its span if the first one already changed it. Two failure modes follow:

  - You emit replace + modify on the same clauseId. The replace consumes the whole template; the modify's find no longer matches.
  - You emit two modifies on overlapping spans of the same clauseId. The first one changes the text; the second one's find string can't find what it's looking for.

If a clause needs multiple span-level changes, prefer ONE replace with the full new template (preserving any unrelated existing spans). Use modify only when the change is genuinely a single span swap.

DON'T REPLACE A PARENT AND THEN MODIFY ITS CHILDREN
Replacing or deleting a parent clause removes its children (or makes their IDs stale). If the owner's request restructures a parent and edits its children, either:
  (a) replace the parent with new text that includes the children's new wording inline, or
  (b) modify the children first and the parent last, taking care that the parent's modify doesn't span over the children's edited text.
Either way: don't emit child-targeted overrides AFTER a parent-replacing override. The renderer can't find children that no longer exist.

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

BOLD LABEL CONVENTIONS
Labeled bullets render with the schema's title in bold + a colon, followed by the body. Two hard rules:

  1. Pass title as the bare label name only — no colon, no markdown.
     RIGHT: title: "Owner Approval Required"
     WRONG: title: "Owner Approval Required:"      (renderer adds the colon)
     WRONG: title: "**Owner Approval Required**"   (no markdown in titles)

  2. NEVER use markdown in body. The renderer outputs body text literally — it does NOT parse \`**bold**\` or \`__bold__\` or \`*italic*\`. Markdown asterisks render as literal asterisks. And specifically: do NOT repeat the label at the start of the body, with or without markdown.

     RIGHT:
       title: "Owner Approval Required"
       body:  "Before incurring any extraordinary fee or coordinating any
               large-scale repair, the Property Manager shall provide..."

     WRONG (label repeated as markdown):
       title: "Owner Approval Required"
       body:  "**Owner Approval Required:** Before incurring any extraordinary..."

     WRONG (label repeated in plain text):
       title: "Owner Approval Required"
       body:  "Owner Approval Required: Before incurring..."

     The renderer dedups defensively so the contract still renders OK, but the canonical output is body-without-prefix.

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
    const value = coerceFieldValue(change.field, change.new_value);
    // mgmt_fee_pct is the one editable term column that stays NOT NULL
    // (it's the core economic term and drives the projection model). A
    // redline should change it, never remove it — defensively skip a
    // null so a pathological LLM output can't crash the apply with a
    // not-null violation; the existing fee is preserved.
    if (change.field === 'mgmt_fee_pct' && value == null) continue;
    fieldUpdates[change.field] = value;
  }

  const existingOverrides = (projection.contract_overrides ?? []) as ContractOverride[];
  const newOverrides: ContractOverride[] = edits.contract_overrides
    .map(toContractOverride)
    .filter((o): o is ContractOverride => o != null);

  return {
    fieldUpdates,
    newContractOverrides: dedupeAddOverrides([...existingOverrides, ...newOverrides]),
  };
}

/**
 * Collapse duplicate `add` overrides so the same clause can't be inserted
 * twice. Each apply APPENDS to the stored overrides array, so re-running
 * interpret+apply for an overlapping edit used to stack two `add`s with
 * the same newId — the renderer then inserted the clause twice AND any
 * `add` anchored "after" that newId matched both copies, cascading the
 * duplication (the 16 Waterman Rd Net Income / Cleaning Fees bug).
 *
 * Rule: for `add` overrides, keep only the LAST occurrence of each newId
 * (a re-run supersedes the earlier insert with the more-refined wording).
 * All non-add overrides are kept in order. Order is otherwise preserved.
 */
function dedupeAddOverrides(overrides: ContractOverride[]): ContractOverride[] {
  const lastIndexByNewId = new Map<string, number>();
  overrides.forEach((o, i) => {
    if (o.action === 'add') lastIndexByNewId.set(o.newId, i);
  });
  return overrides.filter((o, i) =>
    o.action !== 'add' ? true : lastIndexByNewId.get(o.newId) === i,
  );
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

function formatClauseInventory(pages?: ContractPage[]): string {
  const inv = listContractIds(pages);
  const sectionsBlock = inv.sections
    .map((s) => `  [section] ${s.id}  →  "${s.title}"`)
    .join('\n');
  // [d=N] marker shows nesting depth: 0 = top-level bullet/paragraph in
  // the section; 1 = sub-bullet (child of a top-level); 2 = grand-child.
  // Sub-bullets are also indented in the listing so the parent/child
  // shape is visually obvious — both signals together make it hard for
  // Claude to anchor a new top-level bullet to a sub-bullet by accident.
  const clausesBlock = inv.clauses
    .map((c) => {
      const indent = '  '.repeat(c.depth + 1);
      return `${indent}[clause d=${c.depth}]  ${c.id}  (in ${c.sectionId})  →  ${c.preview}`;
    })
    .join('\n');
  return `SECTIONS:\n${sectionsBlock}\n\nCLAUSES (indented by depth; anchor 'add' actions to a clause at the SAME depth as where the new clause should appear):\n${clausesBlock}`;
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
