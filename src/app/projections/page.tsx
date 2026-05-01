import Link from 'next/link';
import { HelmMasthead } from '@/components/HelmMasthead';
import { auth } from '@/auth';
import { supabase } from '@/lib/supabase';
import type { ProjectionRow } from '@/lib/projections-types';
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
      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingTop: 56, paddingBottom: 28, width: '100%' }}>
        <div className="eyebrow" style={{ marginBottom: 14 }}>Helm &middot; Projections</div>
        <h1
          className="font-serif"
          style={{
            fontSize: 44,
            lineHeight: 1.05,
            fontWeight: 300,
            letterSpacing: '-0.02em',
            color: 'var(--ink)',
            maxWidth: 720,
          }}
        >
          A revenue estimate <em style={{ color: 'var(--tide-deep)', fontWeight: 400 }}>for every prospect.</em>
        </h1>
        <p style={{ marginTop: 14, fontSize: 14, lineHeight: 1.55, color: 'var(--ink-3)', maxWidth: 580 }}>
          {firstName ? `Hi ${firstName}. ` : ''}Punch in the property and we&rsquo;ll model what it could earn under Rising Tide management. Output is a print-ready 11-page deck.
        </p>
      </section>

      {/* CTA */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 40, width: '100%' }}>
        <div style={{ borderTop: '1px solid var(--ink)', borderBottom: '1px solid var(--ink)', padding: '24px 0' }}>
          <Link
            href="/projections/new"
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
            New Projection →
          </Link>
        </div>
      </section>

      {/* LIST */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 80, flex: 1, width: '100%' }}>
        <div className="flex items-baseline justify-between" style={{ marginBottom: 14 }}>
          <h2 className="font-serif" style={{ fontSize: 22, fontWeight: 400, letterSpacing: '-0.01em', color: 'var(--ink)', margin: 0 }}>
            Recent Projections
          </h2>
          <span className="eyebrow">last {projections.length}</span>
        </div>

        {projections.length === 0 ? (
          <div style={{ borderTop: '1px solid var(--ink)', padding: '32px 0', textAlign: 'center' }}>
            <p style={{ color: 'var(--ink-3)', marginBottom: 8 }}>No projections yet.</p>
            <p style={{ color: 'var(--ink-4)', fontSize: 12 }}>
              Run the migration at <code className="font-mono">supabase/migrations/20260501_create_projections.sql</code> in
              Helm&apos;s Supabase SQL Editor, then click &ldquo;New Projection&rdquo; above.
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
      <footer style={{ borderTop: '1px solid var(--ink)' }}>
        <div
          className="max-w-[1100px] mx-auto px-10 flex items-center justify-between"
          style={{
            padding: '14px 40px',
            fontSize: 10,
            letterSpacing: '.18em',
            textTransform: 'uppercase',
            color: 'var(--ink-4)',
          }}
        >
          <span>Rising Tide &middot; Projections</span>
          <span style={{ fontStyle: 'italic', textTransform: 'none', letterSpacing: 0, color: 'var(--ink-3)', fontSize: 11 }}>
            Source: Helm
          </span>
        </div>
      </footer>
    </div>
  );
}

function ProjectionRowItem({ projection: p, number }: { projection: ProjectionRow; number: string }) {
  const computed = computeProjection(p);
  const range = fmtMoneyRange(computed.heroLow, computed.heroHigh);
  const sent = p.status === 'sent';
  return (
    <Link href={`/projections/${p.id}`} style={{ display: 'block', textDecoration: 'none', color: 'inherit' }}>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '64px 1fr auto auto',
          gap: 24,
          alignItems: 'baseline',
          padding: '24px 0',
          borderBottom: '1px solid var(--rule)',
        }}
      >
        <span className="font-mono" style={{ fontSize: 11, color: 'var(--signal)', letterSpacing: '.08em' }}>
          {number}
        </span>
        <div>
          <h3 className="font-serif" style={{ fontSize: 22, fontWeight: 400, letterSpacing: '-0.02em', color: 'var(--ink)', margin: 0 }}>
            {p.property_address}
          </h3>
          <p style={{ marginTop: 4, fontSize: 13, color: 'var(--ink-3)' }}>
            {p.prospect_name}
            {p.market ? ` · ${p.market}` : ''}
            {p.bedrooms ? ` · ${p.bedrooms} BR` : ''}
          </p>
        </div>
        <span className="tabular-nums" style={{ fontSize: 13, color: 'var(--ink)', whiteSpace: 'nowrap' }}>
          {range}
        </span>
        <span
          style={{
            fontSize: 10,
            letterSpacing: '.22em',
            textTransform: 'uppercase',
            fontWeight: 500,
            color: sent ? 'var(--positive)' : 'var(--ink-4)',
            whiteSpace: 'nowrap',
          }}
        >
          {sent ? 'Sent' : 'Draft'}
        </span>
      </div>
    </Link>
  );
}
