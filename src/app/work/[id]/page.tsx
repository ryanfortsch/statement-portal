import Link from 'next/link';
import { notFound } from 'next/navigation';
import { HelmMasthead } from '@/components/HelmMasthead';
import { PhotoThumbs } from '@/components/PhotoUploader';
import { supabase } from '@/lib/supabase';
import type { WorkSlipRow } from '@/lib/work-types';
import {
  WORK_SLIP_CATEGORY_LABELS,
} from '@/lib/work-types';
import { StatusChanger } from './StatusChanger';

export const dynamic = 'force-dynamic';

type PropertyMini = { id: string; name: string; title: string | null; city: string };
type InspectionMini = { id: string; inspector_name: string; started_at: string | null };
type InspectionItemMini = { id: string; title: string; category: string };

async function getWorkSlip(id: string): Promise<{
  slip: WorkSlipRow;
  property: PropertyMini | null;
  inspection: InspectionMini | null;
  inspectionItem: InspectionItemMini | null;
} | null> {
  const { data: slip, error } = await supabase
    .from('work_slips')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error || !slip) return null;

  const ws = slip as WorkSlipRow;

  const [{ data: property }, { data: inspection }, { data: inspectionItem }] = await Promise.all([
    supabase
      .from('properties')
      .select('id, name, title, city')
      .eq('id', ws.property_id)
      .maybeSingle(),
    ws.inspection_id
      ? supabase
          .from('inspections')
          .select('id, inspector_name, started_at')
          .eq('id', ws.inspection_id)
          .maybeSingle()
      : Promise.resolve({ data: null as InspectionMini | null }),
    ws.inspection_item_id
      ? supabase
          .from('inspection_items')
          .select('id, title, category')
          .eq('id', ws.inspection_item_id)
          .maybeSingle()
      : Promise.resolve({ data: null as InspectionItemMini | null }),
  ]);

  return {
    slip: ws,
    property: (property as PropertyMini) ?? null,
    inspection: (inspection as InspectionMini) ?? null,
    inspectionItem: (inspectionItem as InspectionItemMini) ?? null,
  };
}

type Params = { id: string };

