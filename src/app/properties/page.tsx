import Link from 'next/link';
import { HelmMasthead } from '@/components/HelmMasthead';
import { supabasePerfection, isPerfectionConfigured } from '@/lib/supabase-perfection';
import type { PerfectionProperty } from '@/lib/perfection-types';

export const dynamic = 'force-dynamic';
export const revalidate = 60;

async function getProperties(): Promise<{ properties: PerfectionProperty[]; error: string | null }> {
  if (!isPerfectionConfigured) {
    return {
      properties: [],
      error: 'Perfection Supabase env vars are not set. Add NEXT_PUBLIC_PERFECTION_SUPABASE_URL and NEXT_PUBLIC_PERFECTION_SUPABASE_ANON_KEY to .env.local (and to your Vercel project).',
    };
  }
  try {
    const { data, error } = await supabasePerfection
      .from('properties')
      .select('id,name,nickname,address,code,title,latitude,longitude,is_active,activated_at,deactivated_at,deactivated_reason,management_fee_pct,cleaning_cost_estimate,is_rising_tide_owned,guesty_listing_id,tags,type_of_unit,timezone,created_at,last_synced_at')
      .order('is_active', { ascending: false })
      .order('name');
    if (error) throw error;
    return { properties: (data ?? []) as PerfectionProperty[], error: null };
  } catch (err) {
    return { properties: [], error: err instanceof Error ? err.message : String(err) };
  }
}

export default async function PropertiesPage() {
  const { properties, error } = await getProperties();
  const active = properties.filter((p) => p.is_active);
  const inactive = properties.filter((p) => !p.is_active);

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead current="properties" />

      {/* HERO */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingTop: 56, paddingBottom: 28, width: '100%' }}>
        <div className="eyebrow" style={{ marginBottom: 14 }}>Helm &middot; Properties</div>
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
          All Rising Tide <em style={{ color: 'var(--tide-deep)', fontWeight: 400 }}>properties.</em>
        </h1>
        {!error && (
          <p style={{ marginTop: 14, fontSize: 14, lineHeight: 1.55, color: 'var(--ink-3)', maxWidth: 580 }}>
            Live data from the Perfection Supabase project. {active.length} active{inactive.length ? `, ${inactive.length} inactive` : ''}.
          </p>
        )}
      </section>

      {/* LIST */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 80, flex: 1, width: '100%' }}>
        {error ? (
          <div
            style={{
              borderTop: '1px solid var(--ink)',
              borderBottom: '1px solid var(--ink)',
              padding: '32px 0',
            }}
          >
            <div className="eyebrow" style={{ color: 'var(--negative)', marginBottom: 12 }}>Configuration needed</div>
            <p style={{ fontSize: 14, color: 'var(--ink)', maxWidth: 640, marginBottom: 16 }}>
              The Properties module reads from the Perfection (Lovable) Supabase project, but the env vars for that project are not set.
            </p>
            <pre
              className="font-mono"
              style={{
                fontSize: 11,
                background: 'var(--paper-2)',
                padding: '12px 14px',
                borderLeft: '3px solid var(--negative)',
                color: 'var(--negative)',
                whiteSpace: 'pre-wrap',
              }}
            >
              {error}
            </pre>
          </div>
        ) : properties.length === 0 ? (
          <div style={{ borderTop: '1px solid var(--ink)', padding: '32px 0', textAlign: 'center' }}>
            <p style={{ color: 'var(--ink-3)' }}>No properties found.</p>
          </div>
        ) : (
          <>
            <div style={{ borderTop: '1px solid var(--ink)' }}>
              {active.map((p, i) => (
                <PropertyRow key={p.id} property={p} number={String(i + 1).padStart(2, '0')} />
              ))}
            </div>

            {inactive.length > 0 && (
              <div style={{ marginTop: 56 }}>
                <div className="eyebrow" style={{ marginBottom: 18 }}>Inactive</div>
                <div style={{ borderTop: '1px solid var(--rule)' }}>
                  {inactive.map((p, i) => (
                    <PropertyRow
                      key={p.id}
                      property={p}
                      number={String(i + 1).padStart(2, '0')}
                      dimmed
                    />
                  ))}
                </div>
              </div>
            )}
          </>
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
          <span>Rising Tide &middot; Properties</span>
          <span style={{ fontStyle: 'italic', textTransform: 'none', letterSpacing: 0, color: 'var(--ink-3)', fontSize: 11 }}>
            Source: inspect.risingtidestr.com
          </span>
        </div>
      </footer>
    </div>
  );
}

function PropertyRow({
  property: p,
  number,
  dimmed = false,
}: {
  property: PerfectionProperty;
  number: string;
  dimmed?: boolean;
}) {
  const display = p.nickname || p.name || p.address;
  const subtitle = p.title || p.address;
  const showAddress = display !== p.address;

  return (
    <Link
      href={`/properties/${p.id}`}
      style={{ display: 'block', textDecoration: 'none', color: 'inherit', opacity: dimmed ? 0.5 : 1 }}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '64px 1fr auto',
          gap: 24,
          alignItems: 'baseline',
          padding: '24px 0',
          borderBottom: '1px solid var(--rule)',
        }}
      >
        <span
          className="font-mono"
          style={{
            fontSize: 11,
            color: dimmed ? 'var(--ink-4)' : 'var(--signal)',
            letterSpacing: '.08em',
          }}
        >
          {number}
        </span>
        <div>
          <h2
            className="font-serif"
            style={{
              fontSize: 24,
              fontWeight: 400,
              letterSpacing: '-0.02em',
              color: 'var(--ink)',
              margin: 0,
            }}
          >
            {display}
          </h2>
          <p style={{ marginTop: 4, fontSize: 13, color: 'var(--ink-3)' }}>
            {subtitle}
            {showAddress && p.address !== subtitle ? ` · ${p.address}` : ''}
          </p>
        </div>
        <span
          style={{
            fontSize: 10,
            letterSpacing: '.22em',
            textTransform: 'uppercase',
            fontWeight: 500,
            color: dimmed ? 'var(--ink-4)' : 'var(--ink)',
            whiteSpace: 'nowrap',
          }}
        >
          {p.is_active ? `${p.management_fee_pct ? `${p.management_fee_pct}%` : ''} →` : 'Inactive'}
        </span>
      </div>
    </Link>
  );
}
