'use client';

import { useMemo, useState, useTransition } from 'react';
import { proposeContractRedlines, applyContractRedlines } from '@/app/projections/actions';
import {
  FIELD_DESCRIPTORS,
  formatFieldValueForPreview,
  type ContractRedlineEdits,
  type EditableField,
} from '@/lib/projection-redlines';
import type { ProjectionRow } from '@/lib/projections-types';

type Mode = 'interpret' | 'precise';
type Step = 'input' | 'preview' | 'applied';

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
  const [mode, setMode] = useState<Mode>('interpret');
  const [step, setStep] = useState<Step>('input');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  // Interpret-mode input state
  const [text, setText] = useState('');

  // Precise-mode input state: lightweight staging of an edit set
  const [draftFieldChanges, setDraftFieldChanges] = useState<DraftFieldChange[]>([]);
  const [draftClausesToAdd, setDraftClausesToAdd] = useState<DraftClauseAdd[]>([]);

  // Preview state — set when transitioning into the preview step from
  // either mode. Holds the actual ContractRedlineEdits being applied.
  const [edits, setEdits] = useState<ContractRedlineEdits | null>(null);

  const resetAll = () => {
    setStep('input');
    setText('');
    setDraftFieldChanges([]);
    setDraftClausesToAdd([]);
    setEdits(null);
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
    setStep('preview');
  };

  const applyEdits = () => {
    if (!edits) return;
    setError(null);
    startTransition(async () => {
      const res = await applyContractRedlines(projection.id, edits);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setStep('applied');
    });
  };

  return (
    <div style={panelStyle}>
      <div style={panelHeadStyle}>
        <div>
          <div className="eyebrow" style={eyebrowStyle}>Owner Redlines</div>
          <h3 className="font-serif" style={titleStyle}>Apply contract edits from the owner</h3>
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
          <Preview edits={edits} projection={projection} />
          <div style={actionsRowStyle}>
            <button
              type="button"
              onClick={applyEdits}
              disabled={pending || !hasAnyChanges(edits)}
              style={primaryButtonStyle}
            >
              {pending ? 'Applying…' : hasAnyChanges(edits) ? 'Apply edits' : 'No edits to apply'}
            </button>
            <button type="button" onClick={resetAll} style={secondaryButtonStyle} disabled={pending}>
              Discard
            </button>
          </div>
        </>
      )}

      {step === 'applied' && (
        <div style={successStyle}>
          <strong>Applied.</strong> The contract preview and downloads now reflect these edits.
          <div style={{ marginTop: 12 }}>
            <button type="button" onClick={resetAll} style={secondaryButtonStyle}>
              Run another round
            </button>
          </div>
        </div>
      )}

      {error && <div style={errorStyle}>{error}</div>}
    </div>
  );
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
        maxLength={4000}
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
        <span style={hintStyle}>{text.length}/4000 · Claude reads, you approve.</span>
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
          // Will surface as null on apply; better than silent corruption.
          newValue = r.newValueText.trim();
        } else if (kind === 'percent') {
          // Allow either 22 or 0.22; normalize to decimal.
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
        reason: r.reason.trim() || 'Manual precise-mode edit.',
      };
    });

  const builtClauseAdds = clausesToAdd
    .filter((r) => r.title.trim() && r.body.trim())
    .map((r) => ({
      title: r.title.trim(),
      body: r.body.trim(),
      reason: r.reason.trim() || 'Manual precise-mode addition.',
    }));

  if (builtFieldChanges.length === 0 && builtClauseAdds.length === 0) return null;

  const summary = [
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
    unsupported_requests: [],
    summary: `Precise-mode edits: ${summary}.`,
  };
}

// ─── Preview (shared between modes) ─────────────────────────────────────────

