'use client';

import { useState } from 'react';
import type { CustomClause } from '@/lib/projections-types';

/**
 * Repeating list of per-deal contract clauses. Each clause has a title +
 * body. Submitted as parallel arrays (`custom_clause_title[]`,
 * `custom_clause_body[]`); the server action zips them together and stores a
 * jsonb array on the prospect record.
 *
 * Renders as a stack of cards, each with a "Remove" button. An "Add clause"
 * button appends a new empty card.
 */
export function CustomClausesField({ initial }: { initial: CustomClause[] | null | undefined }) {
  // Keep keys stable across re-renders so React doesn't re-mount inputs the
  // user is mid-typing in.
  const [rows, setRows] = useState<{ key: number; title: string; body: string }[]>(() => {
    const seed = (initial ?? []).map((c, i) => ({ key: i, title: c.title ?? '', body: c.body ?? '' }));
    return seed.length ? seed : [];
  });
  const nextKey = useNextKey(rows);

  const add = () => setRows((rs) => [...rs, { key: nextKey(), title: '', body: '' }]);
  const remove = (key: number) => setRows((rs) => rs.filter((r) => r.key !== key));
  const update = (key: number, patch: Partial<{ title: string; body: string }>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

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
            <button
              type="button"
              onClick={() => remove(r.key)}
              style={{
                background: 'transparent',
                color: 'var(--negative)',
                fontSize: 10,
                fontWeight: 500,
                letterSpacing: '.18em',
                textTransform: 'uppercase',
                padding: '4px 8px',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              Remove
            </button>
          </div>

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
              placeholder="Full clause text. Renders verbatim on the contract Rider page."
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
