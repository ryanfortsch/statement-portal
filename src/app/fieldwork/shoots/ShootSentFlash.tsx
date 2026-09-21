'use client';

import Link from 'next/link';
import { useEffect } from 'react';

/**
 * The one-shot "sent" banner for the creative board. The result of a send
 * from the planner grid rides the redirect as ?sent=<note>&shoot=<id>, and
 * this strips both the moment it renders, so a refresh, a bookmark, or a tab
 * left open never replays a stale banner (the packets board's SentFlash
 * pattern). replaceState is Next-aware: the rendered banner stays up until
 * the next load.
 */
export function ShootSentFlash({ note, shootId }: { note?: string; shootId?: string }) {
  useEffect(() => {
    if (!note) return;
    const url = new URL(window.location.href);
    if (!url.searchParams.has('sent')) return;
    for (const k of ['sent', 'shoot']) url.searchParams.delete(k);
    window.history.replaceState(null, '', url.pathname + url.search);
  }, [note]);

  if (!note) return null;
  const failed = /did NOT send/i.test(note);
  return (
    <div
      style={{
        marginTop: 14,
        border: `1px solid ${failed ? 'var(--signal)' : 'var(--positive)'}`,
        background: failed ? 'rgba(200,90,58,0.06)' : 'rgba(63,153,34,0.08)',
        color: failed ? 'var(--signal)' : 'var(--positive)',
        padding: '10px 14px',
        borderRadius: 8,
        fontSize: 13,
        lineHeight: 1.5,
        display: 'flex',
        justifyContent: 'space-between',
        gap: 12,
        flexWrap: 'wrap',
      }}
    >
      <span>{note}</span>
      {shootId && (
        <Link href={`/fieldwork/shoots/${shootId}`} style={{ color: 'inherit', fontWeight: 600, textDecoration: 'none', whiteSpace: 'nowrap' }}>
          Open the shoot →
        </Link>
      )}
    </div>
  );
}
