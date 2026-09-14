'use client';

import { useEffect } from 'react';

/**
 * The one-shot "packet sent" banner. The outcome rides the redirect as
 * ?sent=1 (+ who / skipped), and this strips those params from the address
 * bar the moment it renders, so a refresh, a bookmark, or a tab left open
 * never replays a stale banner. (The old failure banner lived in the same
 * URL as ?sent=0 and did exactly that: "keeps coming up" on a board where
 * nothing had just failed, 2026-09-14. Failures now stay inline on the
 * calendar's bundle bar instead.)
 *
 * replaceState is Next-aware: it syncs the router's search params without a
 * navigation, so the already-rendered banner stays up until the next load.
 */
export function SentFlash({ sent, who, skipped }: { sent?: string; who?: string; skipped?: string }) {
  useEffect(() => {
    if (!sent) return;
    const url = new URL(window.location.href);
    if (!url.searchParams.has('sent')) return;
    for (const k of ['sent', 'who', 'skipped']) url.searchParams.delete(k);
    window.history.replaceState(null, '', url.pathname + url.search);
  }, [sent]);

  if (sent !== '1') return null;
  return (
    <div style={{ marginTop: 18, border: '1px solid var(--positive)', background: 'rgba(63,153,34,0.08)', color: 'var(--positive)', padding: '10px 14px', borderRadius: 8, fontSize: 13, lineHeight: 1.5 }}>
      {who
        ? `Packet sent to ${who}. Only they can see and claim it, and nobody else was texted.`
        : "Packet sent. It's out to contractors below."}
      {skipped && (
        <div style={{ marginTop: 4, color: '#7a5512' }}>
          Left off this trip: {skipped}.
        </div>
      )}
    </div>
  );
}
