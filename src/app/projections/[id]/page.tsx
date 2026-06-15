import Link from 'next/link';
import { notFound } from 'next/navigation';
import { HelmMasthead } from '@/components/HelmMasthead';
import { ProjectionForm } from '@/components/projections/ProjectionForm';
import { DownloadPdfButton } from '@/components/projections/DownloadPdfButton';
import { ContractRedlinesPanel } from '@/components/projections/ContractRedlinesPanel';
import { RedlinesDisclosure } from '@/components/projections/RedlinesDisclosure';
import { DeleteProspectButton } from '@/components/projections/DeleteProspectButton';
import { ResetContractButton } from '@/components/projections/ResetContractButton';
import { CloseLikelihoodWidget } from '@/components/projections/CloseLikelihoodWidget';
import { CopyLinkButton, CountersignButton } from '@/components/projections/SigningButtons';
import {
  Pipeline,
  Stage,
  fmtTouchDate,
  fmtTouchTs,
  gmailStatus,
  lockedReason,
} from '@/components/projections/Pipeline';
import { supabase } from '@/lib/supabase';
import { createClient } from '@supabase/supabase-js';
import { getOwnerPortfolio } from '@/lib/owner-portfolio';
import { normalizePhone } from '@/lib/quo';
import { ProspectTexts, type ProspectText } from './ProspectTexts';
import type { ProjectionRow } from '@/lib/projections-types';
import {
  computeProjection,
  fmtMoney,
  fmtMonthYear,
  fmtPercent,
  roundToThousand,
} from '@/lib/projections-model';
import {
  updateProjection,
  markSent,
  promoteToProperty,
  countersignContract,
  markOnboardingDone,
  unmarkOnboardingDone,
  markContractDone,
  unmarkContractDone,
} from '../actions';

export const dynamic = 'force-dynamic';

async function getProjection(id: string): Promise<ProjectionRow | null> {
  const { data, error } = await supabase.from('projections').select('*').eq('id', id).maybeSingle();
  if (error || !data) return null;
  return data as ProjectionRow;
}

// Read-only: surface this prospect's Quo SMS on the deal (matched by
// phone). Service role because quo_events is an audit table. Never writes
// or advances the deal stage.
async function getProspectTexts(phone: string): Promise<ProspectText[]> {
  const target = normalizePhone(phone);
  if (!target) return [];
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
  const sb = createClient(url, key);
  const { data } = await sb
    .from('quo_events')
    .select('payload, received_at')
    .in('event_type', ['message.received', 'message.delivered'])
    .order('received_at', { ascending: false })
    .limit(500);
  type Row = {
    payload: {
      data?: {
        object?: {
          from?: string | null;
          to?: string | string[] | null;
          body?: string | null;
          text?: string | null;
          direction?: string | null;
          createdAt?: string | null;
        };
      };
    };
    received_at: string;
  };
  const out: ProspectText[] = [];
  for (const row of (data ?? []) as Row[]) {
    const obj = row.payload?.data?.object;
    if (!obj) continue;
    const to = Array.isArray(obj.to) ? obj.to[0] : obj.to;
    if (normalizePhone(obj.from) !== target && normalizePhone(to) !== target) continue;
    out.push({
      direction: obj.direction === 'incoming' ? 'inbound' : 'outbound',
      body: (obj.body ?? obj.text ?? '') || '',
      at: obj.createdAt ?? row.received_at,
    });
    if (out.length >= 20) break;
  }
  return out;
}

