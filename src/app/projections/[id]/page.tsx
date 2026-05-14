import Link from 'next/link';
import { notFound } from 'next/navigation';
import { HelmMasthead } from '@/components/HelmMasthead';
import { ProjectionForm } from '@/components/projections/ProjectionForm';
import { DownloadPdfButton } from '@/components/projections/DownloadPdfButton';
import { ContractRedlinesPanel } from '@/components/projections/ContractRedlinesPanel';
import { DeleteProspectButton } from '@/components/projections/DeleteProspectButton';
import { ResetContractButton } from '@/components/projections/ResetContractButton';
import { CloseLikelihoodWidget } from '@/components/projections/CloseLikelihoodWidget';
import {
  Pipeline,
  Stage,
  fmtTouchDate,
  fmtTouchTs,
  gmailStatus,
  lockedReason,
} from '@/components/projections/Pipeline';
import { supabase } from '@/lib/supabase';
import type { ProjectionRow } from '@/lib/projections-types';
import {
  computeProjection,
  fmtMoney,
  fmtMonthYear,
  fmtPercent,
  roundToThousand,
} from '@/lib/projections-model';
import { updateProjection, markSent, promoteToProperty } from '../actions';

export const dynamic = 'force-dynamic';

async function getProjection(id: string): Promise<ProjectionRow | null> {
  const { data, error } = await supabase.from('projections').select('*').eq('id', id).maybeSingle();
  if (error || !data) return null;
  return data as ProjectionRow;
}

