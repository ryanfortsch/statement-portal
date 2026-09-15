import Link from 'next/link';
import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmHero } from '@/components/HelmHero';
import { HelmFooter } from '@/components/HelmFooter';
import { Stat } from '@/components/Stat';
import { supabaseAdmin as supabase, isServiceConfigured as isHelmConfigured } from '@/lib/supabase-admin';
import { LAUNCH_PHASES, LAUNCH_WHO_LABELS, type LaunchStep } from '@/lib/launch-checklist';
import { loadLaunchForFleet, type LaunchLoad, type LaunchPropertyLite } from '@/lib/launch-context';
import { PropertiesTabBar } from '../PropertiesTabBar';

export const dynamic = 'force-dynamic';

/**
 * Fleet onboarding board. One row per home that has a launch checklist:
 * where it is, what is next and who owns it, and the loose ends on homes
 * that are already live. The launch page is per property; this is the
 * view the team asked for when they said "we need a checklist": the one
 * place that says which homes are in flight and what is blocking each.
 *
 * Everything here comes from the same loader and resolver the launch page
 * and the property chip use (src/lib/launch-context.ts), so a count on
 * this board is the count on the page it links to.
 */

type BoardProperty = LaunchPropertyLite & {
  name: string;
  owner_last: string | null;
  created_at: string | null;
};

async function getManagedProperties(): Promise<BoardProperty[]> {
  if (!isHelmConfigured) return [];
  try {
    const { data, error } = await supabase
      .from('properties')
      .select(
        'id, name, owner_last, created_at, title, owner_full, owner_emails, owner_phone, management_fee_pct, bank_last4, tax_cert_id, guesty_listing_id, is_active, activated_at',
      )
      .eq('kind', 'managed')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return (data ?? []) as BoardProperty[];
  } catch {
    return [];
  }
}

type BoardRow = { p: BoardProperty; load: LaunchLoad; flags: string[] };

/**
 * The things on this home worth a second look even before its next step:
 * risk that is time-sensitive (bookings landing while the cleaner
 * automation is unconfirmed), or a symptom Helm can read (a flat price).
 */
function attentionFlags(load: LaunchLoad): string[] {
  const flags: string[] = [];
  const open = new Set(load.effective.filter((e) => !e.resolved).map((e) => e.step.key));
  if (open.has('guesty_cleaning_automation') && load.facts.upcomingStays > 0) {
    flags.push(
      `${load.facts.upcomingStays} upcoming ${load.facts.upcomingStays === 1 ? 'stay' : 'stays'} and the Guesty cleaning automation is unconfirmed: the cleaners may not be hearing about bookings.`,
    );
  }
  if (open.has('pricing_flowing') && load.ctx.forwardDistinctPrices === 1) {
    flags.push('One flat nightly price across the next 60 days: PriceLabs is not pushing to this listing.');
  }
  if (open.has('code_roster_entry')) {
    flags.push('Not in the code roster (src/lib/properties.ts): /book page 404s, fallbacks skip it.');
  }
  if (open.has('guesty_listing_match') && !load.ctx.property.guesty_listing_id) {
    flags.push('No Guesty listing id on the record: syncs cannot attribute its reservations.');
  }
  return flags;
}

