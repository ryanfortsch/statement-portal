import Link from 'next/link';
import { notFound } from 'next/navigation';
import { HelmMasthead } from '@/components/HelmMasthead';
import { supabase } from '@/lib/supabase';
import type {
  InspectionRow,
  InspectionItemRow,
  InspectionResultRow,
} from '@/lib/inspections-types';

export const dynamic = 'force-dynamic';

type PropertyShape = { id: string; name: string; title: string | null; city: string };

type ResultWithItem = {
  result: InspectionResultRow;
  item: InspectionItemRow;
};

async function getInspection(id: string): Promise<{
  inspection: InspectionRow;
  property: PropertyShape;
  results: ResultWithItem[];
} | null> {
  const { data: inspection } = await supabase
    .from('inspections')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (!inspection) return null;

  const insp = inspection as InspectionRow;

  const [{ data: property }, { data: results }, { data: items }] = await Promise.all([
    supabase
      .from('properties')
      .select('id, name, title, city')
      .eq('id', insp.property_id)
      .maybeSingle(),
    supabase
      .from('inspection_results')
      .select('id, inspection_id, item_id, status, notes, photo_urls, created_at')
      .eq('inspection_id', id),
    supabase
      .from('inspection_items')
      .select('id, template_id, category, title, description, sort_order')
      .eq('template_id', insp.template_id),
  ]);

  if (!property) return null;

  const itemMap = new Map<string, InspectionItemRow>();
  for (const it of (items ?? []) as InspectionItemRow[]) {
    itemMap.set(it.id, it);
  }

  const merged: ResultWithItem[] = ((results ?? []) as InspectionResultRow[])
    .map((r) => {
      const item = itemMap.get(r.item_id);
      if (!item) return null;
      return { result: r, item };
    })
    .filter((x): x is ResultWithItem => x !== null)
    .sort((a, b) => a.item.sort_order - b.item.sort_order);

  return {
    inspection: insp,
    property: property as PropertyShape,
    results: merged,
  };
}

type Params = { id: string };

export default async function InspectionSummaryPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { id } = await params;
  const data = await getInspection(id);
  if (!data) notFound();

  const { inspection, property, results } = data;
  const issues = results.filter((r) => r.result.status === 'issue');
  const passes = results.filter((r) => r.result.status === 'pass');
  const nas = results.filter((r) => r.result.status === 'na');

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead current="inspections" />

      {/* HEADER */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingTop: 32, paddingBottom: 16, width: '100%' }}>
        <Link
          href="/inspections"
          style={{
            fontSize: 11,
            letterSpacing: '.18em',
            textTransform: 'uppercase',
            color: 'var(--ink-3)',
            textDecoration: 'none',
          }}
        >
          ← All Inspections
        </Link>
      </section>

      {/* HERO */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingTop: 16, paddingBottom: 28, width: '100%' }}>
        <div className="eyebrow" style={{ marginBottom: 14 }}>Inspection &middot; complete</div>
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
          {property.title || property.name}
        </h1>
        <p style={{ marginTop: 8, fontSize: 14, color: 'var(--ink-3)' }}>
          {property.city} &middot; {inspection.inspector_name} &middot; Completed {formatDateTime(inspection.completed_at)}
        </p>
      </section>

      {/* STAT GRID */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 48, width: '100%' }}>
        <div style={{ borderTop: '1px solid var(--ink)', borderBottom: '1px solid var(--ink)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)' }}>
            <Stat label="Total" value={String(inspection.total_items)} />
            <Stat label="Pass" value={String(inspection.pass_count)} accent="var(--positive)" />
            <Stat label="Issue" value={String(inspection.issue_count)} accent="var(--signal)" />
            <Stat label="N/A" value={String(inspection.na_count)} accent="var(--ink-4)" last />
          </div>
        </div>
      </section>

      {/* ISSUES */}
      <Section
        title="Issues"
        eyebrow={`${issues.length} flagged`}
        empty={issues.length === 0}
        emptyMessage="No issues flagged on this inspection. Clean walkthrough."
      >
        <div style={{ borderTop: '1px solid var(--ink)' }}>
          {issues.map((row) => (
            <IssueRow key={row.result.id} row={row} />
          ))}
        </div>
      </Section>

      {/* COMPLETED ITEMS */}
      <Section
        title="Passed"
        eyebrow={`${passes.length} clean`}
        empty={passes.length === 0}
        emptyMessage="—"
      >
        <div style={{ borderTop: '1px solid var(--rule)' }}>
          {passes.map((row) => (
            <CompactRow key={row.result.id} row={row} statusColor="var(--positive)" />
          ))}
        </div>
      </Section>

      {nas.length > 0 && (
        <Section title="Not Applicable" eyebrow={`${nas.length}`} empty={false} emptyMessage="">
          <div style={{ borderTop: '1px solid var(--rule)' }}>
            {nas.map((row) => (
              <CompactRow key={row.result.id} row={row} statusColor="var(--ink-4)" />
            ))}
          </div>
        </Section>
      )}

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
          <span>Rising Tide &middot; Inspection</span>
          <span style={{ fontStyle: 'italic', textTransform: 'none', letterSpacing: 0, color: 'var(--ink-3)', fontSize: 11 }}>
            Source: Helm
          </span>
        </div>
      </footer>
    </div>
  );
}