export default async function WorkSlipDetailPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { id } = await params;
  const data = await getWorkSlip(id);
  if (!data) notFound();

  const { slip, property, inspection, inspectionItem } = data;

  const priorityColor =
    slip.priority === 'high' ? 'var(--negative)' :
    slip.priority === 'low' ? 'var(--ink-4)' :
    'var(--ink-3)';

  const statusColor =
    slip.status === 'done'        ? 'var(--positive)' :
    slip.status === 'in_progress' ? 'var(--signal)'   :
    slip.status === 'scheduled'   ? 'var(--tide-deep)' :
    slip.status === 'blocked'     ? 'var(--negative)' :
    'var(--ink-3)';

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead current="work" />

      {/* BACK */}
      <div className="max-w-[1100px] mx-auto px-10" style={{ paddingTop: 24, width: '100%' }}>
        <Link
          href="/work"
          style={{
            fontSize: 11,
            letterSpacing: '.18em',
            textTransform: 'uppercase',
            color: 'var(--ink-3)',
            textDecoration: 'none',
          }}
        >
          ← All Work
        </Link>
      </div>

      {/* HERO */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingTop: 24, paddingBottom: 28, width: '100%' }}>
        <div className="eyebrow" style={{ marginBottom: 14 }}>Work Slip</div>
        <h1
          className="font-serif"
          style={{
            fontSize: 38,
            lineHeight: 1.05,
            fontWeight: 300,
            letterSpacing: '-0.02em',
            color: 'var(--ink)',
            maxWidth: 720,
          }}
        >
          {slip.title}
        </h1>
        <div className="flex items-center gap-3 flex-wrap" style={{ marginTop: 14 }}>
          <Pill color={statusColor} label={slip.status.replace('_', ' ').toUpperCase()} solid />
          <Pill color={priorityColor} label={`${slip.priority.toUpperCase()} priority`} />
          <Pill color="var(--ink-4)" label={WORK_SLIP_CATEGORY_LABELS[slip.category] ?? slip.category} />
        </div>
      </section>

      {/* STAT GRID */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 48, width: '100%' }}>
        <div style={{ borderTop: '1px solid var(--ink)', borderBottom: '1px solid var(--ink)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)' }}>
            <Stat
              label="Property"
              value={property ? property.name : slip.property_id}
              href={property ? `/properties/${property.id}` : undefined}
            />
            <Stat
              label="Location"
              value={slip.location || '—'}
            />
            <Stat
              label="Created"
              value={formatDate(slip.created_at)}
              sub={slip.created_by_email.split('@')[0]}
            />
            <Stat
              label={slip.completed_at ? 'Completed' : 'Status'}
              value={slip.completed_at ? formatDate(slip.completed_at) : slip.status.replace('_', ' ')}
              last
            />
          </div>
        </div>
      </section>

      {/* DESCRIPTION */}
      {(slip.description || slip.action_summary) && (
        <Section title="Details" eyebrow="What's needed">
          {slip.action_summary && (
            <div style={{ marginBottom: 14 }}>
              <div className="eyebrow" style={{ marginBottom: 6, color: 'var(--signal)' }}>Action summary</div>
              <p style={{ fontSize: 14, color: 'var(--ink)', lineHeight: 1.5, margin: 0 }}>
                {slip.action_summary}
              </p>
            </div>
          )}
          {slip.description && (
            <div>
              <div className="eyebrow" style={{ marginBottom: 6 }}>Description</div>
              <p style={{ fontSize: 14, color: 'var(--ink-2)', lineHeight: 1.55, margin: 0, whiteSpace: 'pre-wrap' }}>
                {slip.description}
              </p>
            </div>
          )}
        </Section>
      )}

      {/* PHOTOS */}
      {slip.photo_urls && slip.photo_urls.length > 0 && (
        <Section title="Photos" eyebrow={`${slip.photo_urls.length} attached`}>
          <PhotoThumbs urls={slip.photo_urls} size={120} />
        </Section>
      )}

      {/* SOURCE INSPECTION */}
      {inspection && (
        <Section title="Source" eyebrow="Created from inspection">
          <Link
            href={`/inspections/${inspection.id}/summary`}
            style={{
              display: 'block',
              padding: '14px 16px',
              border: '1px solid var(--rule)',
              textDecoration: 'none',
              color: 'inherit',
            }}
          >
            <div style={{ fontSize: 13, color: 'var(--ink)', fontWeight: 500 }}>
              Inspection by {inspection.inspector_name}
              {inspection.started_at && ` · ${formatDate(inspection.started_at)}`}
            </div>
            {inspectionItem && (
              <div style={{ marginTop: 4, fontSize: 12, color: 'var(--ink-3)' }}>
                Card: {inspectionItem.category} &middot; {inspectionItem.title}
              </div>
            )}
            <div style={{ marginTop: 8, fontSize: 11, letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>
              View inspection summary →
            </div>
          </Link>
        </Section>
      )}

      {/* STATUS + RESOLUTION */}
      <Section title="Update" eyebrow="Mark progress">
        <StatusChanger
          workSlipId={slip.id}
          initialStatus={slip.status}
          initialResolutionNotes={slip.resolution_notes ?? null}
        />
      </Section>

      {/* FOOTER */}
      <footer style={{ borderTop: '1px solid var(--ink)', marginTop: 'auto' }}>
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
          <span>Rising Tide &middot; Work Slip {slip.id.slice(0, 8)}</span>
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
  children,
}: {
  title: string;
  eyebrow: string;
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
      <div style={{ borderTop: '1px solid var(--ink)', paddingTop: 18 }}>{children}</div>
    </section>
  );
}

function Stat({
  label,
  value,
  sub,
  href,
  last = false,
}: {
  label: string;
  value: string;
  sub?: string;
  href?: string;
  last?: boolean;
}) {
  const inner = (
    <div
      style={{
        padding: '20px 22px',
        borderRight: last ? 'none' : '1px solid var(--rule)',
      }}
    >
      <div className="eyebrow" style={{ marginBottom: 8 }}>{label}</div>
      <div className="font-serif" style={{ fontSize: 18, fontWeight: 400, color: 'var(--ink)', lineHeight: 1.2 }}>
        {value}
      </div>
      {sub && (
        <div style={{ marginTop: 4, fontSize: 11, color: 'var(--ink-4)' }}>{sub}</div>
      )}
    </div>
  );
  if (href) {
    return (
      <Link href={href} style={{ display: 'block', textDecoration: 'none', color: 'inherit' }}>
        {inner}
      </Link>
    );
  }
  return inner;
}

function Pill({ color, label, solid = false }: { color: string; label: string; solid?: boolean }) {
  return (
    <span
      style={{
        background: solid ? color : 'transparent',
        color: solid ? 'var(--paper)' : color,
        border: `1.5px solid ${color}`,
        padding: '4px 12px',
        fontSize: 10,
        letterSpacing: '.18em',
        textTransform: 'uppercase',
        fontWeight: 700,
      }}
    >
      {label}
    </span>
  );
}

function formatDate(value: string | null): string {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return value;
  }
}