export default async function OnboardingBoardPage() {
  const properties = await getManagedProperties();
  const loads = await loadLaunchForFleet(properties);

  const rows: BoardRow[] = properties
    .map((p) => {
      const load = loads.get(p.id);
      return load ? { p, load, flags: attentionFlags(load) } : null;
    })
    .filter((r): r is BoardRow => r !== null);

  // Only homes with checklist rows are tracked: the nine homes onboarded
  // before the checklist existed never got rows and would otherwise show
  // as "in flight" forever on steps nobody is going to backfill.
  const tracked = rows.filter((r) => r.load.rows.length > 0);
  const untracked = rows.filter((r) => r.load.rows.length === 0);

  const inFlight = tracked.filter((r) => !r.load.summary.live);
  const looseEnds = tracked.filter((r) => r.load.summary.live && r.load.summary.requiredRemaining > 0);
  const complete = tracked.filter((r) => r.load.summary.live && r.load.summary.requiredRemaining === 0);
  const flagged = tracked.filter((r) => r.flags.length > 0).length;
  const openRequired = tracked.reduce((n, r) => n + r.load.summary.requiredRemaining, 0);

  const description =
    tracked.length === 0
      ? 'No home is carrying a launch checklist yet. Promote a prospect and it lands here.'
      : `${inFlight.length} in flight, ${looseEnds.length} live with open go-live steps, ${complete.length} complete. Same resolver as each home's launch page.`;

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead />
      <HelmHero
        eyebrow="Helm · Properties"
        title="Homes coming"
        emphasis="online."
        description={description}
      />
      <PropertiesTabBar active="onboarding" />

      <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 28 }}>
        <div style={{ borderTop: '1px solid var(--ink)', borderBottom: '1px solid var(--ink)' }}>
          <div className="rt-helm-stat-strip" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)' }}>
            <Stat label="In flight" value={inFlight.length} sub="not yet activated" />
            <Stat
              label="Live, loose ends"
              value={looseEnds.length}
              accent={looseEnds.length > 0}
              sub={looseEnds.length ? 'required steps still open' : 'all quiet'}
            />
            <Stat
              label="Needs a look"
              value={flagged}
              valueColor={flagged ? 'var(--negative)' : undefined}
              sub="bookings landing, flat prices, no roster entry"
            />
            <Stat label="Open required steps" value={openRequired} sub="across tracked homes" last />
          </div>
        </div>
      </section>

      <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 60, flex: 1 }}>
        <Group
          title="In flight"
          blurb="Promoted, not yet activated. The next step is the first open required step in checklist order."
          rows={inFlight}
          empty="Nothing in flight."
        />
        <Group
          title="Live, with loose ends"
          blurb="The first guest has already arrived, or the go-live date is stamped, but required steps were never confirmed. These are the gaps that bite later: the cleaner automation, pricing, the roster."
          rows={looseEnds}
          empty="Every live home has its required steps resolved."
        />
        <Group
          title="Complete"
          blurb="Live and nothing required is open."
          rows={complete}
          empty="No tracked home is fully resolved yet."
          muted
        />

        {untracked.length > 0 && (
          <div style={{ marginTop: 40, fontSize: 12, color: 'var(--ink-4)', lineHeight: 1.6, maxWidth: 720 }}>
            Not tracked here: {untracked.map((r) => r.p.name).join(', ')}. These homes were onboarded before the
            launch checklist existed. Opening a home&rsquo;s launch page seeds its rows and pulls it onto this board.
          </div>
        )}
      </section>

      <HelmFooter />
    </div>
  );
}

function Group({
  title,
  blurb,
  rows,
  empty,
  muted,
}: {
  title: string;
  blurb: string;
  rows: BoardRow[];
  empty: string;
  muted?: boolean;
}) {
  return (
    <section style={{ marginTop: 36 }}>
      <header style={{ paddingBottom: 12, borderBottom: '1px solid var(--ink)' }}>
        <h2
          className="font-serif"
          style={{ fontSize: 22, fontWeight: 400, letterSpacing: '-0.01em', margin: 0, lineHeight: 1.15, color: 'var(--ink)' }}
        >
          {title}
          <span style={{ marginLeft: 10, fontSize: 12, color: 'var(--ink-3)', fontFamily: 'var(--font-mono-dash), ui-monospace, monospace' }}>
            {rows.length}
          </span>
        </h2>
        <div style={{ marginTop: 4, fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.5, maxWidth: 720 }}>{blurb}</div>
      </header>
      {rows.length === 0 ? (
        <div style={{ padding: '18px 0', fontSize: 13, color: 'var(--ink-4)' }}>{empty}</div>
      ) : (
        <div>
          {rows.map((r) => (
            <HomeRow key={r.p.id} row={r} muted={muted} />
          ))}
        </div>
      )}
    </section>
  );
}

