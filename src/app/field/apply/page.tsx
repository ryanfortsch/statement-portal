import type { Metadata } from 'next';
import { FieldShell } from '../FieldShell';
import { ApplyForm } from './ApplyForm';
import { parseTrade, TRADE_META, type ContractorTrade } from '@/lib/field-types';

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
      <hr style={{ border: 'none', borderTop: '1px solid var(--rule)', margin: '28px 0 24px', maxWidth: 520 }} />
      <ApplyForm source={sp.src ?? ''} trade={trade} />
    </FieldShell>
  );
}
