'use client';

import { useState } from 'react';
import { downloadStatementPdf } from '@/lib/download-pdf';

export function DownloadPdfChip({ id, month }: { id: string; month: string }) {
  const [busy, setBusy] = useState(false);

  return (
    <button
      className="download-chip"
      disabled={busy}
      aria-label="Download statement as PDF"
      onClick={async () => {
        setBusy(true);
        try {
          await downloadStatementPdf(id, month);
        } catch (err) {
          alert(`Download failed: ${err instanceof Error ? err.message : err}`);
        } finally {
          setBusy(false);
        }
      }}
    >
      {busy ? (
        <>
          <span
            aria-hidden
            style={{
              width: 12, height: 12, borderRadius: '50%',
              border: '1.5px solid currentColor', borderTopColor: 'transparent',
              animation: 'spin 0.8s linear infinite',
              display: 'inline-block',
            }}
          />
          <span>Preparing PDF…</span>
        </>
      ) : (
        <>
          <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <span>Download PDF</span>
        </>
      )}
    </button>
  );
}
