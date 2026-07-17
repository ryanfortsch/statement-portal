'use client';

import { useState } from 'react';
import type { PropertyDeliverable } from '@/lib/property-pdf';

/**
 * Client-side button that hits /api/property-pdf and triggers a real
 * download with the friendly filename from Content-Disposition.
 */
export function DownloadPropertyPdfButton({
  propertyId,
  type,
  label,
  noticeId,
}: {
  propertyId: string;
  type: PropertyDeliverable;
  label: string;
  /** Required when type === 'notice'; identifies which bespoke notice to render. */
  noticeId?: string;
}) {
  const [busy, setBusy] = useState(false);

  return (
    <button
      type="button"
      disabled={busy}
      aria-label={label}
      onClick={async () => {
        setBusy(true);
        try {
          const params = new URLSearchParams({ id: propertyId, type });
          if (noticeId) params.set('noticeId', noticeId);
          const res = await fetch(`/api/property-pdf?${params.toString()}`);
          if (!res.ok) {
            let msg = `${res.status}`;
            try { msg = (await res.json()).error || msg; } catch { /* ignore */ }
            throw new Error(msg);
          }
          const blob = await res.blob();
          const cd = res.headers.get('Content-Disposition') || '';
          const match = cd.match(/filename="([^"]+)"/);
          const filename = match?.[1] || `${type}-${propertyId}.pdf`;
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          a.remove();
          // Some browsers cancel the download if the blob URL is revoked
          // before the download dialog is committed. Defer the revoke.
          setTimeout(() => URL.revokeObjectURL(url), 5000);
        } catch (err) {
          alert(`Download failed: ${err instanceof Error ? err.message : err}`);
        } finally {
          setBusy(false);
        }
      }}
      style={{
        background: 'transparent',
        color: 'var(--ink)',
        fontSize: 11,
        fontWeight: 500,
        letterSpacing: '.18em',
        textTransform: 'uppercase',
        padding: '9px 16px',
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
  );
}
