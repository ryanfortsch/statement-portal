import Link from 'next/link';
import { listSegments } from '@/lib/guests';
import { countSegmentRecipients } from '@/lib/guests-campaigns';
import { TONE_OPTIONS } from '@/lib/ai/brand-voice';
import { CampaignCreationForms } from './CampaignCreationForms';

export const dynamic = 'force-dynamic';

export default async function NewCampaignPage() {
  const segments = await listSegments();
  const insider = segments.find((s) => s.name === 'Insider List');
  // The audiences a campaign can go to, each with who it reaches today. The
  // two system segments (Insider List, Weekly Subscribers) are the model;
  // there is no segments page, so this select is where they are read.
  const counts = await Promise.all(segments.map((s) => countSegmentRecipients(s)));
  const audiences = segments.map((s, i) => ({ id: s.id, name: s.name, description: s.description, count: counts[i] }));

  return (
    <div className="flex-1 flex flex-col">
      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingTop: 56, paddingBottom: 28, width: '100%' }}>
        <div className="eyebrow" style={{ marginBottom: 14 }}>
          <Link href="/guests/campaigns" style={{ color: 'var(--ink-3)', textDecoration: 'none' }}>← Campaigns</Link>
        </div>
        <h1 className="font-serif" style={{
          fontSize: 36,
          lineHeight: 1.05,
          fontWeight: 300,
          letterSpacing: '-0.02em',
          color: 'var(--ink)',
        }}>
          New campaign
        </h1>
        <p style={{ marginTop: 8, fontSize: 14, color: 'var(--ink-3)', maxWidth: 580 }}>
          Nothing sends from this page.
        </p>
      </section>

      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 56, flex: 1, width: '100%' }}>
        <CampaignCreationForms segments={audiences} tones={TONE_OPTIONS} defaultSegment={insider?.id ?? ''} />
      </section>

      <footer style={{ borderTop: '1px solid var(--ink)' }}>
        <div className="max-w-[1100px] mx-auto px-10 flex items-center justify-between" style={{
          padding: '14px 40px',
          fontSize: 10,
          letterSpacing: '.18em',
          textTransform: 'uppercase',
          color: 'var(--ink-4)',
        }}>
          <span>Rising Tide &middot; Contacts &middot; New Campaign</span>
        </div>
      </footer>
    </div>
  );
}
