'use client';

/**
 * Fires the inspection Drive archive when the summary page loads.
 *
 * The contract archive hooks a server action (countersign) and the
 * statement archive hooks a client checkbox. An inspection completes
 * via completeInspection, which redirect()s straight to this summary
 * page — so the cleanest non-blocking hook is right here: on mount,
 * if the inspection isn't archived yet, POST /api/archive-inspection.
 * Keeps the inspector's "Complete" tap instant (the ~10s render +
 * Drive upload runs in the background while they review the summary).
 *
 * Idempotent on the server (the route returns the existing url if
 * already archived), so a page refresh re-firing this is harmless.
 */

import { useEffect, useState } from 'react';

const linkStyle: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: 'var(--ink-3)',
  textDecoration: 'none',
};

export function ArchiveTrigger({
  inspectionId,
  initialDriveUrl,
}: {
  inspectionId: string;
  initialDriveUrl: string | null;
}) {
  const [driveUrl, setDriveUrl] = useState<string | null>(initialDriveUrl);
  const [status, setStatus] = useState<'idle' | 'archiving' | 'failed'>(
    initialDriveUrl ? 'idle' : 'archiving',
  );

  useEffect(() => {
    if (initialDriveUrl) return; // already archived — nothing to do
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/archive-inspection', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ inspectionId }),
        });
        const data = (await res.json()) as { ok: boolean; url?: string };
        if (cancelled) return;
        if (data.ok && data.url) {
          setDriveUrl(data.url);
          setStatus('idle');
        } else {
          setStatus('failed');
        }
      } catch {
        if (!cancelled) setStatus('failed');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [inspectionId, initialDriveUrl]);

  if (driveUrl) {
    return (
      <a href={driveUrl} target="_blank" rel="noreferrer" style={linkStyle}>
        ↗ View in Drive archive
      </a>
    );
  }
  if (status === 'archiving') {
    return <span style={{ ...linkStyle, color: 'var(--ink-4)' }}>Archiving to Drive…</span>;
  }
  // failed — the next summary-page load re-fires the archive (idempotent).
  return <span style={{ ...linkStyle, color: 'var(--ink-4)' }}>Drive archive pending</span>;
}
