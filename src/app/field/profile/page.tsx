import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { resolveContractorFromCookie } from '@/lib/field-auth';
import { loadContractorProfile, type ContractorReview, type ContractorHistoryItem } from '@/lib/field-profile';
import { dollars, TRADE_META, type ContractorRow } from '@/lib/field-types';
import { STREAK_MILESTONES, STREAK_CYCLE_DAYS, type StreakInfo } from '@/lib/field-streaks';
import { FieldShell } from '../FieldShell';
import { ProfilePhoto } from '../ProfilePhoto';
import { SmsToggle } from '../SmsToggle';
import { ReviewText } from './ReviewText';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Your profile · Rising Tide Field',
  robots: { index: false, follow: false, googleBot: { index: false, follow: false } },
};

const GOLD = '#b8860b';

function monthYear(d: string | null): string {
  if (!d) return '';
  try {
    return new Date(d).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  } catch {
    return '';
  }
}
function shortDate(d: string | null): string {
  if (!d) return '';
  // Accept a bare YYYY-MM-DD (visit dates) OR a full timestamp (review times).
  // Pull the leading date part and format that; never render "Invalid Date".
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(d);
  if (!m) return '';
  const dt = new Date(`${m[1]}T00:00:00`);
  if (Number.isNaN(dt.getTime())) return '';
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function stars(n: number): string {
  const full = Math.max(0, Math.min(5, Math.round(n)));
  return '★★★★★'.slice(0, full) + '☆☆☆☆☆'.slice(0, 5 - full);
}
const eyebrow: React.CSSProperties = {
  fontSize: 11,
  letterSpacing: '0.18em',
  textTransform: 'uppercase',
  color: 'var(--ink-4)',
  margin: 0,
};

export default async function FieldProfilePage() {
  const contractor = await resolveContractorFromCookie();
  if (!contractor) redirect('/field');

  const { payStats, reliability, rating, reviews, history, streak } = await loadContractorProfile(contractor.id);

  const paidCents = payStats?.paidCents ?? 0;
  const owedCents = payStats?.owedCents ?? 0;
  const jobsDone = reliability?.completed ?? payStats?.approvedCount ?? 0;
  const onTimePct =
    reliability && reliability.onTime + reliability.late > 0
      ? Math.round((reliability.onTime / (reliability.onTime + reliability.late)) * 100)
      : null;
  const hasActivity = jobsDone > 0 || paidCents > 0 || owedCents > 0 || reviews.length > 0;

  const roleLabel = TRADE_META[contractor.trade]?.role ?? contractor.trade;
  const firstName = contractor.full_name.split(' ')[0];

  return (
    <FieldShell contractorName={contractor.full_name}>
      {/* Hero — name on the left, the overall guest rating prominent on the right. */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 16, margin: '16px 0 26px', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 20, minWidth: 0 }}>
          <ProfilePhoto current={contractor.photo_url} name={contractor.full_name} size={76} stacked />
          <div style={{ minWidth: 0 }}>
            <h1 className="font-serif" style={{ fontSize: 30, fontWeight: 300, margin: 0, lineHeight: 1.1 }}>{contractor.full_name}</h1>
            <div style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 6, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <span>{roleLabel}</span>
              {monthYear(contractor.created_at) && <span style={{ color: 'var(--ink-4)' }}>· since {monthYear(contractor.created_at)}</span>}
            </div>
          </div>
        </div>
        {/* Show the score from the first review on. `rated` (>= MIN_RATED) gates
            the competitive tier on the roster, not her own profile — the review
            count renders right beside the number, so it qualifies itself. */}
        {rating && rating.count > 0 && rating.avg != null && (
          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div style={{ color: GOLD, fontSize: 17, letterSpacing: 2 }}>{stars(rating.avg)}</div>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 5, justifyContent: 'flex-end', marginTop: 3 }}>
              <span className="font-mono" style={{ fontSize: 27, color: GOLD, fontWeight: 500, lineHeight: 1 }}>{rating.avg.toFixed(2)}</span>
              <span style={{ fontSize: 12, color: 'var(--ink-4)' }}>/ 5</span>
            </div>
            <div style={{ fontSize: 11.5, color: 'var(--ink-4)', marginTop: 3 }}>{rating.count} {rating.count === 1 ? 'review' : 'reviews'}</div>
          </div>
        )}
      </div>

      {/* Work streak — a milestone bar toward the day-5 and day-10 bonuses. */}
      <StreakBar streak={streak} firstName={firstName} />

      {/* Lifetime stats */}
      {hasActivity && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 30 }}>
          <Stat label="Earned to date" value={dollars(paidCents)} />
          {owedCents > 0 && <Stat label="Pending" value={dollars(owedCents)} tone="var(--signal)" />}
          {jobsDone > 0 && <Stat label="Jobs completed" value={String(jobsDone)} />}
          {onTimePct != null && <Stat label="On time" value={`${onTimePct}%`} />}
        </div>
      )}

      {/* Guest reviews — the most recent 3, the rest one tap away. */}
      {reviews.length > 0 && (
        <section style={{ marginBottom: 28 }}>
          <h2 style={{ ...eyebrow, marginBottom: 12 }}>Guest reviews · {reviews.length}</h2>
          <div style={{ display: 'grid', gap: 12 }}>
            {reviews.slice(0, 3).map((r, i) => (
              <ReviewCard key={i} r={r} />
            ))}
          </div>
          {reviews.length > 3 && (
            <details style={{ marginTop: 12 }}>
              <summary style={{ cursor: 'pointer', fontSize: 12.5, color: 'var(--tide-deep)', fontWeight: 600, padding: '8px 2px', listStyle: 'none' }}>
                Show {reviews.length - 3} more {reviews.length - 3 === 1 ? 'review' : 'reviews'} ▾
              </summary>
              <div style={{ display: 'grid', gap: 12, marginTop: 12 }}>
                {reviews.slice(3).map((r, i) => (
                  <ReviewCard key={i} r={r} />
                ))}
              </div>
            </details>
          )}
        </section>
      )}

      {/* Work history */}
      {history.length > 0 && (
        <Section title="Work history">
          {history.map((h) => (
            <HistoryRow key={h.id} h={h} />
          ))}
        </Section>
      )}

      {/* Notifications */}
      <section style={{ marginBottom: 28 }}>
        <h2 style={{ ...eyebrow, marginBottom: 12 }}>Notifications</h2>
        <div style={{ border: '1px solid var(--rule)', borderRadius: 12, padding: '16px 18px', background: 'var(--paper-2, #fff)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 14, color: 'var(--ink)', fontWeight: 500 }}>Text me when new work is posted</div>
            <div style={{ fontSize: 12.5, color: 'var(--ink-3)', marginTop: 3, lineHeight: 1.5 }}>
              We text your phone the moment a packet opens near you. Turn it off anytime.
            </div>
          </div>
          <SmsToggle initial={contractor.sms_opt_in} />
        </div>
      </section>

      {/* Account */}
      <AccountCard contractor={contractor} />
    </FieldShell>
  );
}

