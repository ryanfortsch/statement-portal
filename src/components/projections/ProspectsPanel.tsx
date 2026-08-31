import Link from 'next/link';
import { SyncGmailButton } from '@/components/projections/SyncGmailButton';
import { InactiveQuickAction } from '@/components/projections/ProspectInactiveControls';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import type { GmailTouchType, ProjectionRow } from '@/lib/projections-types';
import { computeProjection, fmtMoneyRange } from '@/lib/projections-model';

/**
 * The prospect funnel body: the New-Prospect CTA + Gmail sync, the active
 * prospect list, and the promoted/archive list.
 *
 * Extracted from /projections/page.tsx so the exact same funnel renders in
 * two places without drift: the standalone Prospects page (masthead + hero +
 * this + footer) AND the "Prospects" tab on /properties. Fetches its own
 * data; the host page supplies only the surrounding chrome.
 */
async function getProjections(): Promise<ProjectionRow[]> {
  const { data } = await supabase
    .from('projections')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(200);
  return (data ?? []) as ProjectionRow[];
}

export async function ProspectsPanel() {
  const projections = await getProjections();

  // Three-way split. Promoted (became managed properties) and Inactive
  // (demoted: never signed, no longer viable) both leave the active scan
  // but stay fully accessible — promoted for revisiting the original
  // deck / contract / walkthrough, inactive because deleting a dead deal
  // throws away the projection, the contract draft, and the history of
  // why it died. property_id wins when both could apply.
  const active = projections.filter((p) => !p.property_id && !p.inactive_at);
  const archived = projections.filter((p) => !!p.property_id);
  const inactive = projections.filter((p) => !p.property_id && !!p.inactive_at);

  return (
    <>
      {/* CTA */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 40, width: '100%' }}>
        <div className="rt-projections-cta" style={{ borderTop: '1px solid var(--ink)', borderBottom: '1px solid var(--ink)', padding: '24px 0', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12 }}>
          <Link
            href="/prospects/new"
            className="rt-projections-cta-primary"
            style={{
              display: 'inline-block',
              background: 'var(--ink)',
              color: 'var(--paper)',
              fontSize: 12,
              fontWeight: 600,
              letterSpacing: '.18em',
              textTransform: 'uppercase',
              padding: '14px 28px',
              textDecoration: 'none',
            }}
          >
            New Prospect →
          </Link>
          <SyncGmailButton />
          <span className="rt-projections-cta-spacer" style={{ flex: 1 }} />
          <span className="rt-projections-cta-note" style={{ fontSize: 11, color: 'var(--ink-4)', fontStyle: 'italic' }}>
            Sync scans Allie&rsquo;s sent folder for prospect emails and tags each row with the last deliverable seen.
          </span>
        </div>
      </section>

      {/* ACTIVE LIST */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: archived.length + inactive.length > 0 ? 48 : 80, flex: 1, width: '100%' }}>
        <div className="flex items-baseline justify-between" style={{ marginBottom: 14 }}>
          <h2 className="font-serif" style={{ fontSize: 22, fontWeight: 400, letterSpacing: '-0.01em', color: 'var(--ink)', margin: 0 }}>
            Active Prospects
          </h2>
          <span className="eyebrow">{active.length} active</span>
        </div>

        {active.length === 0 ? (
          <div style={{ borderTop: '1px solid var(--ink)', padding: '32px 0', textAlign: 'center' }}>
            <p style={{ color: 'var(--ink-3)', marginBottom: 8 }}>
              {projections.length === 0 ? 'No prospects yet.' : 'No active prospects.'}
            </p>
            <p style={{ color: 'var(--ink-4)', fontSize: 12 }}>
              {projections.length === 0
                ? <>Click &ldquo;New Prospect&rdquo; above to get started.</>
                : <>Everything on file has been promoted or marked inactive.</>}
            </p>
          </div>
        ) : (
          <div style={{ borderTop: '1px solid var(--ink)' }}>
            {active.map((p, i) => (
              <ProjectionRowItem key={p.id} projection={p} number={String(i + 1).padStart(2, '0')} />
            ))}
          </div>
        )}
      </section>

      {/* ARCHIVE — promoted prospects. Hidden entirely when empty so a
          first-time user doesn't see a phantom section. Same row layout as
          active, but the row's status badge reads "Promoted" and the
          close-likelihood chip is hidden (irrelevant on a closed deal). */}
      {archived.length > 0 && (
        <section className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: inactive.length > 0 ? 48 : 80, width: '100%' }}>
          <div className="flex items-baseline justify-between" style={{ marginBottom: 6 }}>
            <h2 className="font-serif" style={{ fontSize: 22, fontWeight: 400, letterSpacing: '-0.01em', color: 'var(--ink-3)', margin: 0 }}>
              Promoted
            </h2>
            <span className="eyebrow">
              {archived.length} archived
            </span>
          </div>
          <p style={{ margin: '0 0 14px', fontSize: 12, color: 'var(--ink-4)', lineHeight: 1.5, maxWidth: 580 }}>
            These prospects became managed properties. Click any row to revisit the original projection,
            contract, and walkthrough.
          </p>
          <div style={{ borderTop: '1px solid var(--ink-3)' }}>
            {archived.map((p, i) => (
              <ProjectionRowItem key={p.id} projection={p} number={String(i + 1).padStart(2, '0')} />
            ))}
          </div>
        </section>
      )}

      {/* INACTIVE — demoted prospects: never signed, no longer a viable
          opportunity, kept on file instead of deleted. Hidden entirely when
          empty. Reactivate puts a row straight back in the active list. */}
      {inactive.length > 0 && (
        <section className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 80, width: '100%' }}>
          <div className="flex items-baseline justify-between" style={{ marginBottom: 6 }}>
            <h2 className="font-serif" style={{ fontSize: 22, fontWeight: 400, letterSpacing: '-0.01em', color: 'var(--ink-3)', margin: 0 }}>
              Inactive
            </h2>
            <span className="eyebrow">
              {inactive.length} inactive
            </span>
          </div>
          <p style={{ margin: '0 0 14px', fontSize: 12, color: 'var(--ink-4)', lineHeight: 1.5, maxWidth: 580 }}>
            Deals that didn&rsquo;t happen, kept on file. Everything is still here — projection,
            contract draft, intake — and Reactivate puts one back in the funnel if the owner returns.
          </p>
          <div style={{ borderTop: '1px solid var(--ink-3)' }}>
            {inactive.map((p, i) => (
              <ProjectionRowItem key={p.id} projection={p} number={String(i + 1).padStart(2, '0')} />
            ))}
          </div>
        </section>
      )}
    </>
  );
}

