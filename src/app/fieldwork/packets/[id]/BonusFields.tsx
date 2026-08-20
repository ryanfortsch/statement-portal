'use client';

import { useState } from 'react';

/**
 * The above-and-beyond bonus inputs, as one labeled unit: amount + a reason
 * picked from presets (the phrases the office actually uses), with "Other…"
 * revealing a free-text field. Posts plain bonus_dollars / bonus_reason, so
 * both server actions (approvePacket, setPacketBonus) read it unchanged.
 * Rendered inside those forms on the office packet page.
 */
const PRESETS = [
  'Additional work done',
  'Extra time on site',
  'Above and beyond on the details',
  'Handled something urgent',
];
const OTHER = '__other__';

const box: React.CSSProperties = {
  font: 'inherit',
  fontSize: 13,
  color: 'var(--ink)',
  background: 'var(--paper)',
  border: '1px solid var(--rule)',
  borderRadius: 6,
  padding: '6px 8px',
};

export function BonusFields({ defaultDollars, defaultReason }: { defaultDollars?: number; defaultReason?: string | null }) {
  const initial = !defaultReason ? '' : PRESETS.includes(defaultReason) ? defaultReason : OTHER;
  const [choice, setChoice] = useState(initial);
  const other = choice === OTHER;
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', padding: '6px 10px', border: '1px dashed var(--rule)', borderRadius: 8 }}>
      <span style={{ fontSize: 10.5, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-4)', fontWeight: 600 }}>
        Bonus · optional
      </span>
      <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>$</span>
      <input type="number" name="bonus_dollars" min={0} step={1} placeholder="0" defaultValue={defaultDollars || undefined} style={{ ...box, width: 64 }} />
      {/* The select carries the field name unless "Other…" is picked, in which
          case the free-text input takes it over so exactly one value posts. */}
      <select
        name={other ? undefined : 'bonus_reason'}
        value={choice}
        onChange={(e) => setChoice(e.target.value)}
        style={{ ...box, color: choice ? 'var(--ink)' : 'var(--ink-4)', maxWidth: 220 }}
      >
        <option value="">why (they will see this)</option>
        {PRESETS.map((r) => (
          <option key={r} value={r}>{r}</option>
        ))}
        <option value={OTHER}>Other…</option>
      </select>
      {other && (
        <input
          name="bonus_reason"
          defaultValue={defaultReason && !PRESETS.includes(defaultReason) ? defaultReason : ''}
          placeholder="say it in your words"
          autoFocus
          style={{ ...box, width: 200 }}
        />
      )}
    </span>
  );
}
