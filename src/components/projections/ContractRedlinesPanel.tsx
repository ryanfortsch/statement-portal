'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { proposeContractRedlines, applyContractRedlines } from '@/app/projections/actions';
import {
  FIELD_DESCRIPTORS,
  formatFieldValueForPreview,
  POSITION_LABELS,
  type ContractRedlineEdits,
  type EditableField,
  type RedlinePosition,
} from '@/lib/projection-redlines';
import type { ProjectionRow } from '@/lib/projections-types';

type Mode = 'interpret' | 'precise';
type Step = 'input' | 'preview' | 'applied';

/**
 * Per-edit accept/reject state. Each array's length must match the
 * corresponding `edits.*` array; the index into each acceptance array
 * lines up with the index in the matching edits array. true = will be
 * included in the Apply call; false = will be silently discarded.
 */
type Acceptance = {
  fieldChanges: boolean[];
  clauseAdds: boolean[];
  clauseEdits: boolean[];
  clauseRemoves: boolean[];
};

const EDITABLE_FIELDS: readonly EditableField[] = Object.keys(FIELD_DESCRIPTORS) as EditableField[];

/**
 * Two-mode redline flow:
 *
 *   INTERPRET (default)
 *     Staff pastes the owner's freeform redlines (email / SMS / call notes)
 *     and Claude maps the request to a structured edit set. Good for
 *     "owner emailed me a paragraph; map it to fields" workflows.
 *
 *   PRECISE
 *     Staff authors the edit set directly — pick fields, set new values,
 *     stage clauses to add. No AI. Good for "I know exactly what to
 *     change" workflows where the LLM round-trip is overkill.
 *
 * Both modes funnel into the same preview → apply → applied terminal flow,
 * which uses applyContractRedlines on the server. The contract PDF is
 * data-driven so the moment edits land, downloads reflect them.
 */
