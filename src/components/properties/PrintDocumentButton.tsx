'use client';

/** Print, from the guest document bar. The document's own @page rule sets the size. */
export function PrintDocumentButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      style={{
        background: 'var(--ink)',
        color: 'var(--paper)',
        fontSize: 11,
        fontWeight: 500,
        letterSpacing: '.18em',
        textTransform: 'uppercase',
        padding: '9px 16px',
        border: '1px solid var(--ink)',
        cursor: 'pointer',
      }}
    >
      Print
    </button>
  );
}
