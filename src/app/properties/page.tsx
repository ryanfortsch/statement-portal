import Link from 'next/link';
import { HelmMasthead } from '@/components/HelmMasthead';
import { WorkTabs } from '@/components/WorkTabs';
import { HelmHero } from '@/components/HelmHero';
import { HelmFooter } from '@/components/HelmFooter';
import { supabaseAdmin as supabase, isServiceConfigured as isHelmConfigured } from '@/lib/supabase-admin';
import type { HelmPropertyRow } from '@/lib/properties';
import { ACTIVE_WORK_SLIP_STATUSES } from '@/lib/work-types';
import PropertiesMap from './PropertiesMap';
import { ProspectsPanel } from '@/components/projections/ProspectsPanel';
import type { ReactNode } from 'react';

export const dynamic = 'force-dynamic';
export const revalidate = 60;

type WorkCounts = { total: number; ownerAction: number };

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

/**
 * Pulls every active work slip with just (property_id, owner_action_required)
 * and rolls up to a {property_id: { total, ownerAction }} map. One round
 * trip is fine — we have ~12 properties and at most a few dozen slips
 * per. If this ever grows we can swap to a server-side aggregation.
 */
async function getWorkCountsByProperty(): Promise<Record<string, WorkCounts>> {
  if (!isHelmConfigured) return {};
  try {
    const todayIso = new Date().toISOString().slice(0, 10);
    const { data, error } = await supabase
      .from('work_slips')
      .select('property_id, owner_action_required')
      .in('status', ACTIVE_WORK_SLIP_STATUSES)
      .or(`snoozed_until.is.null,snoozed_until.lte.${todayIso}`);
    if (error) throw error;

    const counts: Record<string, WorkCounts> = {};
    for (const row of (data ?? []) as Array<{ property_id: string; owner_action_required: boolean }>) {
      const c = counts[row.property_id] ?? { total: 0, ownerAction: 0 };
      c.total += 1;
      if (row.owner_action_required) c.ownerAction += 1;
      counts[row.property_id] = c;
    }
    return counts;
  } catch {
    return {};
  }
}

