import type { Metadata } from 'next';
import Link from 'next/link';
import { resolveContractorFromCookie } from '@/lib/field-auth';
import { loadContractorMarketplace, getContractorPayStats } from '@/lib/field-packets';
import { getContractorRatings, type ContractorRating } from '@/lib/field-ratings';
import { canClaim, onboardingComplete, dollars, packetHeadline, type PacketDetail } from '@/lib/field-types';
import { FieldShell } from './FieldShell';
import { ProfilePhoto } from './ProfilePhoto';
import { FieldPillars } from './FieldPillars';

const TIER_TINT: Record<string, string> = { unrated: 'var(--ink-4)', bronze: '#a0522d', silver: '#8a8d91', gold: '#b8860b' };
const NEXT_TIER: Record<string, { name: string; at: number }> = {
  unrated: { name: 'Bronze', at: 25 },
  bronze: { name: 'Silver', at: 50 },
  silver: { name: 'Gold', at: 100 },
};

/** The one repeatable editorial section header: a tide index numeral, a serif
 *  title, and a hairline rule running to the edge. The page's spine. */
function SectionHeader({ n, title }: { n?: string; title: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 16 }}>
      {n && <span className="font-mono" style={{ fontSize: 13, fontWeight: 600, color: 'var(--tide)', flexShrink: 0 }}>{n}</span>}
      <span className="font-serif" style={{ fontSize: 17, fontWeight: 400, color: 'var(--ink)', flexShrink: 0 }}>{title}</span>
      <span style={{ flex: 1, height: 0, borderTop: '1px solid var(--rule)', alignSelf: 'center', marginLeft: 4 }} />
    </div>
  );
}

/** The contractor's own reputation: a ladder toward Bronze (25) / Silver (50) /
 *  Gold (100) cumulative 5-star reviews, with the current "in a row" run as a
 *  flourish. */