export function ContractRedlinesPanel({ projection }: { projection: ProjectionRow }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('interpret');
  const [step, setStep] = useState<Step>('input');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Record of the last apply call — what was applied, when, and (snapshot
  // of the filtered edit set so we can render the "here's what landed"
  // list in the success state). Persists across resets so the small chip
  // at the panel head can keep reminding the user that changes are live.
  const [lastApplied, setLastApplied] = useState<{
    at: Date;
    edits: ContractRedlineEdits;
    selectedCount: number;
  } | null>(null);

  // Interpret-mode input state
  const [text, setText] = useState('');

  // Precise-mode input state: lightweight staging of an edit set
  const [draftFieldChanges, setDraftFieldChanges] = useState<DraftFieldChange[]>([]);
  const [draftClausesToAdd, setDraftClausesToAdd] = useState<DraftClauseAdd[]>([]);

  // Preview state — set when transitioning into the preview step from
  // either mode. Holds the actual ContractRedlineEdits being applied.
  const [edits, setEdits] = useState<ContractRedlineEdits | null>(null);

  // Per-edit accept/reject state — checkbox on each edit in the preview.
  // Initialized to all-true when edits are first set.
  const [acceptance, setAcceptance] = useState<Acceptance>({
    fieldChanges: [],
    clauseAdds: [],
    clauseEdits: [],
    clauseRemoves: [],
  });

  // The text we originally sent to the interpreter. Held so the Iterate
  // step can re-call the interpreter with the original + refinement notes
  // (giving Claude continuity rather than starting fresh). Empty when
  // edits came from Precise mode (no interpretation happened).
  const [originalText, setOriginalText] = useState('');
  const [iterationText, setIterationText] = useState('');

  const resetAll = () => {
    setStep('input');
    setText('');
    setDraftFieldChanges([]);
    setDraftClausesToAdd([]);
    setEdits(null);
    setAcceptance({ fieldChanges: [], clauseAdds: [], clauseEdits: [], clauseRemoves: [] });
    setOriginalText('');
    setIterationText('');
    setError(null);
  };

  const switchMode = (next: Mode) => {
    if (next === mode) return;
    setMode(next);
    resetAll();
  };

  const interpretRequest = () => {
    setError(null);
    startTransition(async () => {
      const res = await proposeContractRedlines(projection.id, text);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setEdits(res.edits);
      setAcceptance(initAcceptance(res.edits));
      setOriginalText(text);
      setIterationText('');
      setStep('preview');
    });
  };

  const stagePreciseEdits = () => {
    setError(null);
    const built = buildPreciseEdits(draftFieldChanges, draftClausesToAdd);
    if (!built) {
      setError('Add at least one field change or clause first.');
      return;
    }
    setEdits(built);
    setAcceptance(initAcceptance(built));
    setOriginalText(''); // precise edits aren't iterable — no LLM context to refine
    setIterationText('');
    setStep('preview');
  };

  /**
   * Re-run the interpreter with the original prompt + the refinement notes.
   * Replaces the current edit set with a fresh interpretation; acceptance
   * state resets to all-true on the new edits.
   */
  const iterate = () => {
    const refinement = iterationText.trim();
    if (!refinement || !originalText) return;
    setError(null);
    const combined =
      `Original owner request:\n${originalText}\n\n` +
      `On a previous interpretation pass you produced edits, but the staff reviewer wants to refine. ` +
      `Refinement notes:\n${refinement}\n\n` +
      `Re-interpret with the original request AND the refinement notes in mind. The refinement notes ` +
      `take precedence when they conflict with the original.`;
    startTransition(async () => {
      const res = await proposeContractRedlines(projection.id, combined);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setEdits(res.edits);
      setAcceptance(initAcceptance(res.edits));
      setIterationText('');
      // Stay on the preview step — just refresh what's shown.
    });
  };

  const applyEdits = () => {
    if (!edits) return;
    const filtered = filterEditsByAcceptance(edits, acceptance);
    const filteredCount =
      filtered.field_changes.length +
      filtered.clauses_to_add.length +
      filtered.clauses_to_edit.length +
      filtered.clauses_to_remove.length;
    if (filteredCount === 0) {
      setError('Nothing selected to apply.');
      return;
    }
    setError(null);
    startTransition(async () => {
      const res = await applyContractRedlines(projection.id, filtered);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      // Refresh the server tree so the projection edit form lower on the
      // page picks up the new field values. Without this, the form's
      // initial-state would clobber redline-applied values when Save is
      // hit. Then transition to the applied step.
      router.refresh();
      setLastApplied({ at: new Date(), edits: filtered, selectedCount: filteredCount });
      setStep('applied');
    });
  };

  const selectedCount =
    acceptance.fieldChanges.filter(Boolean).length +
    acceptance.clauseAdds.filter(Boolean).length +
    acceptance.clauseEdits.filter(Boolean).length +
    acceptance.clauseRemoves.filter(Boolean).length;

  return (
    <div style={panelStyle}>
      <div style={panelHeadStyle}>
        <div>
          <div className="eyebrow" style={eyebrowStyle}>Owner Redlines</div>
          <h3 className="font-serif" style={titleStyle}>Apply contract edits from the owner</h3>
          {lastApplied && step !== 'applied' && (
            <div style={recentChipStyle}>
              <span style={recentChipDotStyle} />
              <span>
                Last applied {formatTime(lastApplied.at)} · {lastApplied.selectedCount}{' '}
                {lastApplied.selectedCount === 1 ? 'edit' : 'edits'} live on the contract.
              </span>
            </div>
          )}
        </div>
        {step !== 'input' && (
          <button type="button" onClick={resetAll} style={resetButtonStyle}>
            Start over
          </button>
        )}
      </div>

      {/* Mode toggle — only visible in the input step. Once edits are
          staged for preview, the mode is fixed for the rest of the flow. */}
      {step === 'input' && (
        <ModeToggle mode={mode} onChange={switchMode} />
      )}

      <p style={ledeStyle}>
        {mode === 'interpret'
          ? 'Paste what the owner sent — email, text, call notes. The interpreter maps their request to specific contract fields and clauses, shows you the diff, and applies the edits when you approve. The PDF re-renders automatically.'
          : 'Pick exactly which fields and clauses to change. No AI interpretation — you author the edits directly. Same diff preview + apply flow as Interpret.'}
      </p>

      {step === 'input' && mode === 'interpret' && (
        <InterpretInput
          text={text}
          setText={setText}
          onInterpret={interpretRequest}
          pending={pending}
        />
      )}

      {step === 'input' && mode === 'precise' && (
        <PreciseEditor
          projection={projection}
          fieldChanges={draftFieldChanges}
          setFieldChanges={setDraftFieldChanges}
          clausesToAdd={draftClausesToAdd}
          setClausesToAdd={setDraftClausesToAdd}
          onStage={stagePreciseEdits}
          pending={pending}
        />
      )}

      {step === 'preview' && edits && (
        <>
          <Preview
            edits={edits}
            projection={projection}
            acceptance={acceptance}
            setAcceptance={setAcceptance}
          />

          {/* Refine block — Interpret mode only. Lets the staff reviewer
              send specific feedback back to Claude for unselected or
              wrongly-mapped edits without losing context. */}
          {mode === 'interpret' && originalText && (
            <div style={refineBlockStyle}>
              <div className="eyebrow" style={{ ...eyebrowStyle, marginBottom: 4 }}>
                Need to refine?
              </div>
              <p style={{ margin: '0 0 8px', fontSize: 11, color: 'var(--ink-3)', lineHeight: 1.5 }}>
                Tell Claude what to reconsider. The original request + your notes both go back in;
                the new interpretation replaces what&rsquo;s shown above.
              </p>
              <textarea
                value={iterationText}
                onChange={(e) => setIterationText(e.target.value)}
                rows={3}
                maxLength={4000}
                placeholder={'e.g. "Min availability should be 130 not 150." Or "Drop the no-weddings clause — owner is fine with weddings, just not parties."'}
                style={{ ...textareaStyle, fontSize: 12, padding: '8px 10px' }}
                disabled={pending}
              />
              <div style={{ ...actionsRowStyle, marginTop: 8 }}>
                <button
                  type="button"
                  onClick={iterate}
                  disabled={pending || !iterationText.trim()}
                  style={secondaryButtonStyle}
                >
                  {pending ? 'Iterating…' : 'Iterate'}
                </button>
                <span style={hintStyle}>Replaces the preview above with a fresh interpretation.</span>
              </div>
            </div>
          )}

          <div style={actionsRowStyle}>
            <button
              type="button"
              onClick={applyEdits}
              disabled={pending || selectedCount === 0}
              style={primaryButtonStyle}
            >
              {pending
                ? 'Applying…'
                : selectedCount === 0
                  ? 'Nothing selected'
                  : `Apply ${selectedCount} selected ${selectedCount === 1 ? 'edit' : 'edits'}`}
            </button>
            <button type="button" onClick={resetAll} style={secondaryButtonStyle} disabled={pending}>
              Discard all
            </button>
          </div>
        </>
      )}

      {step === 'applied' && lastApplied && (
        <AppliedConfirmation
          projectionId={projection.id}
          applied={lastApplied}
          onAnotherRound={resetAll}
        />
      )}

      {error && <div style={errorStyle}>{error}</div>}
    </div>
  );
}

// ─── Applied confirmation ───────────────────────────────────────────────────

/**
 * The "you did it" view that replaces the preview after Apply succeeds.
 *
 * Deliberately loud — Dotti's feedback from the May 2026 36 Granite St run
 * was that the prior success state was so small she couldn't tell if the
 * apply had actually happened. Combined with the projection edit form's
 * Save button lower on the page, it was easy to think "apply" meant
 * "scroll down and save" — which would have clobbered the redline values
 * back to the form's stale defaults.
 *
 * Fixes:
 *   - Big success banner with a checkmark + explicit "Contract updated."
 *   - Per-change list of exactly what was applied (field changes + clauses).
 *   - Explicit "View updated contract ↗" and "Download updated PDF" CTAs
 *     that open FRESH tabs / files, bypassing any stale tab the user may
 *     have left open from before the apply.
 *   - Run another round / Done CTAs at the bottom.
 *   - Heads-up: refresh any already-open contract tab to see the new values.
 *
 * The router.refresh() in applyEdits also re-fetches the page server-side
 * so the projection edit form picks up the new values and won't clobber
 * them on its next Save.
 */
function AppliedConfirmation({
  projectionId,
  applied,
  onAnotherRound,
}: {
  projectionId: string;
  applied: { at: Date; edits: ContractRedlineEdits; selectedCount: number };
  onAnotherRound: () => void;
}) {
  const { at, edits, selectedCount } = applied;
  const tally = [
    edits.field_changes.length > 0
      ? `${edits.field_changes.length} field ${edits.field_changes.length === 1 ? 'change' : 'changes'}`
      : null,
    edits.clauses_to_add.length > 0
      ? `${edits.clauses_to_add.length} clause ${edits.clauses_to_add.length === 1 ? 'addition' : 'additions'}`
      : null,
    edits.clauses_to_edit.length > 0
      ? `${edits.clauses_to_edit.length} clause ${edits.clauses_to_edit.length === 1 ? 'edit' : 'edits'}`
      : null,
    edits.clauses_to_remove.length > 0
      ? `${edits.clauses_to_remove.length} clause ${edits.clauses_to_remove.length === 1 ? 'removal' : 'removals'}`
      : null,
  ]
    .filter(Boolean)
    .join(' · ');

  return (
    <div style={appliedBannerStyle}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 6 }}>
        <span style={appliedCheckStyle}>✓</span>
        <strong style={{ fontSize: 18, color: 'var(--ink)' }}>Contract updated.</strong>
        <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>at {formatTime(at)}</span>
      </div>
      <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--ink)', lineHeight: 1.55 }}>
        Applied <strong>{selectedCount}</strong> {selectedCount === 1 ? 'edit' : 'edits'} ({tally}) to the
        projection. The Contract preview and downloads below now reflect these changes — the projection edit
        form on this page has been refreshed too.
      </p>

      <ul style={appliedListStyle}>
        {edits.field_changes.map((c, i) => (
          <li key={`fc-${i}`}>
            <strong>{FIELD_DESCRIPTORS[c.field as EditableField].label}</strong> →{' '}
            <span style={{ fontFamily: 'var(--font-mono-dash, ui-monospace), monospace' }}>
              {formatFieldValueForPreview(c.field as EditableField, c.new_value)}
            </span>
            <span style={appliedRowMetaStyle}>{POSITION_LABELS[c.ourPosition]}</span>
          </li>
        ))}
        {edits.clauses_to_add.map((c, i) => (
          <li key={`ca-${i}`}>
            <strong>+ Added clause:</strong> {c.title}
            <span style={appliedRowMetaStyle}>{POSITION_LABELS[c.ourPosition]}</span>
          </li>
        ))}
        {edits.clauses_to_edit.map((c, i) => (
          <li key={`ce-${i}`}>
            <strong>~ Edited clause #{c.index}:</strong> {c.title ?? '(body change only)'}
            <span style={appliedRowMetaStyle}>{POSITION_LABELS[c.ourPosition]}</span>
          </li>
        ))}
        {edits.clauses_to_remove.map((c, i) => (
          <li key={`cr-${i}`}>
            <strong>− Removed clause #{c.index}</strong>
            <span style={appliedRowMetaStyle}>{POSITION_LABELS[c.ourPosition]}</span>
          </li>
        ))}
      </ul>

      <p style={appliedHeadsUpStyle}>
        If the contract preview is already open in another tab, refresh that tab to see the new values.
      </p>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 14, alignItems: 'center' }}>
        <Link href={`/projections/${projectionId}/contract`} target="_blank" style={primaryButtonStyle}>
          View updated contract ↗
        </Link>
        <button type="button" onClick={onAnotherRound} style={secondaryButtonStyle}>
          Run another round
        </button>
      </div>
    </div>
  );
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

