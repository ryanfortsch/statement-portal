'use client';

/**
 * Root error boundary.
 *
 * App Router renders this whenever a server component, server action, or route
 * handler throws past its segment. Without it Next falls back to a default
 * crash screen with raw stack text, which is the worst version of an
 * already-bad moment -- a logged-in operator should see Helm's editorial
 * surface, an honest one-line explanation, and a reset button that re-runs the
 * failing render without a full page reload.
 *
 * Must be a client component (the reset prop is a function the boundary calls
 * after re-rendering the segment). HelmMasthead is safe to mount from here --
 * it composes a few client components of its own and uses no module-specific
 * data, so we don't pass a `current` highlight.
 */

import Link from 'next/link';
import { useEffect } from 'react';
import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmFooter } from '@/components/HelmFooter';

type Props = {
  error: Error & { digest?: string };
  reset: () => void;
};

export default function GlobalError({ error, reset }: Props) {
  useEffect(() => {
    // Surface the failure in the browser console for live debugging. Vercel
    // captures the server-side throw separately via its logs; this is just so
    // a developer hitting F12 in production can see what blew up.
    console.error('Helm error boundary caught:', error);
  }, [error]);

  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ background: 'var(--paper)', color: 'var(--ink)' }}
    >
      <HelmMasthead />
      <section
        className="max-w-[680px] mx-auto px-10"
        style={{ paddingTop: 80, paddingBottom: 56, width: '100%' }}
      >
        <div
          className="eyebrow"
          style={{ marginBottom: 14, color: 'var(--signal)' }}
        >
          Something went sideways
        </div>
        <h1
          className="font-serif"
          style={{ fontSize: 36, fontWeight: 400, lineHeight: 1.15, letterSpacing: '-0.01em', margin: 0 }}
        >
          The page hit an error.
        </h1>
        <p style={{ fontSize: 15, color: 'var(--ink-3)', marginTop: 18, lineHeight: 1.6 }}>
          The failure was logged. You can try the same page again, or go back to the home
          screen and pick a different route.
        </p>

        {error?.digest && (
          <p
            className="font-mono"
            style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 16 }}
          >
            Ref: {error.digest}
          </p>
        )}

        <div style={{ display: 'flex', gap: 12, marginTop: 28, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => reset()}
            style={{
              padding: '10px 18px',
              fontSize: 12,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              fontWeight: 500,
              fontFamily: 'inherit',
              background: 'var(--ink)',
              color: 'var(--paper)',
              border: '1px solid var(--ink)',
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
          <Link
            href="/"
            style={{
              padding: '10px 18px',
              fontSize: 12,
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              fontWeight: 500,
              fontFamily: 'inherit',
              background: 'transparent',
              color: 'var(--ink)',
              border: '1px solid var(--ink)',
              textDecoration: 'none',
              display: 'inline-block',
            }}
          >
            Back to Helm
          </Link>
        </div>
      </section>
      <div style={{ flex: 1 }} />
      <HelmFooter />
    </div>
  );
}
