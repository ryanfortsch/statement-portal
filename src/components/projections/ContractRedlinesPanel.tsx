'use client';

import { useMemo, useState, useTransition } from 'react';
import Link from 'next/link';
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
import { useSoftRefresh } from '@/lib/use-soft-refresh';
import { GLOUCESTER_TZ } from '@/lib/stable-time';

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

/**
 * The owner's written asks become proposed contract edits: paste the
 * email, text or call notes, Claude maps each ask to an edit, the reader
 * accepts, refines or drops each one, and the accepted set is applied by
 * applyContractRedlines through the same lock-checked writer as the edit
 * form's Contract terms section. Section 06 of that form is where a term is
 * typed directly; this panel has no field editor of its own. Not rendered
 * once the owner has signed (the page prints the terms-locked notice).
 */
export function ContractRedlinesPanel({ projection }: { projection: ProjectionRow }) {
  const softRefresh = useSoftRefresh();
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

  const [text, setText] = useState('');

  const [edits, setEdits] = useState<ContractRedlineEdits | null>(null);

  const [acceptance, setAcceptance] = useState<Acceptance>({ fieldChanges: [], overrides: [] });

  const [originalText, setOriginalText] = useState('');
  const [iterationText, setIterationText] = useState('');

  const resetAll = () => {
    setStep('input');
    setText('');
    setEdits(null);
    setAcceptance({ fieldChanges: [], overrides: [] });
    setOriginalText('');
    setIterationText('');
    setError(null);
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
      softRefresh();
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

      <p style={ledeStyle}>
        Paste what the owner sent: an email, a text, call notes. Claude turns each ask into a proposed edit to the
        contract; accept, refine or drop each one before it is applied. To type a term yourself, use Contract terms
        under Edit prospect details.
      </p>

      {step === 'input' && (
        <InterpretInput text={text} setText={setText} onInterpret={interpretRequest} pending={pending} />
      )}

      {step === 'preview' && edits && (
        <>
          <Preview
            edits={edits}
            projection={projection}
            acceptance={acceptance}
            setAcceptance={setAcceptance}
          />

          {originalText && (
            <div style={refineBlockStyle}>
              <div className="eyebrow" style={{ ...eyebrowStyle, marginBottom: 4 }}>Need to refine?</div>
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
        Applied <strong>{selectedCount - failures.length}</strong> {selectedCount - failures.length === 1 ? 'edit' : 'edits'} ({effectiveTally}). Body edits land in place, no Rider.
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
      return `${o.targetId}: full clause swap`;
    case 'modify':
      return `${o.targetId}: "${truncate(o.find, 30)}" → "${truncate(o.replaceWith, 30)}"`;
    case 'rename':
      return `${o.targetId} → "${o.newTitle}"`;
    case 'delete':
      return `${o.targetId}: removed`;
    case 'add':
      return `${o.title ?? o.newId} (anchored)`;
  }
}

function truncate(s: string, n: number): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

function formatTime(d: Date): string {
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: GLOUCESTER_TZ });
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
const textareaStyle: React.CSSProperties = { width: '100%', border: '1px solid var(--rule)', borderBottom: '1px solid var(--ink)', background: 'transparent', color: 'var(--ink)', fontSize: 13, padding: '10px 12px', outline: 'none', boxSizing: 'border-box', fontFamily: 'inherit', lineHeight: 1.55, resize: 'vertical' };
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
