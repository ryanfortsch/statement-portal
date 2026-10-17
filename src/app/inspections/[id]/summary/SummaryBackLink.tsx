'use client';

import Link from 'next/link';
import { useSyncExternalStore } from 'react';

/**
 * The summary's back link returns to where the reader came from: the
 * pipeline row (Turnovers), the property page, Home or the inspections
 * index. The referrer is a browser fact the server cannot know, so it is
 * read as an external value (empty on the server and on the first paint,
 * so hydration matches) and only a same-origin Helm page counts; anything
 * else falls back to the index. Native history.back() would also drop a
 * reader on an external page or a sign-in redirect, so this navigates to
 * the referrer URL instead.
 */
const FALLBACK = { href: '/inspections', label: '← All Inspections' };

const noop = () => () => {};
const readReferrer = () => (typeof document === 'undefined' ? '' : document.referrer);
const serverReferrer = () => '';

function targetFor(referrer: string): { href: string; label: string } {
  if (!referrer) return FALLBACK;
  try {
    const url = new URL(referrer);
    if (url.origin !== window.location.origin) return FALLBACK;
    const path = url.pathname;
    // The stepper's Complete lands here by redirect; its referrer is the
    // walk itself, which no longer wants a visitor.
    if (path.startsWith('/inspections/')) return FALLBACK;
    const href = `${url.pathname}${url.search}${url.hash}`;
    if (path.startsWith('/turnovers')) return { href, label: '← Turnovers' };
    if (path.startsWith('/properties/')) return { href, label: '← Property' };
    if (path === '/inspections') return { href, label: '← All Inspections' };
    if (path === '/' || path.startsWith('/today')) return { href, label: '← Home' };
    return FALLBACK;
  } catch {
    return FALLBACK;
  }
}

export function SummaryBackLink() {
  const referrer = useSyncExternalStore(noop, readReferrer, serverReferrer);
  const target = targetFor(referrer);

  return (
    <Link
      href={target.href}
      style={{
        fontSize: 11,
        letterSpacing: '.18em',
        textTransform: 'uppercase',
        color: 'var(--ink-3)',
        textDecoration: 'none',
      }}
    >
      {target.label}
    </Link>
  );
}
