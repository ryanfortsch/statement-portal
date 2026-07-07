import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { resolveContractorFromCookie } from '@/lib/field-auth';
import { loadContractorProfile, type ContractorReview, type ContractorHistoryItem } from '@/lib/field-profile';
import { dollars, type ContractorRow } from '@/lib/field-types';
import { FieldShell } from '../FieldShell';
import { ProfilePhoto } from '../ProfilePhoto';
import { SmsToggle } from '../SmsToggle';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Your profile · Rising Tide Field',
  robots: { index: false, follow: false, googleBot: { index: false, follow: false } },
};

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
  try {
    return new Date(`${d}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  } catch {
    return d;
  }
}
function stars(n: number): string {
  const full = Math.max(0, Math.min(5, Math.round(n)));
  return '★★★★★'.slice(0, full) + '☆☆☆☆☆'.slice(0, 5 - full);
}

export default async function FieldProfilePage() {
  const contractor = await resolveContractorFromCookie();
  if (!contractor) redirect('/field');

  const { payStats, reliability, rating, reviews, history } = await loadContractorProfile(contractor.id);

  const paidCents = payStats?.paidCents ?? 0;
  const owedCents = payStats?.owedCents ?? 0;
  const jobsDone = reliability?.completed ?? payStats?.approvedCount ?? 0;
  const onTimePct =
    reliability && reliability.onTime + reliability.late > 0
      ? Math.round((reliability.onTime / (reliability.onTime + reliability.late)) * 100)
      : null;
  const hasActivity = jobsDone > 0 || paidCents > 0 || owedCents > 0 || reviews.length > 0;

  const firstName = contractor.full_name.split(' ')[0];

  return (
    <FieldShell contractorName={contractor.full_name}>
      <Link href="/field" style={{ fontSize: 12, color: 'var(--ink-4)', textDecoration: 'none' }}>← Back to work</Link>

      {/* Hero */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 20, margin: '16px 0 26px', flexWrap: 'wrap' }}>
        <ProfilePhoto current={contractor.photo_url} name={contractor.full_name} size={76} stacked />
        <div style={{ minWidth: 0 }}>
          <h1 className="font-serif" style={{ fontSize: 30, fontWeight: 300, margin: 0, lineHeight: 1.1 }}>{contractor.full_name}</h1>
          <div style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 6, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ textTransform: 'capitalize' }}>{contractor.trade}</span>
            {monthYear(contractor.created_at) && <span style={{ color: 'var(--ink-4)' }}>· since {monthYear(contractor.created_at)}</span>}
          </div>
          {rating?.rated && rating.avg != null && (
            <div style={{ fontSize: 13, color: '#b8860b', marginTop: 5 }}>
              ★ {rating.avg.toFixed(2)} <span style={{ color: 'var(--ink-4)' }}>· {rating.count} guest {rating.count === 1 ? 'review' : 'reviews'}</span>
            </div>
          )}
        </div>
      </div>

      {/* Lifetime stats — only once there's something real to show */}
      {hasActivity && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 28 }}>
          <Stat label="Earned to date" value={dollars(paidCents)} />
          {owedCents > 0 && <Stat label="Pending" value={dollars(owedCents)} tone="var(--signal)" />}
          {jobsDone > 0 && <Stat label="Jobs completed" value={String(jobsDone)} />}
          {onTimePct != null && <Stat label="On time" value={`${onTimePct}%`} />}
          {rating?.rated && rating.avg != null && <Stat label="Guest rating" value={`★ ${rating.avg.toFixed(2)}`} />}
        </div>
      )}


      {/* Guest reviews */}
      {reviews.length > 0 && (
        <Section title={`Guest reviews · ${reviews.length}`}>
          {reviews.map((r, i) => (
            <ReviewRow key={i} r={r} />
          ))}
        </Section>
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
        <h2 style={{ fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--ink-4)', marginBottom: 12 }}>Notifications</h2>
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

      {/* New-contractor forward nudge */}
      {!hasActivity && (
        <Link
          href="/field"
          style={{ display: 'block', textDecoration: 'none', border: '1px solid var(--rule)', borderRadius: 12, padding: '18px 20px', background: 'var(--paper-2, #fff)', marginTop: 4 }}
        >
          <div className="font-serif" style={{ fontSize: 18, color: 'var(--ink)' }}>Ready when you are, {firstName}</div>
          <div style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 4 }}>
            Browse the work open near you and claim your first visit. <span style={{ color: 'var(--signal)', fontWeight: 600 }}>See open work →</span>
          </div>
        </Link>
      )}
    </FieldShell>
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
      <h2 style={{ fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--ink-4)', marginBottom: 12 }}>{title}</h2>
      {children}
    </section>
  );
}

function ReviewRow({ r }: { r: ContractorReview }) {
  return (
    <div style={{ borderTop: '1px solid var(--rule)', padding: '12px 0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'baseline' }}>
        <span style={{ color: '#b8860b', fontSize: 14, letterSpacing: 1 }}>{stars(r.rating)}</span>
        <span style={{ fontSize: 12, color: 'var(--ink-4)' }}>{r.propertyName}{r.date ? ` · ${shortDate(r.date)}` : ''}</span>
      </div>
      {r.text && <p style={{ fontSize: 13.5, color: 'var(--ink-3)', lineHeight: 1.55, margin: '6px 0 0', fontStyle: 'italic' }}>&ldquo;{r.text}&rdquo;</p>}
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
        <h2 style={{ fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--ink-4)', margin: 0 }}>Account</h2>
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
