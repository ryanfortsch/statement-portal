import Link from 'next/link';
import { notFound } from 'next/navigation';
import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmBreadcrumb } from '@/components/HelmBreadcrumb';
import { HelmFooter } from '@/components/HelmFooter';
import { supabaseAdmin as supabase, isServiceConfigured as isHelmConfigured } from '@/lib/supabase-admin';
import type { HelmPropertyRow } from '@/lib/properties';
import {
  PropertyActivityList,
  loadPropertyActivity,
  KIND_GROUPS,
  type ActivityKind,
} from '../PropertyActivity';

/**
 * The full activity log for one property.
 *
 * It lives on its own route because it is the heaviest thing the property
 * record loads (six queries over a 90 day window for up to 160 rows) and the
 * least likely thing anyone opens the record to read. Nobody answers a
 * mid-day question from an audit log. The property page keeps a short peek
 * that links here.
 *
 * Moving it also lets it be what an audit log has to be to earn its keep:
 * filterable by kind and by range. Collapsed inside a section on a tab, it
 * could be neither.
 */
export const dynamic = 'force-dynamic';

const RANGES = [
  { key: '30', label: '30 days', days: 30 },
  { key: '90', label: '90 days', days: 90 },
  { key: '365', label: '1 year', days: 365 },
  { key: 'all', label: 'All', days: 3650 },
];

async function getProperty(id: string): Promise<HelmPropertyRow | null> {
  if (!isHelmConfigured) return null;
  const { data, error } = await supabase.from('properties').select('*').eq('id', id).maybeSingle();
  if (error) throw error;
  return (data as HelmPropertyRow) ?? null;
}

function chipStyle(on: boolean): React.CSSProperties {
  return {
    fontSize: 11,
    letterSpacing: '.06em',
    textTransform: 'uppercase',
    textDecoration: 'none',
    padding: '6px 12px',
    border: `1px solid ${on ? 'var(--ink)' : 'var(--rule)'}`,
    color: on ? 'var(--paper)' : 'var(--ink-3)',
    background: on ? 'var(--ink)' : 'transparent',
    whiteSpace: 'nowrap',
  };
}

export default async function PropertyActivityPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ kind?: string; range?: string }>;
}) {
  const { id } = await params;
  const sp = (await searchParams) ?? {};
  const p = await getProperty(id);
  if (!p) notFound();

  const range = RANGES.find((r) => r.key === sp.range) ?? RANGES[1];
  const group = sp.kind && sp.kind in KIND_GROUPS ? sp.kind : null;

  // A wide range needs a matching row allowance or the filter silently lies
  // about how much history it looked at.
  const scale = range.days > 90 ? Math.ceil(range.days / 90) : 1;
  const all = await loadPropertyActivity(p, { windowDays: range.days, scale });

  const kinds: ActivityKind[] | null = group ? KIND_GROUPS[group].kinds : null;
  const events = kinds ? all.filter((e) => kinds.includes(e.kind)) : all;

  const href = (next: { kind?: string | null; range?: string }) => {
    const q = new URLSearchParams();
    const k = next.kind === undefined ? group : next.kind;
    const r = next.range ?? range.key;
    if (k) q.set('kind', k);
    if (r !== '90') q.set('range', r);
    const s = q.toString();
    return `/properties/${p.id}/activity${s ? `?${s}` : ''}`;
  };

  return (
    <div style={{ minHeight: '100vh', background: 'var(--paper)' }}>
      <HelmMasthead />
      <HelmBreadcrumb
        trail={[
          { label: 'Properties', href: '/properties' },
          { label: p.name, href: `/properties/${p.id}` },
          { label: 'Activity' },
        ]}
      />

      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingTop: 28, width: '100%' }}>
        <div className="eyebrow" style={{ marginBottom: 10 }}>Activity</div>
        <h1
          className="font-serif"
          style={{ fontSize: 34, fontWeight: 400, letterSpacing: '-0.02em', margin: '0 0 6px', color: 'var(--ink)' }}
        >
          {p.name}
        </h1>
        <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-3)' }}>
          Every slip, inspection, note and contact touch recorded against this property.
        </p>
      </section>

      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingTop: 24, width: '100%' }}>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
          <Link href={href({ kind: null })} style={chipStyle(!group)}>All</Link>
          {Object.entries(KIND_GROUPS).map(([key, g]) => (
            <Link key={key} href={href({ kind: key })} style={chipStyle(group === key)}>
              {g.label}
            </Link>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 20 }}>
          {RANGES.map((r) => (
            <Link key={r.key} href={href({ range: r.key })} style={chipStyle(range.key === r.key)}>
              {r.label}
            </Link>
          ))}
        </div>

        <div style={{ borderTop: '1px solid var(--ink)', paddingTop: 4 }}>
          {events.length === 0 && group ? (
            <div style={{ padding: '16px 0', color: 'var(--ink-3)', fontSize: 13 }}>
              No {KIND_GROUPS[group].label.toLowerCase()} activity in the last {range.label.toLowerCase()}.
            </div>
          ) : (
            <PropertyActivityList events={events} max={250} />
          )}
        </div>
      </section>

      <section className="max-w-[1100px] mx-auto px-10" style={{ padding: '28px 0 60px', width: '100%' }}>
        <Link
          href={`/properties/${p.id}`}
          style={{ fontSize: 12, color: 'var(--ink-3)', textDecoration: 'none' }}
        >
          ← Back to {p.name}
        </Link>
      </section>

      <HelmFooter module="Properties" right="Source: Helm" />
    </div>
  );
}
