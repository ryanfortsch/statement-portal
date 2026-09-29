'use client';

import { usePdfDownload } from '@/lib/use-pdf-download';
import type { DeliverableType } from '@/lib/projection-pdf';

/**
 * Client-side button that hits /api/projection-pdf, pulls the filename out of
 * the Content-Disposition header, and triggers a real download. Renders a
 * small spinner while busy.
 */
export function DownloadPdfButton({
  projectionId,
  type,
  label,
}: {
  projectionId: string;
  type: DeliverableType;
  label: string;
}) {
  const { pending: busy, error, download } = usePdfDownload(
    `/api/projection-pdf?id=${encodeURIComponent(projectionId)}&type=${encodeURIComponent(type)}`,
    `${type}-${projectionId}.pdf`,
  );

  return (
    <span>
    <button
      type="button"
      disabled={busy}
      aria-label={label}
      onClick={download}
      style={{
        background: 'transparent',
        color: 'var(--ink)',
        fontSize: 11,
        fontWeight: 500,
        letterSpacing: '.18em',
        textTransform: 'uppercase',
        padding: '13px 18px',
        border: '1px solid var(--rule)',
        cursor: busy ? 'wait' : 'pointer',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
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
          <span>Preparing…</span>
        </>
      ) : (
        <>
          <svg width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
          <span>{label}</span>
        </>
      )}
    </button>
    {error && <span role="alert" style={{ display: 'block', color: 'var(--negative)', fontSize: 13 }}>{error} Use the download button to retry.</span>}
    </span>
  );
}
