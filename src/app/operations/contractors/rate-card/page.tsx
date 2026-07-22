import type { Metadata } from 'next';
import { fieldDb, isFieldConfigured } from '@/lib/field-db';
import { loadEffectiveCard, payForViews, type RateCard } from '@/lib/creative-rates';
import { PrintButton } from './PrintButton';

/**
 * The printable Reel Rate Card - the editorial one-pager sent to content
 * partners, rendered from the live card data (standard, or a talent's custom
 * card via ?contractor=<id>, which also stamps "Prepared for <name>").
 * House pattern: server-rendered HTML the operator prints to PDF with Cmd+P;
 * backgrounds forced for print like the SCA placards.
 */

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Reel Rate Card · Rising Tide',
  robots: { index: false, follow: false },
};

// Palette: Rising Tide navy/gold on warm paper (print-safe, no CSS vars so the
// card renders identically outside the Helm theme).
const NAVY = '#12283f';
const PAPER = '#f3efe6';
const CARD = '#fffdf8';
const INK = '#17293b';
const INK_SOFT = '#4a5b6b';
const INK_FAINT = '#8a94a0';
const RULE = '#e3ddd0';
const RULE_SOFT = '#ece7db';
const GOLD = '#b0842a';
const GOLD_INK = '#8a6414';
const SEA = '#3f6d8a';
const SEA_INK = '#2f5670';
const ON_NAVY = '#f3ede0';
const HEAT = 'rgba(176,132,42,0.09)';
const SEA_TINT = 'rgba(63,109,138,0.08)';

function weeksOrDays(days: number): string {
  if (days % 7 === 0) {
    const w = days / 7;
    return `${w} week${w === 1 ? '' : 's'}`;
  }
  return `${days} days`;
}

const NUM_WORD = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

function fmt(cents: number): string {
  return `$${Math.round(cents / 100).toLocaleString('en-US')}`;
}

/** Derived "How it works" rules, mirroring the hand-written card's structure. */
function buildRules(card: RateCard): Array<{ lead: string; body: string }> {
  const rules: Array<{ lead: string; body: string }> = [];
  if (card.minSeconds > 0) rules.push({ lead: `${card.minSeconds} seconds minimum.`, body: '' });
  rules.push({
    lead: `${fmt(card.baseCents)} base per reel.`,
    body:
      card.tiers.length > 0
        ? `Every reel we green-light earns the base. From ${card.tiers[0].views.toLocaleString('en-US')} views up, the rate climbs.`
        : 'Every reel we green-light earns the base.',
  });
  rules.push({
    lead: `Counted at ${weeksOrDays(card.countDays)}.`,
    body: `View count is locked ${card.countDays} days after posting, read from Instagram's analytics, so a reel has time to find its audience.`,
  });
  const strongest = NUM_WORD[card.maxPerShoot] ?? String(card.maxPerShoot);
  rules.push({
    lead: `Up to ${card.maxPerShoot} reel${card.maxPerShoot === 1 ? '' : 's'} per shoot.`,
    body:
      `Each shoot pays out on its ${card.maxPerShoot === 1 ? 'strongest reel' : `${strongest} strongest reels`}.` +
      (card.carouselCents > 0 ? ` A carousel from that shoot is the +${fmt(card.carouselCents)} add-on.` : ''),
  });
  return rules;
}