// ─── Mode toggle ────────────────────────────────────────────────────────────

function ModeToggle({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  return (
    <div role="tablist" aria-label="Redline input mode" style={toggleWrapStyle}>
      <button
        role="tab"
        aria-selected={mode === 'interpret'}
        type="button"
        onClick={() => onChange('interpret')}
        style={mode === 'interpret' ? toggleActiveStyle : toggleInactiveStyle}
      >
        Interpret
      </button>
      <button
        role="tab"
        aria-selected={mode === 'precise'}
        type="button"
        onClick={() => onChange('precise')}
        style={mode === 'precise' ? toggleActiveStyle : toggleInactiveStyle}
      >
        Precise
      </button>
    </div>
  );
}

// ─── Interpret input ────────────────────────────────────────────────────────

function InterpretInput({
  text,
  setText,
  onInterpret,
  pending,
}: {
  text: string;
  setText: (v: string) => void;
  onInterpret: () => void;
  pending: boolean;
}) {
  return (
    <>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={5}
        maxLength={20000}
        placeholder={
          'e.g. "Owner wants min availability dropped to 150 days, mgmt fee to 22%, and a clause that no parties or weddings are allowed."'
        }
        style={textareaStyle}
        disabled={pending}
      />
      <div style={actionsRowStyle}>
        <button
          type="button"
          onClick={onInterpret}
          disabled={pending || !text.trim()}
          style={primaryButtonStyle}
        >
          {pending ? 'Interpreting…' : 'Interpret edits'}
        </button>
        <span style={hintStyle}>{text.length.toLocaleString()}/20,000 · Claude reads, you approve.</span>
      </div>
    </>
  );
}

// ─── Precise editor ─────────────────────────────────────────────────────────

type DraftFieldChange = {
  field: EditableField | '';
  newValueText: string;
  reason: string;
};

type DraftClauseAdd = {
  title: string;
  body: string;
  reason: string;
};

function PreciseEditor({
  projection,
  fieldChanges,
  setFieldChanges,
  clausesToAdd,
  setClausesToAdd,
  onStage,
  pending,
}: {
  projection: ProjectionRow;
  fieldChanges: DraftFieldChange[];
  setFieldChanges: React.Dispatch<React.SetStateAction<DraftFieldChange[]>>;
  clausesToAdd: DraftClauseAdd[];
  setClausesToAdd: React.Dispatch<React.SetStateAction<DraftClauseAdd[]>>;
  onStage: () => void;
  pending: boolean;
}) {
  const addFieldChange = () =>
    setFieldChanges((prev) => [...prev, { field: '', newValueText: '', reason: '' }]);
  const updateFieldChange = (i: number, patch: Partial<DraftFieldChange>) =>
    setFieldChanges((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const removeFieldChange = (i: number) =>
    setFieldChanges((prev) => prev.filter((_, j) => j !== i));

  const addClause = () =>
    setClausesToAdd((prev) => [...prev, { title: '', body: '', reason: '' }]);
  const updateClause = (i: number, patch: Partial<DraftClauseAdd>) =>
    setClausesToAdd((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const removeClause = (i: number) =>
    setClausesToAdd((prev) => prev.filter((_, j) => j !== i));

  const stagedCount = fieldChanges.length + clausesToAdd.length;
  const projectionAsRecord = projection as unknown as Record<string, string | number | null>;

  return (
    <>
      {/* Field changes builder */}
      <BuilderBlock
        title="Field changes"
        helpText="Pick a contract field and set its new value. The current value shows so you can sanity-check."
      >
        {fieldChanges.length === 0 ? (
          <p style={builderEmptyStyle}>No field changes staged yet.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {fieldChanges.map((row, i) => (
              <FieldChangeRow
                key={i}
                row={row}
                current={row.field ? projectionAsRecord[row.field] ?? null : null}
                onChange={(patch) => updateFieldChange(i, patch)}
                onRemove={() => removeFieldChange(i)}
              />
            ))}
          </div>
        )}
        <button type="button" onClick={addFieldChange} style={addRowButtonStyle} disabled={pending}>
          + Add field change
        </button>
      </BuilderBlock>

      {/* Clauses to add builder */}
      <BuilderBlock
        title="Clauses to add"
        helpText="Each clause appears in the contract's Rider page in the order added. Body should be one or two formal-voice sentences."
      >
        {clausesToAdd.length === 0 ? (
          <p style={builderEmptyStyle}>No new clauses staged.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {clausesToAdd.map((row, i) => (
              <ClauseAddRow
                key={i}
                row={row}
                onChange={(patch) => updateClause(i, patch)}
                onRemove={() => removeClause(i)}
              />
            ))}
          </div>
        )}
        <button type="button" onClick={addClause} style={addRowButtonStyle} disabled={pending}>
          + Add clause
        </button>
      </BuilderBlock>

      <div style={actionsRowStyle}>
        <button
          type="button"
          onClick={onStage}
          disabled={pending || stagedCount === 0}
          style={primaryButtonStyle}
        >
          Preview {stagedCount} {stagedCount === 1 ? 'edit' : 'edits'}
        </button>
        <span style={hintStyle}>
          No AI in this mode — your structured edits go straight to the preview.
        </span>
      </div>
    </>
  );
}

function FieldChangeRow({
  row,
  current,
  onChange,
  onRemove,
}: {
  row: DraftFieldChange;
  current: string | number | null;
  onChange: (patch: Partial<DraftFieldChange>) => void;
  onRemove: () => void;
}) {
  const descriptor = row.field ? FIELD_DESCRIPTORS[row.field as EditableField] : null;
  return (
    <div style={builderRowStyle}>
      <div style={{ display: 'grid', gridTemplateColumns: '180px 120px 1fr 1fr auto', gap: 8, alignItems: 'center' }}>
        <select
          value={row.field}
          onChange={(e) => onChange({ field: (e.target.value || '') as EditableField | '' })}
          style={selectStyle}
        >
          <option value="">Choose field…</option>
          {EDITABLE_FIELDS.map((f) => (
            <option key={f} value={f}>
              {FIELD_DESCRIPTORS[f].label}
            </option>
          ))}
        </select>
        <span style={{ fontSize: 11, color: 'var(--ink-3)', whiteSpace: 'nowrap' }}>
          {row.field
            ? `now: ${formatFieldValueForPreview(row.field as EditableField, current ?? null)}`
            : ''}
        </span>
        <input
          type="text"
          value={row.newValueText}
          onChange={(e) => onChange({ newValueText: e.target.value })}
          placeholder={descriptor ? placeholderForKind(descriptor.kind) : 'New value'}
          style={inputStyle}
        />
        <input
          type="text"
          value={row.reason}
          onChange={(e) => onChange({ reason: e.target.value })}
          placeholder="Reason (optional)"
          style={inputStyle}
        />
        <button type="button" onClick={onRemove} style={removeButtonStyle} aria-label="Remove this field change">
          ×
        </button>
      </div>
    </div>
  );
}

function ClauseAddRow({
  row,
  onChange,
  onRemove,
}: {
  row: DraftClauseAdd;
  onChange: (patch: Partial<DraftClauseAdd>) => void;
  onRemove: () => void;
}) {
  return (
    <div style={builderRowStyle}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            type="text"
            value={row.title}
            onChange={(e) => onChange({ title: e.target.value })}
            placeholder="Clause title (e.g. No weddings)"
            style={{ ...inputStyle, flex: 1 }}
          />
          <button type="button" onClick={onRemove} style={removeButtonStyle} aria-label="Remove this clause">
            ×
          </button>
        </div>
        <textarea
          value={row.body}
          onChange={(e) => onChange({ body: e.target.value })}
          rows={2}
          placeholder="Clause body — one or two formal-voice sentences."
          style={{ ...textareaStyle, fontSize: 12, padding: '8px 10px' }}
        />
        <input
          type="text"
          value={row.reason}
          onChange={(e) => onChange({ reason: e.target.value })}
          placeholder="Reason (optional)"
          style={inputStyle}
        />
      </div>
    </div>
  );
}

function BuilderBlock({
  title,
  helpText,
  children,
}: {
  title: string;
  helpText: string;
  children: React.ReactNode;
}) {
  return (
    <div style={{ borderTop: '1px solid var(--rule)', paddingTop: 14, marginTop: 14 }}>
      <div className="eyebrow" style={{ ...eyebrowStyle, marginBottom: 4 }}>{title}</div>
      <p style={{ margin: '0 0 10px', fontSize: 11, color: 'var(--ink-3)', lineHeight: 1.5 }}>
        {helpText}
      </p>
      {children}
    </div>
  );
}

function placeholderForKind(kind: 'date' | 'money' | 'integer' | 'percent'): string {
  switch (kind) {
    case 'date': return 'YYYY-MM-DD';
    case 'money': return 'Dollars (e.g. 7500)';
    case 'integer': return 'Whole number';
    case 'percent': return '22 or 0.22';
  }
}

/**
 * Precise-mode authoring doesn't have a Claude round-trip, so the rich
 * metadata fields get sensible defaults: ourPosition is 'restructure' (we
 * authored a substantively new term), ownerAsk is a tag indicating staff
 * authorship, reviewPriority normal, sensitiveSection false. The user can
 * still see + override via the projection's main edit form if they need
 * to flip something to high.
 */
function buildPreciseEdits(
  fieldChanges: DraftFieldChange[],
  clausesToAdd: DraftClauseAdd[],
): ContractRedlineEdits | null {
  const builtFieldChanges = fieldChanges
    .filter((r) => r.field && r.newValueText.trim() !== '')
    .map((r) => {
      const field = r.field as EditableField;
      const kind = FIELD_DESCRIPTORS[field].kind;
      let newValue: string | number;
      if (kind === 'date') {
        newValue = r.newValueText.trim();
      } else {
        const cleaned = r.newValueText.replace(/[^0-9.\-]/g, '');
        const n = Number(cleaned);
        if (!Number.isFinite(n)) {
          newValue = r.newValueText.trim();
        } else if (kind === 'percent') {
          newValue = n > 1 ? n / 100 : n;
        } else if (kind === 'integer') {
          newValue = Math.round(n);
        } else {
          newValue = n;
        }
      }
      return {
        field,
        new_value: newValue,
        ownerAsk: '(staff-authored, no owner ask)',
        ourPosition: 'restructure' as RedlinePosition,
        positionDetail: r.reason.trim() || 'Manual precise-mode edit.',
        reviewPriority: 'normal' as const,
        sensitiveSection: false,
      };
    });

  const builtClauseAdds = clausesToAdd
    .filter((r) => r.title.trim() && r.body.trim())
    .map((r) => ({
      title: r.title.trim(),
      body: r.body.trim(),
      ownerAsk: '(staff-authored, no owner ask)',
      ourPosition: 'restructure' as RedlinePosition,
      positionDetail: r.reason.trim() || 'Manual precise-mode addition.',
      reviewPriority: 'normal' as const,
      sensitiveSection: false,
    }));

  if (builtFieldChanges.length === 0 && builtClauseAdds.length === 0) return null;

  const counts = [
    builtFieldChanges.length
      ? `${builtFieldChanges.length} field ${builtFieldChanges.length === 1 ? 'change' : 'changes'}`
      : null,
    builtClauseAdds.length
      ? `${builtClauseAdds.length} new ${builtClauseAdds.length === 1 ? 'clause' : 'clauses'}`
      : null,
  ]
    .filter(Boolean)
    .join(' + ');

  return {
    field_changes: builtFieldChanges,
    clauses_to_add: builtClauseAdds,
    clauses_to_edit: [],
    clauses_to_remove: [],
    summary: `Staff-authored precise edits: ${counts}.`,
  };
}

// ─── Preview (shared between modes) ─────────────────────────────────────────

/**
 * Render preview of the structured edit set. Sensitive items (anything
 * with sensitiveSection: true or reviewPriority: 'high') get pulled to a
 * dedicated block at the top under "Attorney review recommended" — same
 * UI shape as the rest, just with a signal-accent border and a
 * stand-alone position in the doc.
 */
function Preview({
  edits,
  projection,
  acceptance,
  setAcceptance,
}: {
  edits: ContractRedlineEdits;
  projection: ProjectionRow;
  acceptance: Acceptance;
  setAcceptance: (a: Acceptance) => void;
}) {
  const projectionAsRecord = projection as unknown as Record<string, string | number | null>;
  const currentClauses = useMemo(() => projection.custom_clauses ?? [], [projection.custom_clauses]);

  // Partition each change list into sensitive / standard with the original
  // index preserved so the acceptance toggles map back to the right slot.
  type WithIdx<T> = { item: T; index: number };
  const partition = <T extends { sensitiveSection: boolean; reviewPriority: 'normal' | 'high' }>(
    arr: T[],
  ): { sensitive: WithIdx<T>[]; standard: WithIdx<T>[] } => {
    const sensitive: WithIdx<T>[] = [];
    const standard: WithIdx<T>[] = [];
    arr.forEach((item, index) => {
      if (item.sensitiveSection || item.reviewPriority === 'high') {
        sensitive.push({ item, index });
      } else {
        standard.push({ item, index });
      }
    });
    return { sensitive, standard };
  };

  const fc = partition(edits.field_changes);
  const ca = partition(edits.clauses_to_add);
  const ce = partition(edits.clauses_to_edit);
  const cr = partition(edits.clauses_to_remove);

  const sensitiveTotal =
    fc.sensitive.length + ca.sensitive.length + ce.sensitive.length + cr.sensitive.length;
  const totalChanges =
    edits.field_changes.length + edits.clauses_to_add.length + edits.clauses_to_edit.length + edits.clauses_to_remove.length;

  const toggleFieldChange = (i: number) =>
    setAcceptance({
      ...acceptance,
      fieldChanges: acceptance.fieldChanges.map((v, j) => (j === i ? !v : v)),
    });
  const toggleClauseAdd = (i: number) =>
    setAcceptance({
      ...acceptance,
      clauseAdds: acceptance.clauseAdds.map((v, j) => (j === i ? !v : v)),
    });
  const toggleClauseEdit = (i: number) =>
    setAcceptance({
      ...acceptance,
      clauseEdits: acceptance.clauseEdits.map((v, j) => (j === i ? !v : v)),
    });
  const toggleClauseRemove = (i: number) =>
    setAcceptance({
      ...acceptance,
      clauseRemoves: acceptance.clauseRemoves.map((v, j) => (j === i ? !v : v)),
    });

  const renderFieldRow = (
    entry: { item: ContractRedlineEdits['field_changes'][number]; index: number },
    key: number,
  ) => {
    const { item: c, index: i } = entry;
    const f = c.field as EditableField;
    const current = projectionAsRecord[f];
    const accepted = acceptance.fieldChanges[i] ?? true;
    return (
      <FieldChangeReviewRow
        key={`fc-${i}-${key}`}
        accepted={accepted}
        onToggle={() => toggleFieldChange(i)}
        label={FIELD_DESCRIPTORS[f].label}
        currentValue={formatFieldValueForPreview(f, current ?? null)}
        newValue={formatFieldValueForPreview(f, c.new_value)}
        ownerAsk={c.ownerAsk}
        ourPosition={c.ourPosition}
        positionDetail={c.positionDetail}
        sensitive={c.sensitiveSection || c.reviewPriority === 'high'}
      />
    );
  };

  return (
    <div style={previewStyle}>
      <div style={previewSummaryStyle}>
        <div className="eyebrow" style={eyebrowStyle}>Summary</div>
        <p style={{ margin: '6px 0 0', fontSize: 13, lineHeight: 1.55, color: 'var(--ink)' }}>
          {edits.summary}
        </p>
        <p style={{ margin: '8px 0 0', fontSize: 11, color: 'var(--ink-3)', fontStyle: 'italic' }}>
          Uncheck any edit you don&rsquo;t want applied. Use Iterate below to send refinements back to Claude.
        </p>
      </div>

      {sensitiveTotal > 0 && (
        <div style={attorneyBlockStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
            <span
              style={{
                background: 'var(--signal)',
                color: 'var(--paper)',
                fontSize: 9,
                letterSpacing: '.22em',
                textTransform: 'uppercase',
                padding: '3px 6px',
                fontWeight: 600,
              }}
            >
              Attorney review recommended
            </span>
            <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>
              {sensitiveTotal} of {totalChanges} {totalChanges === 1 ? 'edit' : 'edits'} touches a sensitive section
            </span>
          </div>
          <p style={{ margin: '4px 0 10px', fontSize: 11, color: 'var(--ink-3)', lineHeight: 1.55 }}>
            These changes draft a candidate the same as any other edit — they&rsquo;re not blocked. They&rsquo;re
            surfaced here because they touch hard-coded legal language (Liability, Force Majeure, Governing Law,
            etc.) and warrant a counsel pass before the contract goes back to the owner.
          </p>

          {fc.sensitive.map((e, k) => renderFieldRow(e, k))}
          {ca.sensitive.map((e) => (
            <ClauseCard
              key={`ca-sens-${e.index}`}
              title={e.item.title}
              body={e.item.body}
              ownerAsk={e.item.ownerAsk}
              ourPosition={e.item.ourPosition}
              positionDetail={e.item.positionDetail}
              sensitive
              kind="add"
              accepted={acceptance.clauseAdds[e.index] ?? true}
              onToggle={() => toggleClauseAdd(e.index)}
            />
          ))}
          {ce.sensitive.map((e) => {
            const current = currentClauses[e.item.index];
            return (
              <ClauseCard
                key={`ce-sens-${e.index}`}
                title={e.item.title ?? current?.title ?? '(missing)'}
                body={e.item.body ?? current?.body ?? '(missing)'}
                ownerAsk={e.item.ownerAsk}
                ourPosition={e.item.ourPosition}
                positionDetail={e.item.positionDetail}
                sensitive
                kind="edit"
                accepted={acceptance.clauseEdits[e.index] ?? true}
                onToggle={() => toggleClauseEdit(e.index)}
              />
            );
          })}
          {cr.sensitive.map((e) => {
            const current = currentClauses[e.item.index];
            return (
              <ClauseCard
                key={`cr-sens-${e.index}`}
                title={current?.title ?? `Clause #${e.item.index}`}
                body={current?.body ?? ''}
                ownerAsk={e.item.ownerAsk}
                ourPosition={e.item.ourPosition}
                positionDetail={e.item.positionDetail}
                sensitive
                kind="remove"
                accepted={acceptance.clauseRemoves[e.index] ?? true}
                onToggle={() => toggleClauseRemove(e.index)}
              />
            );
          })}
        </div>
      )}

      {fc.standard.length > 0 && (
        <PreviewBlock title="Field changes">
          {fc.standard.map((e, k) => renderFieldRow(e, k))}
        </PreviewBlock>
      )}

      {ca.standard.length > 0 && (
        <PreviewBlock title="Clauses to add">
          {ca.standard.map((e) => (
            <ClauseCard
              key={`ca-${e.index}`}
              title={e.item.title}
              body={e.item.body}
              ownerAsk={e.item.ownerAsk}
              ourPosition={e.item.ourPosition}
              positionDetail={e.item.positionDetail}
              sensitive={false}
              kind="add"
              accepted={acceptance.clauseAdds[e.index] ?? true}
              onToggle={() => toggleClauseAdd(e.index)}
            />
          ))}
        </PreviewBlock>
      )}

      {ce.standard.length > 0 && (
        <PreviewBlock title="Clauses to edit">
          {ce.standard.map((e) => {
            const current = currentClauses[e.item.index];
            return (
              <ClauseCard
                key={`ce-${e.index}`}
                title={e.item.title ?? current?.title ?? '(missing)'}
                body={e.item.body ?? current?.body ?? '(missing)'}
                ownerAsk={e.item.ownerAsk}
                ourPosition={e.item.ourPosition}
                positionDetail={e.item.positionDetail}
                sensitive={false}
                kind="edit"
                accepted={acceptance.clauseEdits[e.index] ?? true}
                onToggle={() => toggleClauseEdit(e.index)}
              />
            );
          })}
        </PreviewBlock>
      )}

      {cr.standard.length > 0 && (
        <PreviewBlock title="Clauses to remove">
          {cr.standard.map((e) => {
            const current = currentClauses[e.item.index];
            return (
              <ClauseCard
                key={`cr-${e.index}`}
                title={current?.title ?? `Clause #${e.item.index}`}
                body={current?.body ?? ''}
                ownerAsk={e.item.ownerAsk}
                ourPosition={e.item.ourPosition}
                positionDetail={e.item.positionDetail}
                sensitive={false}
                kind="remove"
                accepted={acceptance.clauseRemoves[e.index] ?? true}
                onToggle={() => toggleClauseRemove(e.index)}
              />
            );
          })}
        </PreviewBlock>
      )}

      {totalChanges === 0 && (
        <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-3)', fontStyle: 'italic' }}>
          Nothing actionable was staged. Discard and try again.
        </p>
      )}
    </div>
  );
}

/**
 * Field-change preview row (used in the Review preview only — distinct
 * from FieldChangeRow above which is the Precise-mode builder row).
 * Renders a checkbox + diff + the three-field rationale stacked
 * underneath. Sensitive items get a thin signal accent on the left edge.
 */
function FieldChangeReviewRow({
  accepted,
  onToggle,
  label,
  currentValue,
  newValue,
  ownerAsk,
  ourPosition,
  positionDetail,
  sensitive,
}: {
  accepted: boolean;
  onToggle: () => void;
  label: string;
  currentValue: string;
  newValue: string;
  ownerAsk: string;
  ourPosition: RedlinePosition;
  positionDetail: string;
  sensitive: boolean;
}) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'auto 1fr',
        gap: 10,
        padding: '10px 12px',
        marginBottom: 8,
        border: '1px solid var(--rule)',
        borderLeft: sensitive ? '3px solid var(--signal)' : '1px solid var(--rule)',
        background: 'var(--paper)',
        opacity: accepted ? 1 : 0.45,
      }}
    >
      <input
        type="checkbox"
        checked={accepted}
        onChange={onToggle}
        aria-label={`Accept change to ${label}`}
        style={{ marginTop: 4 }}
      />
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
          <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink)' }}>{label}</span>
          <span style={{ fontSize: 11, color: 'var(--ink-3)', textDecoration: 'line-through' }}>{currentValue}</span>
          <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>→</span>
          <span style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink)' }}>{newValue}</span>
          <PositionPill position={ourPosition} />
        </div>
        <RationaleStack ownerAsk={ownerAsk} positionDetail={positionDetail} />
      </div>
    </div>
  );
}

