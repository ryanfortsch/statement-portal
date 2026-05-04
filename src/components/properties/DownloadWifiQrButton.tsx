'use client';

import { useState } from 'react';

/**
 * Standalone WiFi QR download. PNG by default (works in email + photo
 * editors); pass format="svg" for vector. Hits /api/wifi-qr.
 */
export function DownloadWifiQrButton({
  propertyId,
  format = 'png',
  label = 'Download QR',
}: {
  propertyId: string;
  format?: 'png' | 'svg';
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
          const res = await fetch(
            `/api/wifi-qr?id=${encodeURIComponent(propertyId)}&format=${format}`,
          );
          if (!res.ok) {
            let msg = `${res.status}`;
            try { msg = (await res.json()).error || msg; } catch { /* ignore */ }
            throw new Error(msg);
          }
          const blob = await res.blob();
          const cd = res.headers.get('Content-Disposition') || '';
          const match = cd.match(/filename="([^"]+)"/);
          const filename = match?.[1] || `wifi-qr-${propertyId}.${format}`;
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = filename;
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 5000);
        } catch (err) {
          alert(`QR download failed: ${err instanceof Error ? err.message : err}`);
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
          {/* QR-code-ish glyph — 4 squares */}
          <svg width="13" height="13" viewBox="0 0 14 14" fill="currentColor">
            <rect x="0" y="0" width="5" height="5" />
            <rect x="9" y="0" width="5" height="5" />
            <rect x="0" y="9" width="5" height="5" />
            <rect x="9" y="9" width="3" height="3" />
            <rect x="11" y="11" width="3" height="3" />
          </svg>
          <span>{label}</span>
        </>
      )}
    </button>
  );
}