function ProjectionRowItem({ projection: p, number }: { projection: ProjectionRow; number: string }) {
  const computed = computeProjection(p);
  const range = fmtMoneyRange(computed.heroLow, computed.heroHigh);
  const promoted = !!p.property_id;
  const isInactive = !promoted && !!p.inactive_at;
  const sent = p.status === 'sent';
  const touches = p.gmail_touches || {};
  const touchTypes: GmailTouchType[] = ['projection', 'guide', 'contract', 'onboarding'];
  const seen = touchTypes.filter((t) => touches[t]);
  const latestTouch = seen
    .map((t) => ({ type: t, at: touches[t]!.sent_at }))
    .sort((a, b) => b.at.localeCompare(a.at))[0];

  // Status badge text + color. Promoted wins over everything (it's the
  // terminal state); Inactive is the demoted parking state; otherwise the
  // existing last-touch / marked-sent / draft ladder applies.
  let statusText: string;
  let statusColor: string;
  if (promoted) {
    statusText = 'Promoted';
    statusColor = 'var(--positive)';
  } else if (isInactive) {
    statusText = `Inactive · ${shortDate(p.inactive_at!)}`;
    statusColor = 'var(--ink-4)';
  } else if (latestTouch) {
    statusText = `Last touch ${shortDate(latestTouch.at)}`;
    statusColor = 'var(--positive)';
  } else if (sent) {
    statusText = 'Marked sent';
    statusColor = 'var(--positive)';
  } else {
    statusText = 'Draft';
    statusColor = 'var(--ink-4)';
  }

  return (
    <Link href={`/prospects/${p.id}`} style={{ display: 'block', textDecoration: 'none', color: 'inherit' }}>
      <div
        className="rt-projections-row"
        style={{
          display: 'grid',
          gridTemplateColumns: '64px 1fr auto auto',
          gap: 24,
          alignItems: 'baseline',
          padding: '20px 0 18px',
          borderBottom: '1px solid var(--rule)',
          // Promoted / inactive rows render a touch softer so the eye
          // lands on active prospects first without the archives looking
          // broken. Inactive goes softer still — it's the dead pile.
          opacity: promoted ? 0.78 : isInactive ? 0.65 : 1,
        }}
      >
        <span className="font-mono rt-projections-row-num" style={{ fontSize: 11, color: 'var(--signal)', letterSpacing: '.08em' }}>
          {number}
        </span>
        <div className="rt-projections-row-body" style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
            <h3 className="font-serif rt-projections-row-title" style={{ fontSize: 22, fontWeight: 400, letterSpacing: '-0.02em', color: 'var(--ink)', margin: 0, wordBreak: 'break-word' }}>
              {p.property_address}
            </h3>
            {/* Close-likelihood is an active-funnel metric — hide on
                promoted rows (deal closed) and inactive rows (deal dead). */}
            {!promoted && !isInactive && <LikelihoodChip pct={p.close_likelihood_pct} />}
          </div>
          <p style={{ marginTop: 4, fontSize: 13, color: 'var(--ink-3)' }}>
            {p.prospect_name}
            {p.market ? ` · ${p.market}` : ''}
            {p.bedrooms ? ` · ${p.bedrooms} BR` : ''}
          </p>
          {isInactive && p.inactive_reason && (
            <p style={{ marginTop: 4, fontSize: 12, color: 'var(--ink-4)', fontStyle: 'italic' }}>
              {p.inactive_reason}
            </p>
          )}
          {seen.length > 0 && (
            <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {seen.map((t) => (
                <TouchBadge key={t} type={t} sentAt={touches[t]!.sent_at} fromUser={touches[t]!.from_user} />
              ))}
            </div>
          )}
        </div>
        <span className="tabular-nums rt-projections-row-range" style={{ fontSize: 13, color: 'var(--ink)', whiteSpace: 'nowrap' }}>
          {range}
        </span>
        <span
          className="rt-projections-row-status"
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'flex-end',
            gap: 6,
            fontSize: 10,
            letterSpacing: '.22em',
            textTransform: 'uppercase',
            fontWeight: 500,
            color: statusColor,
            whiteSpace: 'nowrap',
            textAlign: 'right',
          }}
        >
          {statusText}
          {/* One-click demote / reactivate without leaving the list.
              Promoted rows get neither — property_id owns that state. */}
          {!promoted && (
            <InactiveQuickAction projectionId={p.id} mode={isInactive ? 'reactivate' : 'demote'} />
          )}
        </span>
      </div>
    </Link>
  );
}