function StreakLadder({ rating }: { rating?: ContractorRating }) {
  const streak = rating?.fiveStreak ?? 0;
  const count = rating?.count ?? 0;
  const tier = rating?.tier ?? 'unrated';
  const next = NEXT_TIER[tier]; // undefined at gold
  const pct = next ? Math.min(100, Math.round((streak / next.at) * 100)) : 100;
  const toNext = rating?.toNextTier ?? (next ? Math.max(0, next.at - streak) : 0);
  const milestones = [
    { n: 25, label: 'Bronze' },
    { n: 50, label: 'Silver' },
    { n: 100, label: 'Gold' },
  ];
  return (
    <div style={{ borderRadius: 0, padding: '18px 20px', marginBottom: 36, background: 'var(--paper-2)', boxShadow: '0 1px 0 var(--rule), 0 6px 16px rgba(11,37,69,0.06)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <div style={{ fontSize: 11, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>Your rating</div>
        {count > 0 && (
          <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>
            {rating?.rated && rating.avg != null ? `★ ${rating.avg.toFixed(2)} · ` : ''}
            {count} {count === 1 ? 'review' : 'reviews'}
          </div>
        )}
      </div>
      {count === 0 ? (
        <p style={{ fontSize: 14, color: 'var(--ink-3)', lineHeight: 1.6, margin: 0 }}>
          No guest reviews yet. The guests who stay in the homes you prep rate their stay. Earn{' '}
          <strong style={{ color: TIER_TINT.bronze }}>25 five-star reviews in a row</strong> for Bronze, 50 in a
          row for Silver, 100 for Gold.
        </p>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: TIER_TINT[tier] }}>
              {tier === 'unrated' ? 'Unrated' : tier}
            </span>
            <span style={{ fontSize: 14, color: 'var(--ink)' }}>{streak} in a row</span>
            {next ? (
              <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>{toNext} more in a row to {next.name}</span>
            ) : (
              <span style={{ fontSize: 13, color: TIER_TINT.gold }}>Top tier</span>
            )}
          </div>
          <div style={{ height: 8, borderRadius: 999, background: 'var(--paper-3)', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${pct}%`, background: TIER_TINT[tier === 'unrated' ? 'bronze' : tier], transition: 'width .3s ease' }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
            {milestones.map((m) => (
              <span key={m.n} style={{ fontSize: 10.5, fontWeight: streak >= m.n ? 700 : 400, color: streak >= m.n ? TIER_TINT[m.label.toLowerCase()] : 'var(--ink-4)' }}>
                {m.label} {m.n}
              </span>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Rising Tide Field',
  robots: { index: false, follow: false, googleBot: { index: false, follow: false } },
};

function windowSummary(p: PacketDetail): string {
  if (p.trade === 'maintenance') return `${p.stop_count} ${p.stop_count === 1 ? 'job' : 'jobs'} to fix`;
  return '12:00–2:45 PM window';
}

function eyebrowDate(d: string): string {
  try {
    return new Date(`${d}T00:00:00`)
      .toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
      .toUpperCase();
  } catch {
    return d.toUpperCase();
  }
}

function PacketCard({ p, href, featured }: { p: PacketDetail; href: string; featured?: boolean }) {
  const spread =
    p.stop_count > 1 && p.max_pairwise_miles != null
      ? `${p.max_pairwise_miles < 1 ? '<1' : Math.round(p.max_pairwise_miles)} mi apart · `
      : '';
  const away =
    // An implausible distance is a mis-geocoded home, not information — hide
    // it rather than print "472 mi away" on a Gloucester packet.
    p.distanceMiles != null && p.distanceMiles <= 120
      ? `${p.distanceMiles < 1 ? '<1' : Math.round(p.distanceMiles)} mi away · `
      : '';
  return (
    <Link
      href={href}
      style={{
        display: 'block',
        textDecoration: 'none',
        color: 'var(--ink)',
        border: 'none',
        borderLeft: featured ? '3px solid var(--signal)' : undefined,
        background: 'var(--paper-2)',
        boxShadow: '0 1px 0 var(--rule), 0 6px 16px rgba(11,37,69,0.06)',
        padding: '18px 20px',
        marginBottom: 14,
      }}
    >
      <div className="rt-packet-row" style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, letterSpacing: '0.16em', color: 'var(--signal)', fontWeight: 600, marginBottom: 6 }}>
            {eyebrowDate(p.visit_date)}
          </div>
          <div className="font-serif" style={{ fontSize: 20, fontWeight: 400, lineHeight: 1.15 }}>
            {packetHeadline(p)}
          </div>
          {(() => {
            const homes = [...new Set(p.stops.map((s) => s.property.name).filter(Boolean))];
            if (homes.length === 0) return null;
            return (
              <div style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 8, lineHeight: 1.5 }}>
                {homes.join(' · ')}
              </div>
            );
          })()}
          <div style={{ fontSize: 12, color: 'var(--ink-4)', marginTop: 6 }}>
            {away}
            {spread}
            {windowSummary(p)}
          </div>
        </div>
        <div className="rt-packet-price" style={{ textAlign: 'right', flexShrink: 0 }}>
          <div className="font-mono" style={{ fontSize: 24, lineHeight: 1 }}>
            {dollars(p.posted_price_cents)}
          </div>
          <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 4 }}>
            {dollars(Math.round(p.posted_price_cents / Math.max(1, p.stop_count)))} / stop
          </div>
          <div style={{ fontSize: 12, color: 'var(--signal)', marginTop: 12, fontWeight: 600 }}>View →</div>
        </div>
      </div>
    </Link>
  );
}

/** The onboarding journey as a flat progress track reversed out of the navy
 *  hero plate. The fill (tide, or negative when failed) runs to the live stage;
 *  labels carry the state. No dots, no pulse. */
function JourneyRail({ activeIndex, failed }: { activeIndex: number; failed?: boolean }) {
  // Long labels wrap raggedly in a 4-way split at ~340px — the first thing a
  // new contractor sees. Under 400px (rt-jr-* in globals.css) the short forms
  // swap in so every label stays on one line.
  const steps = [
    { long: 'Applied', short: 'Applied' },
    { long: 'Account set up', short: 'Set up' },
    { long: 'Background check', short: 'Check' },
    { long: 'Ready to claim', short: 'Ready' },
  ];
  const pct = (activeIndex / (steps.length - 1)) * 100;
  const fill = failed ? 'var(--negative)' : 'var(--tide)';
  return (
    <div style={{ marginTop: 24 }}>
      <div style={{ position: 'relative', height: 2, background: 'rgba(245,239,226,0.18)' }}>
        <div style={{ position: 'absolute', left: 0, top: 0, height: 2, width: `${pct}%`, background: fill }} />
        <span style={{ position: 'absolute', top: -1, left: `calc(${pct}% - 2px)`, width: 4, height: 4, background: fill }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
        {steps.map((s, i) => {
          const done = i < activeIndex;
          const active = i === activeIndex;
          const color = done ? 'var(--paper)' : active ? (failed ? 'var(--negative)' : 'var(--signal-soft)') : 'rgba(245,239,226,0.4)';
          return (
            <span
              key={s.long}
              style={{ flex: 1, fontSize: 10.5, letterSpacing: '0.12em', textTransform: 'uppercase', lineHeight: 1.3, color, fontWeight: active ? 600 : 400, textAlign: i === 0 ? 'left' : i === steps.length - 1 ? 'right' : 'center', whiteSpace: 'nowrap' }}
            >
              <span className="rt-jr-long">{s.long}</span>
              <span className="rt-jr-short">{s.short}</span>
            </span>
          );
        })}
      </div>
    </div>
  );
}

export default async function FieldHome({
  searchParams,
}: {
  searchParams: Promise<{ invalid?: string }>;
}) {
  const sp = await searchParams;
  const contractor = await resolveContractorFromCookie();

  if (!contractor) {
    return (
      <FieldShell showSignOut={false}>
        <h1 className="font-serif" style={{ fontSize: 30, fontWeight: 300, marginBottom: 12 }}>
          {sp.invalid ? 'That link is no longer valid' : 'Welcome to Rising Tide Field'}
        </h1>
        <p style={{ fontSize: 15, color: 'var(--ink-3)', lineHeight: 1.6, maxWidth: 480 }}>
          {sp.invalid
            ? 'Your invite link has expired or was revoked. Ask Rising Tide to send a fresh one.'
            : 'Open the personal link Rising Tide emailed you to see inspection work near you. If you think you should have access, reach out to the office.'}
        </p>
      </FieldShell>
    );
  }

  // Paused: onboarded, but benched by the office. Say so plainly instead of
  // dropping them into the "finish setup" flow (they already did).
  if (contractor.status === 'paused') {
    return (
      <FieldShell contractorName={contractor.full_name}>
        <h1 className="font-serif" style={{ fontSize: 28, fontWeight: 300, marginBottom: 10 }}>
          Your account is paused
        </h1>
        <p style={{ fontSize: 15, color: 'var(--ink-3)', lineHeight: 1.6, maxWidth: 460 }}>
          You can&apos;t claim new work right now. Reach out to the Rising Tide office and they&apos;ll get you back
          on the schedule.
        </p>
      </FieldShell>
    );
  }

  const setupDone = onboardingComplete(contractor);
  const claimable = canClaim(contractor);

  if (!claimable) {
    // Read-only marketplace: invitees (and people awaiting their check) can see
    // the work/pay; the welcome treatment + CTA differ by sub-state.
    const { available } = await loadContractorMarketplace(contractor);
    const first = contractor.full_name.split(' ')[0];
    const failed = contractor.background_check_status === 'failed';
    const activeIndex = setupDone ? 2 : 1;
    const preview = available.slice(0, 3);

    const numbered = (rows: Array<[string, string]>, accent: string) => (
      <div>
        {rows.map(([t, d], i) => (
          <div key={t} style={{ display: 'flex', gap: 14, paddingTop: i === 0 ? 0 : 16, marginTop: i === 0 ? 0 : 16, borderTop: i === 0 ? 'none' : '1px solid var(--rule-soft)' }}>
            <span className="font-mono" style={{ fontSize: 13, color: accent, fontWeight: 600, flexShrink: 0, width: 18 }}>{i + 1}</span>
            <div>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', marginBottom: 2 }}>{t}</div>
              <div style={{ fontSize: 13.5, color: 'var(--ink-3)', lineHeight: 1.55 }}>{d}</div>
            </div>
          </div>
        ))}
      </div>
    );

    return (
      <FieldShell contractorName={contractor.full_name}>
        {/* Hero plate: the page's one navy ground, the welcome moment */}
        <div style={{ background: 'var(--ink)', borderRadius: 4, padding: 'clamp(28px,6vw,36px)', marginBottom: 40 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 4 }}>
            <ProfilePhoto current={contractor.photo_url} name={contractor.full_name} onDark />
            <div style={{ minWidth: 0 }}>
              <div className="font-mono" style={{ fontSize: 11, letterSpacing: '0.22em', textTransform: 'uppercase', color: failed ? 'var(--negative)' : 'var(--signal-soft)', fontWeight: 600, marginBottom: 6 }}>
                {failed ? 'Action needed' : setupDone ? 'Welcome aboard' : 'One step left'}
              </div>
              <h1 className="font-serif" style={{ fontSize: 'clamp(28px,7vw,36px)', fontWeight: 300, lineHeight: 1.05, letterSpacing: '-0.01em', margin: 0, color: 'var(--paper)' }}>
                {failed ? "Let's clear this up, " : setupDone ? 'You made the crew, ' : 'Almost there, '}
                <span style={{ color: 'var(--signal-soft)' }}>{first}</span>
              </h1>
            </div>
          </div>

          <JourneyRail activeIndex={activeIndex} failed={failed} />

          <p style={{ fontSize: 14, color: 'rgba(245,239,226,0.78)', lineHeight: 1.6, margin: '24px 0 0' }}>
            {failed ? (
              <>There&apos;s a hold on your background check. Give the office a call at (978) 865-2387 and we&apos;ll get it sorted.</>
            ) : setupDone ? (
              <>Your setup is done. We&apos;re getting your background check underway (standard, since you&apos;ll have keys to owners&apos; homes). As soon as it&apos;s running we&apos;ll text and email you, and your first packets open up right here.</>
            ) : (
              <>You&apos;re invited. Finish your quick setup (W-9, a short agreement, and how you want to be paid) and we&apos;ll get your background check going. Once it&apos;s underway, you can start claiming paid work near you.</>
            )}
          </p>

          {!setupDone && !failed && (
            <Link href="/field/onboarding" style={{ display: 'inline-block', marginTop: 20, background: 'var(--paper)', color: 'var(--ink)', textDecoration: 'none', fontSize: 12, fontWeight: 600, letterSpacing: '0.16em', textTransform: 'uppercase', padding: '12px 24px' }}>
              Finish setup
            </Link>
          )}
        </div>

        {/* Who we are: the lead */}
        <div style={{ background: 'var(--ink)', borderRadius: 4, padding: 'clamp(28px,6vw,36px)', marginBottom: 40 }}>
          <div className="font-mono" style={{ fontSize: 11, letterSpacing: '0.22em', textTransform: 'uppercase', color: 'var(--signal-soft)', fontWeight: 600, marginBottom: 12 }}>
            Who we are
          </div>
          <h2 className="font-serif" style={{ fontSize: 'clamp(26px,6vw,32px)', fontWeight: 300, lineHeight: 1.18, letterSpacing: '-0.01em', color: 'var(--paper)', margin: '0 0 20px' }}>
            Rising Tide focuses on the best vacation rentals on Cape Ann. We need you to help keep them <span style={{ color: 'var(--signal-soft)' }}>guest-ready</span>.
          </h2>
          <p style={{ fontSize: 14, color: 'rgba(245,239,226,0.78)', lineHeight: 1.6, margin: '0 0 14px', maxWidth: '60ch' }}>
            We are a boutique manager, local by design. We do not run a sprawling region. We hold a curated portfolio
            to a standard larger operators cannot, and our whole edge is the guest experience.
          </p>
          <p style={{ fontSize: 14, color: 'rgba(245,239,226,0.78)', lineHeight: 1.6, margin: 0, maxWidth: '60ch' }}>
            You are the on-site hands for it. Inspect and stage each home to the standard, restock it, and catch
            issues before a guest does. The turnover runs on you being the last set of eyes before check-in.
          </p>
        </div>

        {/* The standard: three flip cards */}
        <div style={{ marginBottom: 40 }}>
          <SectionHeader n="01" title="The standard" />
          <FieldPillars />
        </div>

        {/* How a visit works */}
        <div style={{ marginBottom: 40 }}>
          <SectionHeader n="02" title="How a visit works" />
          {numbered(
            [
              ['Claim a packet', 'Pick up a route of nearby homes, priced up front. First come, first served.'],
              ['Bring your kit', 'Your Rising Tide kit has the essentials to restock and touch up at every stop.'],
              ['Make it guest-ready', 'Walk every room the way a guest will. Set it right, restock what is thin, and get every detail to flawless. Photos document your work.'],
              ['Submit and get paid', 'Send it in. Once the office reviews it, your payout is on the way.'],
            ],
            'var(--tide)',
          )}
        </div>

        {/* A preview of the work */}
        <div>
          <SectionHeader n="03" title={preview.length > 0 ? 'What’s waiting' : 'The work'} />
          {preview.length > 0 ? (
            <>
              {preview.map((p, i) => (
                <PacketCard key={p.id} p={p} href={`/field/packet/${p.id}`} featured={i === 0} />
              ))}
            </>
          ) : (
            <p style={{ fontSize: 14, color: 'var(--ink-3)', lineHeight: 1.6, margin: 0 }}>
              No routes are open this minute, but new ones post all the time. We&apos;ll text you the moment a packet near you goes up.
            </p>
          )}
        </div>
      </FieldShell>
    );
  }

  const [{ available, mine }, payStats, ratings] = await Promise.all([
    loadContractorMarketplace(contractor),
    getContractorPayStats(),
    getContractorRatings(),
  ]);
  const pay = payStats.get(contractor.id);
  const rating = ratings.get(contractor.id);

  return (
    <FieldShell contractorName={contractor.full_name}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap', marginBottom: 24 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <ProfilePhoto current={contractor.photo_url} name={contractor.full_name} />
          <div>
            <h1 className="font-serif" style={{ fontSize: 30, fontWeight: 300, marginBottom: 4, display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
              <span>Hi {contractor.full_name.split(' ')[0]}</span>
              {rating?.rated && rating.avg != null && (
                <span style={{ fontSize: 16, fontWeight: 400, color: 'var(--ink-3)' }}>★ {rating.avg.toFixed(1)}</span>
              )}
            </h1>
            <p style={{ fontSize: 14, color: 'var(--ink-3)', margin: 0 }}>
              {available.length > 0
                ? `${available.length} ${available.length === 1 ? 'packet' : 'packets'} open near you`
                : 'All quiet right now. We’ll text you when a packet near you posts.'}
            </p>
          </div>
        </div>
        {pay && (pay.paidCents > 0 || pay.owedCents > 0) && (
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>
              Earned to date
            </div>
            <div className="font-mono" style={{ fontSize: 22, color: 'var(--ink)' }}>{dollars(pay.paidCents)}</div>
            {pay.owedCents > 0 && (
              <div style={{ fontSize: 12, color: 'var(--signal)' }}>{dollars(pay.owedCents)} pending</div>
            )}
          </div>
        )}
      </div>

      <StreakLadder rating={rating} />

      {mine.length > 0 && (
        <section style={{ marginBottom: 40 }}>
          <SectionHeader title="Your packets" />
          {mine.map((p) => (
            <PacketCard key={p.id} p={p} href={`/field/packet/${p.id}`} />
          ))}
        </section>
      )}

      {available.length > 0 && (
        <section>
          <SectionHeader title="Available now" />
          {available.map((p, i) => (
            <PacketCard key={p.id} p={p} href={`/field/packet/${p.id}`} featured={i === 0} />
          ))}
        </section>
      )}
    </FieldShell>
  );
}
