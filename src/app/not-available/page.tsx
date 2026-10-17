import Link from 'next/link';
import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmFooter } from '@/components/HelmFooter';

/**
 * Where the proxy lands a staff login that opened an owner-only page. The
 * nav, the section strips and the feed never link there for staff, so this
 * is reached by a typed URL, an old bookmark, or a link in a message. Say
 * plainly what stays with the owners and point home.
 *
 * The sentence below names every area in OWNER_PATH_PREFIXES
 * (helm-access.ts); helm-access.test.ts checks the words are still here, so
 * a newly gated page gets named on this page too.
 */
export const dynamic = 'force-dynamic';

export default async function NotAvailablePage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string }>;
}) {
  const { from } = await searchParams;
  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead />
      <section className="max-w-[760px] mx-auto px-10" style={{ paddingTop: 72, paddingBottom: 96, width: '100%' }}>
        <div style={{ fontSize: 10, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--ink-4)', fontWeight: 500 }}>
          Owners only
        </div>
        <h1 className="font-serif" style={{ fontSize: 34, fontWeight: 500, letterSpacing: '-0.01em', marginTop: 10, lineHeight: 1.15 }}>
          This part of Helm is for the owners.
        </h1>
        <p style={{ marginTop: 18, fontSize: 15.5, lineHeight: 1.6, color: 'var(--ink-3)', maxWidth: 560 }}>
          Owner statements, revenue, the forecast, the books and payments; contracts, prospects
          and projections; owner messaging; guest quotes; creative pay and the contractor rate card.
          All of it stays with Ryan and the back office. If you need something from here, ask Ryan.
        </p>
        {from && (
          <p className="font-mono" style={{ marginTop: 14, fontSize: 12, color: 'var(--ink-4)' }}>{from}</p>
        )}
        <p style={{ marginTop: 28 }}>
          <Link href="/" style={{ color: 'var(--tide-deep)', fontWeight: 600, textDecoration: 'none' }}>
            Back to Helm →
          </Link>
        </p>
      </section>
      <HelmFooter />
    </div>
  );
}
