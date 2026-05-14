'use client';

import { useState } from 'react';
import type { PropertyDeliverable } from '@/lib/property-pdf';

/**
 * Sibling of DownloadPropertyPdfButton — hits /api/property-docx and
 * triggers a real download with the friendly filename from
 * Content-Disposition. Staff use this to edit a deliverable in Word
 * before printing when a one-off tweak (custom Wi-Fi for a Sonos demo
 * night, etc.) doesn't justify changing the Helm record.
 */
export function DownloadPropertyDocxButton({
  propertyId,
  type,
  label = 'Download Word',
}: {
  propertyId: string;
  type: PropertyDeliverable;
  label?: string;
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
          const res = await fetch(`/api/property-docx?${params.toString()}`);
          if (!res.ok) {
            let msg = `${res.status}`;
            try {
              msg = (await res.json()).error || msg;
            } catch {
              /* ignore */
            }
            throw new Error(msg);
          }
          const blob = await res.blob();
          const cd = res.headers.get('Content-Disposition') || '';
          const match = cd.match(/filename="([^"]+)"/);
          const filename = match?.[1] || `${type}-${propertyId}.docx`;
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 5000);
        } catch (err) {
          alert(`Download failed: ${err instanceof Error ? err.message : err}`);
        } finally {
          setBusy(false);
        }
      }}
      style={{
        background: 'transparent',
        color: 'var(--ink-3)',
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
              width: 12,
              height: 12,
              borderRadius: '50%',
              border: '1.5px solid currentColor',
              borderTopColor: 'transparent',
              animation: 'spin 0.8s linear infinite',
              display: 'inline-block',
            }}
          />
          <span>Preparing…</span>
        </>
      ) : (
        <>
          <svg width="13" height="13" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m-9 5h12a2 2 0 002-2V7l-5-5H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
          </svg>
          <span>{label}</span>
        </>
      )}
    </button>
  );
}
