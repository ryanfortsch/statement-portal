import Link from 'next/link';
import { HelmMasthead } from '@/components/HelmMasthead';
import { auth } from '@/auth';
import { supabase } from '@/lib/supabase';
import { startInspection } from './actions';

export const dynamic = 'force-dynamic';

type PropertyOption = {
  id: string;
  name: string;
  title: string | null;
  city: string;
};

type RecentInspection = {
  id: string;
  property_id: string;
  inspector_name: string;
  started_at: string | null;
  completed_at: string | null;
  total_items: number;
  pass_count: number;
  issue_count: number;
  na_count: number;
  property_name: string;
};

async function getProperties(): Promise<PropertyOption[]> {
  const { data } = await supabase
    .from('properties')
    .select('id, name, title, city')
    .eq('is_active', true)
    .order('name');
  return (data ?? []) as PropertyOption[];
}

async function getRecentInspections(): Promise<RecentInspection[]> {
  const { data } = await supabase
    .from('inspections')
    .select('id, property_id, inspector_name, started_at, completed_at, total_items, pass_count, issue_count, na_count, properties!inner(name, title)')
    .order('started_at', { ascending: false })
    .limit(10);
  return (data ?? []).map((row: {
    id: string;
    property_id: string;
    inspector_name: string;
    started_at: string | null;
    completed_at: string | null;
    total_items: number;
    pass_count: number;
    issue_count: number;
    na_count: number;
    properties: { name: string; title: string | null } | { name: string; title: string | null }[];
  }) => {
    const property = Array.isArray(row.properties) ? row.properties[0] : row.properties;
    return {
      id: row.id,
      property_id: row.property_id,
      inspector_name: row.inspector_name,
      started_at: row.started_at,
      completed_at: row.completed_at,
      total_items: row.total_items,
      pass_count: row.pass_count,
      issue_count: row.issue_count,
      na_count: row.na_count,
      property_name: property?.title || property?.name || row.property_id,
    };
  });
}

export default async function InspectionsPage() {
  const session = await auth();
  const [properties, recents] = await Promise.all([
    getProperties(),
    getRecentInspections(),
  ]);

  const firstName = session?.user?.name?.split(' ')[0] || session?.user?.email?.split('@')[0] || 'inspector';

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead current="inspections" />

      {/* HERO */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingTop: 56, paddingBottom: 28, width: '100%' }}>
        <div className="eyebrow" style={{ marginBottom: 14 }}>Helm &middot; Inspections</div>
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
          Walk a property, <em style={{ color: 'var(--tide-deep)', fontWeight: 400 }}>start a checklist.</em>
        </h1>
        <p style={{ marginTop: 14, fontSize: 14, lineHeight: 1.55, color: 'var(--ink-3)', maxWidth: 580 }}>
          Hi {firstName}. Pick a property and Helm will walk you through 50 items across 10 categories. Mark each Pass, Issue, or N/A; add notes where it matters.
        </p>
      </section>

      {/* START FORM */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 56, width: '100%' }}>
        <div style={{ borderTop: '1px solid var(--ink)', borderBottom: '1px solid var(--ink)', padding: '24px 0' }}>
          <form action={startInspection} className="flex items-end gap-4 flex-wrap">
            <div style={{ flex: 1, minWidth: 280 }}>
              <label htmlFor="property_id" className="eyebrow" style={{ display: 'block', marginBottom: 8 }}>
                Property
              </label>
              <select
                id="property_id"
                name="property_id"
                required
                defaultValue=""
                className="font-serif"
                style={{
                  width: '100%',
                  background: 'transparent',
                  border: '1px solid var(--rule)',
                  color: 'var(--ink)',
                  fontSize: 18,
                  fontWeight: 400,
                  padding: '10px 32px 10px 14px',
                  outline: 'none',
                  cursor: 'pointer',
                  appearance: 'none',
                  backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3E%3Cpath stroke='%23506068' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3E%3C/svg%3E")`,
                  backgroundRepeat: 'no-repeat',
                  backgroundPosition: 'right 12px center',
                  backgroundSize: '18px',
                }}
              >
                <option value="" disabled>Choose a property…</option>
                {properties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title || p.name} · {p.city}
                  </option>
                ))}
              </select>
            </div>
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
              Begin Inspection →
            </button>
          </form>
        </div>
      </section>

      {/* RECENTS */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 80, flex: 1, width: '100%' }}>
        <div className="flex items-baseline justify-between" style={{ marginBottom: 14 }}>
          <h2 className="font-serif" style={{ fontSize: 22, fontWeight: 400, letterSpacing: '-0.01em', color: 'var(--ink)', margin: 0 }}>
            Recent Inspections
          </h2>
          <span className="eyebrow">last 10</span>
        </div>

        {recents.length === 0 ? (
          <div style={{ borderTop: '1px solid var(--ink)', padding: '24px 0', fontSize: 13, color: 'var(--ink-4)' }}>
            No inspections yet. Start one above.
          </div>
        ) : (
          <div style={{ borderTop: '1px solid var(--ink)' }}>
            {recents.map((r) => (
              <RecentRow key={r.id} inspection={r} />
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
          <span>Rising Tide &middot; Inspections</span>
          <span style={{ fontStyle: 'italic', textTransform: 'none', letterSpacing: 0, color: 'var(--ink-3)', fontSize: 11 }}>
            Source: Helm
          </span>
        </div>
      </footer>
    </div>
  );
}

function RecentRow({ inspection: r }: { inspection: RecentInspection }) {
  const isComplete = !!r.completed_at;
  const summary = isComplete
    ? `${r.pass_count} pass · ${r.issue_count} issue · ${r.na_count} N/A`
    : 'In progress';

  return (
    <Link
      href={`/inspections/${r.id}${isComplete ? '/summary' : ''}`}
      style={{ display: 'block', textDecoration: 'none', color: 'inherit' }}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '160px 1fr auto auto',
          gap: 24,
          alignItems: 'baseline',
          padding: '18px 0',
          borderBottom: '1px solid var(--rule)',
        }}
      >
        <span className="font-serif" style={{ fontSize: 16, fontWeight: 400, color: 'var(--ink)' }}>
          {formatDateShort(r.started_at)}
        </span>
        <div>
          <div style={{ fontSize: 14, color: 'var(--ink)' }}>{r.property_name}</div>
          <div style={{ marginTop: 2, fontSize: 12, color: 'var(--ink-3)' }}>{r.inspector_name}</div>
        </div>
        <span
          style={{
            fontSize: 11,
            letterSpacing: '.08em',
            textTransform: 'uppercase',
            color: isComplete ? (r.issue_count > 0 ? 'var(--signal)' : 'var(--positive)') : 'var(--ink-4)',
          }}
        >
          {summary}
        </span>
        <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>
          {isComplete ? 'Summary →' : 'Resume →'}
        </span>
      </div>
    </Link>
  );
}

function formatDateShort(value: string | null): string {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return value;
  }
}
