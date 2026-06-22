/**
 * Root 404 page. App Router renders this for unknown routes and whenever a
 * server component calls notFound(). Stays in Helm's editorial style instead
 * of Next's default plain text so a typo or stale link still feels like part
 * of the product.
 */

import Link from 'next/link';
import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmFooter } from '@/components/HelmFooter';

export default function NotFound() {
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
          style={{ marginBottom: 14, color: 'var(--ink-4)' }}
        >
          404
        </div>
        <h1
          className="font-serif"
          style={{ fontSize: 36, fontWeight: 400, lineHeight: 1.15, letterSpacing: '-0.01em', margin: 0 }}
        >
          That page is not here.
        </h1>
        <p style={{ fontSize: 15, color: 'var(--ink-3)', marginTop: 18, lineHeight: 1.6 }}>
          The URL may have moved, or the record you were looking at is gone. Try the search
          bar in the masthead, or jump back to the home screen.
        </p>

        <div style={{ display: 'flex', gap: 12, marginTop: 28, flexWrap: 'wrap' }}>
          <Link
            href="/"
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
