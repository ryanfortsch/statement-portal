import Link from 'next/link';
import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmFooter } from '@/components/HelmFooter';
import { SyncGmailButton } from '@/components/projections/SyncGmailButton';
import { auth } from '@/auth';
import { supabase } from '@/lib/supabase';
import type { GmailTouchType, ProjectionRow } from '@/lib/projections-types';
import { computeProjection, fmtMoneyRange } from '@/lib/projections-model';

export const dynamic = 'force-dynamic';

async function getProjections(): Promise<ProjectionRow[]> {
  const { data } = await supabase
    .from('projections')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50);
  return (data ?? []) as ProjectionRow[];
}

export default async function ProjectionsPage() {
  const session = await auth();
  const projections = await getProjections();

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

      {/* CTA */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 40, width: '100%' }}>
        <div className="rt-projections-cta" style={{ borderTop: '1px solid var(--ink)', borderBottom: '1px solid var(--ink)', padding: '24px 0', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
          <Link
            href="/projections/new"
            className="rt-projections-cta-primary"
            style={{
              display: 'inline-block',
              background: 'var(--ink)',
              color: 'var(--paper)',
              fontSize: 12,
              fontWeight: 600,
              letterSpacing: '.18em',
              textTransform: 'uppercase',
              padding: '14px 28px',
              textDecoration: 'none',
            }}
          >
            New Prospect →
          </Link>
          <SyncGmailButton />
          <span className="rt-projections-cta-spacer" style={{ flex: 1 }} />
          <span className="rt-projections-cta-note" style={{ fontSize: 11, color: 'var(--ink-4)', fontStyle: 'italic' }}>
            Sync scans Allie&rsquo;s sent folder for prospect emails and tags each row with the last deliverable seen.
          </span>
        </div>
      </section>

      {/* LIST */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 80, flex: 1, width: '100%' }}>
        <div className="flex items-baseline justify-between" style={{ marginBottom: 14 }}>
          <h2 className="font-serif" style={{ fontSize: 22, fontWeight: 400, letterSpacing: '-0.01em', color: 'var(--ink)', margin: 0 }}>
            Recent Prospects
          </h2>
          <span className="eyebrow">last {projections.length}</span>
        </div>

        {projections.length === 0 ? (
          <div style={{ borderTop: '1px solid var(--ink)', padding: '32px 0', textAlign: 'center' }}>
            <p style={{ color: 'var(--ink-3)', marginBottom: 8 }}>No prospects yet.</p>
            <p style={{ color: 'var(--ink-4)', fontSize: 12 }}>
              Click &ldquo;New Prospect&rdquo; above to get started.
            </p>
          </div>
        ) : (
          <div style={{ borderTop: '1px solid var(--ink)' }}>
            {projections.map((p, i) => (
              <ProjectionRowItem key={p.id} projection={p} number={String(i + 1).padStart(2, '0')} />
            ))}
          </div>
        )}
      </section>

      {/* FOOTER */}
      <HelmFooter module="Prospects" right="Source: Helm" />
    </div>
  );
}

