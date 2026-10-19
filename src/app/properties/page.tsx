import Link from 'next/link';
import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmHero } from '@/components/HelmHero';
import { HelmFooter } from '@/components/HelmFooter';
import { supabaseAdmin as supabase, isServiceConfigured as isHelmConfigured } from '@/lib/supabase-admin';
import type { HelmPropertyRow } from '@/lib/properties';
import { loadLaunchForFleet, type LaunchLoad } from '@/lib/launch-context';
import { openStepTitle, type LaunchSummary } from '@/lib/launch-checklist';
import { ComingOnline } from './ComingOnline';
import { AddProspectHomeForm } from './AddProspectHomeForm';
import { HashOpenScript } from '@/components/properties/HashOpenScript';
import { ACTIVE_WORK_SLIP_STATUSES } from '@/lib/work-types';
import PropertiesMap from './PropertiesMap';
import { PropertiesTabBar } from './PropertiesTabBar';
import { isOwnerSession } from '@/lib/helm-access-server';
import { operatingDate } from '@/lib/operating-date';

export const dynamic = 'force-dynamic';
export const revalidate = 60;

type WorkCounts = { total: number; ownerAction: number };

async function getProperties(): Promise<{ properties: HelmPropertyRow[]; error: string | null }> {
  if (!isHelmConfigured) {
    return { properties: [], error: 'Ask Ryan: this page is not set up.' };
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
    const todayIso = operatingDate();
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

export default async function PropertiesPage() {
  // The fee percentage on each row is owner money; staff see the roster
  // without it.
  const owner = await isOwnerSession();
  // The Properties index is the managed roster + map. Its sibling route
  // /properties/prospects carries the deal funnel; the tab bar below
  // switches between the two real URLs.
  const [{ properties, error }, workCounts] = await Promise.all([
    getProperties(),
    getWorkCountsByProperty(),
  ]);
  /**
   * Fleet readiness, one row per property, and the Coming online section
   * above the list (the old /properties/onboarding board, folded in).
   *
   * This is load-bearing now rather than nice to have: the property page's
   * Setup tab retires itself once a house is established (#1617), so a
   * stalled half-onboarded home has nowhere else to be visible. This is
   * that somewhere. Failures degrade to an empty map and no pills, never to
   * a blank roster.
   */
  const managedActive = properties.filter((p) => p.is_active && p.kind === 'managed');
  const launchByProperty = await loadLaunchForFleet(managedActive).catch(() => new Map<string, LaunchLoad>());
  const active = properties.filter((p) => p.is_active);
  // Non-managed work locations (HQ, prospect homes) ride is_active=false but
  // aren't "inactive rentals" — count them by what they are.
  const inactive = properties.filter((p) => !p.is_active);
  const prospectCount = inactive.filter((p) => p.kind === 'prospect').length;
  const inactiveManaged = inactive.filter((p) => p.kind === 'managed').length;
  const countLine = !error
    ? `${active.length} active${prospectCount ? `, ${prospectCount} ${prospectCount === 1 ? 'prospect' : 'prospects'}` : ''}${inactiveManaged ? `, ${inactiveManaged} inactive` : ''}.`
    : undefined;

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead />

      <HelmHero plain eyebrow="Helm · Properties" title="Properties" line={countLine} />

      <PropertiesTabBar active="properties" />

      {/* Every home's Stay Cape Ann launcher, one list (read-only). */}
      <div
        className="max-w-[1100px] mx-auto px-10 w-full"
        style={{ paddingBottom: 18, display: 'flex', gap: 20, flexWrap: 'wrap' }}
      >
        <Link
          href="/properties/stay-cape-ann"
          style={{ fontSize: 12, color: 'var(--tide-deep)', textDecoration: 'none', letterSpacing: '.03em' }}
        >
          Stay Cape Ann listings →
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

      {/* COMING ONLINE: the homes carrying a Launch list, above the roster. */}
      {!error && <ComingOnline properties={managedActive} loads={launchByProperty} />}

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
                  launch={launchByProperty.get(p.id)?.summary}
                  owner={owner}
                />
              ))}
            </div>

            {inactive.length > 0 && (
              <div style={{ marginTop: 56 }}>
                <div className="eyebrow" style={{ marginBottom: 18 }}>
                  {inactive.some((p) => p.kind !== 'managed') ? 'Prospects, HQ & inactive' : 'Inactive'}
                </div>
                <div style={{ borderTop: '1px solid var(--rule)' }}>
                  {inactive.map((p, i) => (
                    <PropertyRow
                      key={p.id}
                      property={p}
                      number={String(i + 1).padStart(2, '0')}
                      workCounts={workCounts[p.id]}
                      owner={owner}
                      dimmed
                    />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
        {/* A home we may sign is a properties row (kind 'prospect'), so it
            is added here, beside the roster it will join. The deal funnel
            at /properties/prospects is projections only. */}
        {!error && <AddProspectHomeForm />}
      </section>

      <HelmFooter module="Properties" right="Source: Helm" />

      {/* /properties/onboarding and the Launch breadcrumb land on
          #coming-online, which sits under the map: scroll there on arrival. */}
      <HashOpenScript />
    </div>
  );
}

function PropertyRow({
  property: p,
  number,
  workCounts,
  launch,
  owner,
  dimmed = false,
}: {
  property: HelmPropertyRow;
  /** Owner session: the row shows the management fee. */
  owner: boolean;
  number: string;
  workCounts?: WorkCounts;
  /** Undefined for anything not loaded (inactive, HQ, prospects) or on a
   *  failed load: no pill rather than a wrong one. */
  launch?: LaunchSummary;
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
        className="rt-property-list-row"
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
          {/* Readiness. Only shown while a home is still being set up: a
              live property wearing a progress chip forever is the habit the
              old 27%% badge taught, and the whole point of retiring Setup
              was to stop it. */}
          {launch && !launch.live && (
            <span
              title={
                launch.requiredRemaining > 0
                  ? `${launch.requiredRemaining} required Launch step${launch.requiredRemaining === 1 ? '' : 's'} open${launch.next ? `. Next: ${openStepTitle(launch.next)}` : ''}`
                  : 'All required Launch steps are done; not yet marked live'
              }
              style={{
                fontSize: 9, fontWeight: 600, letterSpacing: '.16em', textTransform: 'uppercase',
                color: launch.requiredRemaining > 0 ? 'var(--paper)' : 'var(--positive)',
                background: launch.requiredRemaining > 0 ? 'var(--tide-deep)' : 'transparent',
                border: launch.requiredRemaining > 0 ? 'none' : '1px solid var(--positive)',
                padding: '2px 7px',
              }}
            >
              {launch.requiredRemaining > 0 ? `launch ${launch.done}/${launch.total}` : 'ready'}
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
          {p.is_active ? (owner ? `${p.management_fee_pct}% →` : 'Managed →') : p.kind === 'hq' ? 'HQ' : p.kind === 'prospect' ? 'Prospect' : 'Inactive'}
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
        Ask Ryan: the property registry is not set up yet.
      </p>
    </div>
  );
}
