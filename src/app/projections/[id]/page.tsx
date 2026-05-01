import Link from 'next/link';
import { notFound } from 'next/navigation';
import { HelmMasthead } from '@/components/HelmMasthead';
import { ProjectionForm } from '@/components/projections/ProjectionForm';
import { supabase } from '@/lib/supabase';
import type { ProjectionRow } from '@/lib/projections-types';
import {
  computeProjection,
  fmtMoney,
  fmtMoneyRange,
  fmtMonthYear,
  fmtPercent,
  roundToThousand,
} from '@/lib/projections-model';
import { updateProjection, deleteProjection, markSent } from '../actions';

export const dynamic = 'force-dynamic';

async function getProjection(id: string): Promise<ProjectionRow | null> {
  const { data, error } = await supabase.from('projections').select('*').eq('id', id).maybeSingle();
  if (error || !data) return null;
  return data as ProjectionRow;
}

export default async function ProjectionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const projection = await getProjection(id);
  if (!projection) notFound();

  const computed = computeProjection(projection);
  const update = updateProjection.bind(null, id);
  const remove = deleteProjection.bind(null, id);
  const send = markSent.bind(null, id);

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead current="projections" />

      {/* HERO */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingTop: 56, paddingBottom: 28, width: '100%' }}>
        <div className="eyebrow" style={{ marginBottom: 14 }}>
          <Link href="/projections" style={{ color: 'var(--ink-4)', textDecoration: 'none' }}>
            ← Projections
          </Link>
          {' · '}
          <span>{fmtMonthYear(projection.presentation_month)}</span>
          {' · '}
          <span style={{ color: projection.status === 'sent' ? 'var(--positive)' : 'var(--ink-4)' }}>
            {projection.status === 'sent' ? 'Sent' : 'Draft'}
          </span>
        </div>
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
          {projection.property_address}
          <span style={{ color: 'var(--ink-3)', fontWeight: 300 }}> · </span>
          <em style={{ color: 'var(--tide-deep)', fontWeight: 400 }}>{projection.prospect_name}</em>
        </h1>
      </section>

      {/* PREVIEW PANEL */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 32, width: '100%' }}>
        <div style={{ borderTop: '1px solid var(--ink)', borderBottom: '1px solid var(--ink)', padding: '28px 0' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 28 }}>
            <Stat
              label="Cover range"
              value={fmtMoneyRange(computed.heroLow, computed.heroHigh)}
              sub="Year 1 estimate (net)"
              accent
            />
            <Stat
              label="Year 1 (full)"
              value={fmtMoney(roundToThousand(computed.year1.mid.netPayout))}
              sub={`${fmtMoney(roundToThousand(computed.year1.low.netPayout))} – ${fmtMoney(roundToThousand(computed.year1.high.netPayout))}`}
            />
            <Stat
              label="Year 1 ramped"
              value={fmtMoney(roundToThousand(computed.year1Ramped.netPayout))}
              sub={`${computed.year1Ramped.activeMonthCount} active months`}
            />
            <Stat
              label="Year 2"
              value={fmtMoney(roundToThousand(computed.year2.netPayout))}
              sub={`+${fmtPercent(projection.year2_growth_pct)} on Year 1`}
            />
          </div>
          <div style={{ marginTop: 20, fontSize: 12, color: 'var(--ink-4)', lineHeight: 1.6 }}>
            Tiered % rule: {fmtMoney(computed.tieredRevenue)} ({fmtPercent(computed.tieredRate)}). AirDNA 3-yr avg: {fmtMoney(computed.airdna3YrAvg, { decimals: 0 })} ({computed.airdnaYears.map((y) => y.year).join(', ')}). Blended gross: {fmtMoney(computed.blendedGrossRevenue)}. Annual cleaning: {fmtMoney(computed.year1.mid.cleaningExpense)}.
          </div>
        </div>
      </section>

      {/* DELIVERABLE LINK + STATE ACTIONS */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 40, width: '100%' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
          <Link
            href={`/projections/${id}/render`}
            target="_blank"
            style={{
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
            View deliverable ↗
          </Link>
          {projection.status === 'draft' ? (
            <form action={send}>
              <button
                type="submit"
                style={{
                  background: 'transparent',
                  color: 'var(--ink)',
                  fontSize: 11,
                  fontWeight: 500,
                  letterSpacing: '.18em',
                  textTransform: 'uppercase',
                  padding: '14px 20px',
                  border: '1px solid var(--ink)',
                  cursor: 'pointer',
                }}
              >
                Mark as sent
              </button>
            </form>
          ) : (
            <span style={{ fontSize: 11, color: 'var(--ink-4)', letterSpacing: '.08em' }}>
              Sent {projection.sent_at ? new Date(projection.sent_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''}
            </span>
          )}
          <span style={{ flex: 1 }} />
          <form action={remove}>
            <button
              type="submit"
              style={{
                background: 'transparent',
                color: 'var(--negative)',
                fontSize: 11,
                fontWeight: 500,
                letterSpacing: '.18em',
                textTransform: 'uppercase',
                padding: '14px 20px',
                border: 'none',
                cursor: 'pointer',
              }}
            >
              Delete
            </button>
          </form>
        </div>
      </section>

      {/* EDIT FORM */}
      <section className="max-w-[860px] mx-auto px-10" style={{ paddingBottom: 80, flex: 1, width: '100%' }}>
        <div className="eyebrow" style={{ marginBottom: 14 }}>Edit inputs</div>
        <ProjectionForm action={update} initial={projection} submitLabel="Save changes" />
      </section>
    </div>
  );
}

function Stat({ label, value, sub, accent = false }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div>
      <div className="eyebrow" style={{ marginBottom: 8 }}>{label}</div>
      <div
        className="font-serif tabular-nums"
        style={{
          fontSize: accent ? 30 : 24,
          fontWeight: 400,
          color: accent ? 'var(--signal)' : 'var(--ink)',
          lineHeight: 1.05,
        }}
      >
        {value}
      </div>
      {sub && <div style={{ marginTop: 6, fontSize: 11, color: 'var(--ink-3)' }}>{sub}</div>}
    </div>
  );
}
