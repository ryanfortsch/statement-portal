'use client';

import { useState } from 'react';

/**
 * The office-side payout finalizer: a compact readout of the claim-time
 * estimate and the time-on-site suggestion, plus the one editable Final field
 * that posts `final_dollars`. Drops into either the approve form (submitted) or
 * the standalone finalize form (approved, unpaid) — the surrounding <form>'s
 * action decides what happens on submit.
 *
 * The methodology (actual minutes × rate) stays here, office-only. The
 * contractor never sees this; they just watch the number settle from
 * "estimated" to final.
 */
const box: React.CSSProperties = {
  font: 'inherit',
  fontSize: 16,
  width: 92,
  color: 'var(--ink)',
  background: 'var(--paper)',
  border: '1px solid var(--rule)',
  borderRadius: 6,
  padding: '7px 9px',
};

export function FinalPayoutField({
  estimateCents,
  suggestedCents,
  minsTotal,
  stopsTimed,
  stopsTotal,
  currentFinalCents,
}: {
  estimateCents: number;
  suggestedCents: number;
  minsTotal: number;
  stopsTimed: number;
  stopsTotal: number;
  currentFinalCents?: number | null;
}) {
  const toD = (c: number) => Math.round(c / 100);
  const est = toD(estimateCents);
  const sug = toD(suggestedCents);
  // Prefill: a final that's already been set wins; otherwise the time-based
  // suggestion. She can type over it freely.
  const [val, setVal] = useState<string>(String(currentFinalCents != null ? toD(currentFinalCents) : sug));
  const n = Number(val);

  return (
    <div style={{ border: '1px solid var(--rule)', borderRadius: 10, padding: '12px 14px', background: 'var(--paper-2, #fff)', maxWidth: 440 }}>
      <div style={{ fontSize: 10.5, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-4)', fontWeight: 600, marginBottom: 8 }}>
        Payout
      </div>
      <div style={{ fontSize: 12.5, color: 'var(--ink-3)', lineHeight: 1.6, marginBottom: 10 }}>
        Estimate <span className="font-mono" style={{ color: 'var(--ink)' }}>${est}</span>
        {minsTotal > 0 && (
          <>
            {' · '}
            <span className="font-mono" style={{ color: 'var(--ink)' }}>{minsTotal} min</span> on site
            {stopsTimed < stopsTotal ? ` (${stopsTimed}/${stopsTotal} stops timed)` : ''}
          </>
        )}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>Final&nbsp;$</span>
        <input
          name="final_dollars"
          type="number"
          min={0}
          step={1}
          inputMode="numeric"
          value={val}
          onChange={(e) => setVal(e.target.value)}
          style={box}
        />
        {Number.isFinite(n) && n !== sug && (
          <button
            type="button"
            onClick={() => setVal(String(sug))}
            style={{ background: 'none', border: 'none', cursor: 'pointer', fontSize: 12, color: 'var(--tide-deep)', textDecoration: 'underline', padding: '4px 2px' }}
          >
            use suggested ${sug}
          </button>
        )}
      </div>
    </div>
  );
}