export default async function ProjectionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const projection = await getProjection(id);
  if (!projection) notFound();

  const computed = computeProjection(projection);
  const update = updateProjection.bind(null, id);
  const send = markSent.bind(null, id);
  const promote = promoteToProperty.bind(null, id);

  // For the Danger zone delete confirmation: prefer the structured
  // owner's last name when populated; otherwise fall back to the last
  // token of the legacy prospect_name string.
  const ownerLastName =
    projection.owners?.[0]?.last_name?.trim() ||
    projection.prospect_name?.trim().split(/\s+/).slice(-1)[0] ||
    'DELETE';
  const hasContractEdits =
    ((projection.contract_overrides as unknown[] | null)?.length ?? 0) > 0 ||
    (projection.custom_clauses?.length ?? 0) > 0;

  // ─── Stage state derivation ────────────────────────────────────────────
  const touches = projection.gmail_touches ?? {};
  const projectionTouch = touches.projection;
  const guideTouch = touches.guide;
  const contractTouch = touches.contract;
  const onboardingTouch = touches.onboarding;

  const projectionSent = !!projectionTouch || projection.status === 'sent';
  const guideSent = !!guideTouch;
  const contractSent = !!contractTouch;
  const signed = !!projection.contract_signed_at;
  const onboardingDone = !!projection.onboarding_submitted_at;
  const promoted = !!projection.property_id;
  const promoteUnlocked = signed && onboardingDone;

  // For Stage 06 (Promote): 'done' once promoted; 'active' once unlocked but
  // not yet promoted; 'locked' until both prerequisites land.
  const promoteState = promoted ? 'done' : promoteUnlocked ? 'active' : 'locked';

  // ─── Pipeline progress bar (hero) ──────────────────────────────────────
  // Mirrors the five vertical Stages below as a compact horizontal status
  // bar that replaces the old "Cover range" hero KPI. "Done" = filled
  // signal dot; "active" = the first not-yet-done stage (ring); everything
  // after that = "locked" (muted). One source of truth: the same booleans
  // the Stage cards use, just summarised.
  const pipelineSteps: { label: string; state: 'done' | 'active' | 'locked' }[] = (() => {
    const flags = [
      { label: 'Projection', done: projectionSent },
      { label: 'Guide & Contract', done: guideSent && contractSent },
      { label: 'Signed', done: signed },
      { label: 'Onboarding', done: onboardingDone },
      { label: 'Promote', done: promoted },
    ];
    let activeAssigned = false;
    return flags.map((f) => {
      if (f.done) return { label: f.label, state: 'done' as const };
      if (!activeAssigned) {
        activeAssigned = true;
        return { label: f.label, state: 'active' as const };
      }
      return { label: f.label, state: 'locked' as const };
    });
  })();
  const doneCount = pipelineSteps.filter((s) => s.state === 'done').length;

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead current="projections" />

      {/* ─── Identity strip ─────────────────────────────────────────────── */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingTop: 56, paddingBottom: 36, width: '100%' }}>
        <div className="eyebrow" style={{ marginBottom: 14 }}>
          <Link href="/projections" style={{ color: 'var(--ink-4)', textDecoration: 'none' }}>
            ← Prospects
          </Link>
          {' · '}
          <span>{fmtMonthYear(projection.presentation_month)}</span>
          {' · '}
          <span style={{ color: promoted ? 'var(--positive)' : projection.status === 'sent' ? 'var(--positive)' : 'var(--ink-4)' }}>
            {promoted ? 'Promoted' : projection.status === 'sent' ? 'Active' : 'Draft'}
          </span>
        </div>
        <h1
          className="font-serif"
          style={{
            fontSize: 44,
            lineHeight: 1.05,
            fontWeight: 300,
            letterSpacing: '-0.02em',
            color: 'var(--ink)',
            margin: 0,
            maxWidth: 720,
          }}
        >
          {projection.property_address}
          {projection.property_city && (
            <span style={{ color: 'var(--ink-3)', fontWeight: 300 }}>
              {', '}{projection.property_city.split(',')[0]}
            </span>
          )}
        </h1>
        <p style={{ marginTop: 8, fontSize: 14, color: 'var(--ink-3)', lineHeight: 1.5 }}>
          Prepared for{' '}
          <span style={{ color: 'var(--tide-deep)', fontStyle: 'italic' }}>
            {projection.prospect_name}
          </span>
        </p>
        {/* Two hero summaries side-by-side: pipeline progress (left) for
            "where is this deal?" and close-likelihood (right) for "how
            likely are we to get it?" Cover-range / Year-1 detail moved
            down into Stage 01's body where it sits alongside the
            tiered-rule + AirDNA breakdown. */}
        <div
          style={{
            marginTop: 26,
            display: 'grid',
            gridTemplateColumns: 'minmax(0, 1fr) auto',
            gap: 48,
            alignItems: 'flex-end',
          }}
        >
          <PipelineProgressBar steps={pipelineSteps} doneCount={doneCount} />
          <CloseLikelihoodWidget projectionId={id} value={projection.close_likelihood_pct} size="large" />
        </div>
      </section>

      {/* ─── Pipeline ───────────────────────────────────────────────────── */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 32, width: '100%' }}>
        <Pipeline>

          {/* 01 — Projection */}
          <Stage
            num="01"
            title="Projection"
            state={projectionSent ? 'done' : 'active'}
            status={
              projectionTouch
                ? gmailStatus(projectionTouch)
                : projection.status === 'sent'
                  ? gmailStatus(undefined, { sentAt: projection.sent_at })
                  : 'Not yet sent'
            }
          >
            <ProjectionStageBody projection={projection} computed={computed} markSent={send} canMarkSent={projection.status === 'draft' && !projectionTouch} projectionId={id} />
          </Stage>

          {/* 02 — Partnership Guide & Contract (sent together) */}
          <Stage
            num="02"
            title="Partnership Guide & Contract"
            state={guideSent && contractSent ? 'done' : 'active'}
            status={
              guideSent && contractSent
                // Both sent — show the most recent of the two so the status
                // line tracks the latest touch.
                ? gmailStatus(
                    [guideTouch, contractTouch]
                      .filter((t): t is NonNullable<typeof t> => !!t)
                      .sort((a, b) => b.sent_at.localeCompare(a.sent_at))[0],
                  )
                : guideSent
                  ? 'Guide sent · contract pending'
                  : contractSent
                    ? 'Contract sent · guide pending'
                    : 'Not yet sent'
            }
          >
            <GuideAndContractStageBody projection={projection} projectionId={id} />
          </Stage>

          {/* 03 — Signed */}
          <Stage
            num="03"
            title="Signed"
            state={signed ? 'done' : 'active'}
            status={
              signed
                ? <>Signed {fmtTouchDate(projection.contract_signed_at!)}{projection.contract_signed_name ? ` by ${projection.contract_signed_name}` : ''}</>
                : 'Awaiting signature'
            }
          >
            <SignedStageBody projection={projection} />
          </Stage>

          {/* 04 — Onboarding */}
          <Stage
            num="04"
            title="Onboarding"
            state={onboardingDone ? 'done' : 'active'}
            status={
              onboardingDone
                ? <>Submitted {fmtTouchDate(projection.onboarding_submitted_at!)}</>
                : 'Awaiting submission'
            }
          >
            <OnboardingStageBody projection={projection} onboardingTouch={onboardingTouch ? gmailStatus(onboardingTouch) : null} />
          </Stage>

          {/* 05 — Promote to managed property */}
          <Stage
            num="05"
            title="Promote to managed property"
            state={promoteState}
            status={
              promoted
                ? 'Promoted'
                : promoteUnlocked
                  ? 'Ready to promote'
                  : lockedReason(projection)
            }
          >
            <PromoteStageBody projection={projection} promote={promote} unlocked={promoteUnlocked} promoted={promoted} />
          </Stage>

        </Pipeline>
      </section>

      {/* ─── Activity log ───────────────────────────────────────────────── */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 24, width: '100%' }}>
        <ActivityLog projection={projection} />
      </section>

      {/* ─── Edit details (collapsed) ───────────────────────────────────── */}
      <section className="max-w-[860px] mx-auto px-10" style={{ paddingBottom: 40, flex: 1, width: '100%' }}>
        <details style={{ borderTop: '1px solid var(--rule)', paddingTop: 16 }}>
          <summary
            style={{
              listStyle: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'baseline',
              gap: 10,
              padding: '8px 0',
              userSelect: 'none',
            }}
          >
            <span aria-hidden style={{ fontSize: 10, color: 'var(--ink-4)' }}>▸</span>
            <span className="eyebrow">Edit prospect details</span>
            <span style={{ fontSize: 11, color: 'var(--ink-4)', fontStyle: 'italic' }}>
              owners, property, assumptions, contract terms, overrides
            </span>
          </summary>
          <div style={{ paddingTop: 18 }}>
            {/* The `key` is set to projection.updated_at so the form fully
                remounts whenever the row's updated_at advances (after Save or
                applyContractRedlines). Without that, the form inputs use
                `defaultValue` which only sets on mount — so the user would see
                stale values after a redline apply. */}
            <ProjectionForm
              key={projection.updated_at ?? 'no-ts'}
              action={update}
              initial={projection}
              submitLabel="Save changes"
              lastSavedAt={projection.updated_at}
            />
          </div>
        </details>
      </section>

      {/* ─── Danger zone ────────────────────────────────────────────────── */}
      <section className="max-w-[860px] mx-auto px-10" style={{ paddingBottom: 80, width: '100%' }}>
        <div
          style={{
            borderTop: '1px solid var(--rule)',
            paddingTop: 24,
            marginTop: 16,
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
          }}
        >
          <div className="eyebrow" style={{ color: 'var(--negative)' }}>Danger zone</div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, alignItems: 'flex-start' }}>
            <div style={{ flex: '1 1 320px', minWidth: 280 }}>
              <div className="font-serif" style={{ fontSize: 16, color: 'var(--ink)', margin: '0 0 4px' }}>
                Reset contract
              </div>
              <p style={{ margin: '0 0 10px', fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.6, maxWidth: 480 }}>
                Clears every redline override + Rider clause applied to this prospect&rsquo;s contract.
                The contract reverts to the standard template. <strong>Prospect record, inputs,
                signing token, and onboarding intake stay intact.</strong>
              </p>
              <ResetContractButton projectionId={id} hasOverrides={hasContractEdits} />
            </div>

            <div style={{ flex: '1 1 320px', minWidth: 280 }}>
              <div className="font-serif" style={{ fontSize: 16, color: 'var(--negative)', margin: '0 0 4px' }}>
                Delete prospect
              </div>
              <p style={{ margin: '0 0 10px', fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.6, maxWidth: 480 }}>
                Permanently removes <strong>{projection.prospect_name}</strong> and everything tied to
                this projection. Recovery is a Supabase support ticket. Use Reset contract instead
                if you just want to restart the negotiation.
              </p>
              <DeleteProspectButton
                projectionId={id}
                prospectName={projection.prospect_name || 'this prospect'}
                prospectLastName={ownerLastName}
              />
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

