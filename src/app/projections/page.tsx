import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmFooter } from '@/components/HelmFooter';
import { ProspectsPanel } from '@/components/projections/ProspectsPanel';
import { auth } from '@/auth';

export const dynamic = 'force-dynamic';

/**
 * The standalone Prospects page. The funnel body (CTA + active + archive)
 * lives in <ProspectsPanel> so it renders identically here and as the
 * "Prospects" tab on /properties. This page keeps the prospects-specific
 * masthead, hero, and footer.
 */
export default async function ProjectionsPage() {
  const session = await auth();
  const firstName = session?.user?.name?.split(' ')[0] || session?.user?.email?.split('@')[0] || '';

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead current="projections" />

      {/* HERO */}
      <section className="max-w-[1100px] mx-auto px-10 rt-helm-hero" style={{ paddingTop: 56, paddingBottom: 28, width: '100%' }}>
        <div className="eyebrow" style={{ marginBottom: 14 }}>Helm &middot; Prospects</div>
        <h1
          className="font-serif rt-helm-hero-h1"
          style={{
            fontSize: 44,
            lineHeight: 1.05,
            fontWeight: 300,
            letterSpacing: '-0.02em',
            color: 'var(--ink)',
            maxWidth: 720,
          }}
        >
          The prospect funnel <em style={{ color: 'var(--tide-deep)', fontWeight: 400 }}>in one place.</em>
        </h1>
        <p style={{ marginTop: 14, fontSize: 14, lineHeight: 1.55, color: 'var(--ink-3)', maxWidth: 580 }}>
          {firstName ? `Hi ${firstName}. ` : ''}One record per prospect drives three deliverables: a projection deck, a partnership guide, and a management contract. Same inputs, no copy-paste.
        </p>
      </section>

      <ProspectsPanel />

      <HelmFooter module="Prospects" right="Source: Helm" />
    </div>
  );
}
