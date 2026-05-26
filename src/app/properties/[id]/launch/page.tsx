import Link from 'next/link';
import { notFound } from 'next/navigation';
import { HelmMasthead } from '@/components/HelmMasthead';
import { supabase, isConfigured as isHelmConfigured } from '@/lib/supabase';
import type { HelmPropertyRow } from '@/lib/properties';
import {
  LAUNCH_STEPS,
  LAUNCH_PHASES,
  isStepResolved,
  type LaunchStepRow,
} from '@/lib/launch-checklist';
import { ensureLaunchStepsSeeded } from './actions';
import { LaunchStepCard } from './LaunchStepCard';

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

async function getLaunchSteps(propertyId: string): Promise<LaunchStepRow[]> {
  if (!isHelmConfigured) return [];
  try {
    const { data, error } = await supabase
      .from('property_launch_steps')
      .select('*')
      .eq('property_id', propertyId);
    if (error) throw error;
    return (data ?? []) as LaunchStepRow[];
  } catch {
    return [];
  }
}

type Params = { id: string };

/**
 * Per-property launch checklist. The post-promotion staging area where every
 * integration the property needs (Quo cleaner, Seam lock, Guesty match, bank
 * last4, listing copy, Airbnb live, etc.) gets wired before the property is
 * truly operational.
 *
 * The canonical step list lives in src/lib/launch-checklist.ts. Rows in
 * property_launch_steps persist status + audit per (property_id, step_key).
 * promoteToProperty seeds them; this page calls ensureLaunchStepsSeeded as
 * a backstop so a property whose seed was skipped (or whose step list grew)
 * still shows every step.
 *
 * PR 1 (this) renders the checklist with manual status + notes. PR 2 adds
 * the AI listing-copy generator. PR 3 adds the deep-link actions (inline
 * editors for listing_match / bank_last4, jump links to Quo + Seam, the
 * activation gate that flips is_active).
 */
export default async function PropertyLaunchPage({ params }: { params: Promise<Params> }) {
  const { id } = await params;
  const p = await getProperty(id);
  if (!p) notFound();

  // Backstop seed: if this property was created before the launch checklist
  // existed, or if new steps have been added to LAUNCH_STEPS since the
  // initial seed, fill in any missing rows. Idempotent — never overwrites.
  await ensureLaunchStepsSeeded(p.id);
  const rows = await getLaunchSteps(p.id);

  const byKey = new Map<string, LaunchStepRow>();
  for (const row of rows) byKey.set(row.step_key, row);

  // Progress count: any resolved (done | skipped | n_a) step counts. Required
  // remaining drives the headline "X required still to go" copy.
  let done = 0;
  let requiredRemaining = 0;
  for (const step of LAUNCH_STEPS) {
    const row = byKey.get(step.key);
    const resolved = isStepResolved(row?.status);
    if (resolved) done += 1;
    if (step.required && !step.gate && !resolved) requiredRemaining += 1;
  }
  const total = LAUNCH_STEPS.length;
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead current="properties" />

      <div className="max-w-[900px] mx-auto px-10" style={{ paddingTop: 24, width: '100%' }}>
        <Link
          href={`/properties/${p.id}`}
          style={{
            fontSize: 11,
            letterSpacing: '.18em',
            textTransform: 'uppercase',
            color: 'var(--ink-3)',
            textDecoration: 'none',
          }}
        >
          ← {p.name}
        </Link>
      </div>

      <section className="max-w-[900px] mx-auto px-10" style={{ paddingTop: 24, paddingBottom: 14, width: '100%' }}>
        <div className="eyebrow" style={{ marginBottom: 14 }}>Launch checklist</div>
        <h1
          className="font-serif"
          style={{ fontSize: 40, lineHeight: 1.05, fontWeight: 300, letterSpacing: '-0.02em', color: 'var(--ink)' }}
        >
          Bring {p.name} online
        </h1>
        <p style={{ marginTop: 12, fontSize: 14, color: 'var(--ink-3)', maxWidth: 620, lineHeight: 1.6 }}>
          The post-promotion checklist. Every integration the property needs to operate, in one
          place. Mark each step done as you wire it, skip what does not apply, and leave a note
          when something needs follow-up.
        </p>

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
        </div>
      </section>

      <section className="max-w-[900px] mx-auto px-10" style={{ paddingBottom: 80, width: '100%' }}>
        {LAUNCH_PHASES.map((phase) => {
          const phaseSteps = LAUNCH_STEPS.filter((s) => s.phase === phase.key);
          if (phaseSteps.length === 0) return null;
          const phaseDone = phaseSteps.filter((s) => isStepResolved(byKey.get(s.key)?.status)).length;
          return (
            <PhaseSection
              key={phase.key}
              label={phase.label}
              blurb={phase.blurb}
              done={phaseDone}
              total={phaseSteps.length}
            >
              {phaseSteps.map((step) => (
                <LaunchStepCard
                  key={step.key}
                  propertyId={p.id}
                  step={step}
                  row={byKey.get(step.key) ?? null}
                />
              ))}
            </PhaseSection>
          );
        })}

        <p style={{ marginTop: 36, fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.55 }}>
          Looking for an integration deep link or the AI listing-copy generator? Those land in the
          next launch-checklist iteration. For now, mark each step manually as you wire it through
          its existing surface (edit page, Quo, Seam, etc.).
        </p>
      </section>
    </div>
  );
}

function PhaseSection({
  label,
  blurb,
  done,
  total,
  children,
}: {
  label: string;
  blurb: string;
  done: number;
  total: number;
  children: React.ReactNode;
}) {
  return (
    <div style={{ marginTop: 36 }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          justifyContent: 'space-between',
          paddingBottom: 8,
          borderBottom: '1px solid var(--ink)',
        }}
      >
        <div>
          <div className="eyebrow" style={{ marginBottom: 2 }}>{label}</div>
          <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>{blurb}</div>
        </div>
        <div style={{ fontSize: 11, color: 'var(--ink-3)', letterSpacing: '.12em' }}>
          {done}/{total}
        </div>
      </div>
      <div>{children}</div>
    </div>
  );
}