// ─── Stage bodies ──────────────────────────────────────────────────────────
// Each stage's body slots its specific content under the stage card. The
// outer Stage component handles the rail / dot / title / status; these
// helpers only render the meta numbers and actions for that step.

function ProjectionStageBody({
  projection,
  computed,
  markSent,
  canMarkSent,
  projectionId,
}: {
  projection: ProjectionRow;
  computed: ReturnType<typeof computeProjection>;
  markSent: () => Promise<void>;
  canMarkSent: boolean;
  projectionId: string;
}) {
  const fullMid = roundToThousand(computed.year1.mid.netPayout);
  const rampMid = roundToThousand(computed.year1Ramped.netPayout);
  const showRamp = rampMid !== fullMid;
  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 22, marginBottom: 14 }}>
        <StageStat label="Year 1" value={fmtMoney(fullMid)} sub={`${fmtMoney(roundToThousand(computed.year1.low.netPayout))} – ${fmtMoney(roundToThousand(computed.year1.high.netPayout))}`} />
        {showRamp && (
          <StageStat label="Year 1 ramped" value={fmtMoney(rampMid)} sub={`${computed.year1Ramped.activeMonthCount} active months`} />
        )}
        <StageStat label="Year 2" value={fmtMoney(roundToThousand(computed.year2.netPayout))} sub={`+${fmtPercent(projection.year2_growth_pct)} on Year 1`} />
      </div>
      <div style={{ fontSize: 11, color: 'var(--ink-4)', lineHeight: 1.55, marginBottom: 14 }}>
        Tiered % rule: {fmtMoney(computed.tieredRevenue)} ({fmtPercent(computed.tieredRate)}) · AirDNA 3-yr avg: {fmtMoney(computed.airdna3YrAvg, { decimals: 0 })} ({computed.airdnaYears.map((y) => y.year).join(', ')}) · Blended gross: {fmtMoney(computed.blendedGrossRevenue)} · Annual cleaning: {fmtMoney(computed.year1.mid.cleaningExpense)}
      </div>
      <DeliverableActions
        projectionId={projectionId}
        type="projection"
        openSlug="render"
        downloadLabel="Download Projection"
        extraAction={
          canMarkSent ? (
            <form action={markSent} style={{ display: 'inline-block' }}>
              <button type="submit" style={ghostButtonStyle}>
                Mark as sent
              </button>
            </form>
          ) : null
        }
      />
    </>
  );
}

