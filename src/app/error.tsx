'use client';

/** Root recovery UI; controls remain available even when automatic reload is blocked. */

import { useEffect } from 'react';
import { claimDeployReload, isStaleDeployError } from '@/lib/recovery';
import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmFooter } from '@/components/HelmFooter';

type Props = {
  error: Error & { digest?: string };
  unstable_retry: () => void;
};

export default function GlobalError({ error, unstable_retry }: Props) {
  const staleDeploy = isStaleDeployError(error);
  useEffect(() => {
    console.error('Helm error boundary caught:', error);
    if (staleDeploy) {
      // Reading sessionStorage itself can throw in restricted browsers.
      try {
        if (claimDeployReload(window.sessionStorage)) window.location.reload();
      } catch { /* Keep the recovery controls visible. */ }
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
      // Without a persisted cap, leave recovery to the manual controls.
      return;
    }
    if (attempt >= 4) return;
    const delay = Math.min(8_000 * 2 ** attempt, 60_000) * (0.8 + Math.random() * 0.4);
    const t = setTimeout(() => {
      try {
        window.sessionStorage.setItem(KEY, JSON.stringify({ n: attempt + 1, at: Date.now() }));
      } catch {}
      unstable_retry();
    }, delay);
    return () => clearTimeout(t);
  }, [staleDeploy, unstable_retry]);

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
          {staleDeploy ? 'This page needs a fresh start.' : 'The page hit an error.'}
        </h1>
        <p style={{ fontSize: 15, color: 'var(--ink-3)', marginTop: 18, lineHeight: 1.6 }}>
          {staleDeploy
            ? 'A newer version of Helm may be available. Reload this page, or return to the home screen. If this continues, share the reference below with your administrator.'
            : 'Try this page again, or return to the home screen. If this continues, share the reference below with your administrator.'}
        </p>

        <p
            className="font-mono"
            style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 16 }}
          >
            Ref: {error.digest || (staleDeploy ? 'HELM-PAGE-UPDATE' : 'HELM-PAGE-ERROR')}
        </p>

        <div style={{ display: 'flex', gap: 12, marginTop: 28, flexWrap: 'wrap' }}>
          <button
            type="button"
            onClick={() => staleDeploy ? window.location.reload() : unstable_retry()}
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
            {staleDeploy ? 'Reload page' : 'Try again'}
          </button>
          {/* Full navigation deliberately discards stale client chunks. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a
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
          </a>
        </div>
      </section>
      <div style={{ flex: 1 }} />
      <HelmFooter />
    </div>
  );
}