export default async function PropertiesPage({
  searchParams,
}: {
  searchParams?: Promise<{ view?: string }>;
}) {
  // The Properties index is two tabs over the same lifecycle: Properties (the
  // managed roster + map) and Prospects (the deal funnel, reused verbatim from
  // the standalone /projections page). Tab state lives in ?view= so each tab
  // is deep-linkable and only the active tab's data is fetched.
  const view = (await searchParams)?.view === 'prospects' ? 'prospects' : 'properties';

  let heroEmphasis = 'properties.';
  let heroDescription: string | undefined;
  let body: ReactNode;

  if (view === 'prospects') {
    heroEmphasis = 'prospects.';
    heroDescription = 'The prospect funnel, in one place.';
    body = <ProspectsPanel />;
  } else {
    const [{ properties, error }, workCounts] = await Promise.all([
      getProperties(),
      getWorkCountsByProperty(),
    ]);
    const active = properties.filter((p) => p.is_active);
    const inactive = properties.filter((p) => !p.is_active);
    heroDescription = !error
      ? `${active.length} active${inactive.length ? `, ${inactive.length} inactive` : ''}. Helm-native data.`
      : undefined;
    body = (
      <>
        {/* Cross-listing Stay Cape Ann tools. */}
        <div
          className="max-w-[1100px] mx-auto px-10 w-full"
          style={{ paddingBottom: 18, display: 'flex', gap: 20, flexWrap: 'wrap' }}
        >
          <Link
            href="/properties/listing-copy-studio"
            style={{ fontSize: 12, color: 'var(--tide-deep)', textDecoration: 'none', letterSpacing: '.03em' }}
          >
            Stay Cape Ann listing copy →
          </Link>
          <Link
            href="/properties/bedroom-photos"
            style={{ fontSize: 12, color: 'var(--tide-deep)', textDecoration: 'none', letterSpacing: '.03em' }}
          >
            Bedroom photos →
          </Link>
        </div>

        {/* MAP — geographic portfolio view above the list. Click a pin to
            surface a card with property name + slip count + Open link. */}
        {!error && active.length > 0 && (
          <section
            className="max-w-[1100px] mx-auto px-10"
            style={{ width: '100%', paddingBottom: 28 }}
          >
            <PropertiesMap properties={active} workCounts={workCounts} />
          </section>
        )}

        {/* LIST */}
        <section className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 80, flex: 1, width: '100%' }}>
          {error ? (
            <ErrorBlock error={error} />
          ) : properties.length === 0 ? (
            <EmptyBlock />
          ) : (
            <>
              {/* Single column. The 2-column md:grid-cols-2 layout looked
                  tidy in theory but PropertyRow's internal 5-col grid
                  (64px 1fr auto auto auto) was designed for the full
                  container width - at half width the auto cols squeezed
                  the subtitle and meta into truncated, wrapping mess. The
                  map up top is doing the portfolio overview job; the
                  list below just needs to be a clean lookup with room
                  to breathe. */}
              <div style={{ borderTop: '1px solid var(--ink)' }}>
                {active.map((p, i) => (
                  <PropertyRow
                    key={p.id}
                    property={p}
                    number={String(i + 1).padStart(2, '0')}
                    workCounts={workCounts[p.id]}
                  />
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
                        workCounts={workCounts[p.id]}
                        dimmed
                      />
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </section>
      </>
    );
  }

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead current="work" />
      <WorkTabs current="properties" />

      <HelmHero
        eyebrow="Helm · Properties"
        title="All Rising Tide"
        emphasis={heroEmphasis}
        description={heroDescription}
      />

      <PropertiesTabBar active={view} />

      {body}

      <HelmFooter module="Properties" right="Source: Helm" />
    </div>
  );
}

/** Two-tab switch over the Properties index: the managed roster and the
 *  prospect funnel. Server-rendered Links (no client JS) so each tab is a
 *  plain deep-linkable URL. Styled to match the property detail tab bar. */
function PropertiesTabBar({ active }: { active: 'properties' | 'prospects' }) {
  const tabs = [
    { id: 'properties' as const, label: 'Properties', href: '/properties' },
    { id: 'prospects' as const, label: 'Prospects', href: '/properties?view=prospects' },
  ];
  return (
    <nav aria-label="Properties sections" style={{ borderBottom: '1px solid var(--ink)', marginBottom: 28 }}>
      <div className="max-w-[1100px] mx-auto px-10" style={{ display: 'flex', gap: 4 }}>
        {tabs.map((t) => {
          const on = t.id === active;
          return (
            <Link
              key={t.id}
              href={t.href}
              aria-current={on ? 'page' : undefined}
              style={{
                borderBottom: on ? '2px solid var(--ink)' : '2px solid transparent',
                margin: '0 0 -1px',
                padding: '14px 14px 12px',
                fontSize: 11,
                letterSpacing: '.18em',
                textTransform: 'uppercase',
                fontWeight: on ? 600 : 500,
                color: on ? 'var(--ink)' : 'var(--ink-3)',
                textDecoration: 'none',
              }}
            >
              {t.label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

function PropertyRow({
  property: p,
  number,
  workCounts,
  dimmed = false,
}: {
  property: HelmPropertyRow;
  number: string;
  workCounts?: WorkCounts;
  dimmed?: boolean;
}) {
  // Internal naming convention: show the short address-without-suffix
  // primary, and the external "Stay at ..." marketing title as a quieter
  // secondary label when present.
  const display = p.name;
  const subtitle = p.title || p.address;
  const totalWork = workCounts?.total ?? 0;
  const ownerActionWork = workCounts?.ownerAction ?? 0;

  return (
    <Link
      href={`/properties/${p.id}`}
      style={{ display: 'block', textDecoration: 'none', color: 'inherit', opacity: dimmed ? 0.5 : 1 }}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '64px 1fr auto auto auto',
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
          style={{
            display: 'flex',
            gap: 6,
            alignItems: 'baseline',
            whiteSpace: 'nowrap',
          }}
        >
          {ownerActionWork > 0 && (
            <span
              title={`${ownerActionWork} open work slip${ownerActionWork === 1 ? '' : 's'} flagged for owner input`}
              style={{
                fontSize: 9, fontWeight: 600, letterSpacing: '.16em', textTransform: 'uppercase',
                color: 'var(--paper)',
                background: 'var(--signal)',
                padding: '2px 7px',
              }}
            >
              {ownerActionWork} owner
            </span>
          )}
          {totalWork > 0 && (
            <span
              title={`${totalWork} active work slip${totalWork === 1 ? '' : 's'}`}
              style={{
                fontSize: 9, fontWeight: 600, letterSpacing: '.16em', textTransform: 'uppercase',
                color: 'var(--ink-3)',
                border: '1px solid var(--rule)',
                padding: '2px 7px',
              }}
            >
              {totalWork} {totalWork === 1 ? 'slip' : 'slips'}
            </span>
          )}
        </span>
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
