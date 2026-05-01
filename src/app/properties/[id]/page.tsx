import Link from 'next/link';
import { notFound } from 'next/navigation';
import { HelmMasthead } from '@/components/HelmMasthead';
import { supabasePerfection, isPerfectionConfigured } from '@/lib/supabase-perfection';
import type { PerfectionProperty } from '@/lib/perfection-types';

export const dynamic = 'force-dynamic';
export const revalidate = 60;

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

type Params = { id: string };

export default async function PropertyDetailPage({ params }: { params: Promise<Params> }) {
  const { id } = await params;
  const p = await getProperty(id);
  if (!p) notFound();

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
      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingTop: 24, paddingBottom: 36, width: '100%' }}>
        <div className="eyebrow" style={{ marginBottom: 14 }}>Property</div>
        <h1
          className="font-serif"
          style={{
            fontSize: 52,
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

      {/* METADATA GRID */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 48, flex: 1, width: '100%' }}>
        <div style={{ borderTop: '1px solid var(--ink)', borderBottom: '1px solid var(--ink)' }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
            }}
          >
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
              value={p.is_rising_tide_owned ? 'Rising Tide' : '—'}
              last
            />
          </div>
        </div>

        {/* DETAILS */}
        <div style={{ marginTop: 48 }}>
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
        </div>

        {/* ACTIVATION + SYNC */}
        <div style={{ marginTop: 48 }}>
          <div className="eyebrow" style={{ marginBottom: 18 }}>Activity</div>
          <dl style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px 64px', fontSize: 13 }}>
            <Detail term="Activated" definition={formatDate(p.activated_at)} />
            <Detail term="Last Synced" definition={formatRelative(p.last_synced_at)} />
            <Detail term="Created" definition={formatDate(p.created_at)} />
            <Detail term="Property ID" definition={p.id} mono />
          </dl>
        </div>
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
            Source: inspect.risingtidestr.com
          </span>
        </div>
      </footer>
    </div>
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
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
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
    if (minutes < 60) return `${minutes} min ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} hr ago`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
    return formatDate(value);
  } catch {
    return value;
  }
}
