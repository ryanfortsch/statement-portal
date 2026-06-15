'use client';

import { useEffect } from 'react';

/**
 * Tiny client island wrapping window.print(). Lives on the work-slips
 * print page so the rest of the page stays a server component. The
 * surrounding action bar carries data-no-print so it disappears in the
 * printed output.
 *
 * When opened with ?auto=1 (e.g. the Work board's per-property print
 * icon hands off here), it fires the print dialog once on load. The
 * short delay lets fonts and layout settle so the first sheet measures
 * correctly.
 */
export function PrintButton({ autoPrint = false }: { autoPrint?: boolean }) {
  useEffect(() => {
    if (!autoPrint) return;
    const t = setTimeout(() => window.print(), 350);
    return () => clearTimeout(t);
  }, [autoPrint]);

  return (
    <button
      type="button"
      onClick={() => window.print()}
      style={{
        background: 'var(--ink)',
        color: 'var(--paper)',
        border: 'none',
        padding: '12px 22px',
        fontSize: 11,
        letterSpacing: '.18em',
        textTransform: 'uppercase',
        fontWeight: 600,
        cursor: 'pointer',
      }}
    >
      Print / Save PDF
    </button>
  );
}