function HomeRow({ row, muted }: { row: BoardRow; muted?: boolean }) {
  const { p, load, flags } = row;
  const { done, total, requiredRemaining, next, live } = load.summary;
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  const nextPhase = next ? LAUNCH_PHASES.find((ph) => ph.key === next.phase)?.label : null;
  const liveLine = p.activated_at
    ? `Live since ${fmtDate(p.activated_at)}`
    : load.facts.firstStayCheckIn
      ? `First guest ${fmtDate(load.facts.firstStayCheckIn)}, go-live date not stamped`
      : p.created_at
        ? `Promoted ${fmtDate(p.created_at)}`
        : '';

  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1.3fr) minmax(0, 1.6fr) auto',
        gap: 24,
        alignItems: 'start',
        padding: '18px 0',
        borderBottom: '1px solid var(--rule)',
        opacity: muted ? 0.7 : 1,
      }}
    >
      <div style={{ minWidth: 0 }}>
        <Link
          href={`/properties/${p.id}/launch`}
          className="font-serif"
          style={{ fontSize: 20, color: 'var(--ink)', textDecoration: 'none', lineHeight: 1.15 }}
        >
          {p.name}
        </Link>
        <div style={{ marginTop: 4, fontSize: 12, color: 'var(--ink-3)' }}>
          {[p.owner_last, liveLine].filter(Boolean).join(' · ')}
        </div>
        <div style={{ marginTop: 12, height: 4, background: 'var(--rule)', position: 'relative', overflow: 'hidden', maxWidth: 260 }}>
          <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${pct}%`, background: live ? 'var(--positive)' : 'var(--ink)' }} />
        </div>
        <div style={{ marginTop: 6, fontSize: 11, color: 'var(--ink-4)', letterSpacing: '.04em' }}>
          <span className="font-mono">{done}/{total}</span> resolved
          {requiredRemaining > 0 && (
            <>
              {' · '}
              <span style={{ color: 'var(--signal)' }}>{requiredRemaining} required open</span>
            </>
          )}
        </div>
      </div>

      <div style={{ minWidth: 0 }}>
        {next ? (
          <NextStep step={next} phase={nextPhase ?? ''} propertyId={p.id} />
        ) : (
          <div style={{ fontSize: 13, color: 'var(--positive)' }}>Nothing required is open.</div>
        )}
        {flags.length > 0 && (
          <ul style={{ margin: '10px 0 0', padding: 0, listStyle: 'none', display: 'grid', gap: 6 }}>
            {flags.map((f) => (
              <li key={f} style={{ fontSize: 12, color: 'var(--negative)', lineHeight: 1.5, display: 'flex', gap: 8 }}>
                <span aria-hidden>!</span>
                <span>{f}</span>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
        <Link
          href={`/properties/${p.id}/launch`}
          style={{ fontSize: 12, color: 'var(--tide-deep)', textDecoration: 'none', letterSpacing: '.03em' }}
        >
          Open checklist →
        </Link>
      </div>
    </div>
  );
}

function NextStep({ step, phase, propertyId }: { step: LaunchStep; phase: string; propertyId: string }) {
  return (
    <div>
      <div style={{ fontSize: 10, letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>Next up</div>
      <Link
        href={`/properties/${propertyId}/launch#step-${step.key}`}
        style={{ display: 'inline-block', marginTop: 3, fontSize: 14, color: 'var(--ink)', textDecoration: 'none', lineHeight: 1.4 }}
      >
        {step.title}
      </Link>
      <div style={{ marginTop: 2, fontSize: 11.5, color: 'var(--ink-4)', letterSpacing: '.04em' }}>
        {phase} · {LAUNCH_WHO_LABELS[step.who]}
        {step.gate ? ' · activation gate' : ''}
      </div>
    </div>
  );
}

/** "2026-07-01" or an ISO timestamp -> "Jul 1, 2026" (UTC so the day never shifts). */
function fmtDate(iso: string): string {
  const d = iso.length <= 10 ? new Date(`${iso}T12:00:00Z`) : new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}
