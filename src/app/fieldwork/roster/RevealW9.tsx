'use client';

import { useState } from 'react';
import { revealW9 } from '../packets/actions';

/** Office-only on-demand reveal of a contractor's full TIN (for filing 1099s).
 *  Stays hidden until clicked; the value is fetched through a staff-gated
 *  server action that decrypts it server-side. */
export function RevealW9({ contractorId }: { contractorId: string }) {
  const [tin, setTin] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  if (tin) {
    return <span className="font-mono" style={{ fontSize: 11, color: 'var(--ink)' }}>{tin}</span>;
  }
  return (
    <button
      type="button"
      disabled={loading}
      onClick={async () => {
        setLoading(true);
        try {
          setTin((await revealW9(contractorId)) || '—');
        } finally {
          setLoading(false);
        }
      }}
      style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--ink-4)', fontSize: 11, textDecoration: 'underline', padding: 0 }}
    >
      {loading ? 'revealing…' : 'show full SSN/EIN'}
    </button>
  );
}