function Section({
  title,
  eyebrow,
  empty,
  emptyMessage,
  children,
}: {
  title: string;
  eyebrow: string;
  empty: boolean;
  emptyMessage: string;
  children: React.ReactNode;
}) {
  return (
    <section className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 48, width: '100%' }}>
      <div className="flex items-baseline justify-between" style={{ marginBottom: 14 }}>
        <h2 className="font-serif" style={{ fontSize: 22, fontWeight: 400, letterSpacing: '-0.01em', color: 'var(--ink)', margin: 0 }}>
          {title}
        </h2>
        <span className="eyebrow">{eyebrow}</span>
      </div>
      {empty ? (
        <div style={{ borderTop: '1px solid var(--ink)', padding: '20px 0', fontSize: 12, color: 'var(--ink-4)' }}>
          {emptyMessage}
        </div>
      ) : (
        children
      )}
    </section>
  );
}

function Stat({ label, value, accent, last = false }: { label: string; value: string; accent?: string; last?: boolean }) {
  return (
    <div
      style={{
        padding: '20px 20px',
        borderRight: last ? 'none' : '1px solid var(--rule)',
      }}
    >
      <div className="eyebrow" style={{ marginBottom: 6 }}>{label}</div>
      <div className="font-serif tabular-nums" style={{ fontSize: 28, fontWeight: 400, color: accent ?? 'var(--ink)' }}>
        {value}
      </div>
    </div>
  );
}

function IssueRow({ row }: { row: ResultWithItem }) {
  return (
    <div
      style={{
        padding: '18px 0',
        borderBottom: '1px solid var(--rule)',
      }}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '160px 1fr',
          gap: 24,
          alignItems: 'baseline',
        }}
      >
        <span
          style={{
            fontSize: 10,
            letterSpacing: '.18em',
            textTransform: 'uppercase',
            fontWeight: 600,
            color: 'var(--signal)',
          }}
        >
          {row.item.category}
        </span>
        <div>
          <div style={{ fontSize: 14, color: 'var(--ink)', fontWeight: 500 }}>{row.item.title}</div>
          {row.result.notes && (
            <div style={{ marginTop: 6, fontSize: 13, color: 'var(--ink-3)', fontStyle: 'italic' }}>
              &ldquo;{row.result.notes}&rdquo;
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CompactRow({ row, statusColor }: { row: ResultWithItem; statusColor: string }) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '160px 1fr auto',
        gap: 24,
        alignItems: 'baseline',
        padding: '10px 0',
        borderBottom: '1px solid var(--rule-soft)',
        fontSize: 12,
      }}
    >
      <span style={{ color: 'var(--ink-4)' }}>{row.item.category}</span>
      <span style={{ color: 'var(--ink-3)' }}>{row.item.title}</span>
      <span
        style={{
          fontSize: 10,
          letterSpacing: '.16em',
          textTransform: 'uppercase',
          color: statusColor,
        }}
      >
        {row.result.status}
      </span>
    </div>
  );
}

function formatDateTime(value: string | null): string {
  if (!value) return '—';
  try {
    const d = new Date(value);
    return d.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return value;
  }
}
