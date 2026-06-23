import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { resolveContractorFromCookie } from '@/lib/field-auth';
import { loadContractorProfile, type ContractorReview, type ContractorHistoryItem } from '@/lib/field-profile';
import { dollars } from '@/lib/field-types';
import { FieldShell } from '../FieldShell';
import { ProfilePhoto } from '../ProfilePhoto';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Your profile · Rising Tide Field',
  robots: { index: false, follow: false, googleBot: { index: false, follow: false } },
};

const TIER_TINT: Record<string, string> = { unrated: 'var(--ink-4)', bronze: '#a0522d', silver: '#8a8d91', gold: '#b8860b' };
const NEXT_TIER: Record<string, { name: string; at: number }> = {
  unrated: { name: 'Bronze', at: 25 },
  bronze: { name: 'Silver', at: 50 },
  silver: { name: 'Gold', at: 100 },
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

  const stats: Array<{ label: string; value: string; tone?: string }> = [];
  if (payStats && payStats.paidCents > 0) stats.push({ label: 'Earned to date', value: dollars(payStats.paidCents) });
  if (payStats && payStats.owedCents > 0) stats.push({ label: 'Pending', value: dollars(payStats.owedCents), tone: 'var(--signal)' });
  const jobsDone = reliability?.completed ?? payStats?.approvedCount ?? 0;
  if (jobsDone > 0) stats.push({ label: 'Jobs completed', value: String(jobsDone) });
  if (reliability && reliability.onTime + reliability.late > 0) {
    stats.push({ label: 'On time', value: `${Math.round((reliability.onTime / (reliability.onTime + reliability.late)) * 100)}%` });
  }
  if (rating?.rated && rating.avg != null) stats.push({ label: 'Guest rating', value: `★ ${rating.avg.toFixed(2)}` });

  const tier = rating?.tier ?? 'unrated';
  const streak = rating?.fiveStreak ?? 0;
  const next = NEXT_TIER[tier];

  return (
    <FieldShell contractorName={contractor.full_name}>
      <Link href="/field" style={{ fontSize: 12, color: 'var(--ink-4)', textDecoration: 'none' }}>← Back to work</Link>

      {/* Identity */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 18, margin: '16px 0 28px', flexWrap: 'wrap' }}>
        <ProfilePhoto current={contractor.photo_url} name={contractor.full_name} />
        <div>
          <h1 className="font-serif" style={{ fontSize: 30, fontWeight: 300, margin: 0 }}>{contractor.full_name}</h1>
          <div style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 4, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <span style={{ textTransform: 'capitalize' }}>{contractor.trade}</span>
            {monthYear(contractor.created_at) && <span style={{ color: 'var(--ink-4)' }}>· with Rising Tide since {monthYear(contractor.created_at)}</span>}
            {tier !== 'unrated' && (
              <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: TIER_TINT[tier], border: `1px solid ${TIER_TINT[tier]}`, borderRadius: 999, padding: '1px 8px' }}>
                {tier}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Lifetime stats */}
      {stats.length > 0 && (
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginBottom: 28 }}>
          {stats.map((s) => (
            <div key={s.label} style={{ flex: '1 1 130px', border: '1px solid var(--rule)', borderRadius: 10, padding: '12px 16px', background: 'var(--paper-2, #fff)' }}>
              <div className="font-mono" style={{ fontSize: 20, color: s.tone ?? 'var(--ink)' }}>{s.value}</div>
              <div style={{ fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-4)', marginTop: 2 }}>{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Reputation / streak */}
      <Section title="Reputation">
        {streak > 0 || (rating?.count ?? 0) > 0 ? (
          <div style={{ fontSize: 14, color: 'var(--ink-3)', lineHeight: 1.6 }}>
            <span style={{ color: 'var(--ink)' }}>🔥 {streak} five-star {streak === 1 ? 'stay' : 'stays'} in a row</span>
            {next ? <> · {Math.max(0, next.at - streak)} more to {next.name}</> : <> · top tier 🥇</>}
            <div style={{ fontSize: 12, color: 'var(--ink-4)', marginTop: 4 }}>
              Your reputation is the guest rating of the stays you prep. {rating?.count ?? 0} rated so far.
            </div>
          </div>
        ) : (
          <p style={{ fontSize: 14, color: 'var(--ink-3)', lineHeight: 1.6, margin: 0 }}>
            No guest reviews yet. The guests who stay in the homes you prep rate their stay, and those become your
            reviews. String together 25 five-star stays in a row for Bronze, 50 for Silver, 100 for Gold.
          </p>
        )}
      </Section>

      {/* Reviews */}
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

      {/* Account */}
      <Section title="Account">
        <div style={{ fontSize: 13, color: 'var(--ink-3)', display: 'grid', gap: 6 }}>
          <Status ok={contractor.w9_on_file} label="W-9 on file" />
          <Status ok={!!contractor.agreement_signed_at} label="Contractor agreement signed" />
          <Status ok={!!contractor.photo_url} label="Profile photo" />
          <div style={{ color: 'var(--ink-4)' }}>Payout method · coming soon</div>
        </div>
      </Section>
    </FieldShell>
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

function Status({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div style={{ color: ok ? 'var(--ink-3)' : 'var(--ink-4)' }}>
      <span style={{ color: ok ? 'var(--positive)' : 'var(--ink-4)' }}>{ok ? '✓' : '○'}</span> {label}
    </div>
  );
}
