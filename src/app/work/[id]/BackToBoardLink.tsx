'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';

/**
 * "← All Work" that lands you back on the board exactly as you left it.
 *
 * The board mirrors its view state (filter, tab, expanded groups) into its
 * URL and stashes that URL in sessionStorage on every change. Clicking this
 * link replays that URL with this slip's property merged into the ?open=
 * set, plus a #prop- anchor so the board scrolls to the group. A hardcoded
 * href can't do this — it would silently reset the filter and collapse
 * every other group the operator had open mid-triage.
 *
 * Cold loads (slip opened from a ping or email, no board visit this tab)
 * fall back to the server-provided href, which still opens this property's
 * group — and for a snoozed slip carries filter=snoozed so the group is
 * actually visible on landing.
 */
export function BackToBoardLink({
  fallbackHref,
  propertyId,
}: {
  fallbackHref: string;
  propertyId: string;
}) {
  const router = useRouter();

  function handleClick(e: React.MouseEvent<HTMLAnchorElement>) {
    // Modified clicks (new tab, etc.) keep native Link behavior.
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    let saved: string | null = null;
    try {
      saved = sessionStorage.getItem('helm:work-board-url');
    } catch {
      return;
    }
    if (!saved || !saved.startsWith('/work')) return;
    e.preventDefault();
    const url = new URL(saved, window.location.origin);
    const open = new Set(
      (url.searchParams.get('open') ?? '').split(',').map((s) => s.trim()).filter(Boolean),
    );
    open.add(propertyId);
    url.searchParams.set('open', [...open].join(','));
    router.push(`${url.pathname}?${url.searchParams.toString()}#prop-${propertyId}`);
  }

  return (
    <Link
      href={fallbackHref}
      onClick={handleClick}
      style={{
        fontSize: 11,
        letterSpacing: '.18em',
        textTransform: 'uppercase',
        color: 'var(--ink-3)',
        textDecoration: 'none',
      }}
    >
      ← All Work
    </Link>
  );
}