const TOUCH_LABEL: Record<GmailTouchType, string> = {
  projection: 'Projection',
  guide: 'Guide',
  contract: 'Contract',
  onboarding: 'Onboarding',
};

function TouchBadge({ type, sentAt, fromUser }: { type: GmailTouchType; sentAt: string; fromUser?: string }) {
  // Eastern-pinned: server renders in UTC on Vercel; without the tz hint
  // the tooltip would read 4–5h ahead of Rising Tide local.
  const tip = `${TOUCH_LABEL[type]} sent ${new Date(sentAt).toLocaleString('en-US', { timeZone: 'America/New_York' })}${fromUser ? ` by ${fromUser}` : ''}`;
  return (
    <span
      title={tip}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '3px 8px',
        background: 'var(--paper-2)',
        border: '1px solid var(--rule)',
        fontSize: 10,
        letterSpacing: '.06em',
        color: 'var(--ink)',
        fontWeight: 500,
        borderRadius: 999,
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--positive)' }} aria-hidden />
      {TOUCH_LABEL[type]} · {shortDate(sentAt)}
    </span>
  );
}

function shortDate(iso: string): string {
  try {
    // Eastern-pinned: a Gmail send at 11pm EDT would otherwise display
    // as the next day in the row's "Last touch" chip.
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      timeZone: 'America/New_York',
    });
  } catch {
    return iso.slice(0, 10);
  }
}

/**
 * Read-only close-likelihood chip for the list row. Inside a row-wide
 * `<Link>` so it can't be a button — clicking the row navigates to the
 * detail page where the inline edit widget lives. Three bands of color
 * (cold/warm/hot) match the detail-page widget's visual code.
 */
function LikelihoodChip({ pct }: { pct: number | null }) {
  if (pct == null) {
    return (
      <span
        style={{
          background: 'transparent',
          border: '1px dashed var(--rule)',
          color: 'var(--ink-4)',
          fontSize: 10,
          fontWeight: 500,
          letterSpacing: '0.04em',
          padding: '2px 8px',
          borderRadius: 999,
          whiteSpace: 'nowrap',
        }}
      >
        Set close %
      </span>
    );
  }
  const hot = pct >= 67;
  const cold = pct < 33;
  return (
    <span
      title={`${pct}% likely to close`}
      style={{
        background: 'var(--paper-2)',
        border: `1px solid ${hot ? 'var(--positive)' : cold ? 'var(--rule)' : 'var(--ink-3)'}`,
        color: hot ? 'var(--positive)' : cold ? 'var(--ink-4)' : 'var(--ink)',
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: '0.04em',
        padding: '3px 10px',
        borderRadius: 999,
        whiteSpace: 'nowrap',
      }}
    >
      {pct}% likely
    </span>
  );
}
