'use client';

/**
 * Tiny client island wrapping window.print(). Lives on the work-slips
 * print page so the rest of the page stays a server component. The
 * surrounding action bar carries data-no-print so it disappears in the
 * printed output.
 */
export function PrintButton() {
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