function PositionPill({ position }: { position: RedlinePosition }) {
  const tones: Record<RedlinePosition, { bg: string; fg: string }> = {
    accept: { bg: 'rgba(74, 157, 107, 0.18)', fg: '#3a7a55' },
    'accept-with-modification': { bg: 'rgba(184, 155, 110, 0.22)', fg: '#7c6638' },
    counter: { bg: 'rgba(200, 90, 58, 0.18)', fg: 'var(--signal)' },
    hold: { bg: 'rgba(80, 100, 112, 0.18)', fg: 'var(--ink-3)' },
    restructure: { bg: 'rgba(80, 100, 112, 0.18)', fg: 'var(--ink-3)' },
  };
  const t = tones[position];
  return (
    <span
      style={{
        fontSize: 9,
        letterSpacing: '.18em',
        textTransform: 'uppercase',
        padding: '3px 6px',
        background: t.bg,
        color: t.fg,
        fontWeight: 600,
      }}
    >
      {POSITION_LABELS[position]}
    </span>
  );
}

function RationaleStack({ ownerAsk, positionDetail }: { ownerAsk: string; positionDetail: string }) {
  return (
    <div style={{ marginTop: 6, fontSize: 11, lineHeight: 1.55 }}>
      <div style={{ color: 'var(--ink-3)' }}>
        <span
          style={{
            fontSize: 9,
            letterSpacing: '.22em',
            textTransform: 'uppercase',
            color: 'var(--ink-4)',
            fontWeight: 600,
            marginRight: 6,
          }}
        >
          Owner asked
        </span>
        {ownerAsk}
      </div>
      <div style={{ color: 'var(--ink)', marginTop: 4 }}>
        <span
          style={{
            fontSize: 9,
            letterSpacing: '.22em',
            textTransform: 'uppercase',
            color: 'var(--ink-4)',
            fontWeight: 600,
            marginRight: 6,
          }}
        >
          Our position
        </span>
        {positionDetail}
      </div>
    </div>
  );
}

