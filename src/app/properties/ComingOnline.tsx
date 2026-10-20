import Link from 'next/link';
import {
  LAUNCH_PHASES,
  LAUNCH_WHO_LABELS,
  launchBoardGroup,
  openStepTitle,
  requiredOpenSteps,
  type LaunchStep,
} from '@/lib/launch-checklist';
import type { LaunchLoad } from '@/lib/launch-context';
import type { HelmPropertyRow } from '@/lib/properties';

/**
 * Coming online: every home carrying a Launch list, on the Properties roster.
 *
 * This used to be its own page, /properties/onboarding, under a tab named
 * Onboarding beside a 108-item Setup catalog also called onboarding, an owner
 * intake form called onboarding and a Go-live gates fold. It is now one
 * section above the roster, and the 26-step list it summarizes is called
 * Launch everywhere. The old route redirects here.
 *
 * Everything comes from the same loader and resolver each home's Launch page
 * and the property chip use (src/lib/launch-context.ts), so a count here is
 * the count on the page it links to. Complete homes are not listed: nothing
 * on them is coming online. Homes that never carried a Launch list
 * (onboarded before it existed) are not tracked.
 */

type Row = { p: Pick<HelmPropertyRow, 'id' | 'name' | 'owner_last' | 'created_at' | 'activated_at'>; load: LaunchLoad; flags: string[] };

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
    flags.push('Book page does not resolve yet; ask Systems for the roster entry.');
  }
  if (open.has('guesty_listing_match') && !load.ctx.property.guesty_listing_id) {
    flags.push('No Guesty listing id on the record: syncs cannot attribute its reservations.');
  }
  return flags;
}

export function ComingOnline({
  properties,
  loads,
}: {
  properties: ReadonlyArray<Row['p']>;
  loads: Map<string, LaunchLoad>;
}) {
  const rows: Row[] = properties
    .map((p) => {
      const load = loads.get(p.id);
      return load ? { p, load, flags: attentionFlags(load) } : null;
    })
    .filter((r): r is Row => r !== null);

  // Only homes with Launch rows are tracked: homes onboarded before the list
  // existed never got rows and would otherwise sit "in flight" forever. The
  // same rule the property page uses for its Launch chip.
  const groupOf = (r: Row) => launchBoardGroup(r.load.rows.length > 0, r.load.summary);
  const inFlight = rows.filter((r) => groupOf(r) === 'in_flight');
  const looseEnds = rows.filter((r) => groupOf(r) === 'loose_ends');
  if (inFlight.length === 0 && looseEnds.length === 0) return null;

  return (
    <section
      id="coming-online"
      className="max-w-[1100px] mx-auto px-10"
      style={{ width: '100%', paddingBottom: 40, scrollMarginTop: 100 }}
    >
      <style>{`
        @media (max-width: 640px) {
          .rt-coming-online-row { grid-template-columns: minmax(0, 1fr) !important; gap: 10px !important; }
          .rt-coming-online-row > :last-child { text-align: left !important; }
        }
      `}</style>
      <div className="flex items-baseline justify-between" style={{ gap: 12, flexWrap: 'wrap', borderBottom: '1px solid var(--ink)', paddingBottom: 10 }}>
        <h2 className="font-serif" style={{ fontSize: 24, fontWeight: 400, letterSpacing: '-0.01em', margin: 0, color: 'var(--ink)' }}>
          Coming online
        </h2>
        <div style={{ display: 'flex', gap: 16, alignItems: 'baseline', flexWrap: 'wrap' }}>
          <span className="eyebrow">
            {inFlight.length} in flight · {looseEnds.length} live with loose ends
          </span>
          <Link href="/playbook/onboard-a-new-property" style={{ fontSize: 13, color: 'var(--tide-deep)', textDecoration: 'none' }}>
            How we bring a home online →
          </Link>
        </div>
      </div>

      {inFlight.length === 0 ? (
        <div style={{ padding: '14px 0', fontSize: 13, color: 'var(--ink-4)' }}>Nothing in flight.</div>
      ) : (
        <div>
          {inFlight.map((r) => (
            <HomeRow key={r.p.id} row={r} />
          ))}
        </div>
      )}

      {looseEnds.length > 0 && (
        <details style={{ marginTop: 6 }}>
          <summary
            style={{
              cursor: 'pointer',
              listStyle: 'none',
              padding: '14px 0',
              borderBottom: '1px solid var(--rule)',
              display: 'flex',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              gap: 12,
              flexWrap: 'wrap',
            }}
          >
            <span className="font-serif" style={{ fontSize: 17, color: 'var(--ink)' }}>
              Live, with loose ends <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>{looseEnds.length}</span>
            </span>
          </summary>
          <div>
            {looseEnds.map((r) => (
              <HomeRow key={r.p.id} row={r} requiredOnly />
            ))}
          </div>
        </details>
      )}
    </section>
  );
}

function HomeRow({ row, requiredOnly }: { row: Row; requiredOnly?: boolean }) {
  const { p, load, flags } = row;
  const openRequired = requiredOnly ? requiredOpenSteps(load.effective) : [];
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
      className="rt-coming-online-row"
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1.3fr) minmax(0, 1.6fr) auto',
        gap: 24,
        alignItems: 'start',
        padding: '18px 0',
        borderBottom: '1px solid var(--rule)',
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
        {!requiredOnly && (
          <>
            <div style={{ marginTop: 12, height: 4, background: 'var(--rule)', position: 'relative', overflow: 'hidden', maxWidth: 260 }}>
              <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${pct}%`, background: live ? 'var(--positive)' : 'var(--ink)' }} />
            </div>
            <div style={{ marginTop: 6, fontSize: 11, color: 'var(--ink-4)', letterSpacing: '.04em' }}>
              Launch <span className="font-mono">{done} of {total}</span>
              {requiredRemaining > 0 && (
                <>
                  {' · '}
                  <span style={{ color: 'var(--signal)' }}>{requiredRemaining} required open</span>
                </>
              )}
            </div>
          </>
        )}
      </div>

      <div style={{ minWidth: 0 }}>
        {requiredOnly ? (
          <RequiredOpen steps={openRequired} propertyId={p.id} />
        ) : next ? (
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
          Open Launch →
        </Link>
      </div>
    </div>
  );
}

/** A live home's loose ends: every required step still open, each a link to
 *  its card on the Launch page. */
function RequiredOpen({ steps, propertyId }: { steps: LaunchStep[]; propertyId: string }) {
  return (
    <div>
      <div style={{ fontSize: 10, letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>
        Required, still open · {steps.length}
      </div>
      <ul style={{ margin: '6px 0 0', padding: 0, listStyle: 'none', display: 'grid', gap: 4 }}>
        {steps.map((step) => (
          <li key={step.key} style={{ fontSize: 13.5, lineHeight: 1.4 }}>
            <Link href={`/properties/${propertyId}/launch#step-${step.key}`} style={{ color: 'var(--ink)', textDecoration: 'none' }}>
              {openStepTitle(step)}
            </Link>
            <span style={{ marginLeft: 8, fontSize: 11, color: 'var(--ink-4)', letterSpacing: '.04em' }}>
              {LAUNCH_WHO_LABELS[step.who]}
            </span>
          </li>
        ))}
      </ul>
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
        {openStepTitle(step)}
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