/**
 * Combined Guide + Contract stage body. They're sent together in the funnel
 * (the partnership guide explains the management relationship that the
 * contract codifies), so the UI groups them as one stage with two
 * sub-deliverables. Each gets its own download/open row; the contract sub-
 * deliverable also surfaces the live term/fee summary and the Apply Owner
 * Redlines disclosure.
 */
function GuideAndContractStageBody({ projection, projectionId }: { projection: ProjectionRow; projectionId: string }) {
  const termRange = projection.term_start && projection.term_end
    ? `Term ${fmtTouchDate(projection.term_start)} → ${fmtTouchDate(projection.term_end)}`
    : 'Term dates pending';
  const fee = `${fmtPercent(projection.mgmt_fee_pct)} mgmt fee`;
  return (
    <>
      {/* Partnership Guide sub-deliverable */}
      <SubDeliverable label="Partnership Guide">
        <DeliverableActions projectionId={projectionId} type="guide" openSlug="guide" downloadLabel="Download Guide" />
      </SubDeliverable>

      {/* Contract sub-deliverable */}
      <SubDeliverable label="Contract" isLast>
        <div style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 12 }}>
          {termRange} · {fee} · ${projection.initial_deposit.toLocaleString()} deposit
        </div>
        <DeliverableActions projectionId={projectionId} type="contract" openSlug="contract" downloadLabel="Download Contract" />
        <details style={{ marginTop: 14 }}>
          <summary
            style={{
              listStyle: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'baseline',
              gap: 10,
              userSelect: 'none',
            }}
          >
            <span aria-hidden style={{ fontSize: 10, color: 'var(--ink-4)' }}>▸</span>
            <span className="eyebrow">Apply owner redlines</span>
            <span style={{ fontSize: 11, color: 'var(--ink-4)', fontStyle: 'italic' }}>
              paste their email / call notes, Claude maps to contract edits
            </span>
          </summary>
          <div style={{ paddingTop: 14 }}>
            <ContractRedlinesPanel projection={projection} />
          </div>
        </details>
      </SubDeliverable>
    </>
  );
}

/** Header + body wrapper for one of the two deliverables inside the combined
 *  Guide + Contract stage. Renders a small caps label, then the children.
 *  The last sub-deliverable drops the trailing rule + margin so the stage
 *  card doesn't end with a stray separator. */
