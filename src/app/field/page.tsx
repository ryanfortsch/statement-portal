import type { Metadata } from 'next';
import Link from 'next/link';
import { resolveContractorFromCookie } from '@/lib/field-auth';
import { loadContractorMarketplace, getContractorPayStats, SUPPLY_CLOSET } from '@/lib/field-packets';
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
            {streak >= 3 && <span style={{ fontSize: 13, color: 'var(--signal)' }}>{streak} in a row</span>}
            {next ? (
              <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>{rating?.toNextTier ?? Math.max(0, next.at - total)} more to {next.name}</span>
            ) : (
              <span style={{ fontSize: 13, color: TIER_TINT.gold }}>Top tier</span>
            )}
          </div>
          <div style={{ height: 8, borderRadius: 999, background: 'var(--paper-3)', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${pct}%`, background: TIER_TINT[tier === 'unrated' ? 'bronze' : tier], transition: 'width .3s ease' }} />
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 6 }}>
            {milestones.map((m) => (
              <span key={m.n} style={{ fontSize: 10.5, fontWeight: total >= m.n ? 700 : 400, color: total >= m.n ? TIER_TINT[m.label.toLowerCase()] : 'var(--ink-4)' }}>
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
        border: 'none',
        borderLeft: featured ? '3px solid var(--signal)' : undefined,
        background: 'var(--paper-2)',
        boxShadow: '0 1px 0 var(--rule), 0 6px 16px rgba(11,37,69,0.06)',
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

/** The onboarding journey as a flat progress track reversed out of the navy
 *  hero plate. The fill (tide, or negative when failed) runs to the live stage;
 *  labels carry the state. No dots, no pulse. */
function JourneyRail({ activeIndex, failed }: { activeIndex: number; failed?: boolean }) {
  const steps = ['Applied', 'Account set up', 'Background check', 'Ready to claim'];
  const pct = (activeIndex / (steps.length - 1)) * 100;
  const fill = failed ? 'var(--negative)' : 'var(--tide)';
  return (
    <div style={{ marginTop: 24 }}>
      <div style={{ position: 'relative', height: 2, background: 'rgba(245,239,226,0.18)' }}>
        <div style={{ position: 'absolute', left: 0, top: 0, height: 2, width: `${pct}%`, background: fill }} />
        <span style={{ position: 'absolute', top: -1, left: `calc(${pct}% - 2px)`, width: 4, height: 4, background: fill }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8 }}>
        {steps.map((label, i) => {
          const done = i < activeIndex;
          const active = i === activeIndex;
          const color = done ? 'var(--paper)' : active ? (failed ? 'var(--negative)' : 'var(--signal-soft)') : 'rgba(245,239,226,0.4)';
          return (
            <span
              key={label}
              style={{ flex: 1, fontSize: 10.5, letterSpacing: '0.12em', textTransform: 'uppercase', lineHeight: 1.3, color, fontWeight: active ? 600 : 400, textAlign: i === 0 ? 'left' : i === steps.length - 1 ? 'right' : 'center' }}
            >
              {label}
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
              <>Your setup is done. We&apos;re running the background check now (standard, since you&apos;ll have keys to owners&apos; homes). The moment it clears we&apos;ll text and email you, and your first packets open up right here.</>
            ) : (
              <>You&apos;re invited. Finish your quick setup (W-9, a short agreement, and how you want to be paid) and we&apos;ll start your background check. As soon as it clears, you can claim paid work near you.</>
            )}
          </p>

          {!setupDone && !failed && (
            <Link href="/field/onboarding" style={{ display: 'inline-block', marginTop: 20, background: 'var(--paper)', color: 'var(--ink)', textDecoration: 'none', fontSize: 12, fontWeight: 600, letterSpacing: '0.16em', textTransform: 'uppercase', padding: '12px 24px' }}>
              Finish setup
            </Link>
          )}
        </div>

        {/* The role: leading why + what callout */}
        <div style={{ background: 'var(--ink)', borderRadius: 4, padding: 'clamp(28px,6vw,36px)', marginBottom: 40 }}>
          <div className="font-mono" style={{ fontSize: 11, letterSpacing: '0.22em', textTransform: 'uppercase', color: 'var(--signal-soft)', fontWeight: 600, marginBottom: 10 }}>
            The role
          </div>
          <h2 className="font-serif" style={{ fontSize: 'clamp(26px,6vw,34px)', fontWeight: 300, lineHeight: 1.15, letterSpacing: '-0.01em', color: 'var(--paper)', margin: '0 0 22px' }}>
            A guest opens a door. What they feel in the <span style={{ color: 'var(--signal-soft)' }}>first thirty seconds</span>, you decided.
          </h2>
          <p style={{ fontSize: 14, color: 'rgba(245,239,226,0.80)', lineHeight: 1.6, margin: '0 0 18px', maxWidth: '62ch' }}>
            You are the last person in the home before a guest walks in. The job is plain. You claim a route of
            nearby homes, pick up each home&apos;s labeled bin from the closet at {SUPPLY_CLOSET}, walk every room
            against our standard, restock what is thin, snap a few photos, and flag anything a guest would notice. You
            are not cleaning the home and you are not fixing it. You are the one who stands in the doorway and decides
            it is right.
          </p>
          <div style={{ display: 'flex', gap: 18, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <div style={{ flexShrink: 0 }}>
              <div className="font-serif" style={{ fontSize: 46, fontWeight: 300, color: 'var(--signal-soft)', lineHeight: 1 }}>3rd</div>
              <div style={{ fontSize: 11, color: 'rgba(245,239,226,0.6)', maxWidth: 130, marginTop: 5, lineHeight: 1.35 }}>
                biggest factor in a booking, after location and price
              </div>
            </div>
            <p style={{ fontSize: 14, color: 'rgba(245,239,226,0.80)', lineHeight: 1.6, flex: 1, minWidth: 220, margin: 0 }}>
              It is real, flexible work, and it pays like it matters. Guest reviews are the third biggest reason
              someone books a Rising Tide home, after location and price, and a review starts the moment a door swings
              open. Pay is time on site at a <strong style={{ color: 'var(--paper)' }}>$40 an hour</strong> basis,
              baked into a whole-dollar price posted on every packet before you claim it. No bidding, no guessing. You
              see the number, you decide, you go.
            </p>
          </div>
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
              ['Grab your bins', `Swing by the closet at ${SUPPLY_CLOSET} and grab each home's labeled bin on your way out.`],
              ['Walk each home', 'Inspect against the standard above, snap a few photos, and flag anything off.'],
              ['Submit and get paid', 'Send it in. Once the office reviews it, your payout is on the way.'],
            ],
            'var(--tide)',
          )}
        </div>

        {/* Why it matters: the mission, as the second navy feature */}
        <div style={{ margin: '48px 0' }}>
          <SectionHeader n="03" title="Why it matters" />
          <div style={{ background: 'var(--ink)', borderRadius: 4, padding: 'clamp(24px,5vw,30px)' }}>
            <p className="font-serif" style={{ fontSize: 22, fontWeight: 300, lineHeight: 1.3, margin: '0 0 16px', color: 'var(--paper)' }}>
              Our whole business is the guest experience.
            </p>
            <p style={{ fontSize: 14, color: 'rgba(245,239,226,0.78)', lineHeight: 1.6, margin: '0 0 16px' }}>
              You&apos;re the last set of eyes before that door opens. What a guest feels stepping inside, and what
              they write afterward, runs through your visit. Those reviews are tied to your name, and they build a
              track record you carry.
            </p>
            <p className="font-serif" style={{ fontSize: 16, fontStyle: 'italic', color: 'var(--paper-2)', lineHeight: 1.5, margin: 0, borderTop: '1px solid var(--tide)', paddingTop: 16 }}>
              This isn&apos;t checkbox work. It&apos;s looking around corners, catching the thing a guest would notice
              before they ever do.
            </p>
          </div>
        </div>

        {/* Ways to earn: the role grows over time */}
        <div style={{ margin: '48px 0' }}>
          <SectionHeader n="04" title="Ways to earn" />
          <p style={{ fontSize: 14, color: 'var(--ink-3)', lineHeight: 1.6, maxWidth: '64ch', marginBottom: 20 }}>
            Once you are cleared and claiming, a single inspection is the floor, not the ceiling. The same walk can
            pay more, and there is a second lane of work beyond inspection entirely. Here is what is real today, in
            plain numbers.
          </p>
          {numbered(
            [
              ['Bigger homes pay more', 'Pay follows the work. A four-bed walk is budgeted at more on-site time than a studio, so it pays more, right inside the same packet.'],
              ['Up to five homes in one trip', 'Packets bundle nearby homes, up to five within a few miles. Every stop adds its own on-site pay, so a tight cluster is more paid work off one drive.'],
              ['Paid drive past the core', 'The Cape Ann core near base is an unpaid commute, like any job. Past the first five miles, your round trip and the hops between stops are paid at the same hourly rate.'],
              ['A bump for short notice', 'A visit landing within two days carries a modest rush bump, about 15 percent, for the short notice. Not a tier, just fair pay for little notice.'],
              ['Maintenance as a second lane', 'Beyond inspection, the office bundles real fix-it work into its own priced packets, off open work slips. It is a genuine second kind of packet the office can set you up to claim, so ask them if you want it.'],
            ],
            'var(--tide)',
          )}
          <div style={{ background: 'var(--ink)', borderRadius: 4, padding: 'clamp(24px,5vw,30px)', marginTop: 24 }}>
            <p style={{ fontSize: 14, color: 'rgba(245,239,226,0.80)', lineHeight: 1.6, margin: 0 }}>
              A word on reputation, so it is clear. Reliability moves you up the notify order, so proven inspectors
              hear about a new packet first on a first-come claim, and new inspectors start mid-pack, not last. The
              stays you prep earn a track record too: cumulative five-star guest reviews carry you to Bronze at 25,
              Silver at 50, Gold at 100. To be straight with you, those tiers are reputation, not a pay dial. No badge
              multiplies your hourly rate. What a strong record buys you is <strong style={{ color: 'var(--signal-soft)' }}>the head start</strong>,
              hearing about work first and building trust that keeps it coming. None of it starts until your
              background check clears. The moment it does, the first packet is yours to claim. Thanks in advance for
              the great work.
            </p>
          </div>
        </div>

        {/* A preview of the work */}
        <div>
          <SectionHeader n="05" title={preview.length > 0 ? 'What’s waiting' : 'The work'} />
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
