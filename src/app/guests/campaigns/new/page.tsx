import Link from 'next/link';
import { HelmMasthead } from '@/components/HelmMasthead';

export const dynamic = 'force-dynamic';

export default function NewCampaignPage() {
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
          New Campaign
        </h1>
        <p style={{ marginTop: 8, fontSize: 14, color: 'var(--ink-3)', maxWidth: 580 }}>
          The composer ships in the next iteration. It will use React Email templates, segment-based targeting, preview, and send via Resend Broadcasts.
        </p>
      </section>

      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 80, flex: 1, width: '100%' }}>
        <div style={{ borderTop: '1px solid var(--ink)', borderBottom: '1px solid var(--ink)', padding: '32px 0' }}>
          <div className="eyebrow" style={{ marginBottom: 14 }}>What's coming</div>
          <ul style={{ fontSize: 14, lineHeight: 1.7, color: 'var(--ink)', listStyle: 'none', padding: 0 }}>
            <li>· Subject + preheader + from-name fields</li>
            <li>· Body composer (Markdown to start, React Email later)</li>
            <li>· Segment selector with live recipient count</li>
            <li>· Send-self test, then full send</li>
            <li>· Engagement dashboard (opens, clicks, unsubs) via webhook</li>
          </ul>
        </div>
      </section>

      <footer style={{ borderTop: '1px solid var(--ink)' }}>
        <div className="max-w-[1100px] mx-auto px-10 flex items-center justify-between" style={{
          padding: '14px 40px',
          fontSize: 10,
          letterSpacing: '.18em',
          textTransform: 'uppercase',
          color: 'var(--ink-4)',
        }}>
          <span>Rising Tide &middot;Guests&middot; New Campaign</span>
        </div>
      </footer>
    </div>
  );
}