function SubDeliverable({
  label,
  children,
  isLast,
}: {
  label: string;
  children: React.ReactNode;
  isLast?: boolean;
}) {
  return (
    <div
      style={
        isLast
          ? undefined
          : {
              paddingBottom: 16,
              marginBottom: 16,
              borderBottom: '1px solid var(--rule)',
            }
      }
    >
      <div className="eyebrow" style={{ marginBottom: 10 }}>{label}</div>
      {children}
    </div>
  );
}

function SignedStageBody({ projection }: { projection: ProjectionRow }) {
  const signedAt = projection.contract_signed_at;
  const signedName = projection.contract_signed_name;
  const link = `/contract/${projection.onboarding_token}`;
  return (
    <>
      {!signedAt && (
        <p style={{ marginTop: 0, marginBottom: 12, fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.55, maxWidth: 720 }}>
          Send this link to the owner once the contract terms are settled. They&rsquo;ll type their full legal name and submit; their name + timestamp + IP / user-agent are recorded as their electronic signature (ESIGN/UETA-compliant).
        </p>
      )}
      {signedAt && signedName && (
        <p style={{ marginTop: 0, marginBottom: 12, fontSize: 12, color: 'var(--ink)', lineHeight: 1.55, maxWidth: 720 }}>
          Signed by <strong>{signedName}</strong> on {new Date(signedAt).toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' })}
          {projection.contract_signed_ip ? ` from ${projection.contract_signed_ip}` : ''}.
        </p>
      )}
      <LinkRow link={link} />
    </>
  );
}

function OnboardingStageBody({ projection, onboardingTouch }: { projection: ProjectionRow; onboardingTouch: React.ReactNode | null }) {
  const submitted = projection.onboarding_submitted_at;
  const data = projection.onboarding_data;
  const link = `/onboarding/${projection.onboarding_token}`;
  return (
    <>
      {!submitted && (
        <p style={{ marginTop: 0, marginBottom: 12, fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.55, maxWidth: 720 }}>
          Send this link to the owner once the contract is signed. They&rsquo;ll fill in property details, utilities, access, and an emergency contact. Their answers land back here.
        </p>
      )}
      {onboardingTouch && !submitted && (
        <p style={{ marginTop: 0, marginBottom: 12, fontSize: 11, color: 'var(--ink-4)', fontStyle: 'italic' }}>
          {onboardingTouch}
        </p>
      )}
      <LinkRow link={link} />
      {submitted && data && <OnboardingSummary data={data} />}
    </>
  );
}

function PromoteStageBody({
  projection,
  promote,
  unlocked,
  promoted,
}: {
  projection: ProjectionRow;
  promote: () => Promise<void>;
  unlocked: boolean;
  promoted: boolean;
}) {
  if (promoted) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ fontSize: 13, color: 'var(--ink-3)' }}>
          This prospect was promoted into the Properties module.
        </div>
        <Link
          href={`/properties/${projection.property_id}`}
          style={{
            background: 'transparent',
            color: 'var(--ink)',
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: '.18em',
            textTransform: 'uppercase',
            padding: '11px 18px',
            border: '1px solid var(--ink)',
            textDecoration: 'none',
          }}
        >
          Open property →
        </Link>
      </div>
    );
  }
  return (
    <>
      <p style={{ marginTop: 0, marginBottom: 14, fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.55, maxWidth: 720 }}>
        Once the contract is signed and the owner has submitted the onboarding form, promote this prospect into a managed property. We&rsquo;ll create a record in{' '}
        <Link href="/properties" style={{ color: 'var(--ink)', textDecoration: 'underline' }}>Properties</Link>{' '}
        with all the operational details copied over (utilities, access, emergency contact). The prospect record stays as the sales artifact.
      </p>
      <form action={promote}>
        <button
          type="submit"
          disabled={!unlocked}
          style={{
            background: unlocked ? 'var(--ink)' : 'var(--paper-2)',
            color: unlocked ? 'var(--paper)' : 'var(--ink-4)',
            fontSize: 12,
            fontWeight: 600,
            letterSpacing: '.18em',
            textTransform: 'uppercase',
            padding: '14px 28px',
            border: 'none',
            cursor: unlocked ? 'pointer' : 'not-allowed',
          }}
        >
          {unlocked ? 'Promote to managed property →' : 'Awaiting prerequisites'}
        </button>
      </form>
    </>
  );
}

