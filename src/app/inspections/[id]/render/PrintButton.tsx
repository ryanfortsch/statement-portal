'use client';

/**
 * Tiny client island that wraps window.print(). Lives on the print
 * render page so the rest of the page can stay a server component.
 * Hidden from the printed output via a print-only `display: none`
 * applied at the page level (the surrounding bar carries `data-no-print`).
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