function PreviewBlock({
  title,
  children,
  tone,
}: {
  title: string;
  children: React.ReactNode;
  tone?: 'warning';
}) {
  return (
    <div
      style={{
        borderTop: `1px solid ${tone === 'warning' ? 'var(--signal)' : 'var(--rule)'}`,
        paddingTop: 12,
        marginTop: 14,
      }}
    >
      <div
        className="eyebrow"
        style={{
          ...eyebrowStyle,
          color: tone === 'warning' ? 'var(--signal)' : 'var(--ink-3)',
          marginBottom: 8,
        }}
      >
        {title}
      </div>
      {children}
    </div>
  );
}

function ClauseCard({
  title,
  body,
  ownerAsk,
  ourPosition,
  positionDetail,
  kind,
  accepted,
  onToggle,
  sensitive,
}: {
  title: string;
  body: string;
  ownerAsk: string;
  ourPosition: RedlinePosition;
  positionDetail: string;
  kind: 'add' | 'edit' | 'remove';
  accepted: boolean;
  onToggle: () => void;
  sensitive: boolean;
}) {
  const kindAccent =
    kind === 'remove' ? 'var(--signal)' : kind === 'edit' ? '#B89B6E' : 'var(--positive, #4a9d6b)';
  const leftAccent = sensitive ? 'var(--signal)' : kindAccent;
  return (
    <div
      style={{
        borderLeft: `3px solid ${leftAccent}`,
        padding: '10px 12px',
        marginBottom: 10,
        background: 'var(--paper-2)',
        opacity: accepted ? 1 : 0.45,
        display: 'grid',
        gridTemplateColumns: 'auto 1fr',
        gap: 10,
        alignItems: 'flex-start',
      }}
    >
      <input
        type="checkbox"
        checked={accepted}
        onChange={onToggle}
        aria-label={`Accept clause: ${title}`}
        style={{ marginTop: 4 }}
      />
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
          <span className="font-serif" style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)' }}>
            {title}
          </span>
          <PositionPill position={ourPosition} />
        </div>
        <p style={{ margin: 0, fontSize: 12, color: 'var(--ink)', lineHeight: 1.55 }}>{body}</p>
        <RationaleStack ownerAsk={ownerAsk} positionDetail={positionDetail} />
      </div>
    </div>
  );
}