export default async function ProjectionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const projection = await getProjection(id);
  if (!projection) notFound();

  const prospectTexts = projection.prospect_phone ? await getProspectTexts(projection.prospect_phone) : [];

  // Owner portfolio: does this prospect's owner already manage other
  // properties / have other open prospects with us (matched by email)?
  // Surfaces an "already an owner with us" banner so a second unit for an
  // existing owner (e.g. Simon Prudenzi's bottom floor) is obviously tied
  // to the same person, not a fresh lead.
  const ownerPortfolio = await getOwnerPortfolio({
    emails: [
      projection.prospect_email,
      ...((projection.owners ?? []).map((o) => o?.email ?? null)),
    ],
    excludeProjectionId: id,
  });

  const computed = computeProjection(projection);
  const update = updateProjection.bind(null, id);
  const send = markSent.bind(null, id);
  const promote = promoteToProperty.bind(null, id);
  const markOnboarding = markOnboardingDone.bind(null, id);
  const unmarkOnboarding = unmarkOnboardingDone.bind(null, id);
  const markContract = markContractDone.bind(null, id);
  const unmarkContract = unmarkContractDone.bind(null, id);

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
  const countersigned = !!projection.contract_countersigned_at;
  // Contract stage completes two ways: the in-Helm signing chain fully
  // executes (countersigned), OR a staff member taps "Mark contract
  // complete" (deal closed out elsewhere — signed in person, e-sign
  // bypassed for a one-off). Either advances the pipeline; the latter
  // also unlocks Promote without needing a contract_signed_at stamp.
  const contractMarkedDone = !!projection.contract_marked_done_at;
  const contractStageDone = countersigned || contractMarkedDone;
  // Onboarding completes two ways: the owner submits the public intake
  // form, OR a staff member taps "Mark complete" (info gathered another
  // way). Either advances the pipeline.
  const onboardingSubmitted = !!projection.onboarding_submitted_at;
  const onboardingMarkedDone = !!projection.onboarding_marked_done_at;
  const onboardingDone = onboardingSubmitted || onboardingMarkedDone;
  const promoted = !!projection.property_id;
  // Promote unlock counts a manual contract mark the same as a real
  // owner signature — the staff member is saying "the legal piece is
  // settled, move on."
  const promoteUnlocked = (signed || contractMarkedDone) && onboardingDone;

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
    // Guide + Contract + Signing collapsed into one pipeline step
    // since they were always one logical phase (the contract
    // workflow). "Done" = fully countersigned OR a staff manual mark.
    // The Gmail-touch flags (guideSent / contractSent) only fire when
    // the deliverables go out via an email Gmail can log — but staff
    // might paste the signing URL into a text / DM, or close out the
    // deal entirely off-platform; the contract still got executed.
    // The countersign timestamp is the authoritative auto signal,
    // contract_marked_done_at is the manual fallback for the
    // off-platform path.
    const flags = [
      { label: 'Projection', done: projectionSent },
      { label: 'Guide & Contract', done: contractStageDone },
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

        {/* Existing-owner banner: this prospect's owner already manages
            (or is being prospected for) other properties with us. A
            second unit for an existing owner reuses their identity by
            email, so they stay one owner across the portfolio. */}
        {(ownerPortfolio.properties.length > 0 || ownerPortfolio.prospects.length > 0) && (
          <div
            style={{
              marginTop: 14,
              padding: '12px 16px',
              border: '1px solid var(--positive)',
              background: 'rgba(47,122,58,0.06)',
              borderRadius: 6,
              fontSize: 13,
              color: 'var(--ink)',
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: 8,
            }}
          >
            <span style={{ fontWeight: 600, color: 'var(--positive)' }}>Existing owner.</span>
            <span style={{ color: 'var(--ink-3)' }}>
              Already with Rising Tide on:
            </span>
            {ownerPortfolio.properties.map((op) => (
              <Link key={op.id} href={`/properties/${op.id}`} style={{ color: 'var(--ink)', textDecoration: 'underline', textUnderlineOffset: 3 }}>
                {op.name}
              </Link>
            ))}
            {ownerPortfolio.prospects.map((op) => (
              <Link key={op.id} href={`/projections/${op.id}`} style={{ color: 'var(--ink-3)', textDecoration: 'underline', textUnderlineOffset: 3 }}>
                {op.property_address} (prospect)
              </Link>
            ))}
          </div>
        )}
        {/* Two hero summaries side-by-side: pipeline progress (left) for
            "where is this deal?" and close-likelihood (right) for "how
            likely are we to get it?" Cover-range / Year-1 detail moved
            down into Stage 01's body where it sits alongside the
            tiered-rule + AirDNA breakdown. */}
        <style>{`
          .rt-prospect-hero-kpis {
            margin-top: 26px;
            display: grid;
            grid-template-columns: minmax(0, 1fr) auto;
            gap: 48px;
            align-items: flex-end;
          }
          /* Mobile: stack the pipeline bar above the close-likelihood
             widget so the bar gets full width and labels stop colliding
             with the widget. */
          @media (max-width: 720px) {
            .rt-prospect-hero-kpis {
              grid-template-columns: minmax(0, 1fr);
              gap: 22px;
              align-items: flex-start;
              margin-top: 22px;
            }
          }
        `}</style>
        <div className="rt-prospect-hero-kpis">
          <PipelineProgressBar steps={pipelineSteps} doneCount={doneCount} />
          <CloseLikelihoodWidget projectionId={id} value={projection.close_likelihood_pct} size="large" />
        </div>
      </section>

      <ProspectTexts texts={prospectTexts} touches={projection.gmail_touches} name={projection.prospect_first_name ?? projection.prospect_name} />

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

          {/* 02 — Partnership Guide, Contract, AND Signing. The
              previous 02 (Guide + Contract sent) and 03 (Signing)
              were always one logical phase: the contract workflow.
              Folding them into one stage shows the whole arc in one
              card, with each piece as a sub-deliverable. */}
          <Stage
            num="02"
            title="Partnership Guide & Contract"
            state={contractStageDone ? 'done' : 'active'}
            status={
              // Status priority: fully executed > marked complete > signed/awaiting
              // > both sent > one sent > nothing sent.
              countersigned
                ? <>Fully executed {fmtTouchDate(projection.contract_countersigned_at!)}</>
                : contractMarkedDone
                  ? <>Marked complete {fmtTouchDate(projection.contract_marked_done_at!)}</>
                  : signed
                    ? <>Signed {fmtTouchDate(projection.contract_signed_at!)}{projection.contract_signed_name ? ` by ${projection.contract_signed_name}` : ''} · awaiting countersign</>
                    : guideSent && contractSent
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
            <GuideAndContractStageBody
              projection={projection}
              projectionId={id}
              markContractDone={markContract}
              unmarkContractDone={unmarkContract}
            />
          </Stage>

          {/* 03 — Onboarding (was 04 before contract workflow merge) */}
          <Stage
            num="03"
            title="Onboarding"
            state={onboardingDone ? 'done' : 'active'}
            status={
              onboardingSubmitted
                ? <>Submitted {fmtTouchDate(projection.onboarding_submitted_at!)}</>
                : onboardingMarkedDone
                  ? <>Marked complete {fmtTouchDate(projection.onboarding_marked_done_at!)}</>
                  : 'Awaiting submission'
            }
          >
            <OnboardingStageBody
              projection={projection}
              projectionId={id}
              onboardingTouch={onboardingTouch ? gmailStatus(onboardingTouch) : null}
              markOnboardingDone={markOnboarding}
              unmarkOnboardingDone={unmarkOnboarding}
            />
          </Stage>

          {/* 04 — Promote to managed property (was 05) */}
          <Stage
            num="04"
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
function GuideAndContractStageBody({
  projection,
  projectionId,
  markContractDone,
  unmarkContractDone,
}: {
  projection: ProjectionRow;
  projectionId: string;
  markContractDone: () => Promise<void>;
  unmarkContractDone: () => Promise<void>;
}) {
  const termRange = projection.term_start && projection.term_end
    ? `Term ${fmtTouchDate(projection.term_start)} → ${fmtTouchDate(projection.term_end)}`
    : 'Term dates pending';
  const fee = `${fmtPercent(projection.mgmt_fee_pct)} mgmt fee`;
  const countersigned = !!projection.contract_countersigned_at;
  const markedDone = projection.contract_marked_done_at;
  return (
    <>
      {/* Partnership Guide sub-deliverable */}
      <SubDeliverable label="Partnership Guide">
        <DeliverableActions projectionId={projectionId} type="guide" openSlug="guide" downloadLabel="Download Guide" />
      </SubDeliverable>

      {/* Contract sub-deliverable */}
      <SubDeliverable label="Contract">
        <div style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 12 }}>
          {termRange} · {fee} · {projection.initial_deposit != null
            ? `$${projection.initial_deposit.toLocaleString()} deposit`
            : 'no deposit'}
        </div>
        <DeliverableActions projectionId={projectionId} type="contract" openSlug="contract" downloadLabel="Download Contract" />
        <RedlinesDisclosure>
          <ContractRedlinesPanel projection={projection} />
        </RedlinesDisclosure>
      </SubDeliverable>

      {/* Signing sub-deliverable - folded in from what used to be a
          separate Stage 03. The signing link, audit stamps, and
          countersign workflow all live here so the whole contract
          arc (guide → contract → signature → countersign) reads as
          one phase on the page. isLast flips when the manual-override
          block below is hidden (countersigned), so the stage card
          doesn't trail off with a stray separator. */}
      <SubDeliverable label="Signing" isLast={countersigned}>
        <SignedStageBody projection={projection} />
      </SubDeliverable>

      {/* Manual completion — only when the contract hasn't been
          countersigned in-Helm. Lets staff advance the pipeline to
          Promote when the deal closed out elsewhere (signed in person,
          executed via a one-off, etc.). Mirrors the Onboarding stage's
          "Mark complete" override. */}
      {!countersigned && (
        <SubDeliverable label="Manual override" isLast>
          {markedDone ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, color: 'var(--positive)', fontWeight: 500 }}>
                ✓ Marked complete {fmtTouchDate(markedDone)} — pipeline advanced.
              </span>
              <form action={unmarkContractDone} style={{ display: 'inline-block' }}>
                <button
                  type="submit"
                  style={{ ...ghostButtonStyle, fontSize: 10, padding: '7px 12px' }}
                >
                  Undo
                </button>
              </form>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
              <form action={markContractDone} style={{ display: 'inline-block' }}>
                <button type="submit" style={ghostButtonStyle}>
                  Mark contract complete
                </button>
              </form>
              <span style={{ fontSize: 11, color: 'var(--ink-4)', fontStyle: 'italic' }}>
                Use when the contract was executed outside the in-Helm signing flow.
              </span>
            </div>
          )}
        </SubDeliverable>
      )}
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
  const countersignedAt = projection.contract_countersigned_at;
  const ownerEmailSentAt = projection.contract_owner_email_sent_at;
  const executedEmailSentAt = projection.contract_executed_email_sent_at;
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
          Signed by <strong>{signedName}</strong> on {new Date(signedAt).toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short', timeZone: 'America/New_York' })}
          {projection.contract_signed_ip ? ` from ${projection.contract_signed_ip}` : ''}.
          {ownerEmailSentAt && (
            <>
              {' '}<span style={{ color: 'var(--ink-3)' }}>(signed copy emailed to owner {fmtTouchDate(ownerEmailSentAt)})</span>
            </>
          )}
        </p>
      )}
      {/* Countersign workflow: appears only once the owner has signed
          and Allie hasn't countersigned yet. After countersign, shows
          the executed-state summary including the "fully executed
          email sent" timestamp. */}
      {signedAt && !countersignedAt && (
        <CountersignRow projectionId={projection.id} />
      )}
      {countersignedAt && (
        <p style={{ marginTop: 0, marginBottom: 12, fontSize: 12, color: 'var(--ink)', lineHeight: 1.55, maxWidth: 720 }}>
          Countersigned by <strong>Allie O&rsquo;Brien</strong> on {new Date(countersignedAt).toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short', timeZone: 'America/New_York' })}. Fully executed.
          {executedEmailSentAt && (
            <>
              {' '}<span style={{ color: 'var(--ink-3)' }}>(executed copy emailed to owner {fmtTouchDate(executedEmailSentAt)})</span>
            </>
          )}
        </p>
      )}
      <LinkRow link={link} />
      {/* Once the owner has signed, surface a download for the signed
          PDF directly here (otherwise staff have to dig through the
          onboarding@ inbox to get a fresh copy). The DOWNLOAD CONTRACT
          button in stage 02 also works — same /api/projection-pdf
          endpoint — but having it inline with the signed state is more
          discoverable. */}
      {signedAt && (
        <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Link
            href={`/api/projection-pdf?id=${projection.id}&type=contract`}
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
              whiteSpace: 'nowrap',
            }}
          >
            ↓ Download {countersignedAt ? 'fully executed' : 'signed'} PDF
          </Link>
          {/* Drive archive link — present once the executed contract has
              been uploaded to the Rising Tide shared drive at countersign.
              Gives a one-click jump to the durable off-platform copy. */}
          {projection.contract_drive_url && (
            <Link
              href={projection.contract_drive_url}
              target="_blank"
              style={{
                background: 'transparent',
                color: 'var(--ink-3)',
                fontSize: 11,
                fontWeight: 600,
                letterSpacing: '.18em',
                textTransform: 'uppercase',
                padding: '9px 16px',
                border: '1px solid var(--rule)',
                textDecoration: 'none',
                whiteSpace: 'nowrap',
              }}
            >
              ↗ View in Drive archive
            </Link>
          )}
        </div>
      )}
    </>
  );
}

