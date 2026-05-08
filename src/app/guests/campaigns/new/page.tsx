import Link from 'next/link';
import { HelmMasthead } from '@/components/HelmMasthead';
import { createDraftCampaign } from '../actions';

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
          New campaign
        </h1>
        <p style={{ marginTop: 8, fontSize: 14, color: 'var(--ink-3)', maxWidth: 580 }}>
          Give it a working name. The next page is the composer where you write the subject, body, and pick the segment.
        </p>
      </section>

      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 80, flex: 1, width: '100%' }}>
        <form
          action={createDraftCampaign}
          style={{
            borderTop: '1px solid var(--ink)',
            borderBottom: '1px solid var(--ink)',
            padding: '32px 0',
            display: 'grid',
            gap: 16,
            maxWidth: 560,
          }}
        >
          <div>
            <label htmlFor="name" className="eyebrow" style={{ display: 'block', marginBottom: 8 }}>
              Working name
            </label>
            <input
              id="name"
              name="name"
              type="text"
              required
              placeholder="The Weekly · vol 12"
              className="font-serif"
              style={{
                width: '100%',
                background: 'transparent',
                border: '1px solid var(--rule)',
                color: 'var(--ink)',
                fontSize: 18,
                fontWeight: 400,
                padding: '10px 14px',
                outline: 'none',
              }}
            />
            <p style={{ marginTop: 6, fontSize: 12, color: 'var(--ink-4)' }}>
              Internal label. Recipients never see this.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
            <button
              type="submit"
              style={{
                background: 'var(--ink)',
                color: 'var(--paper)',
                fontSize: 12,
                fontWeight: 600,
                letterSpacing: '.18em',
                textTransform: 'uppercase',
                padding: '14px 28px',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              Create draft →
            </button>
            <Link href="/audience/campaigns" style={{ fontSize: 12, color: 'var(--ink-3)' }}>
              Cancel
            </Link>
          </div>
        </form>
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
