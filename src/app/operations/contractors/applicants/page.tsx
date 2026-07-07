import { HelmMasthead } from '@/components/HelmMasthead';
import { FieldTabs } from '@/components/FieldTabs';
import { HelmFooter } from '@/components/HelmFooter';
import { isFieldConfigured } from '@/lib/field-db';
import { fieldBaseUrl } from '@/lib/field-notify';
import { loadApplications, type ContractorApplication } from '@/lib/field-packets';
import { parseTrade, TRADE_META } from '@/lib/field-types';
import { CopyCode } from '@/app/field/CopyCode';
import { SubmitButton } from '@/components/SubmitButton';
import { inviteApplicant, declineApplicant, reopenApplicant, screenApplicants } from './actions';
import { ScreenButton } from './ScreenButton';

export const dynamic = 'force-dynamic';

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

export default async function ApplicantsPage({
  searchParams,
}: {
  searchParams: Promise<{ trade?: string }>;
}) {
  const trade = parseTrade((await searchParams).trade);
  const meta = TRADE_META[trade];
  if (!isFieldConfigured) {
    return (
      <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
        <HelmMasthead current="operations" />
        <section className="max-w-[900px] mx-auto px-10" style={{ paddingTop: 56 }}>
          <p style={{ color: 'var(--ink-3)' }}>Set SUPABASE_SERVICE_ROLE_KEY to enable the Field module.</p>
        </section>
      </div>
    );
  }

  const apps = (await loadApplications()).filter((a) => (a.trade ?? 'inspection') === trade);
  const active = apps
    .filter((a) => a.status === 'new' || a.status === 'reviewing')
    .sort((a, b) => {
      // Unscreened float to the top (they need attention / a Screen pass),
      // then strong fits, then maybe, then likely-pass. Score breaks ties.
      const ra = recRank(a.ai_recommendation);
      const rb = recRank(b.ai_recommendation);
      if (ra !== rb) return ra - rb;
      return (b.ai_score ?? -1) - (a.ai_score ?? -1);
    });
  const invited = apps.filter((a) => a.status === 'invited');
  const declined = apps.filter((a) => a.status === 'declined');
  const unscreened = active.filter((a) => a.ai_assessed_at == null).length;
  const base = fieldBaseUrl();

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead current="field" />
      <FieldTabs current="hiring" trade={trade} />
      <section className="max-w-[900px] mx-auto px-10" style={{ width: '100%', paddingTop: 28, paddingBottom: 48 }}>
        <div style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--tide-deep)', fontWeight: 600, marginBottom: 2 }}>{meta.label}</div>
        <div className="font-serif" style={{ fontSize: 26, fontWeight: 400 }}>Applicants</div>
        <p style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 4, marginBottom: 20, maxWidth: 620 }}>
          People who applied to be a {meta.role} through the public link. Invite the good ones (we email them a portal
          link and they onboard themselves) or decline. Post the job anywhere and point it at these links:
        </p>

        {/* Shareable apply links, tagged by source for attribution */}
        <div style={{ border: '1px solid var(--rule)', borderRadius: 10, padding: '14px 18px', marginBottom: 28, background: 'var(--paper-2, #fff)' }}>
          <div style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-4)', marginBottom: 8 }}>
            Apply links
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 14px', fontSize: 13, alignItems: 'baseline' }}>
            {SOURCES.map((s) => (
              <div key={s} style={{ display: 'contents' }}>
                <span style={{ color: 'var(--ink-4)', textTransform: 'capitalize' }}>{s}</span>
                <CopyCode value={`${base}/field/apply?src=${s}${trade !== 'inspection' ? `&trade=${trade}` : ''}`} mono={false} />
              </div>
            ))}
          </div>
        </div>

        {active.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 12, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, color: 'var(--ink-4)', letterSpacing: '0.02em' }}>
              Sorted by an AI first pass. Advisory only — you make the call.
            </span>
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
          </div>
        )}

        {active.length === 0 && (
          <p style={{ color: 'var(--ink-4)', fontSize: 14 }}>No new applicants right now.</p>
        )}

        {active.map((a) => (
          <ApplicantCard key={a.id} a={a} />
        ))}

        {invited.length > 0 && (
          <Closed title={`Invited · ${invited.length}`} apps={invited} />
        )}
        {declined.length > 0 && (
          <Closed title={`Declined · ${declined.length}`} apps={declined} />
        )}
      </section>
      <HelmFooter module="Field" right={`${meta.label} applicants`} />
    </div>
  );
}

function ApplicantCard({ a }: { a: ContractorApplication }) {
  return (
    <div style={{ border: '1px solid var(--rule)', borderRadius: 10, padding: '16px 18px', marginBottom: 12, background: 'var(--paper-2, #fff)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'baseline', flexWrap: 'wrap' }}>
        <div>
          <span className="font-serif" style={{ fontSize: 17 }}>{a.full_name}</span>
          {a.trade !== 'inspection' && (
            <span style={{ fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--tide-deep)', border: '1px solid var(--rule)', borderRadius: 999, padding: '1px 7px', marginLeft: 8 }}>{a.trade}</span>
          )}
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
          {fmtWhen(a.created_at)}{a.source ? ` · via ${a.source}` : ''}
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
    </div>
  );
}

function Closed({ title, apps }: { title: string; apps: ContractorApplication[] }) {
  return (
    <div style={{ marginTop: 28 }}>
      <h2 style={{ fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--ink-4)', marginBottom: 8 }}>{title}</h2>
      {apps.map((a) => (
        <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, padding: '8px 0', borderBottom: '1px solid var(--rule)', opacity: 0.7, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 14 }}>{a.full_name} <a href={`mailto:${a.email}`} style={{ color: 'var(--tide-deep)', fontSize: 12, textDecoration: 'none' }}>· {a.email}</a>{a.phone ? <> <a href={`tel:${a.phone.replace(/[^+\d]/g, '')}`} style={{ color: 'var(--tide-deep)', fontSize: 12, textDecoration: 'none' }}>· {a.phone}</a></> : null}</span>
          <form action={reopenApplicant} style={{ margin: 0 }}>
            <input type="hidden" name="application_id" value={a.id} />
            <SubmitButton label="Reopen" busyLabel="Reopening…" style={{ ...btnGhost, padding: '4px 10px' }} spinnerTone="ink" />
          </form>
        </div>
      ))}
    </div>
  );
}

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