/**
 * Countersign action UI. A single form-button that POSTs to
 * countersignContract. Server action does the auth check, stamps
 * contract_countersigned_at, renders the fully-executed PDF, and
 * emails the owner with Allie CC'd.
 */
function CountersignRow({ projectionId }: { projectionId: string }) {
  return (
    <form action={countersignContract} style={{ marginTop: 0, marginBottom: 12, maxWidth: 720 }}>
      <input type="hidden" name="id" value={projectionId} />
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 16,
        flexWrap: 'wrap',
        padding: 14,
        border: '1px solid var(--rule)',
        background: 'var(--paper-2)',
      }}>
        <div style={{ fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.55, maxWidth: 460 }}>
          The owner has signed. Click to add Allie&rsquo;s countersignature and email the owner the fully executed contract (you&rsquo;ll be CC&rsquo;d). The send takes ~10 seconds while the PDF re-renders with both signatures.
        </div>
        <CountersignButton />
      </div>
    </form>
  );
}

function OnboardingStageBody({
  projection,
  projectionId,
  onboardingTouch,
  markOnboardingDone,
  unmarkOnboardingDone,
}: {
  projection: ProjectionRow;
  projectionId: string;
  onboardingTouch: React.ReactNode | null;
  markOnboardingDone: () => Promise<void>;
  unmarkOnboardingDone: () => Promise<void>;
}) {
  const submitted = projection.onboarding_submitted_at;
  const markedDone = projection.onboarding_marked_done_at;
  const data = projection.onboarding_data;
  const link = `/onboarding/${projection.onboarding_token}`;

  // Inputs that drive the readiness checklist's computed quantities.
  // Show a one-line "computed for X guests / Y bedrooms / Z bathrooms"
  // hint so it's clear how the punch-list numbers were derived before
  // opening the doc.
  const beds = Math.max(1, Math.round(projection.bedrooms || 1));
  const guests = beds * 2;
  const intakeBaths = projection.onboarding_data?.bathrooms;
  const bathsParsed = intakeBaths ? parseFloat(String(intakeBaths).replace(/[^0-9.]/g, '')) : NaN;
  const baths = Number.isFinite(bathsParsed) && bathsParsed > 0
    ? Math.ceil(bathsParsed)
    : Math.max(1, Math.round(beds * 0.75));
  const bathsSource = Number.isFinite(bathsParsed) ? 'from intake' : 'estimated';

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

      {/* Manual completion — only when the owner hasn't submitted the
          public form. Lets staff advance the pipeline to Promote when
          the property info was gathered another way (call, walkthrough,
          emailed PDF). */}
      {!submitted && (
        <div style={{ marginTop: 14 }}>
          {markedDone ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, color: 'var(--positive)', fontWeight: 500 }}>
                ✓ Marked complete {fmtTouchDate(markedDone)} — pipeline advanced.
              </span>
              <form action={unmarkOnboardingDone} style={{ display: 'inline-block' }}>
                <button
                  type="submit"
                  style={{ ...ghostButtonStyle, fontSize: 10, padding: '7px 12px' }}
                >
                  Undo
                </button>
              </form>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
              <form action={markOnboardingDone} style={{ display: 'inline-block' }}>
                <button type="submit" style={ghostButtonStyle}>
                  Mark onboarding complete
                </button>
              </form>
              <span style={{ fontSize: 11, color: 'var(--ink-4)', fontStyle: 'italic' }}>
                Use when you&rsquo;ve gathered the property info another way.
              </span>
            </div>
          )}
        </div>
      )}

      {/* Readiness checklist — sub-deliverable that lives inside the
          Onboarding stage rather than its own pipeline step. Always
          available; quantities default from projection.bedrooms when the
          intake form hasn't been submitted yet, and refine once the
          owner fills in bathrooms. */}
      <div style={{ marginTop: 18, paddingTop: 16, borderTop: '1px solid var(--rule)' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', marginBottom: 6 }}>
          <span className="eyebrow">Property Readiness Checklist</span>
          <span style={{ fontSize: 11, color: 'var(--ink-4)', fontStyle: 'italic' }}>
            optional · walk-through punch list
          </span>
        </div>
        <p style={{ margin: '0 0 12px', fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.55, maxWidth: 720 }}>
          Room-by-room punch list to turn the property from owner-ready to guest-ready. Quantities
          are computed for {guests} guests across {beds} bedroom{beds === 1 ? '' : 's'} and {baths}{' '}
          bathroom{baths === 1 ? '' : 's'} ({bathsSource}). Useful for owners new to STR who need
          help sizing pots, towels, and the supply closet.
        </p>
        <DeliverableActions
          projectionId={projectionId}
          type="readiness"
          openSlug="readiness"
          downloadLabel="Download Checklist"
        />
      </div>

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
  if (projection.contract_marked_done_at) {
    events.push({ at: projection.contract_marked_done_at, label: 'Contract marked complete by staff' });
  }
  if (projection.onboarding_submitted_at) {
    events.push({ at: projection.onboarding_submitted_at, label: 'Onboarding form submitted' });
  }
  if (projection.onboarding_marked_done_at) {
    events.push({ at: projection.onboarding_marked_done_at, label: 'Onboarding marked complete by staff' });
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
  type: 'projection' | 'guide' | 'contract' | 'readiness';
  openSlug: 'render' | 'guide' | 'contract' | 'readiness';
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
  // The link is an absolute path (e.g. /contract/<token>). For the
  // Copy button we want the FULL URL with protocol+host so paste-into-
  // email yields a clickable link. resolve at server-render time via
  // the public site domain — falls back to the relative path if the
  // env var isn't set (dev / local).
  const base = process.env.NEXT_PUBLIC_HELM_ORIGIN || 'https://statements.risingtidestr.com';
  const fullUrl = link.startsWith('http') ? link : `${base}${link}`;
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
      <CopyLinkButton text={fullUrl} />
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
    line-height: 1.25;
    color: var(--ink-4);
    /* Wrap freely so multi-word labels ("Guide & Contract") don't overflow
       into neighboring columns on narrow viewports. nowrap on desktop
       where there's room. */
    word-break: break-word;
    hyphens: auto;
    padding: 0 4px;
  }
  .rt-pbar-step[data-state="done"] .rt-pbar-label {
    color: var(--ink);
    font-weight: 500;
  }
  .rt-pbar-step[data-state="active"] .rt-pbar-label {
    color: var(--signal);
    font-weight: 600;
  }
  /* Mobile: shrink the labels a touch and let the bar breathe. The
     column grid stays equal-width so the connectors still line up. */
  @media (max-width: 640px) {
    .rt-pbar-label {
      font-size: 10px;
      letter-spacing: 0.02em;
      padding: 0 2px;
    }
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
