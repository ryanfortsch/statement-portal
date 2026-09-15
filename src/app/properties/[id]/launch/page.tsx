import Link from 'next/link';
import { notFound } from 'next/navigation';
import { HelmMasthead } from '@/components/HelmMasthead';
import { HelmBreadcrumb } from '@/components/HelmBreadcrumb';
import { supabaseAdmin as supabase, isServiceConfigured as isHelmConfigured } from '@/lib/supabase-admin';
import type { HelmPropertyRow } from '@/lib/properties';
import {
  LAUNCH_STEPS,
  LAUNCH_PHASES,
  LAUNCH_WHO_LABELS,
  type LaunchStepRow,
} from '@/lib/launch-checklist';
import { loadLaunchForProperty } from '@/lib/launch-context';
import { ensureLaunchStepsSeeded } from './actions';
import { LaunchStepCard } from './LaunchStepCard';
import { StripeAccountCheck } from './StripeAccountCheck';

export const dynamic = 'force-dynamic';

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

type Params = { id: string };

/**
 * Per-property launch checklist. The post-promotion staging area where every
 * integration the property needs (Quo cleaner, Guesty cleaning automation,
 * Seam lock, Guesty match, PriceLabs, bank last4, listing copy, Airbnb live,
 * the code roster) gets wired before the property is truly operational.
 *
 * The canonical step list lives in src/lib/launch-checklist.ts. Rows in
 * property_launch_steps persist status + audit per (property_id, step_key).
 * promoteToProperty seeds them; this page calls ensureLaunchStepsSeeded as
 * a backstop so a property whose seed was skipped (or whose step list grew)
 * still shows every step.
 *
 * Derived state comes from src/lib/launch-context.ts, the one loader the
 * property-page chip and the fleet onboarding board share, so every surface
 * shows the same count and the same "next up".
 */
