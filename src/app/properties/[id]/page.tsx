import Link from 'next/link';
import { notFound } from 'next/navigation';
import { HelmMasthead } from '@/components/HelmMasthead';
import { supabase, isConfigured as isHelmConfigured } from '@/lib/supabase';
import type { HelmPropertyRow } from '@/lib/properties';

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

type ReservationSummary = {
  id: string;
  guest_name: string | null;
  check_in: string | null;
  check_out: string | null;
  nights: number | null;
  platform: string | null;
  adjusted_revenue: number | null;
};

type InspectionSummary = {
  id: string;
  completed_at: string | null;
  started_at: string | null;
  inspector_name: string | null;
  total_items: number;
  pass_count: number;
  issue_count: number;
  na_count: number;
};

type OwnerRecord = {
  id: string;
  name_full: string;
  name_greeting: string;
  name_last: string;
  emails: string[];
  notes: string | null;
};

async function getProperty(id: string): Promise<HelmPropertyRow | null> {
  if (!isHelmConfigured) return null;
  const { data, error } = await supabase
    .from('properties')
    .select('*')
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return (data as HelmPropertyRow) ?? null;
}

async function getRecentStatements(propertyId: string): Promise<HelmStatementRow[]> {
  if (!isHelmConfigured) return [];
  try {
    const { data, error } = await supabase
      .from('property_statements')
      .select('id, num_stays, nights_booked, rental_revenue, owner_payout, statement_periods!inner(month, status)')
      .eq('property_id', propertyId)
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

// Direct query on reservations.property_id (added in the entity-layer migration).
// Before that column existed, this would have required a join through
// property_statements + statement_periods.
async function getRecentReservations(propertyId: string): Promise<ReservationSummary[]> {
  if (!isHelmConfigured) return [];
  try {
    const { data, error } = await supabase
      .from('reservations')
      .select('id, guest_name, check_in, check_out, nights, platform, adjusted_revenue')
      .eq('property_id', propertyId)
      .order('check_out', { ascending: false })
      .limit(6);
    if (error) throw error;
    return (data ?? []) as ReservationSummary[];
  } catch {
    return [];
  }
}

async function getRecentInspections(propertyId: string): Promise<InspectionSummary[]> {
  if (!isHelmConfigured) return [];
  try {
    const { data, error } = await supabase
      .from('inspections')
      .select('id, completed_at, started_at, inspector_name, total_items, pass_count, issue_count, na_count')
      .eq('property_id', propertyId)
      .order('started_at', { ascending: false })
      .limit(5);
    if (error) throw error;
    return (data ?? []) as InspectionSummary[];
  } catch {
    return [];
  }
}

async function getOwner(ownerId: string | null): Promise<OwnerRecord | null> {
  if (!isHelmConfigured || !ownerId) return null;
  try {
    const { data, error } = await supabase
      .from('owners')
      .select('id, name_full, name_greeting, name_last, emails, notes')
      .eq('id', ownerId)
      .maybeSingle();
    if (error) throw error;
    return (data as OwnerRecord) ?? null;
  } catch {
    return null;
  }
}

type Params = { id: string };

export default async function PropertyDetailPage({ params }: { params: Promise<Params> }) {
  const { id } = await params;
  const p = await getProperty(id);
  if (!p) notFound();

  const [statements, reservations, inspections, owner] = await Promise.all([
    getRecentStatements(p.id),
    getRecentReservations(p.id),
    getRecentInspections(p.id),
    getOwner(p.owner_id),
  ]);

  // Internal-first display: the address-without-suffix name as the hero,
  // the external "Stay at ..." marketing title (if any) as a quieter
  // subtitle below.
  const display = p.name;
  const subtitle = p.title || '';

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
        {subtitle && (
          <p style={{ marginTop: 12, fontSize: 16, color: 'var(--ink-3)' }}>
            {subtitle}
          </p>
        )}
        <p style={{ marginTop: 6, fontSize: 14, color: 'var(--ink-3)' }}>
          {p.address}, {p.city}
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
            <Stat label="Mgmt Fee" value={`${p.management_fee_pct}%`} />
            <Stat
              label="Cleaning Est"
              value={p.cleaning_cost_estimate != null ? `$${p.cleaning_cost_estimate}` : '—'}
            />
            <Stat label="Bank ··" value={p.bank_last4 ? `**${p.bank_last4}` : '—'} />
            <Stat label="Owner" value={p.owner_last} last />
          </div>
        </div>
      </section>

      {/* RECENT STATEMENTS (Helm-native) */}
      <Section
        title="Recent Statements"
        eyebrow="Helm"
        empty={statements.length === 0}
        emptyMessage="No statements for this property yet."
      >
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

      {/* RECENT STAYS (Helm-native via reservations.property_id) */}
      <Section
        title="Recent Stays"
        eyebrow="Helm"
        empty={reservations.length === 0}
        emptyMessage="No reservations yet for this property."
      >
        <div style={{ borderTop: '1px solid var(--ink)' }}>
          {reservations.map((r) => (
            <div
              key={r.id}
              style={{
                display: 'grid',
                gridTemplateColumns: '160px 1fr auto auto',
                gap: 24,
                alignItems: 'baseline',
                padding: '16px 0',
                borderBottom: '1px solid var(--rule)',
              }}
            >
              <span className="font-serif" style={{ fontSize: 16, fontWeight: 400, color: 'var(--ink)' }}>
                {formatDateRange(r.check_in, r.check_out)}
              </span>
              <span style={{ fontSize: 13, color: 'var(--ink)' }}>
                {r.guest_name || '—'}
                {r.platform ? (
                  <span style={{ color: 'var(--ink-3)', marginLeft: 10, fontSize: 11, letterSpacing: '.12em', textTransform: 'uppercase' }}>
                    {r.platform}
                  </span>
                ) : null}
              </span>
              <span className="font-mono tabular-nums" style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                {r.nights ?? 0} night{r.nights === 1 ? '' : 's'}
              </span>
              <span className="font-mono tabular-nums" style={{ fontSize: 13, color: 'var(--ink)', fontWeight: 500 }}>
                {r.adjusted_revenue != null ? formatCurrency(r.adjusted_revenue) : '—'}
              </span>
            </div>
          ))}
        </div>
      </Section>

      {/* INSPECTIONS (Helm-native) */}
      <Section
        title="Inspections"
        eyebrow="Helm"
        empty={inspections.length === 0}
        emptyMessage="No inspections logged for this property yet."
      >
        <div style={{ borderTop: '1px solid var(--ink)' }}>
          {inspections.map((i) => {
            const when = i.completed_at || i.started_at;
            const inProgress = !i.completed_at;
            return (
              <Link
                key={i.id}
                href={`/inspections/${i.id}/summary`}
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
                    {formatDate(when)}
                  </span>
                  <span style={{ fontSize: 13, color: 'var(--ink)' }}>
                    {i.inspector_name || '—'}
                    {inProgress && (
                      <span style={{ color: 'var(--signal, #c85a3a)', marginLeft: 10, fontSize: 11, letterSpacing: '.12em', textTransform: 'uppercase' }}>
                        in progress
                      </span>
                    )}
                  </span>
                  <span className="font-mono tabular-nums" style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                    {i.pass_count} pass · {i.issue_count} issue · {i.na_count} n/a
                  </span>
                  <span className="font-mono tabular-nums" style={{ fontSize: 13, color: 'var(--ink)', fontWeight: 500 }}>
                    {i.total_items > 0 ? `${Math.round((i.pass_count / i.total_items) * 100)}%` : '—'} →
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      </Section>

      {/* OWNER + COMMS */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 48, width: '100%' }}>
        <div className="flex items-baseline justify-between" style={{ marginBottom: 14 }}>
          <h2 className="font-serif" style={{ fontSize: 22, fontWeight: 400, letterSpacing: '-0.01em', color: 'var(--ink)', margin: 0 }}>
            Owner
          </h2>
          <span className="eyebrow">Helm</span>
        </div>
        <div style={{ borderTop: '1px solid var(--ink)', paddingTop: 18 }}>
          <dl style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px 64px', fontSize: 13 }}>
            <Detail term="Owner" definition={owner?.name_full ?? p.owner_full} />
            <Detail term="Greeting" definition={owner?.name_greeting ?? p.owner_greeting} />
            <Detail
              term="Emails"
              definition={(() => {
                const emails = owner?.emails ?? p.owner_emails;
                return emails.length > 0 ? emails.join(', ') : '—';
              })()}
              mono
            />
            <Detail term="Tax Cert ID" definition={p.tax_cert_id || '—'} mono />
          </dl>
        </div>
      </section>

      {/* DETAILS */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 56, width: '100%' }}>
        <div className="eyebrow" style={{ marginBottom: 18 }}>Details</div>
        <dl style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px 64px', fontSize: 13 }}>
          <Detail term="Helm ID" definition={p.id} mono />
          <Detail term="Code" definition={p.code || '—'} />
          <Detail term="Title" definition={p.title || '—'} />
          <Detail term="Type" definition={p.type_of_unit || '—'} />
          <Detail term="Tags" definition={p.tags || '—'} />
          <Detail term="Timezone" definition={p.timezone || '—'} />
          <Detail
            term="Coordinates"
            definition={
              p.latitude != null && p.longitude != null
                ? `${Number(p.latitude).toFixed(4)}°, ${Number(p.longitude).toFixed(4)}°`
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
          <Detail term="Created" definition={formatDate(p.created_at)} />
          <Detail term="Last Synced" definition={formatRelative(p.last_synced_at)} />
          <Detail term="Perfection ID" definition={p.perfection_id || '—'} mono />
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

function formatDateRange(checkIn: string | null, checkOut: string | null): string {
  if (!checkIn && !checkOut) return '—';
  const inDate = checkIn ? formatShortDate(checkIn) : '—';
  const outDate = checkOut ? formatShortDate(checkOut) : '—';
  return `${inDate} → ${outDate}`;
}

function formatShortDate(value: string): string {
  try {
    const d = new Date(value);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return value;
  }
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