/** Milestone streak bar: fills toward day-5 (+$100) and day-10 (+$250). */
function StreakBar({ streak, firstName }: { streak: StreakInfo | null; firstName: string }) {
  const cap = STREAK_CYCLE_DAYS;
  const cyclePos = streak ? streak.cyclePos : 0;
  const days = streak?.days ?? 0;
  const pct = Math.min(100, (cyclePos / cap) * 100);

  return (
    <section style={{ marginBottom: 30, border: '1px solid var(--rule)', borderRadius: 16, padding: '20px 22px 18px', background: 'var(--paper-2, #fff)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
        <h2 style={eyebrow}>Work streak</h2>
        {streak ? (
          <span style={{ fontSize: 12.5, color: 'var(--signal)', fontWeight: 600 }}>
            {streak.nextIn} more {streak.nextIn === 1 ? 'day' : 'days'} → +{dollars(streak.nextBonusCents)}
          </span>
        ) : null}
      </div>

      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 20 }}>
        <span className="font-serif" style={{ fontSize: 34, fontWeight: 300, lineHeight: 1, color: days > 0 ? 'var(--ink)' : 'var(--ink-4)' }}>{days}</span>
        <span style={{ fontSize: 14, color: 'var(--ink-3)' }}>
          {days === 1 ? 'day in a row' : 'days in a row'}
          {days > cap ? ` · ${cyclePos} into this cycle` : ''}
        </span>
      </div>

      {/* Track + milestone markers */}
      <div style={{ position: 'relative', height: 12, borderRadius: 999, background: 'var(--rule)', marginBottom: 46 }}>
        <div style={{ position: 'absolute', inset: 0, borderRadius: 999, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${pct}%`, background: `linear-gradient(90deg, var(--tide-deep), ${GOLD})`, transition: 'width .4s ease', borderRadius: 999 }} />
        </div>
        {STREAK_MILESTONES.map((m) => {
          const reached = cyclePos >= m.day;
          const isNext = !reached && !STREAK_MILESTONES.some((x) => x.day < m.day && x.day > cyclePos);
          const left = (m.day / cap) * 100;
          const atEnd = m.day === cap;
          return (
            <div key={m.day}>
              <div
                style={{
                  position: 'absolute',
                  top: '50%',
                  left: `${left}%`,
                  transform: 'translate(-50%,-50%)',
                  width: 18,
                  height: 18,
                  borderRadius: '50%',
                  background: reached ? GOLD : 'var(--paper)',
                  border: `2px solid ${reached ? GOLD : isNext ? 'var(--signal)' : 'var(--rule)'}`,
                  boxShadow: '0 0 0 3px var(--paper-2, #fff)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {reached && <span style={{ color: 'var(--paper)', fontSize: 10, lineHeight: 1 }}>✓</span>}
              </div>
              <div
                style={{
                  position: 'absolute',
                  top: 26,
                  left: `${left}%`,
                  transform: atEnd ? 'translateX(-100%)' : 'translateX(-50%)',
                  textAlign: atEnd ? 'right' : 'center',
                  whiteSpace: 'nowrap',
                }}
              >
                <div style={{ fontSize: 10.5, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>Day {m.day}</div>
                <div className="font-mono" style={{ fontSize: 15, fontWeight: 600, marginTop: 1, color: reached ? GOLD : isNext ? 'var(--signal)' : 'var(--ink-3)' }}>+{dollars(m.cents)}</div>
              </div>
            </div>
          );
        })}
      </div>

      <p style={{ fontSize: 12.5, color: 'var(--ink-4)', lineHeight: 1.5, margin: 0 }}>
        {streak
          ? `Nice run, ${firstName}. The bonus lands automatically on that day's packet.`
          : `Work days back-to-back. Day 5 adds $100 to that day's packet, day 10 adds $250 — automatically.`}
      </p>
    </section>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div style={{ border: '1px solid var(--rule)', borderRadius: 10, padding: '12px 16px', background: 'var(--paper-2, #fff)' }}>
      <div className="font-mono" style={{ fontSize: 20, color: tone ?? 'var(--ink)' }}>{value}</div>
      <div style={{ fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-4)', marginTop: 2 }}>{label}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ marginBottom: 28 }}>
      <h2 style={{ ...eyebrow, marginBottom: 12 }}>{title}</h2>
      {children}
    </section>
  );
}

function ReviewCard({ r }: { r: ContractorReview }) {
  return (
    <div style={{ background: 'var(--paper-2, #fff)', border: '1px solid var(--rule)', borderRadius: 12, padding: '14px 16px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'baseline' }}>
        <span style={{ color: GOLD, fontSize: 14, letterSpacing: 1.5 }}>{stars(r.rating)}</span>
        <span style={{ fontSize: 11.5, color: 'var(--ink-4)' }}>{r.propertyName}{r.date ? ` · ${shortDate(r.date)}` : ''}</span>
      </div>
      {r.text && <ReviewText text={r.text} />}
    </div>
  );
}

const HISTORY_TINT: Record<string, string> = {
  in_progress: 'var(--tide-deep)',
  submitted: 'var(--signal)',
  approved: 'var(--positive)',
};

function HistoryRow({ h }: { h: ContractorHistoryItem }) {
  const label = h.status === 'approved' ? (h.paid ? 'paid' : 'approved') : h.status.replace('_', ' ');
  return (
    <div style={{ borderTop: '1px solid var(--rule)', padding: '12px 0', display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline', flexWrap: 'wrap' }}>
      <div style={{ minWidth: 0 }}>
        <div className="font-serif" style={{ fontSize: 15 }}>{h.title}</div>
        <div style={{ fontSize: 12, color: 'var(--ink-4)', marginTop: 2 }}>{shortDate(h.date)}</div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div className="font-mono" style={{ fontSize: 14 }}>{dollars(h.payCents)}</div>
        <div style={{ fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase', color: HISTORY_TINT[h.status] ?? 'var(--ink-4)' }}>{label}</div>
      </div>
    </div>
  );
}

const BG_CHECK: Record<ContractorRow['background_check_status'], { icon: string; label: string; tint: string }> = {
  cleared: { icon: '✓', label: 'Background check cleared', tint: 'var(--positive)' },
  pending: { icon: '◷', label: 'Background check in progress', tint: 'var(--signal)' },
  not_started: { icon: '◷', label: 'Background check pending', tint: 'var(--ink-4)' },
  failed: { icon: '✕', label: 'Background check needs attention', tint: 'var(--negative)' },
};

/** Account standing: a small completion meter + the legal/identity/payout
 *  checklist. Surfaces the real payout method captured at onboarding. */
function AccountCard({ contractor }: { contractor: ContractorRow }) {
  const bg = BG_CHECK[contractor.background_check_status];
  const payout = contractor.payment_method
    ? contractor.payment_hint
      ? `${contractor.payment_method} · ${contractor.payment_hint}`
      : contractor.payment_method
    : null;

  const items: Array<{ done: boolean; icon: string; label: string; tint: string; detail?: string }> = [
    { done: contractor.w9_on_file, icon: contractor.w9_on_file ? '✓' : '○', label: 'W-9 on file', tint: contractor.w9_on_file ? 'var(--positive)' : 'var(--ink-4)' },
    { done: !!contractor.agreement_signed_at, icon: contractor.agreement_signed_at ? '✓' : '○', label: 'Contractor agreement signed', tint: contractor.agreement_signed_at ? 'var(--positive)' : 'var(--ink-4)' },
    { done: contractor.background_check_status === 'cleared', icon: bg.icon, label: bg.label, tint: bg.tint },
    { done: !!payout, icon: payout ? '✓' : '○', label: payout ? 'Payout method set' : 'Payout method', tint: payout ? 'var(--positive)' : 'var(--ink-4)', detail: payout ?? undefined },
    { done: !!contractor.photo_url, icon: contractor.photo_url ? '✓' : '○', label: 'Profile photo', tint: contractor.photo_url ? 'var(--positive)' : 'var(--ink-4)' },
  ];
  const done = items.filter((i) => i.done).length;
  const pct = Math.round((done / items.length) * 100);
  const allSet = done === items.length;

  return (
    <section style={{ marginBottom: 28 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, marginBottom: 12 }}>
        <h2 style={eyebrow}>Account</h2>
        <span style={{ fontSize: 11, color: allSet ? 'var(--positive)' : 'var(--ink-4)' }}>
          {allSet ? 'All set' : `${done} of ${items.length} complete`}
        </span>
      </div>

      <div style={{ height: 6, borderRadius: 999, background: 'var(--rule)', overflow: 'hidden', marginBottom: 14 }}>
        <div style={{ height: '100%', width: `${pct}%`, background: allSet ? 'var(--positive)' : 'var(--ink-3)', transition: 'width .3s ease' }} />
      </div>

      <div style={{ display: 'grid', gap: 9 }}>
        {items.map((it) => (
          <div key={it.label} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'baseline', fontSize: 13 }}>
            <span style={{ color: it.done ? 'var(--ink-3)' : 'var(--ink-4)' }}>
              <span style={{ color: it.tint, marginRight: 6 }}>{it.icon}</span>{it.label}
            </span>
            {it.detail && <span className="font-mono" style={{ fontSize: 12, color: 'var(--ink-4)', textAlign: 'right' }}>{it.detail}</span>}
          </div>
        ))}
      </div>
    </section>
  );
}
