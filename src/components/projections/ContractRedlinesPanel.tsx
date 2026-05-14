'use client';

import { useState, useTransition } from 'react';
import { proposeContractRedlines, applyContractRedlines } from '@/app/projections/actions';
import {
  FIELD_DESCRIPTORS,
  formatFieldValueForPreview,
  type ContractRedlineEdits,
  type EditableField,
} from '@/lib/projection-redlines';
import type { ProjectionRow } from '@/lib/projections-types';

/**
 * Three-step redline flow:
 *
 *   1. INPUT    Staff pastes the owner's redlines (email, SMS, call notes).
 *   2. PREVIEW  Server proposes a structured edit set; staff reviews per
 *               field / clause diff with an option to apply or reject.
 *   3. APPLIED  Server persists the edits + revalidates the page so the
 *               contract preview + downloads reflect the new values.
 *
 * Lives on /projections/<id> above the existing download buttons.
 */
export function ContractRedlinesPanel({ projection }: { projection: ProjectionRow }) {
  const [step, setStep] = useState<'input' | 'preview' | 'applied'>('input');
  const [text, setText] = useState('');
  const [edits, setEdits] = useState<ContractRedlineEdits | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const propose = () => {
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

  const apply = () => {
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

  const reset = () => {
    setStep('input');
    setText('');
    setEdits(null);
    setError(null);
  };

  return (
    <div style={panelStyle}>
      <div style={panelHeadStyle}>
        <div>
          <div className="eyebrow" style={eyebrowStyle}>Owner Redlines</div>
          <h3 className="font-serif" style={titleStyle}>
            Apply contract edits from the owner
          </h3>
        </div>
        {step !== 'input' && (
          <button type="button" onClick={reset} style={resetButtonStyle}>
            Start over
          </button>
        )}
      </div>

      <p style={ledeStyle}>
        Paste what the owner sent — an email, a text, call notes, anything. The interpreter maps
        their request to specific contract fields and clauses, shows you the diff, and applies the
        edits to this prospect when you approve. The PDF re-renders automatically.
      </p>

      {step === 'input' && (
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
            <button type="button" onClick={propose} disabled={pending || !text.trim()} style={primaryButtonStyle}>
              {pending ? 'Interpreting…' : 'Interpret edits'}
            </button>
            <span style={hintStyle}>
              {text.length}/4000 · Claude reads, you approve.
            </span>
          </div>
        </>
      )}

      {step === 'preview' && edits && (
        <Preview edits={edits} projection={projection} />
      )}

      {step === 'preview' && edits && (
        <div style={actionsRowStyle}>
          <button type="button" onClick={apply} disabled={pending || !hasAnyChanges(edits)} style={primaryButtonStyle}>
            {pending ? 'Applying…' : hasAnyChanges(edits) ? 'Apply edits' : 'No edits to apply'}
          </button>
          <button type="button" onClick={reset} style={secondaryButtonStyle} disabled={pending}>
            Discard
          </button>
        </div>
      )}

      {step === 'applied' && (
        <div style={successStyle}>
          <strong>Applied.</strong> The contract preview and downloads now reflect these edits.
          <div style={{ marginTop: 12 }}>
            <button type="button" onClick={reset} style={secondaryButtonStyle}>
              Run another round
            </button>
          </div>
        </div>
      )}

      {error && <div style={errorStyle}>{error}</div>}
    </div>
  );
}

function Preview({ edits, projection }: { edits: ContractRedlineEdits; projection: ProjectionRow }) {
  const hasFieldChanges = edits.field_changes.length > 0;
  const hasClauseAdds = edits.clauses_to_add.length > 0;
  const hasClauseEdits = edits.clauses_to_edit.length > 0;
  const hasClauseRemoves = edits.clauses_to_remove.length > 0;
  const hasUnsupported = edits.unsupported_requests.length > 0;

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
                const current = (projection as unknown as Record<string, string | number | null>)[f];
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
            const current = (projection.custom_clauses ?? [])[c.index];
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
            const current = (projection.custom_clauses ?? [])[c.index];
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
          The interpreter didn’t find any actionable changes in that text. Try rephrasing the owner’s
          request, or apply the edits manually in the projection form.
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
  marginBottom: 16,
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
  margin: '4px 0 14px',
  fontSize: 12,
  color: 'var(--ink-3)',
  lineHeight: 1.55,
  maxWidth: 760,
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
