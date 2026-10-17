import Link from 'next/link';
import { HelmMasthead } from '@/components/HelmMasthead';
import { TurnoverTabs } from '@/components/TurnoverTabs';
import { HelmFooter } from '@/components/HelmFooter';
import { Section } from '@/components/Section';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import { CAPE_ANN_REGION } from '@/lib/property-scope';
import { startInspection } from './actions';

/** The list shows the viewer's region, the same gate the start form uses:
 *  a null region reads as Cape Ann (lib/property-scope.ts). PostgREST filter
 *  on the embedded properties row. */
const REGION_FILTER = `region.is.null,region.eq.${CAPE_ANN_REGION}`;

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
    // Cape Ann crew inspects Cape Ann homes; an out-of-region home
    // (properties.region) has its own people. See lib/property-scope.ts.
    .eq('region', 'cape_ann')
    .order('name');
  // Natural-sort by street number so the dropdown reads
  // "3 Locust, 3 South, 4 Brier Neck, 17 Beach, 20 Enon, 20 Hammond, 21 Horton…"
  // instead of the lexical "17, 20, 20, 21, 3, 3, 30…" Postgres returns.
  const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });
  return ((data ?? []) as PropertyOption[]).sort((a, b) => collator.compare(a.name, b.name));
}

const PAGE_SIZE = 10;

async function getRecentInspections(page: number): Promise<{ rows: RecentInspection[]; hasOlder: boolean }> {
  const offset = (page - 1) * PAGE_SIZE;
  // Fetch one row past the page so we know whether an "Older" page exists
  // without a second query. range() is inclusive on both ends.
  const { data } = await supabase
    .from('inspections')
    .select('id, property_id, inspector_name, started_at, completed_at, total_items, pass_count, issue_count, na_count, properties!inner(name, title, region)')
    .or(REGION_FILTER, { referencedTable: 'properties' })
    .order('started_at', { ascending: false })
    .range(offset, offset + PAGE_SIZE);
  const hasOlder = (data ?? []).length > PAGE_SIZE;
  const rows = (data ?? []).slice(0, PAGE_SIZE).map((row: {
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
      property_name: property?.name || property?.title || row.property_id,
    };
  });
  return { rows, hasOlder };
}

async function getInspectionCount(): Promise<number> {
  const { count } = await supabase
    .from('inspections')
    .select('id, properties!inner(region)', { count: 'exact', head: true })
    .or(REGION_FILTER, { referencedTable: 'properties' });
  return count ?? 0;
}

export default async function InspectionsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const params = await searchParams;
  const page = Math.max(1, parseInt(params.page ?? '1', 10) || 1);
  const [properties, { rows: recents, hasOlder }, totalCount] = await Promise.all([
    getProperties(),
    getRecentInspections(page),
    getInspectionCount(),
  ]);

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead />
      <TurnoverTabs current="inspections" />

      {/* The page is the form: the tab's name, a home, Start. The greeting
          and the paragraph that stood here described a fixed checklist the
          decks stopped being; the stepper explains itself card by card. */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingTop: 32, paddingBottom: 56, width: '100%' }}>
        <div className="eyebrow" style={{ marginBottom: 14 }}>Inspections</div>
        <div style={{ borderTop: '1px solid var(--ink)', borderBottom: '1px solid var(--ink)', padding: '24px 0' }}>
          <form action={startInspection} className="flex items-end gap-4 flex-wrap">
            <div style={{ flex: 1, minWidth: 280 }}>
              <label htmlFor="property_id" className="eyebrow" style={{ display: 'block', marginBottom: 8 }}>
                Walk a home
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
                <option value="" disabled>Choose a home…</option>
                {properties.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
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
              Start
            </button>
          </form>
        </div>
      </section>

      {/* RECENTS */}
      <Section
        title="Recent Inspections"
        eyebrow={
          totalCount > 0
            ? page > 1
              ? `page ${page} · ${totalCount} total`
              : `last ${recents.length} · ${totalCount} total`
            : undefined
        }
        empty={totalCount === 0}
        emptyMessage="No inspections yet. Start one above."
        paddingBottom={80}
      >
        <div style={{ borderTop: '1px solid var(--ink)' }}>
          {recents.map((r) => (
            <RecentRow key={r.id} inspection={r} />
          ))}
        </div>
        {(page > 1 || hasOlder) && (
          <HistoryPager page={page} hasOlder={hasOlder} />
        )}
      </Section>

      <HelmFooter module="Inspections" right="Source: Helm" />
    </div>
  );
}

function HistoryPager({ page, hasOlder }: { page: number; hasOlder: boolean }) {
  const linkStyle = {
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: '.14em',
    textTransform: 'uppercase' as const,
    color: 'var(--ink-3)',
    textDecoration: 'none',
  };
  return (
    <nav
      aria-label="Inspection history pages"
      style={{ display: 'flex', justifyContent: 'space-between', padding: '16px 0' }}
    >
      <span>
        {page > 1 && (
          <Link
            href={page === 2 ? '/inspections' : `/inspections?page=${page - 1}`}
            rel="prev"
            prefetch={false}
            style={linkStyle}
          >
            ← Newer
          </Link>
        )}
      </span>
      <span>
        {hasOlder && (
          <Link href={`/inspections?page=${page + 1}`} rel="next" prefetch={false} style={linkStyle}>
            Older →
          </Link>
        )}
      </span>
    </nav>
  );
}

function RecentRow({ inspection: r }: { inspection: RecentInspection }) {
  const isComplete = !!r.completed_at;
  const summary = isComplete
    ? `${r.pass_count} pass · ${r.issue_count} issue · ${r.na_count} N/A`
    : 'In progress';
  const summaryColor = isComplete
    ? r.issue_count > 0
      ? 'var(--signal)'
      : 'var(--positive)'
    : 'var(--ink-4)';

  return (
    // Row = a tap-to-open Link. Delete lives on the summary page's header,
    // where the operator is looking at the walk being deleted, not beside
    // every row of the index. Mobile CSS targets
    // `.rt-inspections-recent-row a > div`.
    <div
      className="rt-inspections-recent-row"
      style={{ display: 'flex', alignItems: 'stretch', borderBottom: '1px solid var(--rule)' }}
    >
      <Link
        href={`/inspections/${r.id}${isComplete ? '/summary' : ''}`}
        style={{ flex: 1, minWidth: 0, display: 'block', textDecoration: 'none', color: 'inherit' }}
      >
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '120px 1fr auto auto',
            gap: 20,
            alignItems: 'baseline',
            padding: '18px 0',
          }}
        >
          <span className="font-serif" style={{ fontSize: 16, fontWeight: 400, color: 'var(--ink)' }}>
            {formatDateShort(r.started_at)}
          </span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 14, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {r.property_name}
            </div>
            <div style={{ marginTop: 2, fontSize: 12, color: 'var(--ink-3)' }}>{r.inspector_name}</div>
          </div>
          <span
            style={{
              fontSize: 11,
              letterSpacing: '.08em',
              textTransform: 'uppercase',
              color: summaryColor,
              whiteSpace: 'nowrap',
            }}
          >
            {summary}
          </span>
          <span style={{ fontSize: 12, color: 'var(--ink-3)', whiteSpace: 'nowrap' }}>
            {isComplete ? 'Summary →' : 'Resume →'}
          </span>
        </div>
      </Link>
    </div>
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