function hasAnyChanges(edits: ContractRedlineEdits): boolean {
  return (
    edits.field_changes.length > 0 ||
    edits.clauses_to_add.length > 0 ||
    edits.clauses_to_edit.length > 0 ||
    edits.clauses_to_remove.length > 0
  );
}

function initAcceptance(edits: ContractRedlineEdits): Acceptance {
  return {
    fieldChanges: edits.field_changes.map(() => true),
    clauseAdds: edits.clauses_to_add.map(() => true),
    clauseEdits: edits.clauses_to_edit.map(() => true),
    clauseRemoves: edits.clauses_to_remove.map(() => true),
  };
}

/**
 * Return a new edit set containing only the entries the reviewer accepted.
 * Summary is preserved so the post-apply confirmation reads the
 * position-framed sentence Claude generated.
 */
function filterEditsByAcceptance(edits: ContractRedlineEdits, accept: Acceptance): ContractRedlineEdits {
  return {
    field_changes: edits.field_changes.filter((_, i) => accept.fieldChanges[i] ?? true),
    clauses_to_add: edits.clauses_to_add.filter((_, i) => accept.clauseAdds[i] ?? true),
    clauses_to_edit: edits.clauses_to_edit.filter((_, i) => accept.clauseEdits[i] ?? true),
    clauses_to_remove: edits.clauses_to_remove.filter((_, i) => accept.clauseRemoves[i] ?? true),
    summary: edits.summary,
  };
}

