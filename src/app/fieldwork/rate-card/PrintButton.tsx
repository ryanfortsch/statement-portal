'use client';

export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="no-print"
      style={{
        position: 'fixed',
        top: 16,
        right: 16,
        background: '#12283f',
        color: '#f3ede0',
        border: 'none',
        borderRadius: 8,
        padding: '10px 18px',
        fontSize: 12,
        fontWeight: 600,
        letterSpacing: '0.1em',
        textTransform: 'uppercase',
        cursor: 'pointer',
        boxShadow: '0 2px 10px rgba(0,0,0,0.18)',
      }}
    >
      Print / save PDF
    </button>
  );
}
