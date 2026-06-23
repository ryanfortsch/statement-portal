'use client';

import { useState } from 'react';
import { revealPay } from '../packets/actions';

/** Office-only on-demand reveal of a contractor's full payout details (e.g. an
 *  ACH account). Hidden until clicked; decrypted server-side via a staff-gated
 *  action. */
export function RevealPay({ contractorId }: { contractorId: string }) {
  const [val, setVal] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  if (val) return <span className="font-mono" style={{ fontSize: 11, color: 'var(--ink)' }}>{val}</span>;
  return (
    <button
      type="button"
      disabled={loading}
      onClick={async () => {
        setLoading(true);
        try {
          setVal((await revealPay(contractorId)) || '—');
        } finally {
          setLoading(false);
        }
      }}
      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-4)', fontSize: 11, textDecoration: 'underline', padding: 0 }}
    >
      {loading ? 'revealing…' : 'show details'}
    </button>
  );
}
