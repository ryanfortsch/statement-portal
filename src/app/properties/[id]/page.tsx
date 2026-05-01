import Link from 'next/link';
import { notFound } from 'next/navigation';
import { HelmMasthead } from '@/components/HelmMasthead';
import { supabasePerfection, isPerfectionConfigured } from '@/lib/supabase-perfection';
import { supabase, isConfigured as isHelmConfigured } from '@/lib/supabase';
import { helmPropertyFromPerfection, type Property as HelmProperty } from '@/lib/properties';
import type { PerfectionProperty, PerfectionInspection, PerfectionWorkSlip } from '@/lib/perfection-types';

export const dynamic = 'force-dynamic';
export const revalidate = 60;

type HelmStatementRow = {
  id: string;
  month: string;
  status: string;
  num_stays: number;
  nights_booked: number;
  rental_revenue: number;
  owner_payout: number;
};

async function getProperty(id: string): Promise<PerfectionProperty | null> {
  if (!isPerfectionConfigured) return null;
  const { data, error } = await supabasePerfection
    .from('properties')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return (data as PerfectionProperty) ?? null;
}

async function getRecentStatements(helmProp: HelmProperty | undefined): Promise<HelmStatementRow[]> {
  if (!helmProp || !isHelmConfigured) return [];
  try {
    const { data, error } = await supabase
      .from('property_statements')
      .select('id, num_stays, nights_booked, rental_revenue, owner_payout, statement_periods!inner(month, status)')
      .eq('property_id', helmProp.id)
      .order('statement_periods(month)', { ascending: false })
      .limit(6);
    if (error) throw error;
    return (data ?? []).map((row: {
      id: string;
      num_stays: number;
      nights_booked: number;
      rental_revenue: number;
      owner_payout: number;
      statement_periods: { month: string; status: string } | { month: string; status: string }[];
    }) => {
      const period = Array.isArray(row.statement_periods) ? row.statement_periods[0] : row.statement_periods;
      return {
        id: row.id,
        month: period?.month ?? '',
        status: period?.status ?? '',
        num_stays: row.num_stays,
        nights_booked: row.nights_booked,
        rental_revenue: row.rental_revenue,
        owner_payout: row.owner_payout,
      };
    });
  } catch {
    return [];
  }
}

async function getRecentInspections(propertyId: string): Promise<PerfectionInspection[]> {
  if (!isPerfectionConfigured) return [];
  try {
    const { data, error } = await supabasePerfection
      .from('inspections')
      .select('id,property_id,inspector_name,started_at,completed_at,skipped_at,skip_reason,skip_reason_type,issue_count,pass_count,total_items')
      .eq('property_id', propertyId)
      .order('started_at', { ascending: false, nullsFirst: false })
      .limit(5);
    if (error) throw error;
    return (data ?? []) as PerfectionInspection[];
  } catch {
    return [];
  }
}

async function getOpenWorkSlips(propertyId: string): Promise<PerfectionWorkSlip[]> {
  if (!isPerfectionConfigured) return [];
  try {
    const { data, error } = await supabasePerfection
      .from('work_slips')
      .select('id,property_id,inspection_id,status,priority,category,title,action_summary,description,scheduled_date,created_at,completed_at,owner_action_required')
      .eq('property_id', propertyId)
      .in('status', ['open', 'scheduled', 'in_progress'])
      .order('created_at', { ascending: false })
      .limit(10);
    if (error) throw error;
    return (data ?? []) as PerfectionWorkSlip[];
  } catch {
    return [];
  }
}

type Params = { id: string };

