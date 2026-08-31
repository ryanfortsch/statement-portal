'use client';

import { useState } from 'react';
import { refineCustomClause } from '@/app/projections/actions';
import type { CustomClause } from '@/lib/projections-types';

/**
 * Repeating list of per-deal contract clauses. Each clause has a title +
 * body. Submitted as parallel arrays (`custom_clause_title[]`,
 * `custom_clause_body[]`); the server action zips them together and stores a
 * jsonb array on the prospect record.
 *
 * Renders as a stack of cards, each with a "Remove" button. An "Add clause"
 * button appends a new empty card.
 *
 * "Refine with AI" sends the card's current text through Claude
 * (refineCustomClause → lib/clause-polish.ts) and drops the contract-language
 * rewrite back into the same editable fields, with a one-step Undo. Nothing
 * persists until the operator hits Save — the form is the review gate.
 */
export function CustomClausesField({
  initial,
  projectionId,
}: {
  initial: CustomClause[] | null | undefined;
  /** Null on /prospects/new (no row yet); the AI refine still works,
   *  just without deal context. */
  projectionId?: string | null;
}) {
  // Keep keys stable across re-renders so React doesn't re-mount inputs the
  // user is mid-typing in.
  const [rows, setRows] = useState<
    { key: number; title: string; body: string; prior: { title: string; body: string } | null }[]
  >(() => {
    const seed = (initial ?? []).map((c, i) => ({
      key: i,
      title: c.title ?? '',
      body: c.body ?? '',
      prior: null,
    }));
    return seed.length ? seed : [];
  });
  const nextKey = useNextKey(rows);
  const [busyKey, setBusyKey] = useState<number | null>(null);
  const [refineError, setRefineError] = useState<{ key: number; message: string } | null>(null);

  const add = () => setRows((rs) => [...rs, { key: nextKey(), title: '', body: '', prior: null }]);
  const remove = (key: number) => setRows((rs) => rs.filter((r) => r.key !== key));
  const update = (key: number, patch: Partial<{ title: string; body: string }>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const refine = async (key: number) => {
    const row = rows.find((r) => r.key === key);
    if (!row || busyKey != null) return;
    setRefineError(null);
    setBusyKey(key);
    try {
      const res = await refineCustomClause(projectionId ?? null, {
        title: row.title,
        body: row.body,
      });
      if (!res.ok) {
        setRefineError({ key, message: res.error });
        return;
      }
      setRows((rs) =>
        rs.map((r) =>
          r.key === key
            ? {
                ...r,
                prior: { title: r.title, body: r.body },
                title: res.clause.title,
                body: res.clause.body,
              }
            : r,
        ),
      );
    } catch (err) {
      setRefineError({ key, message: err instanceof Error ? err.message : String(err) });
    } finally {
      setBusyKey(null);
    }
  };

  const undoRefine = (key: number) =>
    setRows((rs) =>
      rs.map((r) =>
        r.key === key && r.prior
          ? { ...r, title: r.prior.title, body: r.prior.body, prior: null }
          : r,
      ),
    );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {rows.length === 0 && (
        <p style={{ margin: 0, fontSize: 12, color: 'var(--ink-4)', fontStyle: 'italic' }}>
          No custom clauses. The contract will use the standard set only. Click &ldquo;Add clause&rdquo; to attach one.
        </p>
      )}

      {rows.map((r, idx) => (
        <div
          key={r.key}
          style={{
            border: '1px solid var(--rule)',
            background: 'var(--paper)',
            padding: '14px 16px',
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
            <span className="eyebrow">Clause {idx + 1}</span>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 4 }}>
              {r.prior && busyKey !== r.key && (
                <button type="button" onClick={() => undoRefine(r.key)} style={headerButtonStyle('var(--ink-4)')}>
                  Undo
                </button>
              )}
              <button
                type="button"
                onClick={() => refine(r.key)}
                disabled={busyKey != null || (!r.title.trim() && !r.body.trim())}
                style={{
                  ...headerButtonStyle('var(--ink)'),
                  opacity: busyKey != null || (!r.title.trim() && !r.body.trim()) ? 0.4 : 1,
                }}
              >
                {busyKey === r.key ? 'Refining…' : 'Refine with AI'}
              </button>
              <button type="button" onClick={() => remove(r.key)} style={headerButtonStyle('var(--negative)')}>
                Remove
              </button>
            </div>
          </div>

          {refineError?.key === r.key && (
            <p style={{ margin: 0, fontSize: 12, color: 'var(--negative)' }}>{refineError.message}</p>
          )}

          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span className="eyebrow">Title</span>
            <input
              name="custom_clause_title"
              value={r.title}
              onChange={(e) => update(r.key, { title: e.target.value })}
              placeholder='e.g. "Cleaning supply allowance"'
              style={inputStyle}
            />
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span className="eyebrow">Body</span>
            <textarea
              name="custom_clause_body"
              value={r.body}
              onChange={(e) => update(r.key, { body: e.target.value })}
              rows={4}
              placeholder='Full clause text, or rough notes — "Refine with AI" rewrites them in contract language. Renders verbatim on the Rider page once saved.'
              style={{ ...inputStyle, resize: 'vertical', minHeight: 90, fontFamily: 'var(--font-inter), system-ui, sans-serif' }}
            />
          </label>
        </div>
      ))}

      <div>
        <button
          type="button"
          onClick={add}
          style={{
            background: 'transparent',
            color: 'var(--ink)',
            fontSize: 11,
            fontWeight: 500,
            letterSpacing: '.18em',
            textTransform: 'uppercase',
            padding: '10px 16px',
            border: '1px dashed var(--rule)',
            cursor: 'pointer',
          }}
        >
          + Add clause
        </button>
      </div>
    </div>
  );
}

/** Generates monotonically increasing keys for new rows. */
function useNextKey(rows: { key: number }[]) {
  return () => (rows.reduce((m, r) => Math.max(m, r.key), -1) + 1);
}

const headerButtonStyle = (color: string): React.CSSProperties => ({
  background: 'transparent',
  color,
  fontSize: 10,
  fontWeight: 500,
  letterSpacing: '.18em',
  textTransform: 'uppercase',
  padding: '4px 8px',
  border: 'none',
  cursor: 'pointer',
});

const inputStyle: React.CSSProperties = {
  background: 'var(--paper)',
  border: '1px solid var(--rule)',
  color: 'var(--ink)',
  fontSize: 14,
  fontWeight: 400,
  padding: '8px 10px',
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
};
