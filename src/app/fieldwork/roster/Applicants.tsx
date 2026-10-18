import Link from 'next/link';
import type { ContractorApplication } from '@/lib/field-packets';
import { TRADE_META, type ContractorTrade } from '@/lib/field-types';
import { CopyCode } from '@/app/field/CopyCode';
import { SubmitButton } from '@/components/SubmitButton';
import { inviteApplicant, declineApplicant, reopenApplicant, screenApplicants } from '../hiring/actions';
import { inviteContractor } from '../packets/actions';
import { ScreenButton } from '../hiring/ScreenButton';

/**
 * The applicant pipeline, at the top of each trade's roster. It used to be
 * its own Hiring page, a short list one link away that made the same
 * contractor row the roster's own invite form made. Now there is one invite
 * door, here: invite an applicant from their card, or (below the cards)
 * someone who never applied.
 *
 * Staff screen and shortlist; inviting, declining and reopening are owner
 * calls (the actions refuse a staff session too).
 */

function fmtWhen(d: string): string {
  try {
    return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return d;
  }
}

const SOURCES = ['indeed', 'facebook', 'nextdoor', 'craigslist', 'referral'];

type Rec = 'reach_out' | 'maybe' | 'pass';
const REC_META: Record<Rec, { label: string; color: string; bg: string; border: string }> = {
  reach_out: { label: 'Reach out', color: '#2e7d4f',      bg: 'rgba(46,125,79,0.10)',  border: 'none' },
  maybe:     { label: 'Maybe',     color: '#9a6a1e',      bg: 'rgba(154,106,30,0.10)', border: 'none' },
  pass:      { label: 'Pass',      color: 'var(--ink-4)', bg: 'transparent',           border: '1px solid var(--rule)' },
};

/** Sort key for the active list: unscreened first (need attention), then
 *  reach_out, maybe, pass. */
function recRank(r: Rec | null): number {
  if (r == null) return -1;
  return r === 'reach_out' ? 0 : r === 'maybe' ? 1 : 2;
}

function RecChip({ rec, score }: { rec: Rec | null; score: number | null }) {
  if (!rec) {
    return (
      <span style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)', marginLeft: 8 }}>
        Not screened
      </span>
    );
  }
  const m = REC_META[rec];
  return (
    <span
      title={score != null ? `AI fit ${score}/100` : undefined}
      style={{ fontSize: 10, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: m.color, background: m.bg, border: m.border, borderRadius: 999, padding: '2px 9px', marginLeft: 8, whiteSpace: 'nowrap' }}
    >
      {m.label}
    </span>
  );
}

/** The trade's active applicants, newest pipeline first. */
export function activeApplicants(apps: ContractorApplication[], trade: ContractorTrade): ContractorApplication[] {
  return apps
    .filter((a) => (a.trade ?? 'inspection') === trade && (a.status === 'new' || a.status === 'reviewing'))
    .sort((a, b) => {
      // Unscreened float to the top (they need attention / a Screen pass),
      // then strong fits, then maybe, then likely-pass. Score breaks ties.
      const ra = recRank(a.ai_recommendation);
      const rb = recRank(b.ai_recommendation);
      if (ra !== rb) return ra - rb;
      return (b.ai_score ?? -1) - (a.ai_score ?? -1);
    });
}

