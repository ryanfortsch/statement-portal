import Link from 'next/link';
import { HelmMasthead } from '@/components/HelmMasthead';
import { TurnoverTabs } from '@/components/TurnoverTabs';
import { HelmFooter } from '@/components/HelmFooter';
import { Section } from '@/components/Section';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import { CAPE_ANN_REGION } from '@/lib/property-scope';

/** The list shows the viewer's region, the same gate the board's start form
 *  uses: a null region reads as Cape Ann (lib/property-scope.ts). PostgREST
 *  filter on the embedded properties row. */
const REGION_FILTER = `region.is.null,region.eq.${CAPE_ANN_REGION}`;

export const dynamic = 'force-dynamic';

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
  const [{ rows: recents, hasOlder }, totalCount] = await Promise.all([
    getRecentInspections(page),
    getInspectionCount(),
  ]);

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead />
      <TurnoverTabs current="inspections" />

      {/* The tab's name, then the one way in: a walk starts from the board,
          where "Walk a home now" sits under the rows. This page is the
          history of walks. */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingTop: 32, paddingBottom: 32, width: '100%' }}>
        <div className="eyebrow" style={{ marginBottom: 14 }}>Walks</div>
        <Link href="/turnovers#walk-home-now" style={{ fontSize: 13, color: 'var(--ink-3)', textDecoration: 'underline', textUnderlineOffset: 3 }}>
          Walk a home now, from the board →
        </Link>
      </section>

      {/* RECENTS */}
      <Section
        title="Recent walks"
        eyebrow={page > 1 ? `page ${page}` : undefined}
        empty={totalCount === 0}
        emptyMessage="No walks yet."
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

      <HelmFooter module="Walks" right="Source: Helm" />
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
      aria-label="Walk history pages"
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