function Preview({ edits, projection }: { edits: ContractRedlineEdits; projection: ProjectionRow }) {
  const hasFieldChanges = edits.field_changes.length > 0;
  const hasClauseAdds = edits.clauses_to_add.length > 0;
  const hasClauseEdits = edits.clauses_to_edit.length > 0;
  const hasClauseRemoves = edits.clauses_to_remove.length > 0;
  const hasUnsupported = edits.unsupported_requests.length > 0;

  const projectionAsRecord = projection as unknown as Record<string, string | number | null>;
  const currentClauses = useMemo(() => projection.custom_clauses ?? [], [projection.custom_clauses]);

  return (
    <div style={previewStyle}>
      <div style={previewSummaryStyle}>
        <div className="eyebrow" style={eyebrowStyle}>Summary</div>
        <p style={{ margin: '6px 0 0', fontSize: 13, lineHeight: 1.55, color: 'var(--ink)' }}>
          {edits.summary}
        </p>
      </div>

      {hasFieldChanges && (
        <PreviewBlock title="Field changes">
          <table style={diffTableStyle}>
            <tbody>
              {edits.field_changes.map((c, i) => {
                const f = c.field as EditableField;
                const current = projectionAsRecord[f];
                return (
                  <tr key={i} style={diffRowStyle}>
                    <td style={diffLabelStyle}>{FIELD_DESCRIPTORS[f].label}</td>
                    <td style={diffOldStyle}>{formatFieldValueForPreview(f, current ?? null)}</td>
                    <td style={diffArrowStyle}>→</td>
                    <td style={diffNewStyle}>{formatFieldValueForPreview(f, c.new_value)}</td>
                    <td style={diffReasonStyle}>{c.reason}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </PreviewBlock>
      )}

      {hasClauseAdds && (
        <PreviewBlock title="Clauses to add">
          {edits.clauses_to_add.map((c, i) => (
            <ClauseCard key={i} title={c.title} body={c.body} reason={c.reason} kind="add" />
          ))}
        </PreviewBlock>
      )}

      {hasClauseEdits && (
        <PreviewBlock title="Clauses to edit">
          {edits.clauses_to_edit.map((c, i) => {
            const current = currentClauses[c.index];
            return (
              <ClauseCard
                key={i}
                title={c.title ?? current?.title ?? '(missing)'}
                body={c.body ?? current?.body ?? '(missing)'}
                reason={c.reason}
                kind="edit"
              />
            );
          })}
        </PreviewBlock>
      )}

      {hasClauseRemoves && (
        <PreviewBlock title="Clauses to remove">
          {edits.clauses_to_remove.map((c, i) => {
            const current = currentClauses[c.index];
            return (
              <ClauseCard
                key={i}
                title={current?.title ?? `Clause #${c.index}`}
                body={current?.body ?? ''}
                reason={c.reason}
                kind="remove"
              />
            );
          })}
        </PreviewBlock>
      )}

      {hasUnsupported && (
        <PreviewBlock title="Needs out-of-band handling" tone="warning">
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: 12, color: 'var(--ink)', lineHeight: 1.6 }}>
            {edits.unsupported_requests.map((u, i) => (
              <li key={i} style={{ marginBottom: 6 }}>{u}</li>
            ))}
          </ul>
          <p style={{ margin: '10px 0 0', fontSize: 11, color: 'var(--ink-3)', fontStyle: 'italic' }}>
            These touch hard-coded legal boilerplate or fall outside the editable scope. Handle by hand
            or loop in counsel; not applied automatically.
          </p>
        </PreviewBlock>
      )}

      {!hasFieldChanges && !hasClauseAdds && !hasClauseEdits && !hasClauseRemoves && !hasUnsupported && (
        <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-3)', fontStyle: 'italic' }}>
          Nothing actionable was staged. Discard and try again.
        </p>
      )}
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
  reason,
  kind,
}: {
  title: string;
  body: string;
  reason: string;
  kind: 'add' | 'edit' | 'remove';
}) {
  const accent = kind === 'remove' ? 'var(--signal)' : kind === 'edit' ? '#B89B6E' : 'var(--positive, #4a9d6b)';
  return (
    <div style={{ borderLeft: `3px solid ${accent}`, padding: '6px 12px', marginBottom: 10, background: 'var(--paper-2)' }}>
      <div className="font-serif" style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)', marginBottom: 4 }}>
        {title}
      </div>
      <p style={{ margin: 0, fontSize: 12, color: 'var(--ink)', lineHeight: 1.55 }}>{body}</p>
      <p style={{ margin: '6px 0 0', fontSize: 11, fontStyle: 'italic', color: 'var(--ink-3)' }}>{reason}</p>
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
const successStyle: React.CSSProperties = {
  marginTop: 14,
  padding: 12,
  borderLeft: '3px solid #4a9d6b',
  background: 'var(--paper)',
  fontSize: 13,
  color: 'var(--ink)',
};
const errorStyle: React.CSSProperties = {
  marginTop: 12,
  padding: 10,
  borderLeft: '3px solid var(--signal)',
  background: 'var(--paper)',
  fontSize: 12,
  color: 'var(--ink)',
};
