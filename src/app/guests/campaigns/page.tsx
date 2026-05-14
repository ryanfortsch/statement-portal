import Link from 'next/link';
import { HelmMasthead } from '@/components/HelmMasthead';
import { listCampaigns } from '@/lib/guests';

export const dynamic = 'force-dynamic';

export default async function GuestCampaignsPage() {
  const campaigns = await listCampaigns();

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead current="guests" />

      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingTop: 56, paddingBottom: 28, width: '100%' }}>
        <div className="eyebrow" style={{ marginBottom: 14 }}>
          <Link href="/guests" style={{ color: 'var(--ink-3)', textDecoration: 'none' }}>← Guests</Link>
        </div>
        <h1 className="font-serif" style={{
          fontSize: 36,
          lineHeight: 1.05,
          fontWeight: 300,
          letterSpacing: '-0.02em',
          color: 'var(--ink)',
        }}>
          Campaigns
        </h1>
        <p style={{ marginTop: 8, fontSize: 14, color: 'var(--ink-3)', maxWidth: 580 }}>
          Newsletters and broadcasts. Composer + send-via-Resend lands next; for now this view shows what's been saved or sent.
        </p>
      </section>

      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 80, flex: 1, width: '100%' }}>
        {campaigns.length === 0 ? (
          <div style={{ borderTop: '1px solid var(--ink)', padding: '40px 0', textAlign: 'center', color: 'var(--ink-3)' }}>
            No campaigns yet.
          </div>
        ) : (
          <div style={{ borderTop: '1px solid var(--ink)' }}>
            {campaigns.map((c) => (
              <Link
                key={c.id}
                href={`/guests/campaigns/${c.id}`}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '120px 1fr auto auto',
                  gap: 24,
                  padding: '18px 0',
                  borderBottom: '1px solid var(--rule)',
                  alignItems: 'baseline',
                  textDecoration: 'none',
                  color: 'inherit',
                }}
              >
                <span className="eyebrow">{c.status}</span>
                <div>
                  <div style={{ fontSize: 14, color: 'var(--ink)' }}>{c.name}</div>
                  {c.subject && <div style={{ marginTop: 2, fontSize: 12, color: 'var(--ink-3)' }}>{c.subject}</div>}
                </div>
                <span className="tabular-nums" style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                  {c.recipient_count != null ? `${c.recipient_count}` : '—'}
                </span>
                <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                  {c.sent_at ? new Date(c.sent_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : 'Open →'}
                </span>
              </Link>
            ))}
          </div>
        )}
      </section>

      <footer style={{ borderTop: '1px solid var(--ink)' }}>
        <div className="max-w-[1100px] mx-auto px-10 flex items-center justify-between" style={{
          padding: '14px 40px',
          fontSize: 10,
          letterSpacing: '.18em',
          textTransform: 'uppercase',
          color: 'var(--ink-4)',
        }}>
          <span>Rising Tide &middot;Guests&middot; Campaigns</span>
        </div>
      </footer>
    </div>
  );
}