export default async function PropertyLaunchPage({ params }: { params: Promise<Params> }) {
  const { id } = await params;
  const p = await getProperty(id);
  if (!p) notFound();

  // Backstop seed: if this property was created before the launch checklist
  // existed, or if new steps have been added to LAUNCH_STEPS since the
  // initial seed, fill in any missing rows. Idempotent — never overwrites.
  await ensureLaunchStepsSeeded(p.id);
  const load = await loadLaunchForProperty(p);
  const { effective, summary, facts } = load;
  const byKey = new Map<string, LaunchStepRow>();
  for (const row of load.rows) byKey.set(row.step_key, row);
  const effectiveByKey = new Map(effective.map((e) => [e.step.key, e]));

  const { done, total, requiredRemaining, next, live, canActivate } = summary;
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);
  const nextPhase = next ? LAUNCH_PHASES.find((ph) => ph.key === next.phase) : null;

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead />

      <HelmBreadcrumb
        trail={[
          { label: 'Onboarding', href: '/properties/onboarding' },
          { label: p.name, href: `/properties/${p.id}` },
          { label: 'Launch checklist' },
        ]}
      />

      <section className="max-w-[900px] mx-auto px-10" style={{ paddingTop: 24, paddingBottom: 14, width: '100%' }}>
        <div className="eyebrow" style={{ marginBottom: 14 }}>Launch checklist</div>
        <h1
          className="font-serif"
          style={{ fontSize: 40, lineHeight: 1.05, fontWeight: 300, letterSpacing: '-0.02em', color: 'var(--ink)' }}
        >
          Bring {p.name} online
        </h1>
        <p style={{ marginTop: 12, fontSize: 14, color: 'var(--ink-3)', maxWidth: 620, lineHeight: 1.6 }}>
          Every integration the property needs to operate, in one place, in order. Each step says who
          does it: Ops works the tools, Systems is a Helm change to ask for. Steps Helm can see for
          itself tick on their own; the rest are yours to mark. Skip what does not apply and leave a
          note when something needs follow-up.
        </p>
        <div style={{ marginTop: 10 }}>
          <Link
            href="/properties/onboarding"
            style={{ fontSize: 12, color: 'var(--tide-deep)', textDecoration: 'none', letterSpacing: '.03em' }}
          >
            All homes onboarding →
          </Link>
        </div>

        {/* Progress strip */}
        <div style={{ marginTop: 22, padding: '16px 18px', border: '1px solid var(--rule)', background: 'var(--paper-2, #f5f1e7)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 16 }}>
            <div>
              <div style={{ fontSize: 11, letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>
                Progress
              </div>
              <div className="font-serif" style={{ fontSize: 28, fontWeight: 400, color: 'var(--ink)', marginTop: 4 }}>
                {done} <span style={{ color: 'var(--ink-3)' }}>of {total}</span>
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: 11, letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>
                Required remaining
              </div>
              <div
                className="font-serif"
                style={{
                  fontSize: 28,
                  fontWeight: 400,
                  marginTop: 4,
                  color: requiredRemaining === 0 ? 'var(--ink)' : 'var(--signal, #c85a3a)',
                }}
              >
                {requiredRemaining}
              </div>
            </div>
          </div>
          <div
            style={{
              marginTop: 14,
              height: 4,
              background: 'var(--rule)',
              position: 'relative',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                bottom: 0,
                width: `${pct}%`,
                background: 'var(--ink)',
                transition: 'width 200ms ease',
              }}
            />
          </div>

          {/* Next up: the one thing to do now. The first open required step in
              checklist order; the gate once everything else is resolved. */}
          <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid var(--rule)' }}>
            <div style={{ fontSize: 11, letterSpacing: '.18em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>
              Next up
            </div>
            {next ? (
              <div style={{ marginTop: 6, display: 'flex', gap: 12, alignItems: 'baseline', flexWrap: 'wrap' }}>
                <a
                  href={`#step-${next.key}`}
                  className="font-serif"
                  style={{ fontSize: 20, color: 'var(--ink)', textDecoration: 'none' }}
                >
                  {next.title} ↓
                </a>
                <span style={{ fontSize: 11.5, color: 'var(--ink-4)', letterSpacing: '.04em' }}>
                  {nextPhase?.label ?? ''} · {LAUNCH_WHO_LABELS[next.who]}
                </span>
              </div>
            ) : (
              <div className="font-serif" style={{ marginTop: 6, fontSize: 20, color: 'var(--positive)' }}>
                {live ? 'Live. Nothing required is open.' : 'Everything required is resolved.'}
              </div>
            )}
            {live && p.activated_at && (
              <div style={{ marginTop: 6, fontSize: 12, color: 'var(--ink-3)' }}>
                Went live {fmtDate(p.activated_at)}.
              </div>
            )}
            {live && !p.activated_at && facts.firstStayCheckIn && (
              <div style={{ marginTop: 6, fontSize: 12, color: 'var(--ink-3)' }}>
                First guest checked in {fmtDate(facts.firstStayCheckIn)}; press Activate below to put the go-live date on record.
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="max-w-[900px] mx-auto px-10" style={{ paddingBottom: 80, width: '100%' }}>
        {LAUNCH_PHASES.map((phase, i) => {
          const phaseSteps = LAUNCH_STEPS.filter((s) => s.phase === phase.key);
          if (phaseSteps.length === 0) return null;
          const phaseDone = phaseSteps.filter((s) => effectiveByKey.get(s.key)?.resolved).length;
          return (
            <PhaseSection
              key={phase.key}
              num={String(i + 1).padStart(2, '0')}
              label={phase.label}
              blurb={phase.blurb}
              done={phaseDone}
              total={phaseSteps.length}
            >
              {phaseSteps.map((step) => (
                <LaunchStepCard
                  key={step.key}
                  propertyId={p.id}
                  propertyName={p.name}
                  step={step}
                  row={byKey.get(step.key) ?? null}
                  autoResolved={effectiveByKey.get(step.key)?.auto ?? false}
                  fieldValue={launchFieldValue(step.action, p)}
                  nextUp={next?.key === step.key}
                  canActivate={step.gate ? canActivate : undefined}
                  activatedAt={step.gate ? (p.activated_at ?? null) : undefined}
                />
              ))}
              {/* Stripe account-identity check rides the Financial phase:
                  it verifies the stripe_auto_payouts step's key reaches the
                  RIGHT account (3 Windward's was minted from the wrong one
                  and synced clean at 0 charges). Read-only diagnostic. */}
              {phase.key === 'financial' && <StripeAccountCheck propertyId={p.id} />}
            </PhaseSection>
          );
        })}
      </section>
    </div>
  );
}

/** "2026-07-01" or an ISO timestamp -> "Jul 1, 2026" (UTC so the day never shifts). */
function fmtDate(iso: string): string {
  const d = iso.length <= 10 ? new Date(`${iso}T12:00:00Z`) : new Date(iso);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

/** Current value of the property column a `set_*` step writes through to,
 *  so the card can prefill its inline editor. Returns undefined for
 *  non-field steps. */
function launchFieldValue(
  action: import('@/lib/launch-checklist').LaunchStep['action'],
  p: HelmPropertyRow,
): string | null | undefined {
  switch (action) {
    case 'set_external_title':
      return p.title ?? null;
    case 'set_tax_cert':
      return p.tax_cert_id ?? null;
    case 'set_bank_last4':
      return p.bank_last4 ?? null;
    case 'set_listing_match':
      return (p as { listing_match?: string | null }).listing_match ?? null;
    default:
      return undefined;
  }
}

/**
 * Phase divider + container. Renders the phase number / serif label /
 * blurb on the left and a chip-style "N / total" progress count on the
 * right, with a hairline rule underneath. The chip flips positive once
 * every step in the phase is resolved so a glance down the page tells
 * you which phases are still in flight.
 */
function PhaseSection({
  num,
  label,
  blurb,
  done,
  total,
  children,
}: {
  num: string;
  label: string;
  blurb: string;
  done: number;
  total: number;
  children: React.ReactNode;
}) {
  const allDone = done >= total && total > 0;
  return (
    <section style={{ marginTop: 44 }}>
      <header
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr auto',
          alignItems: 'baseline',
          gap: 20,
          paddingBottom: 14,
          borderBottom: `1px solid ${allDone ? 'var(--positive)' : 'var(--ink)'}`,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div
            className="eyebrow"
            style={{
              fontSize: 10,
              letterSpacing: '.22em',
              color: 'var(--ink-4)',
              marginBottom: 6,
            }}
          >
            Phase {num}
          </div>
          <h2
            className="font-serif"
            style={{
              fontSize: 22,
              fontWeight: 400,
              letterSpacing: '-0.01em',
              color: 'var(--ink)',
              margin: 0,
              lineHeight: 1.15,
            }}
          >
            {label}
          </h2>
          <div style={{ marginTop: 4, fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.5 }}>
            {blurb}
          </div>
        </div>
        <div
          aria-label={`${done} of ${total} resolved`}
          style={{
            display: 'inline-flex',
            alignItems: 'baseline',
            gap: 6,
            padding: '6px 12px',
            border: `1px solid ${allDone ? 'var(--positive)' : 'var(--rule)'}`,
            background: allDone ? 'rgba(47, 122, 58, 0.08)' : 'var(--paper)',
            color: allDone ? 'var(--positive)' : 'var(--ink-3)',
            fontSize: 11,
            letterSpacing: '0.06em',
            fontWeight: 500,
            whiteSpace: 'nowrap',
          }}
        >
          <span
            style={{
              fontFamily: 'var(--font-mono-dash), ui-monospace, monospace',
              fontWeight: 700,
              color: allDone ? 'var(--positive)' : 'var(--ink)',
              letterSpacing: '0.02em',
            }}
          >
            {done}/{total}
          </span>
          <span style={{ fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase' }}>
            {allDone ? 'Complete' : 'Resolved'}
          </span>
        </div>
      </header>
      <div>{children}</div>
    </section>
  );
}
