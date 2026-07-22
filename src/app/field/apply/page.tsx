import type { Metadata } from 'next';
import { FieldShell } from '../FieldShell';
import { ApplyForm } from './ApplyForm';
import { parseTrade, TRADE_META, type ContractorTrade } from '@/lib/field-types';
import { loadRateCards, rungLabel, STANDARD_CARD, type RateCard } from '@/lib/creative-rates';

export const dynamic = 'force-dynamic';

const NOINDEX = { index: false, follow: false, googleBot: { index: false, follow: false } } as const;

export async function generateMetadata({
  searchParams,
}: {
  searchParams: Promise<{ trade?: string }>;
}): Promise<Metadata> {
  const trade = parseTrade((await searchParams).trade);
  return { title: `${TRADE_META[trade].role} · Rising Tide`, robots: NOINDEX };
}

/** Public-facing recruiting copy per trade. Each job type has its own apply
 *  link (?trade=), so the page speaks to that role. Inspection is the default. */
const COPY: Record<
  ContractorTrade,
  { intro: string; bulletsHeading: string; bullets: [string, string][]; successTail: string }
> = {
  inspection: {
    intro:
      "Rising Tide manages short-term rentals across Cape Ann. We're a hands-on team, and we need a sharp, reliable local to help us cover more ground between guests. Flexible, paid-per-visit work on your own schedule. Visits run 20 to 90 minutes, usually 2 to 5 homes per trip.",
    bulletsHeading: 'On every visit you cover three things:',
    bullets: [
      ['Perfection', 'the home should look flawless and guest-ready.'],
      ['Maintenance', 'flag anything worn or heading toward a repair.'],
      ['Supplies & inventory', 'confirm the essentials are stocked and note anything running low.'],
    ],
    successTail: 'start claiming paid inspections near you.',
  },
  maintenance: {
    intro:
      "Rising Tide manages short-term rentals across Cape Ann. We need a reliable local handyman for repairs and upkeep between guests. Flexible, paid-per-job work on your own schedule.",
    bulletsHeading: 'What the work looks like:',
    bullets: [
      ['Repairs', 'fix what breaks between guests, from a running toilet to a loose railing.'],
      ['Punch lists', 'knock out the small stuff owners and guests flag.'],
      ['Upkeep', 'seasonal and preventive work that keeps a home guest-ready.'],
    ],
    successTail: 'start claiming paid jobs near you.',
  },
  creative: {
    intro:
      "Rising Tide manages the best short-term rentals on Cape Ann, and we're hiring a local to make them look as good as they feel. You shoot and edit short video and photos at our homes for Stay Cape Ann and Rising Tide. Flexible, paid per delivered asset, on your own schedule.",
    bulletsHeading: "What you'll make:",
    bullets: [
      ['Short video', 'shoot and edit Reels on location that make a home worth booking.'],
      ['Photo & stories', 'carousels and story sets that sell the stay and the coast.'],
      ['Paid per asset', 'a clear rate card, delivered on your schedule, paid monthly.'],
    ],
    successTail: 'start on paid content assets.',
  },
  cleaning: {
    intro:
      "Rising Tide manages short-term rentals across Cape Ann. We need dependable local turnover cleaners between guests. Flexible, paid-per-turn work on your own schedule.",
    bulletsHeading: 'What the work looks like:',
    bullets: [
      ['Turnovers', 'reset a home to five-star condition between guests.'],
      ['An eye for detail', 'the little things guests notice are the whole job.'],
      ['Reliability', 'turns happen on a tight clock, same-day before check-in.'],
    ],
    successTail: 'start claiming paid turns near you.',
  },
};

const GOLD = '#b0842a';

/** Compact live rate ladder for the creative apply page: the standard card's
 *  base, view rungs, carousel add-on, and a one-line terms summary. Applicants
 *  see the real current rates, not a promise of "a clear rate card". */
