'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Per-cleaning-event credit control. Inline on each row of the Cleaning
 * Charges block on /statements. Click "Mark duplicate / credit", enter the
 * amount + reason (defaults: full event amount, "Duplicate charge"), save.
 * The event's row gets a strikethrough display + reason; cleaning_total
 * and owner_payout recompute on the server.
 *
 * Pass credit_amount=0 to clear a prior credit (the form does this when
 * the operator clicks "Clear credit").
 */

export function CleaningEventCredit({
  eventId, amount, initialCreditAmount, initialCreditReason,
}: {
  eventId: string;
  amount: number;
  initialCreditAmount: number;
  initialCreditReason: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [credit, setCredit] = useState(initialCreditAmount > 0 ? initialCreditAmount : amount);
  const [reason, setReason] = useState(initialCreditReason || 'Duplicate charge');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasCredit = initialCreditAmount > 0;

  async function submit(clear = false) {
    setBusy(true); setError(null);
    try {
      const res = await fetch(`/api/cleaning-events/${eventId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          credit_amount: clear ? 0 : Number(credit),
          credit_reason: clear ? null : reason,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Save failed');
      setOpen(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => { setOpen(true); setError(null); }}
        style={{
          fontSize: 9, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase',
          color: hasCredit ? 'var(--signal)' : 'var(--ink-3)',
          border: '1px solid var(--rule)', background: 'transparent',
          padding: '3px 8px', cursor: 'pointer',
        }}
      >
        {hasCredit ? 'Edit credit' : 'Mark duplicate'}
      </button>
    );
  }
  return (
    <div className="flex items-center" style={{ gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
      <span style={{ fontSize: 10, color: 'var(--ink-3)' }}>Credit $</span>
      <input
        type="number"
        step="0.01"
        min="0"
        max={amount}
        value={credit}
        onChange={(e) => setCredit(Number(e.target.value))}
        disabled={busy}
        style={{ border: '1px solid var(--rule)', background: 'var(--paper)', color: 'var(--ink)', padding: '3px 6px', fontSize: 12, width: 80 }}
      />
      <input
        type="text"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        disabled={busy}
        placeholder="Reason"
        style={{ border: '1px solid var(--rule)', background: 'var(--paper)', color: 'var(--ink)', padding: '3px 6px', fontSize: 12, width: 140 }}
      />
      <button
        type="button"
        onClick={() => submit(false)}
        disabled={busy || credit <= 0 || credit > amount}
        style={{
          fontSize: 9, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase',
          color: 'var(--paper)', background: 'var(--ink)', border: '1px solid var(--ink)',
          padding: '3px 8px', cursor: busy ? 'wait' : 'pointer', opacity: (credit <= 0 || credit > amount) ? 0.5 : 1,
        }}
      >
        {busy ? '…' : 'Save'}
      </button>
      {hasCredit && (
        <button
          type="button"
          onClick={() => submit(true)}
          disabled={busy}
          style={{
            fontSize: 9, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase',
            color: 'var(--ink-3)', background: 'transparent', border: '1px solid var(--rule)',
            padding: '3px 8px', cursor: busy ? 'wait' : 'pointer',
          }}
        >
          Clear
        </button>
      )}
      <button
        type="button"
        onClick={() => setOpen(false)}
        disabled={busy}
        style={{
          fontSize: 9, fontWeight: 700, letterSpacing: '.14em', textTransform: 'uppercase',
          color: 'var(--ink-3)', background: 'transparent', border: 'none',
          padding: '3px 6px', cursor: busy ? 'wait' : 'pointer',
        }}
      >
        Cancel
      </button>
      {error && <span style={{ fontSize: 10, color: 'var(--negative, #b13b2a)' }}>{error}</span>}
    </div>
  );
}
