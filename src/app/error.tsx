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

// A chunk / dynamic-import failure means this tab was loaded before a deploy
// and is now requesting JS the new build replaced (we ship many times a day, so
// any tab left open hits this on its next click). reset() can't fix it (same
// stale chunks); only a full reload pulls the current build. We match by name
// AND message because the name is often minified in production.
function isStaleDeployError(error: Error): boolean {
  const name = error?.name || '';
  const msg = error?.message || '';
  return (
    name === 'ChunkLoadError' ||
    /loading chunk [\d]+ failed|chunkloaderror|failed to fetch dynamically imported module|error loading dynamically imported module|importing a module script failed/i.test(
      msg,
    )
  );
}

export default function GlobalError({ error, reset }: Props) {
  const staleDeploy = isStaleDeployError(error);

  useEffect(() => {
    console.error('Helm error boundary caught:', error);
    // Auto-recover from a stale-deploy chunk error by reloading into the
    // current build, instead of stranding the operator on this screen. Guard
    // against a reload loop: only auto-reload once per short window, so if the
    // reload still fails (a genuinely broken build), the error screen shows.
    if (staleDeploy && typeof window !== 'undefined') {
      try {
        const key = 'helm-stale-deploy-reload-at';
        const last = Number(window.sessionStorage.getItem(key) || 0);
        if (Date.now() - last > 10_000) {
          window.sessionStorage.setItem(key, String(Date.now()));
          window.location.reload();
        }
      } catch {
        window.location.reload();
      }
    }
  }, [error, staleDeploy]);

  // Transient failures (a request shed during a polling burst, a brief
  // upstream blip) heal on re-render, but this screen used to sit until
  // someone pressed Try again - on the auto-refreshing messaging tabs that
  // read as "the page errors constantly". Retry automatically with backoff,
  // a few times per 5-minute window; a genuinely broken page re-trips the
  // boundary, spends the retries, and stays here with the manual buttons.
  useEffect(() => {
    if (staleDeploy) return;
    const KEY = 'helm-error-auto-retry';
    let attempt = 0;
    try {
      const raw = window.sessionStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as { n?: number; at?: number };
        if (Date.now() - (parsed.at || 0) < 5 * 60_000) attempt = parsed.n || 0;
      }
    } catch {
      // sessionStorage unavailable: still retry, just without the cap.
    }
    if (attempt >= 4) return;
    const delay = Math.min(8_000 * 2 ** attempt, 60_000) * (0.8 + Math.random() * 0.4);
    const t = setTimeout(() => {
      try {
        window.sessionStorage.setItem(KEY, JSON.stringify({ n: attempt + 1, at: Date.now() }));
      } catch {}
      reset();
    }, delay);
    return () => clearTimeout(t);
  }, [staleDeploy, reset]);

  // While the reload is in flight, don't flash the scary error screen.
  if (staleDeploy) {
    return (
      <div
        className="min-h-screen flex items-center justify-center"
        style={{ background: 'var(--paper)', color: 'var(--ink-3)', fontSize: 13 }}
      >
        Updating to the latest version…
      </div>
    );
  }

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
          The failure was logged, and Helm will retry on its own in a few seconds.
          You can also try the same page again now, or go back to the home screen
          and pick a different route.
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
