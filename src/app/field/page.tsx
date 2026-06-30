import type { Metadata } from 'next';
import Link from 'next/link';
import { resolveContractorFromCookie } from '@/lib/field-auth';
import { loadContractorMarketplace, getContractorPayStats, SUPPLY_CLOSET } from '@/lib/field-packets';
import { getContractorRatings, type ContractorRating } from '@/lib/field-ratings';
import { canClaim, onboardingComplete, dollars, packetHeadline, type PacketDetail } from '@/lib/field-types';
import { FieldShell } from './FieldShell';
import { ProfilePhoto } from './ProfilePhoto';

const TIER_TINT: Record<string, string> = { unrated: 'var(--ink-4)', bronze: '#a0522d', silver: '#8a8d91', gold: '#b8860b' };
const NEXT_TIER: Record<string, { name: string; at: number }> = {
  unrated: { name: 'Bronze', at: 25 },
  bronze: { name: 'Silver', at: 50 },
  silver: { name: 'Gold', at: 100 },
};

/** The contractor's own reputation: a ladder toward Bronze (25) / Silver (50) /
 *  Gold (100) cumulative 5-star reviews, with the current "in a row" run as a
 *  flourish. */
function StreakLadder({ rating }: { rating?: ContractorRating }) {
  const streak = rating?.fiveStreak ?? 0;
  const total = rating?.fiveStarTotal ?? 0;
  const count = rating?.count ?? 0;
  const tier = rating?.tier ?? 'unrated';
  const next = NEXT_TIER[tier]; // undefined at gold
  const pct = next ? Math.min(100, Math.round((total / next.at) * 100)) : 100;
  const milestones = [
    { n: 25, label: 'Bronze' },
    { n: 50, label: 'Silver' },
    { n: 100, label: 'Gold' },
  ];
  return (
    <div style={{ border: '1px solid var(--rule)', borderRadius: 12, padding: '16px 20px', marginBottom: 28, background: 'var(--paper-2, #fff)' }}>
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
          No guest reviews yet. The guests who stay in the homes you prep rate their stay — earn{' '}
          <strong style={{ color: TIER_TINT.bronze }}>25 five-star reviews</strong> for Bronze, 50 for Silver, 100
          for Gold.
        </p>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginBottom: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase', color: TIER_TINT[tier] }}>
              {tier === 'unrated' ? 'Unrated' : tier}
            </span>
            <span style={{ fontSize: 14, color: 'var(--ink)' }}>{total} five-star</span>
            {streak >= 3 && <span style={{ fontSize: 13, color: 'var(--signal)' }}>🔥 {streak} in a row</span>}
            {next ? (
              <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>{rating?.toNextTier ?? Math.max(0, next.at - total)} more → {next.name}</span>
            ) : (
              <span style={{ fontSize: 13, color: TIER_TINT.gold }}>Top tier 🥇</span>
            )}
          </div>
          <div style={{ height: 8, borderRadius: 999, background: 'var(--rule)', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${pct}%`, background: TIER_TINT[tier === 'unrated' ? 'bronze' : tier], transition: 'width .3s ease' }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
            {milestones.map((m) => (
              <span key={m.n} style={{ fontSize: 10.5, fontWeight: total >= m.n ? 700 : 400, color: total >= m.n ? TIER_TINT[m.label.toLowerCase()] : 'var(--ink-4)' }}>
                {total >= m.n ? '✓ ' : ''}{m.label} {m.n}
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
  const bases = p.stops.map((s) => s.window_basis);
  if (bases.every((b) => b === 'vacant')) return 'already cleaned · flexible timing';
  const parts: string[] = [];
  if (bases.includes('checkout_day')) parts.push('after the cleaning');
  if (bases.includes('vacant')) parts.push('flexible');
  if (bases.includes('pre_checkin')) parts.push('before check-in');
  return parts.join(', then ');
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
    p.distanceMiles != null ? `${p.distanceMiles < 1 ? '<1' : Math.round(p.distanceMiles)} mi away · ` : '';
  return (
    <Link
      href={href}
      style={{
        display: 'block',
        textDecoration: 'none',
        color: 'var(--ink)',
        border: featured ? '2px solid var(--signal)' : '1px solid var(--rule)',
        background: 'var(--paper-2, #fff)',
        padding: '18px 20px',
        marginBottom: 14,
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 11, letterSpacing: '0.16em', color: 'var(--signal)', fontWeight: 600, marginBottom: 6 }}>
            {eyebrowDate(p.visit_date)}
          </div>
          <div className="font-serif" style={{ fontSize: 20, fontWeight: 400, lineHeight: 1.15 }}>
            {packetHeadline(p)}
          </div>
          <div style={{ fontSize: 13, color: 'var(--ink-3)', marginTop: 8, lineHeight: 1.5 }}>
            {[...new Set(p.stops.map((s) => s.property.name))].join(' · ')}
          </div>
          <div style={{ fontSize: 12, color: 'var(--ink-4)', marginTop: 6 }}>
            {away}
            {spread}
            {windowSummary(p)}
          </div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
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

/** The three things every visit covers — the contractor's quality bar, shown
 *  on the welcome screen so they learn the standard before their first claim. */
const WELCOME_PILLARS: Array<{ title: string; desc: string }> = [
  { title: 'Perfection', desc: "The home should look flawless: staged, spotless, guest-ready. You're the last set of eyes before check-in." },
  { title: 'Maintenance', desc: 'Flag anything worn, leaking, or drifting toward a repair, so we fix it before a guest ever notices.' },
  { title: 'Supplies', desc: "Confirm the essentials are stocked, and note whatever's running low so we can restock fast." },
];

/** The onboarding journey as a status rail on the welcome screen. activeIndex
 *  marks the live stage; everything before it reads as done. `failed` paints the
 *  active node in the negative tone with no pulse. */
function JourneyRail({ activeIndex, failed }: { activeIndex: number; failed?: boolean }) {
  const steps = ['Applied', 'Account set up', 'Background check', 'Ready to claim'];
  return (
    <div style={{ display: 'flex' }}>
      {steps.map((label, i) => {
        const done = i < activeIndex;
        const active = i === activeIndex;
        const dotBg = done ? 'var(--signal)' : active ? (failed ? 'var(--negative, #b3261e)' : 'var(--signal)') : 'var(--paper)';
        return (
          <div key={label} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', position: 'relative', minWidth: 0 }}>
            {i > 0 && <span style={{ position: 'absolute', top: 9, left: 0, width: '50%', height: 2, background: i <= activeIndex ? 'var(--signal)' : 'var(--rule)' }} />}
            {i < steps.length - 1 && <span style={{ position: 'absolute', top: 9, right: 0, width: '50%', height: 2, background: i < activeIndex ? 'var(--signal)' : 'var(--rule)' }} />}
            <span
              className={active && !failed ? 'animate-pulse' : undefined}
              style={{ position: 'relative', zIndex: 1, width: 18, height: 18, borderRadius: '50%', background: dotBg, border: done || active ? 'none' : '2px solid var(--rule)', color: 'var(--paper)', fontSize: 11, display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: active && !failed ? '0 0 0 4px rgba(200,90,58,0.14)' : 'none' }}
            >
              {done ? '✓' : ''}
            </span>
            <span style={{ fontSize: 10.5, marginTop: 8, textAlign: 'center', lineHeight: 1.3, color: done || active ? 'var(--ink)' : 'var(--ink-4)', fontWeight: active ? 600 : 400, padding: '0 2px' }}>
              {label}
            </span>
          </div>
        );
      })}
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

    const card: React.CSSProperties = { border: '1px solid var(--rule)', borderRadius: 12, background: 'var(--paper-2, #fff)', padding: '18px 22px' };
    const eyebrow: React.CSSProperties = { fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--ink-4)', marginBottom: 12 };
    const numbered = (rows: Array<[string, string]>, accent: string) => (
      <div style={card}>
        {rows.map(([t, d], i) => (
          <div key={t} style={{ display: 'flex', gap: 14, paddingTop: i === 0 ? 0 : 14, marginTop: i === 0 ? 0 : 14, borderTop: i === 0 ? 'none' : '1px solid var(--rule)' }}>
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
        {/* Hero + journey rail */}
        <div style={{ border: '1px solid var(--rule)', borderTop: '3px solid var(--signal)', borderRadius: 12, background: 'var(--paper-2, #fff)', padding: '24px 24px 22px', marginBottom: 28 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 22 }}>
            <ProfilePhoto current={contractor.photo_url} name={contractor.full_name} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 11, letterSpacing: '0.2em', textTransform: 'uppercase', color: failed ? 'var(--negative, #b3261e)' : 'var(--signal)', fontWeight: 600, marginBottom: 6 }}>
                {failed ? 'Action needed' : setupDone ? 'Welcome aboard' : 'One step left'}
              </div>
              <h1 className="font-serif" style={{ fontSize: 30, fontWeight: 300, lineHeight: 1.05, margin: 0 }}>
                {failed ? `Let's clear this up, ${first}` : setupDone ? `You made the crew, ${first}` : `Almost there, ${first}`}
              </h1>
            </div>
          </div>

          <JourneyRail activeIndex={activeIndex} failed={failed} />

          <p style={{ fontSize: 14, color: 'var(--ink-3)', lineHeight: 1.6, margin: '22px 0 0' }}>
            {failed ? (
              <>There&apos;s a hold on your background check. Give the office a call at (978) 865-2387 and we&apos;ll get it sorted.</>
            ) : setupDone ? (
              <>Your setup is done. We&apos;re running the background check now (standard, since you&apos;ll have keys to owners&apos; homes). The moment it clears we&apos;ll text and email you, and your first packets open up right here.</>
            ) : (
              <>You&apos;re invited. Finish your quick setup (W-9, a short agreement, and how you want to be paid) and we&apos;ll start your background check. As soon as it clears, you can claim paid work near you.</>
            )}
          </p>

          {!setupDone && !failed && (
            <Link href="/field/onboarding" style={{ display: 'inline-block', marginTop: 16, background: 'var(--ink)', color: 'var(--paper)', textDecoration: 'none', fontSize: 12, fontWeight: 600, letterSpacing: '0.16em', textTransform: 'uppercase', padding: '12px 24px' }}>
              Finish setup
            </Link>
          )}
        </div>

        {/* Learn the standard while you wait */}
        <div style={{ marginBottom: 28 }}>
          <div style={eyebrow}>While you wait · know the standard</div>
          <div style={card}>
            {WELCOME_PILLARS.map((p, i) => (
              <div key={p.title} style={{ display: 'flex', gap: 14, paddingTop: i === 0 ? 0 : 14, marginTop: i === 0 ? 0 : 14, borderTop: i === 0 ? 'none' : '1px solid var(--rule)' }}>
                <span className="font-mono" style={{ fontSize: 13, color: 'var(--signal)', fontWeight: 600, flexShrink: 0, width: 18 }}>{i + 1}</span>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--ink)', marginBottom: 2 }}>{p.title}</div>
                  <div style={{ fontSize: 13.5, color: 'var(--ink-3)', lineHeight: 1.55 }}>{p.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* How a visit works */}
        <div style={{ marginBottom: 28 }}>
          <div style={eyebrow}>How a visit works</div>
          {numbered(
            [
              ['Claim a packet', 'Pick up a route of nearby homes, priced up front. First come, first served.'],
              ['Grab your bins', `Swing by the supply closet at ${SUPPLY_CLOSET} for each home's labeled bin before you head out.`],
              ['Walk each home', 'Inspect against the standard above, snap a few photos, and flag anything off.'],
              ['Submit and get paid', 'Send it in. Once the office reviews it, your payout is on the way.'],
            ],
            'var(--ink-4)',
          )}
        </div>

        {/* A preview of the work */}
        <div>
          <div style={eyebrow}>{preview.length > 0 ? 'A look at what’s waiting' : 'The work'}</div>
          {preview.length > 0 ? (
            <>
              {preview.map((p, i) => (
                <PacketCard key={p.id} p={p} href={`/field/packet/${p.id}`} featured={i === 0} />
              ))}
              <p style={{ fontSize: 12, color: 'var(--ink-4)', marginTop: 4 }}>
                Browse all you like. Claiming unlocks the second your check clears.
              </p>
            </>
          ) : (
            <div style={card}>
              <p style={{ fontSize: 14, color: 'var(--ink-3)', lineHeight: 1.6, margin: 0 }}>
                No routes are open this minute, but new ones post all the time. We&apos;ll text you the moment a packet near you goes up.
              </p>
            </div>
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
            <h1 className="font-serif" style={{ fontSize: 30, fontWeight: 300, marginBottom: 4 }}>
              Hi {contractor.full_name.split(' ')[0]}
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
        <section style={{ marginBottom: 36 }}>
          <h2
            style={{
              fontSize: 11,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              color: 'var(--ink-4)',
              marginBottom: 12,
            }}
          >
            Your packets
          </h2>
          {mine.map((p) => (
            <PacketCard key={p.id} p={p} href={`/field/packet/${p.id}`} />
          ))}
        </section>
      )}

      {available.length > 0 && (
        <section>
          <h2
            style={{
              fontSize: 11,
              letterSpacing: '0.18em',
              textTransform: 'uppercase',
              color: 'var(--ink-4)',
              marginBottom: 12,
            }}
          >
            Available now
          </h2>
          {available.map((p, i) => (
            <PacketCard key={p.id} p={p} href={`/field/packet/${p.id}`} featured={i === 0} />
          ))}
        </section>
      )}
    </FieldShell>
  );
}