export default async function RateCardPrintPage({
  searchParams,
}: {
  searchParams: Promise<{ contractor?: string }>;
}) {
  const { contractor: contractorId } = await searchParams;

  let talentName: string | null = null;
  if (contractorId && isFieldConfigured) {
    const { data } = await fieldDb().from('contractors').select('full_name').eq('id', contractorId).maybeSingle();
    talentName = (data?.full_name as string | undefined) ?? null;
  }
  const card = await loadEffectiveCard(contractorId ?? null);

  const rows: Array<{ label: string; sub: string; cents: number; top: boolean }> = [
    { label: 'Base', sub: 'per reel', cents: card.baseCents, top: false },
    ...card.tiers.map((t, i) => ({
      label: `${t.views.toLocaleString('en-US')}${i === card.tiers.length - 1 ? '+' : ''}`,
      sub: 'IG views',
      cents: t.cents,
      top: i === card.tiers.length - 1,
    })),
  ];
  const barWidth = (i: number) => (rows.length === 1 ? 100 : Math.round(25 + (i / (rows.length - 1)) * 75));

  // Worked example between the two top rungs, e.g. 2,300 views when the rungs
  // are 2,000 and 5,000.
  let example: React.ReactNode = null;
  if (card.tiers.length >= 2) {
    const second = card.tiers[card.tiers.length - 2];
    const top = card.tiers[card.tiers.length - 1];
    const exViews = Math.round((second.views * 1.15) / 100) * 100;
    example = (
      <>
        A reel that reaches <b style={{ color: INK }}>{exViews.toLocaleString('en-US')} Instagram views</b> earns{' '}
        <span style={amt}>{fmt(payForViews(card, exViews))}</span>. Passes <b style={{ color: INK }}>{top.views.toLocaleString('en-US')}</b> by
        day {card.countDays}, it&rsquo;s <span style={amt}>{fmt(top.cents)}</span>.
        {card.carouselCents > 0 && (
          <> Add a carousel from the same shoot and that&rsquo;s <span style={amt}>+{fmt(card.carouselCents)}</span> on top.</>
        )}
      </>
    );
  }

  const rules = buildRules(card);
  const finePrint =
    `Views are read from Instagram's analytics on the reel as posted, locked at ${card.countDays} days. ` +
    `One rate per reel: the highest view mark reached, not the sum. ` +
    `Up to ${card.maxPerShoot} reel${card.maxPerShoot === 1 ? '' : 's'} per shoot` +
    (card.carouselCents > 0 ? `; a carousel from the shoot is +${fmt(card.carouselCents)}. ` : '. ') +
    `Reels are approved before posting, and paid after the ${card.countDays}-day count.` +
    (card.extraTerms.length > 0 ? ' ' + card.extraTerms.join(' ') : '');

  const today = new Date().toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  return (
    <div style={{ background: PAPER, minHeight: '100vh', WebkitPrintColorAdjust: 'exact', printColorAdjust: 'exact' } as React.CSSProperties}>
      <style>{`
        @page { size: letter; margin: 0; }
        @media print {
          .no-print { display: none !important; }
          body { background: ${PAPER} !important; }
          * { -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
        }
      `}</style>
      <PrintButton />

      <div style={{ maxWidth: 816, margin: '0 auto', padding: '0 40px 56px', color: INK, fontFamily: "'Inter', -apple-system, sans-serif", lineHeight: 1.6 }}>
        {/* Masthead */}
        <header style={{ background: NAVY, color: ON_NAVY, borderRadius: '0 0 14px 14px', padding: '38px 40px 32px', margin: '0 -40px', position: 'relative', overflow: 'hidden' }}>
          <div style={{ fontSize: 11, letterSpacing: '0.24em', textTransform: 'uppercase', color: GOLD, fontWeight: 700, marginBottom: 16 }}>
            Rising Tide · Content Partners
          </div>
          <h1 className="font-serif" style={{ fontWeight: 400, fontSize: 46, lineHeight: 1.02, letterSpacing: '-0.01em', margin: 0 }}>
            Reel Rate Card
          </h1>
          {talentName && (
            <div style={{ fontSize: 14, color: 'rgba(243,237,224,0.72)', marginTop: 12 }}>
              Prepared for <b style={{ color: ON_NAVY, fontWeight: 600 }}>{talentName}</b> · {today}
            </div>
          )}
          <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 4, background: `linear-gradient(90deg, ${GOLD}, transparent 78%)` }} />
        </header>

        {/* Ladder */}
        <section style={{ marginTop: 42 }}>
          <Eyebrow>What a reel earns</Eyebrow>
          <p style={{ color: INK_SOFT, fontSize: 14.5, margin: '-6px 0 20px', maxWidth: '60ch' }}>
            Every reel earns a base. As it&rsquo;s watched, the pay steps up to the highest view mark it reaches on Instagram.
          </p>
          <div style={{ border: `1px solid ${RULE}`, borderRadius: 12, overflow: 'hidden', background: CARD }}>
            {rows.map((r, i) => (
              <div
                key={r.label}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '130px 1fr 110px',
                  alignItems: 'center',
                  gap: 20,
                  padding: '15px 22px',
                  borderTop: i === 0 ? 'none' : `1px solid ${RULE_SOFT}`,
                  background: r.top ? HEAT : 'transparent',
                }}
              >
                <div>
                  <div style={{ fontWeight: 700, fontSize: r.top ? 18 : 16, color: INK }}>
                    {r.label}
                    {r.top && <span style={{ color: GOLD, fontSize: 12 }}> ★</span>}
                  </div>
                  <div style={{ fontSize: 10, letterSpacing: '0.13em', textTransform: 'uppercase', color: INK_FAINT }}>{r.sub}</div>
                </div>
                <div style={{ height: 12, borderRadius: 999, background: RULE_SOFT, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${barWidth(i)}%`, borderRadius: 999, background: `linear-gradient(90deg, rgba(176,132,42,0.55), ${GOLD})` }} />
                </div>
                <div className="font-serif" style={{ fontSize: r.top ? 30 : 26, color: r.top ? GOLD_INK : INK, textAlign: 'right', fontWeight: r.top ? 600 : 400 }}>
                  {fmt(r.cents)}
                </div>
              </div>
            ))}
          </div>

          {card.carouselCents > 0 && (
            <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 16, border: `1px dashed ${SEA}`, borderRadius: 12, background: SEA_TINT, padding: '15px 20px' }}>
              <div className="font-serif" style={{ fontSize: 26, color: SEA_INK, flexShrink: 0 }}>+ {fmt(card.carouselCents)}</div>
              <div>
                <div style={{ fontSize: 14.5, color: INK, fontWeight: 600 }}>Carousel</div>
                <div style={{ fontSize: 13, color: INK_SOFT, marginTop: 1 }}>
                  Add a carousel from the same shoot. Photos or fresh clips both work, nothing pulled from the reel.
                </div>
              </div>
            </div>
          )}
        </section>

        {/* Rules */}
        <section style={{ marginTop: 42 }}>
          <Eyebrow>How it works</Eyebrow>
          <div style={{ border: `1px solid ${RULE}`, borderRadius: 12, overflow: 'hidden', background: RULE_SOFT, display: 'grid', gap: 2 }}>
            {rules.map((r, i) => (
              <div key={r.lead} style={{ background: CARD, padding: '14px 18px', display: 'grid', gridTemplateColumns: '30px 1fr', gap: 14, alignItems: 'baseline' }}>
                <span className="font-serif" style={{ fontSize: 17, color: GOLD, lineHeight: 1 }}>{i + 1}</span>
                <span style={{ fontSize: 14.5, color: INK_SOFT, lineHeight: 1.5 }}>
                  <b style={{ color: INK, fontWeight: 600 }}>{r.lead}</b>
                  {r.body ? ` ${r.body}` : ''}
                </span>
              </div>
            ))}
          </div>
        </section>

        {/* Example */}
        {example && (
          <section style={{ marginTop: 34 }}>
            <div style={{ borderLeft: `3px solid ${GOLD}`, background: HEAT, borderRadius: '0 10px 10px 0', padding: '18px 22px', fontSize: 15, lineHeight: 1.55, color: INK_SOFT }}>
              <span style={{ fontSize: 11, letterSpacing: '0.14em', textTransform: 'uppercase', color: GOLD_INK, fontWeight: 700, display: 'block', marginBottom: 8 }}>
                For example
              </span>
              {example}
            </div>
          </section>
        )}

        {/* Qualifies */}
        <section style={{ marginTop: 42 }}>
          <Eyebrow>What qualifies</Eyebrow>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
            {card.minSeconds > 0 && (
              <Req k="Length" v={`${card.minSeconds}s +`} d={`At least ${card.minSeconds} seconds of finished reel.`} />
            )}
            <Req k="Platform" v="Instagram" d="Views counted from IG analytics." />
            <Req k="Subject" v="A Rising Tide home" d="Features one of our properties or the brand." />
            <Req k="Footage" v="Fresh each time" d="A carousel can't recycle the reel's clips." />
          </div>
        </section>

        {/* Fine print */}
        <div style={{ marginTop: 38, paddingTop: 16, borderTop: `1px solid ${RULE}`, fontSize: 12, color: INK_FAINT, lineHeight: 1.6 }}>
          <b style={{ color: INK_SOFT, fontWeight: 600 }}>The fine print.</b> {finePrint}
        </div>
      </div>
    </div>
  );
}

const amt: React.CSSProperties = { color: GOLD_INK, fontWeight: 600 };

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
      <h2 className="font-serif" style={{ fontWeight: 400, fontSize: 24, margin: 0, letterSpacing: '-0.01em', flexShrink: 0, color: INK }}>
        {children}
      </h2>
      <span style={{ flex: 1, height: 1, background: RULE }} />
    </div>
  );
}

function Req({ k, v, d }: { k: string; v: string; d: string }) {
  return (
    <div style={{ border: `1px solid ${RULE}`, borderRadius: 10, background: CARD, padding: 15 }}>
      <div style={{ fontSize: 10, letterSpacing: '0.13em', textTransform: 'uppercase', color: SEA, fontWeight: 700 }}>{k}</div>
      <div className="font-serif" style={{ fontSize: 19, color: INK, marginTop: 6 }}>{v}</div>
      <div style={{ fontSize: 12, color: INK_FAINT, marginTop: 4, lineHeight: 1.45 }}>{d}</div>
    </div>
  );
}