export default async function PropertyDetailPage({ params }: { params: Promise<Params> }) {
  const { id } = await params;
  const p = await getProperty(id);
  if (!p) notFound();

  const helmProp = helmPropertyFromPerfection(p);

  const [statements, inspections, workSlips] = await Promise.all([
    getRecentStatements(helmProp),
    getRecentInspections(p.id),
    getOpenWorkSlips(p.id),
  ]);

  const display = p.nickname || p.name || p.address;
  const subtitle = p.title || p.name || '';
  const cityFromAddress = (p.address.match(/,\s*([^,]+),\s*[A-Z]{2}/) || [])[1] || '';

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead current="properties" />

      {/* BACK */}
      <div className="max-w-[1100px] mx-auto px-10" style={{ paddingTop: 24, width: '100%' }}>
        <Link
          href="/properties"
          style={{
            fontSize: 11,
            letterSpacing: '.18em',
            textTransform: 'uppercase',
            color: 'var(--ink-3)',
            textDecoration: 'none',
          }}
        >
          ← All Properties
        </Link>
      </div>

      {/* HERO */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingTop: 24, paddingBottom: 28, width: '100%' }}>
        <div className="eyebrow" style={{ marginBottom: 14 }}>Property</div>
        <h1
          className="font-serif"
          style={{
            fontSize: 48,
            lineHeight: 1.05,
            fontWeight: 300,
            letterSpacing: '-0.02em',
            color: 'var(--ink)',
            maxWidth: 720,
          }}
        >
          {display}
        </h1>
        {subtitle && subtitle !== display && (
          <p style={{ marginTop: 12, fontSize: 16, color: 'var(--ink-3)' }}>
            {subtitle}
          </p>
        )}
        <p style={{ marginTop: 6, fontSize: 14, color: 'var(--ink-3)' }}>
          {p.address}
        </p>

        {!p.is_active && (
          <div
            style={{
              marginTop: 18,
              padding: '8px 14px',
              borderLeft: '3px solid var(--negative)',
              background: 'var(--paper-2)',
              fontSize: 12,
              color: 'var(--negative)',
              display: 'inline-block',
            }}
          >
            <strong>Inactive</strong>
            {p.deactivated_reason ? ` · ${p.deactivated_reason}` : ''}
            {p.deactivated_at ? ` · ${formatDate(p.deactivated_at)}` : ''}
          </div>
        )}
      </section>

      {/* STAT GRID */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 56, width: '100%' }}>
        <div style={{ borderTop: '1px solid var(--ink)', borderBottom: '1px solid var(--ink)' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)' }}>
            <Stat
              label="Mgmt Fee"
              value={p.management_fee_pct != null ? `${p.management_fee_pct}%` : '—'}
            />
            <Stat
              label="Cleaning Est"
              value={p.cleaning_cost_estimate != null ? `$${p.cleaning_cost_estimate}` : '—'}
            />
            <Stat
              label="Type"
              value={p.type_of_unit || '—'}
            />
            <Stat
              label="Owner"
              value={helmProp?.owner_last || (p.is_rising_tide_owned ? 'Rising Tide' : '—')}
              last
            />
          </div>
        </div>
      </section>

      {/* RECENT STATEMENTS */}
      <Section title="Recent Statements" eyebrow="Helm" empty={!helmProp || statements.length === 0} emptyMessage={
        !helmProp
          ? 'This property is not in the Helm statements registry.'
          : 'No statements for this property yet.'
      }>
        <div style={{ borderTop: '1px solid var(--ink)' }}>
          {statements.map((s) => (
            <Link
              key={s.id}
              href={`/statements?month=${s.month}`}
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
                <span className="font-serif" style={{ fontSize: 18, fontWeight: 400, color: 'var(--ink)' }}>
                  {formatMonth(s.month)}
                </span>
                <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                  {s.num_stays} stay{s.num_stays === 1 ? '' : 's'} · {s.nights_booked} nights
                </span>
                <span className="font-mono tabular-nums" style={{ fontSize: 13, color: 'var(--ink-3)' }}>
                  {formatCurrency(s.rental_revenue)} rev
                </span>
                <span className="font-mono tabular-nums" style={{ fontSize: 13, color: 'var(--ink)', fontWeight: 500 }}>
                  {formatCurrency(s.owner_payout)} payout →
                </span>
              </div>
            </Link>
          ))}
        </div>
      </Section>

      {/* RECENT INSPECTIONS */}
      <Section title="Recent Inspections" eyebrow="Perfection" empty={inspections.length === 0} emptyMessage="No inspections yet (or RLS-blocked).">
        <div style={{ borderTop: '1px solid var(--ink)' }}>
          {inspections.map((insp) => (
            <a
              key={insp.id}
              href="https://inspect.risingtidestr.com"
              target="_blank"
              rel="noopener noreferrer"
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
                  {formatDate(insp.started_at) || '—'}
                </span>
                <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                  {insp.inspector_name}
                </span>
                <span style={{
                  fontSize: 11,
                  letterSpacing: '.08em',
                  textTransform: 'uppercase',
                  color: inspectionStatusColor(insp),
                }}>
                  {inspectionStatusLabel(insp)}
                </span>
                <span className="font-mono tabular-nums" style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                  {insp.issue_count != null && insp.issue_count > 0
                    ? `${insp.issue_count} issue${insp.issue_count === 1 ? '' : 's'} ↗`
                    : '↗'}
                </span>
              </div>
            </a>
          ))}
        </div>
      </Section>

      {/* OPEN WORK */}
      <Section title="Open Work" eyebrow="Perfection" empty={workSlips.length === 0} emptyMessage="No open work slips for this property.">
        <div style={{ borderTop: '1px solid var(--ink)' }}>
          {workSlips.map((w) => (
            <a
              key={w.id}
              href="https://inspect.risingtidestr.com"
              target="_blank"
              rel="noopener noreferrer"
              style={{ display: 'block', textDecoration: 'none', color: 'inherit' }}
            >
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '90px 1fr auto auto',
                  gap: 24,
                  alignItems: 'baseline',
                  padding: '18px 0',
                  borderBottom: '1px solid var(--rule)',
                }}
              >
                <span style={{
                  fontSize: 10,
                  letterSpacing: '.18em',
                  textTransform: 'uppercase',
                  color: workSlipPriorityColor(w.priority),
                  fontWeight: 600,
                }}>
                  {w.priority}
                </span>
                <div>
                  <div style={{ fontSize: 14, color: 'var(--ink)' }}>{w.title}</div>
                  {w.action_summary && (
                    <div style={{ fontSize: 12, color: 'var(--ink-3)', marginTop: 2 }}>
                      {w.action_summary}
                    </div>
                  )}
                </div>
                <span style={{
                  fontSize: 11,
                  letterSpacing: '.08em',
                  textTransform: 'uppercase',
                  color: 'var(--ink-3)',
                }}>
                  {w.status.replaceAll('_', ' ')}
                </span>
                <span className="font-mono tabular-nums" style={{ fontSize: 11, color: 'var(--ink-4)' }}>
                  {formatRelative(w.created_at)} ↗
                </span>
              </div>
            </a>
          ))}
        </div>
      </Section>

      {/* DETAILS */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 56, width: '100%' }}>
        <div className="eyebrow" style={{ marginBottom: 18 }}>Details</div>
        <dl style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px 64px', fontSize: 13 }}>
          <Detail term="Code" definition={p.code || '—'} />
          <Detail term="Nickname" definition={p.nickname || '—'} />
          <Detail term="Title" definition={p.title || '—'} />
          <Detail term="Tags" definition={p.tags || '—'} />
          <Detail term="City" definition={cityFromAddress || '—'} />
          <Detail term="Timezone" definition={p.timezone || '—'} />
          <Detail
            term="Coordinates"
            definition={
              p.latitude != null && p.longitude != null
                ? `${p.latitude.toFixed(4)}°, ${p.longitude.toFixed(4)}°`
                : '—'
            }
          />
          <Detail term="Guesty Listing ID" definition={p.guesty_listing_id || '—'} mono />
        </dl>
      </section>

      {/* ACTIVITY */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 56, flex: 1, width: '100%' }}>
        <div className="eyebrow" style={{ marginBottom: 18 }}>Activity</div>
        <dl style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px 64px', fontSize: 13 }}>
          <Detail term="Activated" definition={formatDate(p.activated_at)} />
          <Detail term="Last Synced" definition={formatRelative(p.last_synced_at)} />
          <Detail term="Created" definition={formatDate(p.created_at)} />
          <Detail term="Property ID" definition={p.id} mono />
        </dl>
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
          <span>Rising Tide &middot; Properties</span>
          <span style={{ fontStyle: 'italic', textTransform: 'none', letterSpacing: 0, color: 'var(--ink-3)', fontSize: 11 }}>
            Sources: Helm + inspect.risingtidestr.com
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

