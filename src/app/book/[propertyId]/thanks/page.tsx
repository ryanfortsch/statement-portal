import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getProperty } from '@/lib/properties';

export const dynamic = 'force-dynamic';

export default async function BookThanksPage({
  params,
}: {
  params: Promise<{ propertyId: string }>;
}) {
  const { propertyId } = await params;
  const property = getProperty(propertyId);
  if (!property) notFound();

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--paper)',
      color: 'var(--ink)',
      display: 'flex',
      flexDirection: 'column',
      fontFamily: 'var(--font-sans, -apple-system, sans-serif)',
    }}>
      <header style={{ padding: '24px 0', borderBottom: '1px solid var(--rule)', textAlign: 'center' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/rising-tide-logo.png" alt="Rising Tide" style={{ width: 44, height: 44 }} />
        <div className="font-serif" style={{ fontSize: 22, marginTop: 6, letterSpacing: '-0.01em' }}>Rising Tide STR</div>
      </header>

      <main style={{ maxWidth: 580, margin: '0 auto', padding: '96px 24px', textAlign: 'center', flex: 1 }}>
        <div style={{
          width: 56,
          height: 56,
          borderRadius: '50%',
          background: 'var(--positive, #2d6b50)',
          color: 'var(--paper)',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 28,
          margin: '0 auto 24px',
        }}>
          ✓
        </div>
        <h1
          className="font-serif"
          style={{
            fontSize: 36,
            fontWeight: 300,
            letterSpacing: '-0.02em',
            color: 'var(--ink)',
            margin: 0,
          }}
        >
          Inquiry sent.
        </h1>
        <p style={{ marginTop: 18, fontSize: 16, lineHeight: 1.6, color: 'var(--ink-3)' }}>
          We got your request for <strong>{property.name}</strong>. Allie or Ryan will reply within a few hours to
          confirm availability and send a quote — usually faster.
        </p>
        <p style={{ marginTop: 14, fontSize: 14, color: 'var(--ink-4)' }}>
          Check your inbox for a copy. Reply to that email if anything changes about your trip.
        </p>
        <Link
          href={`/book/${propertyId}`}
          style={{
            display: 'inline-block',
            marginTop: 36,
            padding: '11px 22px',
            border: '1px solid var(--ink)',
            color: 'var(--ink)',
            fontSize: 12,
            letterSpacing: '.06em',
            textTransform: 'uppercase',
            textDecoration: 'none',
          }}
        >
          ← Different dates
        </Link>
      </main>
    </div>
  );
}