export function Applicants({
  apps,
  trade,
  owner,
  base,
}: {
  /** Every application; this section keeps the lit trade's. */
  apps: ContractorApplication[];
  trade: ContractorTrade;
  owner: boolean;
  base: string;
}) {
  const meta = TRADE_META[trade];
  const mine = apps.filter((a) => (a.trade ?? 'inspection') === trade);
  const active = activeApplicants(apps, trade);
  const invited = mine.filter((a) => a.status === 'invited');
  const declined = mine.filter((a) => a.status === 'declined');
  const unscreened = active.filter((a) => a.ai_assessed_at == null).length;
  const article = trade === 'creative' ? 'a contributor' : `${/^[aeiou]/i.test(meta.singular) ? 'an' : 'a'} ${meta.singular}`;

  return (
    <section id="applicants" aria-labelledby="applicants-heading" style={{ marginBottom: 30, scrollMarginTop: 88 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 10, flexWrap: 'wrap' }}>
        <h2 id="applicants-heading" style={{ fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', color: active.length > 0 ? 'var(--signal)' : 'var(--ink-4)', margin: 0 }}>
          Applicants · {active.length}
        </h2>
        {active.length > 0 && (
          <div style={{ display: 'flex', gap: 14, alignItems: 'baseline' }}>
            {unscreened > 0 && (
              <form action={screenApplicants} style={{ margin: 0 }}>
                <input type="hidden" name="scope" value="new" />
                <ScreenButton variant="primary" label={`✦ Screen ${unscreened} new`} />
              </form>
            )}
            {active.length - unscreened > 0 && (
              <form action={screenApplicants} style={{ margin: 0 }}>
                <input type="hidden" name="scope" value="all" />
                <ScreenButton variant="ghost" label="Re-screen all" />
              </form>
            )}
          </div>
        )}
      </div>
      {active.length > 0 && (
        <div style={{ fontSize: 11, color: 'var(--ink-4)', marginBottom: 10 }}>
          Sorted by an AI first pass. Advisory only; you make the call.
        </div>
      )}

      {active.map((a) => (
        <ApplicantCard key={a.id} a={a} owner={owner} />
      ))}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: active.length > 0 ? 4 : 0 }}>
        {invited.length > 0 && <Closed title={`Invited · ${invited.length}`} apps={invited} owner={owner} />}
        {declined.length > 0 && <Closed title={`Declined · ${declined.length}`} apps={declined} owner={owner} />}

        {/* The one invite door for someone who never applied (a referral,
            a returning contractor). Owners only, like the applicant Invite. */}
        {owner && (
          <details>
            <summary style={foldSummary}>+ Invite {article} who didn&apos;t apply ▾</summary>
            <p style={{ fontSize: 12.5, color: 'var(--ink-4)', margin: '8px 0 10px', lineHeight: 1.5 }}>
              We email them a personal portal link. They set up their account (W-9 + agreement) before they can{' '}
              {trade === 'creative' ? 'take on paid assets' : 'claim paid work'}.
            </p>
            <form action={inviteContractor} style={{ border: '1px solid var(--rule)', borderRadius: 12, background: 'var(--paper-2, #fff)', padding: '14px 18px', display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
              <label style={lbl}>
                Name
                <input name="full_name" required placeholder="Marcus Reed" style={inp} />
              </label>
              <label style={lbl}>
                Email
                <input name="email" type="email" required placeholder="marcus@example.com" style={inp} />
              </label>
              <label style={lbl}>
                Phone
                <input name="phone" type="tel" placeholder="(978) 555-0123" style={inp} />
              </label>
              <label style={lbl}>
                Trade
                {/* Cleaning is a valid trade with no tab (turnovers run through
                    Cape Ann Elite), so an invited cleaner would vanish from
                    every roster view. Not offered until a Cleaners tab exists. */}
                <select name="trade" defaultValue={trade} style={inp}>
                  <option value="inspection">Inspection</option>
                  <option value="maintenance">Maintenance</option>
                  <option value="creative">Creative</option>
                </select>
              </label>
              <SubmitButton label="Send invite" busyLabel="Sending invite…" style={btnDark} />
            </form>
          </details>
        )}

        {/* Shareable apply links, tagged by source for attribution. Folded:
            set-up material, not the day's work. */}
        <details>
          <summary style={foldSummary}>Apply links, one per place the job is posted ▾</summary>
          <div style={{ border: '1px solid var(--rule)', borderRadius: 10, padding: '14px 18px', marginTop: 8, background: 'var(--paper-2, #fff)' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 14px', fontSize: 13, alignItems: 'baseline' }}>
              {SOURCES.map((s) => (
                <div key={s} style={{ display: 'contents' }}>
                  <span style={{ color: 'var(--ink-4)', textTransform: 'capitalize' }}>{s}</span>
                  <CopyCode value={`${base}/field/apply?src=${s}${trade !== 'inspection' ? `&trade=${trade}` : ''}`} mono={false} />
                </div>
              ))}
            </div>
            <p style={{ margin: '12px 0 0', fontSize: 12, color: 'var(--ink-4)', lineHeight: 1.6 }}>
              What a new hire is signing up for, from a published packet to the payment, is written down in the Playbook:{' '}
              <Link href="/playbook/field-packets-from-publish-to-pay" style={{ color: 'var(--tide-deep)', textDecoration: 'underline', textUnderlineOffset: 3 }}>
                Field packets, from publish to pay
              </Link>
              .
            </p>
          </div>
        </details>
      </div>
    </section>
  );
}

function ApplicantCard({ a, owner }: { a: ContractorApplication; owner: boolean }) {
  return (
    <div style={{ border: '1px solid var(--signal)', borderRadius: 10, padding: '16px 18px', marginBottom: 12, background: 'var(--paper-2, #fff)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <div>
          <span className="font-serif" style={{ fontSize: 17 }}>{a.full_name}</span>
          <RecChip rec={a.ai_recommendation} score={a.ai_score} />
          <div style={{ fontSize: 12.5, marginTop: 4, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <a href={`mailto:${a.email}`} style={{ color: 'var(--tide-deep)', textDecoration: 'none' }}>{a.email}</a>
            {a.phone && (
              <>
                <span style={{ color: 'var(--rule)' }}>·</span>
                <a href={`tel:${a.phone.replace(/[^+\d]/g, '')}`} style={{ color: 'var(--tide-deep)', textDecoration: 'none' }}>{a.phone}</a>
                <a href={`sms:${a.phone.replace(/[^+\d]/g, '')}`} style={{ color: 'var(--tide-deep)', textDecoration: 'none', fontSize: 11, fontWeight: 600 }}>Text</a>
              </>
            )}
            {a.area && (
              <>
                <span style={{ color: 'var(--rule)' }}>·</span>
                <span style={{ color: 'var(--ink-4)' }}>{a.area}</span>
              </>
            )}
          </div>
        </div>
        <div style={{ fontSize: 11, color: 'var(--ink-4)', textAlign: 'right' }}>
          Applied {fmtWhen(a.created_at)}{a.source ? ` · via ${a.source}` : ''}
        </div>
      </div>
      {a.ai_reason && (
        <div style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 10, lineHeight: 1.5, display: 'flex', gap: 7 }}>
          <span aria-hidden style={{ color: 'var(--tide-deep)', flexShrink: 0 }}>✦</span>
          <span style={{ fontStyle: 'italic' }}>{a.ai_reason}</span>
        </div>
      )}
      {(a.availability || a.about || a.has_transport != null || a.heard_about || a.video_url) && (
        <div style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 10, lineHeight: 1.55 }}>
          {a.has_transport != null && (
            <div>
              <span style={{ color: 'var(--ink-4)' }}>Vehicle:</span>{' '}
              <span style={a.has_transport ? undefined : { color: 'var(--signal)', fontWeight: 600 }}>
                {a.has_transport ? 'yes' : 'no'}
              </span>
            </div>
          )}
          {a.availability && <div><span style={{ color: 'var(--ink-4)' }}>Available:</span> {a.availability}</div>}
          {a.heard_about && <div><span style={{ color: 'var(--ink-4)' }}>Heard via:</span> {a.heard_about}</div>}
          {a.video_url && (
            <div>
              <span style={{ color: 'var(--ink-4)' }}>Video:</span>{' '}
              <a href={a.video_url} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--tide-deep)' }}>
                Watch ↗
              </a>
            </div>
          )}
          {a.about && <div style={{ marginTop: 4 }}>{a.about}</div>}
        </div>
      )}
      {/* Staff screen and shortlist; the invite is Ryan's. Say so once on
          the card, where the buttons would be. */}
      {!owner && (
        <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 14 }}>Ryan invites or declines.</div>
      )}
      {owner && (
        <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
          <form action={inviteApplicant} style={{ margin: 0 }}>
            <input type="hidden" name="application_id" value={a.id} />
            <SubmitButton label="Invite" busyLabel="Inviting…" style={btnDark} />
          </form>
          <form action={declineApplicant} style={{ margin: 0 }}>
            <input type="hidden" name="application_id" value={a.id} />
            <SubmitButton label="Decline" busyLabel="Declining…" style={btnGhost} spinnerTone="ink" />
          </form>
        </div>
      )}
    </div>
  );
}

function Closed({ title, apps, owner }: { title: string; apps: ContractorApplication[]; owner: boolean }) {
  return (
    <details>
      <summary style={{ ...foldSummary, color: 'var(--ink-4)', fontWeight: 500 }}>{title} ▾</summary>
      <div style={{ marginTop: 6 }}>
        {apps.map((a) => (
          <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, padding: '8px 0', borderBottom: '1px solid var(--rule)', opacity: 0.8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 14 }}>{a.full_name} <a href={`mailto:${a.email}`} style={{ color: 'var(--tide-deep)', fontSize: 12, textDecoration: 'none' }}>· {a.email}</a>{a.phone ? <> <a href={`tel:${a.phone.replace(/[^+\d]/g, '')}`} style={{ color: 'var(--tide-deep)', fontSize: 12, textDecoration: 'none' }}>· {a.phone}</a></> : null}</span>
            {owner && (
              <form action={reopenApplicant} style={{ margin: 0 }}>
                <input type="hidden" name="application_id" value={a.id} />
                <SubmitButton label="Reopen" busyLabel="Reopening…" style={{ ...btnGhost, padding: '4px 10px' }} spinnerTone="ink" />
              </form>
            )}
          </div>
        ))}
      </div>
    </details>
  );
}

const foldSummary: React.CSSProperties = {
  fontSize: 13,
  color: 'var(--tide-deep)',
  fontWeight: 600,
  cursor: 'pointer',
  listStyle: 'none',
  userSelect: 'none',
  padding: '6px 0',
};
const lbl: React.CSSProperties = { fontSize: 11, color: 'var(--ink-4)', display: 'flex', flexDirection: 'column', gap: 4 };
const inp: React.CSSProperties = {
  font: 'inherit',
  fontSize: 14,
  color: 'var(--ink)',
  background: 'var(--paper)',
  border: '1px solid var(--rule)',
  padding: '8px 10px',
  minWidth: 170,
  borderRadius: 6,
};
const btnDark: React.CSSProperties = {
  background: 'var(--ink)',
  color: 'var(--paper)',
  border: 'none',
  borderRadius: 6,
  cursor: 'pointer',
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  padding: '9px 18px',
};
const btnGhost: React.CSSProperties = {
  background: 'transparent',
  color: 'var(--ink-3)',
  border: '1px solid var(--rule)',
  borderRadius: 6,
  cursor: 'pointer',
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  padding: '9px 18px',
};