// ─── styles ─────────────────────────────────────────────────────────────────

const panelStyle: React.CSSProperties = {
  border: '1px solid var(--rule)',
  padding: 22,
  background: 'var(--paper-2)',
};
const panelHeadStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  gap: 12,
  marginBottom: 6,
};
const eyebrowStyle: React.CSSProperties = {
  fontSize: 10,
  letterSpacing: '.18em',
  textTransform: 'uppercase',
  color: 'var(--ink-3)',
  fontWeight: 600,
};
const titleStyle: React.CSSProperties = {
  fontSize: 18,
  fontWeight: 400,
  letterSpacing: '-0.01em',
  color: 'var(--ink)',
  margin: '4px 0 0',
};
const ledeStyle: React.CSSProperties = {
  margin: '14px 0 14px',
  fontSize: 12,
  color: 'var(--ink-3)',
  lineHeight: 1.55,
  maxWidth: 760,
};
const toggleWrapStyle: React.CSSProperties = {
  display: 'inline-flex',
  border: '1px solid var(--ink)',
  marginTop: 10,
};
const toggleActiveStyle: React.CSSProperties = {
  background: 'var(--ink)',
  color: 'var(--paper)',
  fontSize: 11,
  fontWeight: 500,
  letterSpacing: '.18em',
  textTransform: 'uppercase',
  padding: '10px 18px',
  border: 'none',
  cursor: 'pointer',
};
const toggleInactiveStyle: React.CSSProperties = {
  background: 'transparent',
  color: 'var(--ink)',
  fontSize: 11,
  fontWeight: 500,
  letterSpacing: '.18em',
  textTransform: 'uppercase',
  padding: '10px 18px',
  border: 'none',
  cursor: 'pointer',
};
const textareaStyle: React.CSSProperties = {
  width: '100%',
  border: '1px solid var(--rule)',
  borderBottom: '1px solid var(--ink)',
  background: 'transparent',
  color: 'var(--ink)',
  fontSize: 13,
  padding: '10px 12px',
  outline: 'none',
  boxSizing: 'border-box',
  fontFamily: 'inherit',
  lineHeight: 1.55,
  resize: 'vertical',
};
const inputStyle: React.CSSProperties = {
  border: '1px solid var(--rule)',
  borderBottom: '1px solid var(--ink)',
  background: 'transparent',
  color: 'var(--ink)',
  fontSize: 12,
  padding: '8px 10px',
  outline: 'none',
  fontFamily: 'inherit',
  width: '100%',
  boxSizing: 'border-box',
};
const selectStyle: React.CSSProperties = {
  border: '1px solid var(--rule)',
  borderBottom: '1px solid var(--ink)',
  background: 'transparent',
  color: 'var(--ink)',
  fontSize: 12,
  padding: '8px 10px',
  outline: 'none',
  fontFamily: 'inherit',
  width: '100%',
  boxSizing: 'border-box',
};
const builderRowStyle: React.CSSProperties = {
  padding: '10px 12px',
  border: '1px solid var(--rule)',
  background: 'var(--paper)',
};
const builderEmptyStyle: React.CSSProperties = {
  margin: 0,
  fontSize: 12,
  color: 'var(--ink-4)',
  fontStyle: 'italic',
};
const addRowButtonStyle: React.CSSProperties = {
  marginTop: 10,
  background: 'transparent',
  color: 'var(--ink-3)',
  fontSize: 11,
  fontWeight: 500,
  letterSpacing: '.18em',
  textTransform: 'uppercase',
  padding: '10px 14px',
  border: '1px dashed var(--rule)',
  cursor: 'pointer',
};
const removeButtonStyle: React.CSSProperties = {
  background: 'transparent',
  color: 'var(--ink-3)',
  fontSize: 18,
  lineHeight: 1,
  padding: '4px 8px',
  border: 'none',
  cursor: 'pointer',
};
const actionsRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  marginTop: 12,
};
const primaryButtonStyle: React.CSSProperties = {
  background: 'var(--ink)',
  color: 'var(--paper)',
  fontSize: 11,
  fontWeight: 500,
  letterSpacing: '.18em',
  textTransform: 'uppercase',
  padding: '13px 22px',
  border: '1px solid var(--ink)',
  cursor: 'pointer',
};
const secondaryButtonStyle: React.CSSProperties = {
  background: 'transparent',
  color: 'var(--ink-3)',
  fontSize: 11,
  fontWeight: 500,
  letterSpacing: '.18em',
  textTransform: 'uppercase',
  padding: '13px 18px',
  border: '1px solid var(--rule)',
  cursor: 'pointer',
};
const resetButtonStyle: React.CSSProperties = {
  ...secondaryButtonStyle,
  padding: '8px 14px',
  fontSize: 10,
};
const hintStyle: React.CSSProperties = {
  fontSize: 11,
  color: 'var(--ink-4)',
  fontStyle: 'italic',
};
const previewStyle: React.CSSProperties = {
  marginTop: 14,
};
const previewSummaryStyle: React.CSSProperties = {
  borderLeft: '3px solid var(--signal)',
  padding: '6px 12px',
  background: 'var(--paper)',
};
const diffTableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: 12,
};
const diffCheckStyle: React.CSSProperties = {
  width: 28,
  padding: 8,
  verticalAlign: 'middle',
};
const refineBlockStyle: React.CSSProperties = {
  marginTop: 18,
  padding: '12px 14px',
  border: '1px dashed var(--rule)',
  background: 'var(--paper)',
};
const attorneyBlockStyle: React.CSSProperties = {
  marginTop: 14,
  padding: '14px 16px',
  borderTop: '2px solid var(--signal)',
  borderBottom: '1px solid var(--rule)',
  background: 'var(--paper)',
};
const diffRowStyle: React.CSSProperties = {
  borderBottom: '1px solid var(--rule)',
};
const diffLabelStyle: React.CSSProperties = {
  padding: '8px 8px 8px 0',
  fontWeight: 500,
  color: 'var(--ink)',
  whiteSpace: 'nowrap',
};
const diffOldStyle: React.CSSProperties = {
  padding: 8,
  color: 'var(--ink-3)',
  textDecoration: 'line-through',
  whiteSpace: 'nowrap',
};
const diffArrowStyle: React.CSSProperties = {
  padding: 8,
  color: 'var(--ink-4)',
};
const diffNewStyle: React.CSSProperties = {
  padding: 8,
  color: 'var(--ink)',
  fontWeight: 500,
  whiteSpace: 'nowrap',
};
const diffReasonStyle: React.CSSProperties = {
  padding: 8,
  color: 'var(--ink-3)',
  fontStyle: 'italic',
  fontSize: 11,
  lineHeight: 1.5,
};
const errorStyle: React.CSSProperties = {
  marginTop: 12,
  padding: 10,
  borderLeft: '3px solid var(--signal)',
  background: 'var(--paper)',
  fontSize: 12,
  color: 'var(--ink)',
};
const recentChipStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  marginTop: 6,
  padding: '4px 10px',
  background: 'rgba(74, 157, 107, 0.14)',
  color: '#2a5e3f',
  fontSize: 11,
  fontWeight: 500,
  letterSpacing: '.02em',
};
const recentChipDotStyle: React.CSSProperties = {
  width: 6,
  height: 6,
  borderRadius: '50%',
  background: '#4a9d6b',
  display: 'inline-block',
};
const appliedBannerStyle: React.CSSProperties = {
  marginTop: 16,
  padding: '18px 20px',
  background: 'rgba(74, 157, 107, 0.10)',
  borderLeft: '4px solid #4a9d6b',
  border: '1px solid rgba(74, 157, 107, 0.30)',
};
const appliedCheckStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  justifyContent: 'center',
  width: 26,
  height: 26,
  borderRadius: '50%',
  background: '#4a9d6b',
  color: 'var(--paper)',
  fontSize: 16,
  fontWeight: 600,
};
const appliedListStyle: React.CSSProperties = {
  margin: '6px 0 0',
  paddingLeft: 18,
  fontSize: 12,
  color: 'var(--ink)',
  lineHeight: 1.7,
};
const appliedRowMetaStyle: React.CSSProperties = {
  marginLeft: 8,
  fontSize: 9,
  letterSpacing: '.18em',
  textTransform: 'uppercase',
  color: 'var(--ink-3)',
  fontWeight: 600,
};
const appliedHeadsUpStyle: React.CSSProperties = {
  margin: '12px 0 0',
  fontSize: 11,
  color: 'var(--ink-3)',
  fontStyle: 'italic',
};
