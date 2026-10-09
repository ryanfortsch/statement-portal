'use client';

/** Fires the browser print dialog. The page's print CSS puts one card on each 4 x 6 page. */
export function PrintAllButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      style={{
        fontSize: 11,
        letterSpacing: '.18em',
        textTransform: 'uppercase',
        fontWeight: 600,
        color: '#F4ECD8',
        background: '#0F2A44',
        border: '1px solid #0F2A44',
        padding: '10px 18px',
        cursor: 'pointer',
      }}
    >
      Print all
    </button>
  );
}
