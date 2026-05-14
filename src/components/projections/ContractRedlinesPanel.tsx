'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { proposeContractRedlines, applyContractRedlines } from '@/app/projections/actions';
import {
  ACTION_LABELS,
  FIELD_DESCRIPTORS,
  formatFieldValueForPreview,
  POSITION_LABELS,
  type ContractOverrideEditT,
  type ContractRedlineEdits,
  type EditableField,
  type RedlinePosition,
} from '@/lib/projection-redlines';
import type { ProjectionRow } from '@/lib/projections-types';

type Mode = 'interpret' | 'precise';
type Step = 'input' | 'preview' | 'applied';

/**
 * Per-edit accept/reject state. fieldChanges array indexes into
 * edits.field_changes; overrides array indexes into edits.contract_overrides.
 * true = include in apply; false = skip.
 */
type Acceptance = {
  fieldChanges: boolean[];
  overrides: boolean[];
};

const EDITABLE_FIELDS: readonly EditableField[] = Object.keys(FIELD_DESCRIPTORS) as EditableField[];

export function ContractRedlinesPanel({ projection }: { projection: ProjectionRow }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>('interpret');
  const [step, setStep] = useState<Step>('input');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const [lastApplied, setLastApplied] = useState<{
    at: Date;
    edits: ContractRedlineEdits;
    selectedCount: number;
    /** Per-override apply failures detected by the server's dry-run.
     *  Empty when everything landed cleanly. */
    failures: { summary: string }[];
  } | null>(null);

  // Interpret-mode input state
  const [text, setText] = useState('');

  // Precise-mode input state: field-only builder (clause authoring needs
  // clause IDs which precise-mode users don't have — Interpret is the
  // path for clause edits in this v1).
  const [draftFieldChanges, setDraftFieldChanges] = useState<DraftFieldChange[]>([]);

  const [edits, setEdits] = useState<ContractRedlineEdits | null>(null);

  const [acceptance, setAcceptance] = useState<Acceptance>({ fieldChanges: [], overrides: [] });

  const [originalText, setOriginalText] = useState('');
  const [iterationText, setIterationText] = useState('');

  const resetAll = () => {
    setStep('input');
    setText('');
    setDraftFieldChanges([]);
    setEdits(null);
    setAcceptance({ fieldChanges: [], overrides: [] });
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
    const built = buildPreciseEdits(draftFieldChanges);
    if (!built) {
      setError('Add at least one field change first.');
      return;
    }
    setEdits(built);
    setAcceptance(initAcceptance(built));
    setOriginalText('');
    setIterationText('');
    setStep('preview');
  };

  const iterate = () => {
    const refinement = iterationText.trim();
    if (!refinement || !originalText) return;
    setError(null);
    const combined =
      `Original owner request:\n${originalText}\n\n` +
      `Refinement notes from staff reviewer:\n${refinement}\n\n` +
      `Re-interpret with both in mind. Refinement notes take precedence on conflicts.`;
    startTransition(async () => {
      const res = await proposeContractRedlines(projection.id, combined);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setEdits(res.edits);
      setAcceptance(initAcceptance(res.edits));
      setIterationText('');
    });
  };

  const applyEdits = () => {
    if (!edits) return;
    const filtered = filterEditsByAcceptance(edits, acceptance);
    const filteredCount = filtered.field_changes.length + filtered.contract_overrides.length;
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
      router.refresh();
      setLastApplied({
        at: new Date(),
        edits: filtered,
        selectedCount: filteredCount,
        failures: res.failures,
      });
      setStep('applied');
    });
  };

  const selectedCount =
    acceptance.fieldChanges.filter(Boolean).length + acceptance.overrides.filter(Boolean).length;

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

      {step === 'input' && <ModeToggle mode={mode} onChange={switchMode} />}

      <p style={ledeStyle}>
        {mode === 'interpret'
          ? 'Paste what the owner sent — email, text, call notes. Claude maps the request to in-place contract edits with action types (replace, modify, rename, delete, add). Preview, refine, and apply.'
          : 'Quick path for column-only edits (term dates, fees, day-counts). Clause edits should go through Interpret since they need clause-ID targeting.'}
      </p>

      {step === 'input' && mode === 'interpret' && (
        <InterpretInput text={text} setText={setText} onInterpret={interpretRequest} pending={pending} />
      )}

      {step === 'input' && mode === 'precise' && (
        <PreciseEditor
          projection={projection}
          fieldChanges={draftFieldChanges}
          setFieldChanges={setDraftFieldChanges}
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

          {mode === 'interpret' && originalText && (
            <div style={refineBlockStyle}>
              <div className="eyebrow" style={{ ...eyebrowStyle, marginBottom: 4 }}>Need to refine?</div>
              <p style={{ margin: '0 0 8px', fontSize: 11, color: 'var(--ink-3)', lineHeight: 1.5 }}>
                Tell Claude what to reconsider. Original + your notes go back; the new interpretation replaces what&rsquo;s shown.
              </p>
              <textarea
                value={iterationText}
                onChange={(e) => setIterationText(e.target.value)}
                rows={3}
                maxLength={4000}
                placeholder='e.g. "Min availability should be 130 not 150." Or "Drop the no-weddings clause."'
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

function AppliedConfirmation({
  projectionId,
  applied,
  onAnotherRound,
}: {
  projectionId: string;
  applied: {
    at: Date;
    edits: ContractRedlineEdits;
    selectedCount: number;
    failures: { summary: string }[];
  };
  onAnotherRound: () => void;
}) {
  const { at, edits, selectedCount, failures } = applied;
  const overrideCount = edits.contract_overrides.length;
  const fieldCount = edits.field_changes.length;
  const tally = [
    fieldCount > 0 ? `${fieldCount} field ${fieldCount === 1 ? 'change' : 'changes'}` : null,
    overrideCount > 0
      ? `${overrideCount} contract ${overrideCount === 1 ? 'edit' : 'edits'}`
      : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const persistedOverrideCount = overrideCount - failures.length;
  const effectiveTally = failures.length > 0
    ? `${fieldCount} field ${fieldCount === 1 ? 'change' : 'changes'} · ${persistedOverrideCount} of ${overrideCount} contract ${overrideCount === 1 ? 'edit' : 'edits'} applied`
    : tally;

  return (
    <div style={appliedBannerStyle}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 6 }}>
        <span style={appliedCheckStyle}>✓</span>
        <strong style={{ fontSize: 18, color: 'var(--ink)' }}>Contract updated.</strong>
        <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>at {formatTime(at)}</span>
      </div>
      <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--ink)', lineHeight: 1.55 }}>
        Applied <strong>{selectedCount - failures.length}</strong> {selectedCount - failures.length === 1 ? 'edit' : 'edits'} ({effectiveTally}) — body edits land in place, no Rider.
      </p>

      {failures.length > 0 && (
        <div style={appliedFailuresBlockStyle}>
          <div style={{ marginBottom: 6 }}>
            <strong style={{ fontSize: 12, color: 'var(--signal)' }}>
              {failures.length} edit{failures.length === 1 ? '' : 's'} couldn&rsquo;t land
            </strong>
            <span style={{ fontSize: 11, color: 'var(--ink-3)', marginLeft: 8 }}>
              The other {selectedCount - failures.length} did. Re-run the interpreter for these.
            </span>
          </div>
          <ul style={appliedFailuresListStyle}>
            {failures.map((f, i) => (
              <li key={i}>{f.summary}</li>
            ))}
          </ul>
        </div>
      )}

      <ul style={appliedListStyle}>
        {edits.field_changes.map((c, i) => (
          <li key={`fc-${i}`}>
            <strong>{FIELD_DESCRIPTORS[c.field as EditableField].label}</strong> →{' '}
            {formatFieldValueForPreview(c.field as EditableField, c.new_value)}
            <span style={appliedRowMetaStyle}>{POSITION_LABELS[c.ourPosition]}</span>
          </li>
        ))}
        {edits.contract_overrides.map((o, i) => (
          <li key={`co-${i}`}>
            <strong>{ACTION_LABELS[o.action]}</strong>:{' '}
            {summarizeOverride(o)}
            <span style={appliedRowMetaStyle}>{POSITION_LABELS[o.ourPosition]}</span>
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

function summarizeOverride(o: ContractOverrideEditT): string {
  switch (o.action) {
    case 'replace':
      return `${o.targetId} — full clause swap`;
    case 'modify':
      return `${o.targetId} — "${truncate(o.find, 30)}" → "${truncate(o.replaceWith, 30)}"`;
    case 'rename':
      return `${o.targetId} → "${o.newTitle}"`;
    case 'delete':
      return `${o.targetId} — removed`;
    case 'add':
      return `${o.title ?? o.newId} (anchored)`;
  }
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

// ─── Mode toggle + Interpret input ──────────────────────────────────────────

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
        Precise (fields only)
      </button>
    </div>
  );
}

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
        rows={6}
        maxLength={20000}
        placeholder={
          'e.g. "Owner wants min availability dropped to 150 days, the renewal-year non-renewal notice to 90 days (leave 2026\'s 60-day rule alone), and the additional-insured language made reciprocal."'
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

// ─── Precise editor (fields only in v1) ────────────────────────────────────

type DraftFieldChange = {
  field: EditableField | '';
  newValueText: string;
  reason: string;
};

function PreciseEditor({
  projection,
  fieldChanges,
  setFieldChanges,
  onStage,
  pending,
}: {
  projection: ProjectionRow;
  fieldChanges: DraftFieldChange[];
  setFieldChanges: React.Dispatch<React.SetStateAction<DraftFieldChange[]>>;
  onStage: () => void;
  pending: boolean;
}) {
  const addFieldChange = () =>
    setFieldChanges((prev) => [...prev, { field: '', newValueText: '', reason: '' }]);
  const updateFieldChange = (i: number, patch: Partial<DraftFieldChange>) =>
    setFieldChanges((prev) => prev.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  const removeFieldChange = (i: number) =>
    setFieldChanges((prev) => prev.filter((_, j) => j !== i));

  const projectionAsRecord = projection as unknown as Record<string, string | number | null>;

  return (
    <>
      <div style={{ borderTop: '1px solid var(--rule)', paddingTop: 14, marginTop: 14 }}>
        <div className="eyebrow" style={{ ...eyebrowStyle, marginBottom: 4 }}>Field changes</div>
        <p style={{ margin: '0 0 10px', fontSize: 11, color: 'var(--ink-3)', lineHeight: 1.5 }}>
          Pick a contract field and set its new value. Clause-level edits should go through Interpret.
        </p>
        {fieldChanges.length === 0 ? (
          <p style={builderEmptyStyle}>No field changes staged yet.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {fieldChanges.map((row, i) => (
              <FieldChangeBuilderRow
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
      </div>

      <div style={actionsRowStyle}>
        <button
          type="button"
          onClick={onStage}
          disabled={pending || fieldChanges.length === 0}
          style={primaryButtonStyle}
        >
          Preview {fieldChanges.length} {fieldChanges.length === 1 ? 'edit' : 'edits'}
        </button>
        <span style={hintStyle}>No AI — direct field edits go straight to preview.</span>
      </div>
    </>
  );
}

function FieldChangeBuilderRow({
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
        <button type="button" onClick={onRemove} style={removeButtonStyle} aria-label="Remove">
          ×
        </button>
      </div>
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

function buildPreciseEdits(fieldChanges: DraftFieldChange[]): ContractRedlineEdits | null {
  const built = fieldChanges
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
        if (!Number.isFinite(n)) newValue = r.newValueText.trim();
        else if (kind === 'percent') newValue = n > 1 ? n / 100 : n;
        else if (kind === 'integer') newValue = Math.round(n);
        else newValue = n;
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

  if (built.length === 0) return null;

  return {
    field_changes: built,
    contract_overrides: [],
    summary: `Staff-authored precise edits: ${built.length} field ${built.length === 1 ? 'change' : 'changes'}.`,
  };
}

// ─── Preview ────────────────────────────────────────────────────────────────

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

  // Partition both lists into sensitive vs standard so high-priority items
  // float to the top under an "Attorney review recommended" header.
  type WithIdx<T> = { item: T; index: number };

  const fcSensitive: WithIdx<typeof edits.field_changes[number]>[] = [];
  const fcStandard: WithIdx<typeof edits.field_changes[number]>[] = [];
  edits.field_changes.forEach((item, index) => {
    if (item.sensitiveSection || item.reviewPriority === 'high') fcSensitive.push({ item, index });
    else fcStandard.push({ item, index });
  });

  const coSensitive: WithIdx<typeof edits.contract_overrides[number]>[] = [];
  const coStandard: WithIdx<typeof edits.contract_overrides[number]>[] = [];
  edits.contract_overrides.forEach((item, index) => {
    if (item.sensitiveSection || item.reviewPriority === 'high') coSensitive.push({ item, index });
    else coStandard.push({ item, index });
  });

  const sensitiveTotal = fcSensitive.length + coSensitive.length;
  const totalChanges = edits.field_changes.length + edits.contract_overrides.length;

  const toggleField = (i: number) =>
    setAcceptance({
      ...acceptance,
      fieldChanges: acceptance.fieldChanges.map((v, j) => (j === i ? !v : v)),
    });
  const toggleOverride = (i: number) =>
    setAcceptance({
      ...acceptance,
      overrides: acceptance.overrides.map((v, j) => (j === i ? !v : v)),
    });

  const renderFieldRow = (entry: WithIdx<typeof edits.field_changes[number]>, key: string | number) => {
    const { item: c, index: i } = entry;
    const f = c.field as EditableField;
    const current = projectionAsRecord[f];
    const accepted = acceptance.fieldChanges[i] ?? true;
    return (
      <FieldChangeReviewRow
        key={`fc-${i}-${key}`}
        accepted={accepted}
        onToggle={() => toggleField(i)}
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

  const renderOverrideRow = (entry: WithIdx<typeof edits.contract_overrides[number]>, key: string | number) => {
    const { item: o, index: i } = entry;
    const accepted = acceptance.overrides[i] ?? true;
    return (
      <OverrideReviewRow
        key={`co-${i}-${key}`}
        accepted={accepted}
        onToggle={() => toggleOverride(i)}
        override={o}
        sensitive={o.sensitiveSection || o.reviewPriority === 'high'}
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
          {fcSensitive.map((e, k) => renderFieldRow(e, k))}
          {coSensitive.map((e, k) => renderOverrideRow(e, k))}
        </div>
      )}

      {fcStandard.length > 0 && (
        <PreviewBlock title="Field changes">
          {fcStandard.map((e, k) => renderFieldRow(e, k))}
        </PreviewBlock>
      )}

      {coStandard.length > 0 && (
        <PreviewBlock title="Contract edits (in place)">
          {coStandard.map((e, k) => renderOverrideRow(e, k))}
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

function PreviewBlock({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ borderTop: '1px solid var(--rule)', paddingTop: 12, marginTop: 14 }}>
      <div className="eyebrow" style={{ ...eyebrowStyle, marginBottom: 8 }}>{title}</div>
      {children}
    </div>
  );
}

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
          <span style={{ fontSize: 9, letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--ink-4)', fontWeight: 600 }}>
            Field
          </span>
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

/**
 * Per-override row. Shows the action verb prominently (REPLACE / MODIFY /
 * RENAME / DELETE / ADD), the target clause ID, and a short preview of
 * the actual edit. Sensitive items get the signal-accent left edge.
 */
function OverrideReviewRow({
  accepted,
  onToggle,
  override,
  sensitive,
}: {
  accepted: boolean;
  onToggle: () => void;
  override: ContractOverrideEditT;
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
        aria-label={`Accept ${override.action} override`}
        style={{ marginTop: 4 }}
      />
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginBottom: 4 }}>
          <ActionPill action={override.action} />
          <code
            style={{
              fontFamily: 'var(--font-mono-dash, ui-monospace), monospace',
              fontSize: 11,
              color: 'var(--ink-3)',
              background: 'var(--paper-2)',
              padding: '1px 5px',
            }}
          >
            {targetOf(override)}
          </code>
          <PositionPill position={override.ourPosition} />
        </div>
        <OverrideBodyPreview override={override} />
        <RationaleStack ownerAsk={override.ownerAsk} positionDetail={override.positionDetail} />
      </div>
    </div>
  );
}

function targetOf(o: ContractOverrideEditT): string {
  if (o.action === 'add') return `(new) ${o.newId}`;
  return o.targetId;
}

function OverrideBodyPreview({ override: o }: { override: ContractOverrideEditT }) {
  if (o.action === 'modify') {
    return (
      <p style={{ margin: '0 0 6px', fontSize: 12, color: 'var(--ink)', lineHeight: 1.55 }}>
        <span style={{ color: 'var(--ink-3)', textDecoration: 'line-through' }}>{o.find}</span>{' '}
        <span style={{ color: 'var(--ink-4)' }}>→</span>{' '}
        <strong>{o.replaceWith}</strong>
      </p>
    );
  }
  if (o.action === 'rename') {
    return (
      <p style={{ margin: '0 0 6px', fontSize: 12, color: 'var(--ink)', lineHeight: 1.55 }}>
        New title: <strong>{o.newTitle}</strong>
      </p>
    );
  }
  if (o.action === 'replace') {
    return (
      <p style={{ margin: '0 0 6px', fontSize: 12, color: 'var(--ink)', lineHeight: 1.55 }}>{o.newText}</p>
    );
  }
  if (o.action === 'add') {
    return (
      <>
        {o.title && (
          <p style={{ margin: '0 0 4px', fontSize: 12, fontWeight: 500, color: 'var(--ink)' }}>
            {o.title}
          </p>
        )}
        <p style={{ margin: '0 0 6px', fontSize: 12, color: 'var(--ink)', lineHeight: 1.55 }}>{o.body}</p>
        <p style={{ margin: '0 0 6px', fontSize: 10, color: 'var(--ink-4)', fontStyle: 'italic' }}>
          Anchor: {describeAnchor(o.anchor)}
        </p>
      </>
    );
  }
  if (o.action === 'delete') {
    return (
      <p style={{ margin: '0 0 6px', fontSize: 12, color: 'var(--ink-3)', fontStyle: 'italic' }}>
        Removed.
      </p>
    );
  }
  return null;
}

function describeAnchor(
  a: Extract<ContractOverrideEditT, { action: 'add' }>['anchor'],
): string {
  if (a.insertAfter) return `after ${a.insertAfter}`;
  if (a.insertBefore) return `before ${a.insertBefore}`;
  if (a.inSection) return `${a.position} of section ${a.inSection}`;
  return '(unspecified)';
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

function ActionPill({ action }: { action: ContractOverrideEditT['action'] }) {
  const tones: Record<ContractOverrideEditT['action'], { bg: string; fg: string }> = {
    replace: { bg: 'rgba(184, 155, 110, 0.22)', fg: '#7c6638' },
    modify: { bg: 'rgba(74, 157, 107, 0.18)', fg: '#3a7a55' },
    rename: { bg: 'rgba(80, 100, 112, 0.18)', fg: 'var(--ink-3)' },
    delete: { bg: 'rgba(200, 90, 58, 0.18)', fg: 'var(--signal)' },
    add: { bg: 'rgba(50, 100, 160, 0.18)', fg: '#3a5a8a' },
  };
  const t = tones[action];
  return (
    <span
      style={{
        fontSize: 9,
        letterSpacing: '.22em',
        textTransform: 'uppercase',
        padding: '3px 7px',
        background: t.bg,
        color: t.fg,
        fontWeight: 700,
      }}
    >
      {ACTION_LABELS[action]}
    </span>
  );
}

function RationaleStack({ ownerAsk, positionDetail }: { ownerAsk: string; positionDetail: string }) {
  return (
    <div style={{ marginTop: 6, fontSize: 11, lineHeight: 1.55 }}>
      <div style={{ color: 'var(--ink-3)' }}>
        <span style={{ fontSize: 9, letterSpacing: '.22em', textTransform: 'uppercase', color: 'var(--ink-4)', fontWeight: 600, marginRight: 6 }}>
          Owner asked
        </span>
        {ownerAsk}
      </div>
      <div style={{ color: 'var(--ink)', marginTop: 4 }}>
        <span style={{ fontSize: 9, letterSpacing: '.22em', textTransform: 'uppercase', color: 'var(--ink-4)', fontWeight: 600, marginRight: 6 }}>
          Our position
        </span>
        {positionDetail}
      </div>
    </div>
  );
}

// ─── Acceptance helpers ─────────────────────────────────────────────────────

function initAcceptance(edits: ContractRedlineEdits): Acceptance {
  return {
    fieldChanges: edits.field_changes.map(() => true),
    overrides: edits.contract_overrides.map(() => true),
  };
}

function filterEditsByAcceptance(edits: ContractRedlineEdits, accept: Acceptance): ContractRedlineEdits {
  return {
    field_changes: edits.field_changes.filter((_, i) => accept.fieldChanges[i] ?? true),
    contract_overrides: edits.contract_overrides.filter((_, i) => accept.overrides[i] ?? true),
    summary: edits.summary,
  };
}

// Suppress unused-var warnings on intentionally retained type imports.
type _UnusedUseMemo = typeof useMemo;

// ─── styles ─────────────────────────────────────────────────────────────────

const panelStyle: React.CSSProperties = { border: '1px solid var(--rule)', padding: 22, background: 'var(--paper-2)' };
const panelHeadStyle: React.CSSProperties = { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, marginBottom: 6 };
const eyebrowStyle: React.CSSProperties = { fontSize: 10, letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--ink-3)', fontWeight: 600 };
const titleStyle: React.CSSProperties = { fontSize: 18, fontWeight: 400, letterSpacing: '-0.01em', color: 'var(--ink)', margin: '4px 0 0' };
const ledeStyle: React.CSSProperties = { margin: '14px 0 14px', fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.55, maxWidth: 760 };
const toggleWrapStyle: React.CSSProperties = { display: 'inline-flex', border: '1px solid var(--ink)', marginTop: 10 };
const toggleActiveStyle: React.CSSProperties = { background: 'var(--ink)', color: 'var(--paper)', fontSize: 11, fontWeight: 500, letterSpacing: '.18em', textTransform: 'uppercase', padding: '10px 18px', border: 'none', cursor: 'pointer' };
const toggleInactiveStyle: React.CSSProperties = { background: 'transparent', color: 'var(--ink)', fontSize: 11, fontWeight: 500, letterSpacing: '.18em', textTransform: 'uppercase', padding: '10px 18px', border: 'none', cursor: 'pointer' };
const textareaStyle: React.CSSProperties = { width: '100%', border: '1px solid var(--rule)', borderBottom: '1px solid var(--ink)', background: 'transparent', color: 'var(--ink)', fontSize: 13, padding: '10px 12px', outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit', lineHeight: 1.55, resize: 'vertical' };
const inputStyle: React.CSSProperties = { border: '1px solid var(--rule)', borderBottom: '1px solid var(--ink)', background: 'transparent', color: 'var(--ink)', fontSize: 12, padding: '8px 10px', outline: 'none', fontFamily: 'inherit', width: '100%', boxSizing: 'border-box' };
const selectStyle: React.CSSProperties = { ...inputStyle };
const builderRowStyle: React.CSSProperties = { padding: '10px 12px', border: '1px solid var(--rule)', background: 'var(--paper)' };
const builderEmptyStyle: React.CSSProperties = { margin: 0, fontSize: 12, color: 'var(--ink-4)', fontStyle: 'italic' };
const addRowButtonStyle: React.CSSProperties = { marginTop: 10, background: 'transparent', color: 'var(--ink-3)', fontSize: 11, fontWeight: 500, letterSpacing: '.18em', textTransform: 'uppercase', padding: '10px 14px', border: '1px dashed var(--rule)', cursor: 'pointer' };
const removeButtonStyle: React.CSSProperties = { background: 'transparent', color: 'var(--ink-3)', fontSize: 18, lineHeight: 1, padding: '4px 8px', border: 'none', cursor: 'pointer' };
const actionsRowStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 12, marginTop: 12 };
const primaryButtonStyle: React.CSSProperties = { background: 'var(--ink)', color: 'var(--paper)', fontSize: 11, fontWeight: 500, letterSpacing: '.18em', textTransform: 'uppercase', padding: '13px 22px', border: '1px solid var(--ink)', cursor: 'pointer', textDecoration: 'none' };
const secondaryButtonStyle: React.CSSProperties = { background: 'transparent', color: 'var(--ink-3)', fontSize: 11, fontWeight: 500, letterSpacing: '.18em', textTransform: 'uppercase', padding: '13px 18px', border: '1px solid var(--rule)', cursor: 'pointer' };
const resetButtonStyle: React.CSSProperties = { ...secondaryButtonStyle, padding: '8px 14px', fontSize: 10 };
const hintStyle: React.CSSProperties = { fontSize: 11, color: 'var(--ink-4)', fontStyle: 'italic' };
const previewStyle: React.CSSProperties = { marginTop: 14 };
const previewSummaryStyle: React.CSSProperties = { borderLeft: '3px solid var(--signal)', padding: '6px 12px', background: 'var(--paper)' };
const refineBlockStyle: React.CSSProperties = { marginTop: 18, padding: '12px 14px', border: '1px dashed var(--rule)', background: 'var(--paper)' };
const attorneyBlockStyle: React.CSSProperties = { marginTop: 14, padding: '14px 16px', borderTop: '2px solid var(--signal)', borderBottom: '1px solid var(--rule)', background: 'var(--paper)' };
const recentChipStyle: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 6, padding: '4px 10px', background: 'rgba(74, 157, 107, 0.14)', color: '#2a5e3f', fontSize: 11, fontWeight: 500, letterSpacing: '.02em' };
const recentChipDotStyle: React.CSSProperties = { width: 6, height: 6, borderRadius: '50%', background: '#4a9d6b', display: 'inline-block' };
const appliedBannerStyle: React.CSSProperties = { marginTop: 16, padding: '18px 20px', background: 'rgba(74, 157, 107, 0.10)', borderLeft: '4px solid #4a9d6b', border: '1px solid rgba(74, 157, 107, 0.30)' };
const appliedCheckStyle: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 26, height: 26, borderRadius: '50%', background: '#4a9d6b', color: 'var(--paper)', fontSize: 16, fontWeight: 600 };
const appliedListStyle: React.CSSProperties = { margin: '6px 0 0', paddingLeft: 18, fontSize: 12, color: 'var(--ink)', lineHeight: 1.7 };
const appliedRowMetaStyle: React.CSSProperties = { marginLeft: 8, fontSize: 9, letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--ink-3)', fontWeight: 600 };
const appliedHeadsUpStyle: React.CSSProperties = { margin: '12px 0 0', fontSize: 11, color: 'var(--ink-3)', fontStyle: 'italic' };
const appliedFailuresBlockStyle: React.CSSProperties = {
  marginBottom: 12,
  padding: '10px 12px',
  border: '1px solid var(--signal)',
  borderLeft: '3px solid var(--signal)',
  background: 'rgba(200, 90, 58, 0.08)',
};
const appliedFailuresListStyle: React.CSSProperties = {
  margin: 0,
  paddingLeft: 18,
  fontFamily: 'var(--font-mono-dash, ui-monospace), monospace',
  fontSize: 11,
  color: 'var(--ink)',
  lineHeight: 1.55,
};
const errorStyle: React.CSSProperties = { marginTop: 12, padding: 10, borderLeft: '3px solid var(--signal)', background: 'var(--paper)', fontSize: 12, color: 'var(--ink)' };