function Stat({ label, value, last = false }: { label: string; value: string; last?: boolean }) {
  return (
    <div
      style={{
        padding: '20px 20px',
        borderRight: last ? 'none' : '1px solid var(--rule)',
      }}
    >
      <div className="eyebrow" style={{ marginBottom: 6 }}>{label}</div>
      <div className="font-serif tabular-nums" style={{ fontSize: 22, fontWeight: 400, color: 'var(--ink)' }}>
        {value}
      </div>
    </div>
  );
}

function Detail({ term, definition, mono = false }: { term: string; definition: string; mono?: boolean }) {
  return (
    <div>
      <dt className="eyebrow" style={{ marginBottom: 4 }}>{term}</dt>
      <dd
        className={mono ? 'font-mono' : ''}
        style={{ color: 'var(--ink)', fontSize: mono ? 12 : 14, margin: 0 }}
      >
        {definition}
      </dd>
    </div>
  );
}

function inspectionStatusLabel(insp: PerfectionInspection): string {
  if (insp.skipped_at) return `Skipped${insp.skip_reason_type ? ` · ${insp.skip_reason_type}` : ''}`;
  if (insp.completed_at) return 'Complete';
  if (insp.started_at) return 'In progress';
  return '—';
}

function inspectionStatusColor(insp: PerfectionInspection): string {
  if (insp.skipped_at) return 'var(--negative)';
  if (insp.completed_at) return 'var(--positive)';
  if (insp.started_at) return 'var(--signal)';
  return 'var(--ink-4)';
}

function workSlipPriorityColor(priority: string): string {
  if (priority === 'high') return 'var(--negative)';
  if (priority === 'normal') return 'var(--ink)';
  return 'var(--ink-4)';
}

function formatDate(value: string | null): string {
  if (!value) return '—';
  try {
    const d = new Date(value);
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return value;
  }
}

function formatMonth(month: string): string {
  try {
    const [year, m] = month.split('-');
    const d = new Date(Number(year), Number(m) - 1, 1);
    return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  } catch {
    return month;
  }
}

function formatCurrency(value: number): string {
  if (value == null) return '—';
  return `$${Math.round(value).toLocaleString('en-US')}`;
}

function formatRelative(value: string | null): string {
  if (!value) return '—';
  try {
    const then = new Date(value).getTime();
    const now = Date.now();
    const diff = now - then;
    const minutes = Math.floor(diff / 60000);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days}d ago`;
    return formatDate(value);
  } catch {
    return value;
  }
}