// ─── Activity log ──────────────────────────────────────────────────────────
/**
 * Renders a chronological list of milestone events on the prospect — when
 * each deliverable was sent (per Gmail), when the contract was signed, when
 * onboarding was submitted, when promoted. Edits to the record itself are
 * not surfaced here (too noisy); use the audit fields if needed.
 */
function ActivityLog({ projection }: { projection: ProjectionRow }) {
  const events: { at: string; label: string }[] = [];
  if (projection.created_at) events.push({ at: projection.created_at, label: 'Prospect created' });
  const t = projection.gmail_touches ?? {};
  if (t.projection) events.push({ at: t.projection.sent_at, label: `${t.projection.from_user ?? 'Someone'} sent the projection` });
  if (t.guide) events.push({ at: t.guide.sent_at, label: `${t.guide.from_user ?? 'Someone'} sent the partnership guide` });
  if (t.contract) events.push({ at: t.contract.sent_at, label: `${t.contract.from_user ?? 'Someone'} sent the contract` });
  if (t.onboarding) events.push({ at: t.onboarding.sent_at, label: `${t.onboarding.from_user ?? 'Someone'} sent the onboarding link` });
  if (projection.contract_signed_at) {
    const who = projection.contract_signed_name ?? 'Owner';
    events.push({ at: projection.contract_signed_at, label: `${who} signed the contract` });
  }
  if (projection.onboarding_submitted_at) {
    events.push({ at: projection.onboarding_submitted_at, label: 'Onboarding form submitted' });
  }
  if (projection.property_id && projection.updated_at) {
    events.push({ at: projection.updated_at, label: 'Promoted to managed property' });
  }
  events.sort((a, b) => b.at.localeCompare(a.at));

  if (events.length === 0) return null;

  return (
    <details>
      <summary
        style={{
          listStyle: 'none',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'baseline',
          gap: 10,
          padding: '8px 0',
          userSelect: 'none',
        }}
      >
        <span aria-hidden style={{ fontSize: 10, color: 'var(--ink-4)' }}>▸</span>
        <span className="eyebrow">Activity log</span>
        <span style={{ fontSize: 11, color: 'var(--ink-4)', fontStyle: 'italic' }}>
          {events.length} milestone{events.length === 1 ? '' : 's'}
        </span>
      </summary>
      <ol
        style={{
          listStyle: 'none',
          padding: '14px 0 0',
          margin: 0,
          fontSize: 12,
          color: 'var(--ink)',
        }}
      >
        {events.map((ev, i) => (
          <li
            key={i}
            style={{
              display: 'grid',
              gridTemplateColumns: '180px 1fr',
              gap: 16,
              padding: '8px 0',
              borderBottom: i === events.length - 1 ? 'none' : '1px solid var(--rule)',
            }}
          >
            <span style={{ color: 'var(--ink-4)', fontSize: 11, letterSpacing: '0.04em' }}>
              {fmtTouchTs(ev.at)}
            </span>
            <span>{ev.label}</span>
          </li>
        ))}
      </ol>
    </details>
  );
}

// ─── Inline atoms ──────────────────────────────────────────────────────────

/** Action row for a deliverable: Open + Download (+ optional extras). */
function DeliverableActions({
  projectionId,
  type,
  openSlug,
  downloadLabel,
  extraAction,
}: {
  projectionId: string;
  type: 'projection' | 'guide' | 'contract';
  openSlug: 'render' | 'guide' | 'contract';
  downloadLabel: string;
  extraAction?: React.ReactNode;
}) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
      <Link
        href={`/projections/${projectionId}/${openSlug}`}
        target="_blank"
        style={{
          background: 'var(--ink)',
          color: 'var(--paper)',
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: '.18em',
          textTransform: 'uppercase',
          padding: '11px 20px',
          textDecoration: 'none',
        }}
      >
        Open ↗
      </Link>
      <DownloadPdfButton projectionId={projectionId} type={type} label={downloadLabel} />
      {extraAction}
    </div>
  );
}