function RateLadder({ card }: { card: RateCard }) {
  const rows = [
    { label: 'Base', sub: 'per reel', cents: card.baseCents, top: false },
    ...card.tiers.map((t, i) => ({
      label: rungLabel(t, i === card.tiers.length - 1),
      sub: 'IG views',
      cents: t.cents,
      top: i === card.tiers.length - 1,
    })),
  ];

  const bits = [
    card.minSeconds > 0 ? `reels run at least ${card.minSeconds} seconds` : null,
    `Instagram views count for ${card.countDays} days and pay the highest rung reached`,
    `up to ${card.maxPerShoot} reel${card.maxPerShoot === 1 ? '' : 's'} per shoot`,
    'paid monthly',
  ].filter(Boolean).join(' · ');
  const terms = bits.charAt(0).toUpperCase() + bits.slice(1) + '.';

  return (
    <div style={{ maxWidth: 520, marginTop: 22 }}>
      <div style={{ fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--ink-4)', marginBottom: 10 }}>
        The rate card
      </div>
      <div style={{ border: '1px solid var(--rule)', borderRadius: 12, overflow: 'hidden', background: 'var(--paper-2, #fff)' }}>
        {rows.map((r, i) => (
          <div
            key={r.label}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
              padding: '10px 14px',
              borderTop: i === 0 ? 'none' : '1px solid var(--rule)',
              background: r.top ? 'rgba(176,132,42,0.07)' : 'transparent',
            }}
          >
            <div>
              <span style={{ fontWeight: 600, fontSize: 14 }}>
                {r.label}
                {r.top && <span style={{ color: GOLD, fontSize: 11 }}> ★</span>}
              </span>
              <span style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-4)', marginLeft: 8 }}>{r.sub}</span>
            </div>
            <span className="font-serif" style={{ fontSize: r.top ? 20 : 17, color: r.top ? GOLD : 'var(--ink)', fontWeight: r.top ? 600 : 400 }}>
              ${Math.round(r.cents / 100).toLocaleString('en-US')}
            </span>
          </div>
        ))}
        {card.carouselCents > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '10px 14px', borderTop: '1px dashed var(--rule)' }}>
            <div>
              <span style={{ fontWeight: 600, fontSize: 14 }}>Carousel add-on</span>
              <span style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-4)', marginLeft: 8 }}>same shoot, fresh shots</span>
            </div>
            <span className="font-serif" style={{ fontSize: 17, color: 'var(--tide-deep)' }}>
              +${Math.round(card.carouselCents / 100).toLocaleString('en-US')}
            </span>
          </div>
        )}
      </div>
      <p style={{ fontSize: 12.5, color: 'var(--ink-4)', lineHeight: 1.5, margin: '10px 0 0' }}>{terms}</p>
    </div>
  );
}

export default async function ApplyPage({
  searchParams,
}: {
  searchParams: Promise<{ submitted?: string; src?: string; trade?: string }>;
}) {
  const sp = await searchParams;
  const trade = parseTrade(sp.trade);
  const meta = TRADE_META[trade];
  const copy = COPY[trade];

  if (sp.submitted) {
    return (
      <FieldShell showSignOut={false}>
        <h1 className="font-serif" style={{ fontSize: 30, fontWeight: 300, marginBottom: 12 }}>Thanks, we got it</h1>
        <p style={{ fontSize: 15, color: 'var(--ink-3)', lineHeight: 1.6, maxWidth: 480 }}>
          We&apos;ll review your application and follow up by email with next steps. If it&apos;s a fit, you&apos;ll get a
          personal link to set up your account and {copy.successTail}
        </p>
      </FieldShell>
    );
  }

  // The live standard card (never a per-talent card; applicants have none).
  // loadRateCards falls back to STANDARD_CARD on query errors; the catch
  // covers fieldDb() throwing on missing env, since this page is public.
  const rateCard =
    trade === 'creative'
      ? await loadRateCards().then((r) => r.def).catch(() => STANDARD_CARD)
      : null;

  return (
    <FieldShell showSignOut={false}>
      <h1 className="font-serif" style={{ fontSize: 30, fontWeight: 300, marginBottom: 12 }}>{meta.role}</h1>
      <p style={{ fontSize: 15, color: 'var(--ink-3)', lineHeight: 1.6, maxWidth: 520, marginBottom: 20 }}>
        {copy.intro}
      </p>
      <div style={{ maxWidth: 520, marginBottom: 0 }}>
        <div style={{ fontSize: 13, color: 'var(--ink-3)', marginBottom: 10 }}>{copy.bulletsHeading}</div>
        {copy.bullets.map(([t, d]) => (
          <div key={t} style={{ display: 'flex', gap: 8, fontSize: 14, color: 'var(--ink-3)', lineHeight: 1.55, marginBottom: 6 }}>
            <span style={{ color: 'var(--signal)' }}>•</span>
            <span><strong style={{ color: 'var(--ink)', fontWeight: 600 }}>{t}:</strong> {d}</span>
          </div>
        ))}
      </div>
      {rateCard && <RateLadder card={rateCard} />}
      <hr style={{ border: 'none', borderTop: '1px solid var(--rule)', margin: '28px 0 24px', maxWidth: 520 }} />
      <ApplyForm source={sp.src ?? ''} trade={trade} />
    </FieldShell>
  );
}
