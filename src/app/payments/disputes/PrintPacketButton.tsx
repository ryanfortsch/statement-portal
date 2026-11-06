'use client';

/**
 * Save the packet as a PDF for the Stripe upload. The browser's own print
 * dialog, so the PDF is exactly the page the owner just read; the page's
 * print rules drop the navigation, the form and the working notes.
 */
export function PrintPacketButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="eyebrow"
      style={{
        padding: '8px 14px',
        border: '1px solid var(--ink)',
        background: 'var(--ink)',
        color: 'var(--paper)',
        cursor: 'pointer',
      }}
    >
      Save as PDF
    </button>
  );
}