/** Public-link row used by Signed + Onboarding stages — code box + Open ↗. */
function LinkRow({ link }: { link: string }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
      <code
        className="font-mono"
        style={{
          flex: '1 1 280px',
          background: 'var(--paper-2)',
          border: '1px solid var(--rule)',
          padding: '8px 12px',
          fontSize: 11,
          color: 'var(--ink-3)',
          overflowX: 'auto',
          whiteSpace: 'nowrap',
        }}
      >
        {link}
      </code>
      <Link
        href={link}
        target="_blank"
        style={{
          background: 'transparent',
          color: 'var(--ink)',
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: '.18em',
          textTransform: 'uppercase',
          padding: '9px 16px',
          border: '1px solid var(--ink)',
          textDecoration: 'none',
        }}
      >
        Open ↗
      </Link>
    </div>
  );
}

function StageStat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div>
      <div className="eyebrow" style={{ marginBottom: 6 }}>{label}</div>
      <div className="font-serif tabular-nums" style={{ fontSize: 22, fontWeight: 400, color: 'var(--ink)', lineHeight: 1.05 }}>
        {value}
      </div>
      {sub && <div style={{ marginTop: 4, fontSize: 11, color: 'var(--ink-3)' }}>{sub}</div>}
    </div>
  );
}

function OnboardingSummary({ data }: { data: NonNullable<ProjectionRow['onboarding_data']> }) {
  type Item = { label: string; value: string | undefined };
  const groups: { title: string; items: Item[] }[] = [
    {
      title: 'Personal',
      items: [
        { label: 'Name', value: data.full_name },
        { label: 'Phone', value: data.phone },
        { label: 'Email', value: data.email },
        { label: 'Mailing', value: data.mailing_address },
        { label: 'Preferred', value: data.preferred_contact },
      ],
    },
    {
      title: 'Property',
      items: [
        { label: 'Address', value: data.property_address },
        { label: 'Type', value: data.property_type },
        { label: 'HOA', value: data.hoa },
        { label: 'Beds', value: data.bedrooms },
        { label: 'Baths', value: data.bathrooms },
        { label: 'Sq Ft', value: data.square_feet },
        { label: 'Floors', value: data.livable_floors },
        { label: 'Basement', value: data.basement },
        { label: 'Parking', value: data.parking },
      ],
    },
    {
      title: 'Utilities',
      items: [
        { label: 'Electric', value: data.electricity_provider },
        { label: 'Heating', value: data.heating },
        { label: 'Cooling', value: data.cooling },
        { label: 'Internet', value: data.internet_provider },
        { label: 'Cable', value: data.cable_provider },
        { label: 'WiFi name', value: data.wifi_name },
        { label: 'WiFi pass', value: data.wifi_password },
        { label: 'TVs', value: data.num_tvs },
        { label: 'Smart TV', value: data.smart_tv },
      ],
    },
    {
      title: 'STR setup',
      items: [
        { label: 'Currently listed', value: data.currently_listed },
        { label: 'Listing URLs', value: data.listing_urls },
        { label: 'STR reg #', value: data.str_registration },
        { label: 'STR insurance', value: data.str_insurance },
        { label: 'Access', value: data.guest_access_method },
        { label: 'Smart lock', value: data.smart_lock_brand },
        { label: 'Lock code', value: data.smart_lock_code },
        { label: 'Cameras', value: data.security_cameras },
      ],
    },
    {
      title: 'Access & notes',
      items: [
        { label: 'Key/code loc', value: data.key_code_location },
        { label: 'Alarm', value: data.alarm_system },
        { label: 'Known issues', value: data.known_issues },
        { label: 'Maintenance', value: data.upcoming_maintenance },
        { label: 'Notes', value: data.notes },
      ],
    },
    {
      title: 'Emergency contact',
      items: [
        { label: 'Name', value: data.emergency_name },
        { label: 'Relation', value: data.emergency_relationship },
        { label: 'Phone', value: data.emergency_phone },
        { label: 'Email', value: data.emergency_email },
      ],
    },
  ];
  return (
    <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--rule)' }}>
      <div className="eyebrow" style={{ marginBottom: 14, color: 'var(--ink-3)' }}>
        Submitted answers
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 22 }}>
        {groups.map((g) => (
          <div key={g.title}>
            <div className="eyebrow" style={{ marginBottom: 8, color: 'var(--signal)' }}>{g.title}</div>
            <dl style={{ margin: 0, padding: 0, fontSize: 11.5, lineHeight: 1.55 }}>
              {g.items.map((it) =>
                it.value ? (
                  <div key={it.label} style={{ display: 'flex', gap: 8, padding: '3px 0' }}>
                    <dt style={{ color: 'var(--ink-4)', flexShrink: 0, minWidth: 90 }}>{it.label}</dt>
                    <dd style={{ margin: 0, color: 'var(--ink)' }}>{it.value}</dd>
                  </div>
                ) : null,
              )}
            </dl>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Pipeline progress bar ─────────────────────────────────────────────────
/**
 * Horizontal five-step status bar used in the identity strip. Each step gets
 * a dot + label; the dot's visual state mirrors the vertical Stage cards
 * below — filled signal = done, signal ring = active, muted outline =
 * locked. A 2px connector between dots flips to signal once the preceding
 * step is done, so the bar fills in left-to-right as the deal progresses.
 *
 * The container is set to grid `repeat(N, 1fr)` so every step shares the
 * same width regardless of label length, which keeps the connector math
 * (calc with -50%) simple and consistent.
 */
function PipelineProgressBar({
  steps,
  doneCount,
}: {
  steps: { label: string; state: 'done' | 'active' | 'locked' }[];
  doneCount: number;
}) {
  const allDone = doneCount === steps.length;
  return (
    <div>
      <style>{pipelineProgressBarCss}</style>
      <div className="eyebrow" style={{ marginBottom: 14 }}>
        Pipeline ·{' '}
        <span style={{ color: allDone ? 'var(--positive)' : 'var(--ink-3)' }}>
          {doneCount} of {steps.length} complete
        </span>
      </div>
      <ol className="rt-pbar" style={{ gridTemplateColumns: `repeat(${steps.length}, minmax(0, 1fr))` }}>
        {steps.map((s, i) => (
          <li
            key={s.label}
            className="rt-pbar-step"
            data-state={s.state}
            data-prev={i > 0 ? steps[i - 1].state : undefined}
          >
            <span className="rt-pbar-dot" aria-hidden />
            <span className="rt-pbar-label">{s.label}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

const pipelineProgressBarCss = `
  .rt-pbar {
    list-style: none;
    margin: 0;
    padding: 0;
    display: grid;
    gap: 0;
  }
  .rt-pbar-step {
    position: relative;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    min-width: 0;
  }
  /* Connector: 2px line from the previous step's dot center to this step's
     dot center, sitting behind the dots. left/right use calc(-50% + dot-r)
     and calc(50% + dot-r) to land exactly at dot edges since every step is
     1fr wide. */
  .rt-pbar-step:not(:first-child)::before {
    content: '';
    position: absolute;
    left: calc(-50% + 8px);
    right: calc(50% + 8px);
    top: 5px;
    height: 2px;
    background: var(--rule);
    z-index: 0;
  }
  .rt-pbar-step[data-prev="done"]:not(:first-child)::before {
    background: var(--signal);
  }
  .rt-pbar-dot {
    position: relative;
    z-index: 1;
    width: 14px;
    height: 14px;
    border-radius: 50%;
    background: var(--paper);
    border: 2px solid var(--ink-4);
    flex-shrink: 0;
  }
  .rt-pbar-step[data-state="done"] .rt-pbar-dot {
    background: var(--signal);
    border-color: var(--signal);
  }
  .rt-pbar-step[data-state="active"] .rt-pbar-dot {
    background: var(--paper);
    border-color: var(--signal);
    box-shadow: 0 0 0 3px var(--paper), 0 0 0 4px var(--signal);
  }
  .rt-pbar-label {
    font-family: var(--font-inter), system-ui, sans-serif;
    font-size: 11px;
    letter-spacing: 0.04em;
    text-align: center;
    line-height: 1.3;
    color: var(--ink-4);
    white-space: nowrap;
  }
  .rt-pbar-step[data-state="done"] .rt-pbar-label {
    color: var(--ink);
    font-weight: 500;
  }
  .rt-pbar-step[data-state="active"] .rt-pbar-label {
    color: var(--signal);
    font-weight: 600;
  }
`;

// ─── Shared styles ─────────────────────────────────────────────────────────
const ghostButtonStyle: React.CSSProperties = {
  background: 'transparent',
  color: 'var(--ink)',
  fontSize: 11,
  fontWeight: 500,
  letterSpacing: '.18em',
  textTransform: 'uppercase',
  padding: '11px 16px',
  border: '1px solid var(--ink)',
  cursor: 'pointer',
};