function ProjectionRowItem({ projection: p, number }: { projection: ProjectionRow; number: string }) {
  const computed = computeProjection(p);
  const range = fmtMoneyRange(computed.heroLow, computed.heroHigh);
  const sent = p.status === 'sent';
  const touches = p.gmail_touches || {};
  const touchTypes: GmailTouchType[] = ['projection', 'guide', 'contract', 'onboarding'];
  const seen = touchTypes.filter((t) => touches[t]);
  const latestTouch = seen
    .map((t) => ({ type: t, at: touches[t]!.sent_at }))
    .sort((a, b) => b.at.localeCompare(a.at))[0];

  return (
    <Link href={`/projections/${p.id}`} style={{ display: 'block', textDecoration: 'none', color: 'inherit' }}>
      <div
        className="rt-projections-row"
        style={{
          display: 'grid',
          gridTemplateColumns: '64px 1fr auto auto',
          gap: 24,
          alignItems: 'baseline',
          padding: '20px 0 18px',
          borderBottom: '1px solid var(--rule)',
        }}
      >
        <span className="font-mono rt-projections-row-num" style={{ fontSize: 11, color: 'var(--signal)', letterSpacing: '.08em' }}>
          {number}
        </span>
        <div className="rt-projections-row-body" style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
            <h3 className="font-serif rt-projections-row-title" style={{ fontSize: 22, fontWeight: 400, letterSpacing: '-0.02em', color: 'var(--ink)', margin: 0, wordBreak: 'break-word' }}>
              {p.property_address}
            </h3>
            <LikelihoodChip pct={p.close_likelihood_pct} />
          </div>
          <p style={{ marginTop: 4, fontSize: 13, color: 'var(--ink-3)' }}>
            {p.prospect_name}
            {p.market ? ` · ${p.market}` : ''}
            {p.bedrooms ? ` · ${p.bedrooms} BR` : ''}
          </p>
          {seen.length > 0 && (
            <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {seen.map((t) => (
                <TouchBadge key={t} type={t} sentAt={touches[t]!.sent_at} fromUser={touches[t]!.from_user} />
              ))}
            </div>
          )}
        </div>
        <span className="tabular-nums rt-projections-row-range" style={{ fontSize: 13, color: 'var(--ink)', whiteSpace: 'nowrap' }}>
          {range}
        </span>
        <span
          className="rt-projections-row-status"
          style={{
            fontSize: 10,
            letterSpacing: '.22em',
            textTransform: 'uppercase',
            fontWeight: 500,
            color: latestTouch ? 'var(--positive)' : sent ? 'var(--positive)' : 'var(--ink-4)',
            whiteSpace: 'nowrap',
            textAlign: 'right',
          }}
        >
          {latestTouch
            ? `Last touch ${shortDate(latestTouch.at)}`
            : sent
              ? 'Marked sent'
              : 'Draft'}
        </span>
      </div>
    </Link>
  );
}

const TOUCH_LABEL: Record<GmailTouchType, string> = {
  projection: 'Projection',
  guide: 'Guide',
  contract: 'Contract',
  onboarding: 'Onboarding',
};

function TouchBadge({ type, sentAt, fromUser }: { type: GmailTouchType; sentAt: string; fromUser?: string }) {
  const tip = `${TOUCH_LABEL[type]} sent ${new Date(sentAt).toLocaleString()}${fromUser ? ` by ${fromUser}` : ''}`;
  return (
    <span
      title={tip}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '3px 8px',
        background: 'var(--paper-2)',
        border: '1px solid var(--rule)',
        fontSize: 10,
        letterSpacing: '.06em',
        color: 'var(--ink)',
        fontWeight: 500,
        borderRadius: 999,
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--positive)' }} aria-hidden />
      {TOUCH_LABEL[type]} · {shortDate(sentAt)}
    </span>
  );
}

function shortDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return iso.slice(0, 10);
  }
}

/**
 * Read-only close-likelihood chip for the list row. Inside a row-wide
 * `<Link>` so it can't be a button — clicking the row navigates to the
 * detail page where the inline edit widget lives. Three bands of color
 * (cold/warm/hot) match the detail-page widget's visual code.
 */
function LikelihoodChip({ pct }: { pct: number | null }) {
  if (pct == null) {
    return (
      <span
        style={{
          background: 'transparent',
          border: '1px dashed var(--rule)',
          color: 'var(--ink-4)',
          fontSize: 10,
          fontWeight: 500,
          letterSpacing: '0.04em',
          padding: '2px 8px',
          borderRadius: 999,
          whiteSpace: 'nowrap',
        }}
      >
        Set close %
      </span>
    );
  }
  const hot = pct >= 67;
  const cold = pct < 33;
  return (
    <span
      title={`${pct}% likely to close`}
      style={{
        background: 'var(--paper-2)',
        border: `1px solid ${hot ? 'var(--positive)' : cold ? 'var(--rule)' : 'var(--ink-3)'}`,
        color: hot ? 'var(--positive)' : cold ? 'var(--ink-4)' : 'var(--ink)',
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: '0.04em',
        padding: '3px 10px',
        borderRadius: 999,
        whiteSpace: 'nowrap',
      }}
    >
      {pct}% likely
    </span>
  );
}
