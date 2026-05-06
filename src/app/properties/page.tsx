import Link from 'next/link';
import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmHero } from '@/components/HelmHero';
import { HelmFooter } from '@/components/HelmFooter';
import { supabase, isConfigured as isHelmConfigured } from '@/lib/supabase';
import type { HelmPropertyRow } from '@/lib/properties';

export const dynamic = 'force-dynamic';
export const revalidate = 60;

async function getProperties(): Promise<{ properties: HelmPropertyRow[]; error: string | null }> {
  if (!isHelmConfigured) {
    return { properties: [], error: 'Helm Supabase env vars are not set.' };
  }
  try {
    const { data, error } = await supabase
      .from('properties')
      .select('*')
      .order('is_active', { ascending: false })
      .order('name');
    if (error) throw error;
    return { properties: (data ?? []) as HelmPropertyRow[], error: null };
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

      <HelmHero
        eyebrow="Helm · Properties"
        title="All Rising Tide"
        emphasis="properties."
        description={
          !error
            ? `${active.length} active${inactive.length ? `, ${inactive.length} inactive` : ''}. Helm-native data.`
            : undefined
        }
      />

      {/* LIST */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 80, flex: 1, width: '100%' }}>
        {error ? (
          <ErrorBlock error={error} />
        ) : properties.length === 0 ? (
          <EmptyBlock />
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

      <HelmFooter module="Properties" right="Source: Helm" />
    </div>
  );
}

function PropertyRow({
  property: p,
  number,
  dimmed = false,
}: {
  property: HelmPropertyRow;
  number: string;
  dimmed?: boolean;
}) {
  // Internal naming convention: show the short address-without-suffix
  // primary, and the external "Stay at ..." marketing title as a quieter
  // secondary label when present.
  const display = p.name;
  const subtitle = p.title || p.address;

  return (
    <Link
      href={`/properties/${p.id}`}
      style={{ display: 'block', textDecoration: 'none', color: 'inherit', opacity: dimmed ? 0.5 : 1 }}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '64px 1fr auto auto',
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
          </p>
        </div>
        <span
          className="tabular-nums"
          style={{
            fontSize: 12,
            color: 'var(--ink-3)',
            whiteSpace: 'nowrap',
          }}
        >
          {p.owner_last}
        </span>
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
          {p.is_active ? `${p.management_fee_pct}% →` : 'Inactive'}
        </span>
      </div>
    </Link>
  );
}

function ErrorBlock({ error }: { error: string }) {
  return (
    <div
      style={{
        borderTop: '1px solid var(--ink)',
        borderBottom: '1px solid var(--ink)',
        padding: '32px 0',
      }}
    >
      <div className="eyebrow" style={{ color: 'var(--negative)', marginBottom: 12 }}>Database error</div>
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
  );
}

function EmptyBlock() {
  return (
    <div style={{ borderTop: '1px solid var(--ink)', padding: '40px 0', textAlign: 'center' }}>
      <p style={{ color: 'var(--ink-3)', marginBottom: 8 }}>No properties found.</p>
      <p style={{ color: 'var(--ink-4)', fontSize: 12 }}>
        Run the migration at <code className="font-mono">supabase/migrations/20260430_create_properties.sql</code> in
        Helm&apos;s Supabase SQL Editor to seed the table.
      </p>
    </div>
  );
}
