import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { resolveContractorFromCookie } from '@/lib/field-auth';
import { loadEffectiveCard } from '@/lib/creative-rates';
import { FieldShell } from '../FieldShell';

/**
 * The contributor's own rate card in their Field portal - the current pay
 * ladder and terms they work under (their custom card when the office has set
 * one, else the standard card). Creative trade only; everyone else's pay
 * lives on packets.
 */

export const dynamic = 'force-dynamic';
export const metadata: Metadata = {
  title: 'Your rates · Rising Tide Field',
  robots: { index: false, follow: false, googleBot: { index: false, follow: false } },
};

const GOLD = '#b0842a';

export default async function FieldRateCardPage() {
  const contractor = await resolveContractorFromCookie();
  if (!contractor || contractor.trade !== 'creative') redirect('/field');

  const card = await loadEffectiveCard(contractor.id);

  const rows = [
    { label: 'Base', sub: 'per reel', cents: card.baseCents, top: false },
    ...card.tiers.map((t, i) => ({
      label: `${t.views.toLocaleString('en-US')}${i === card.tiers.length - 1 ? '+' : ''}`,
      sub: 'IG views',
      cents: t.cents,
      top: i === card.tiers.length - 1,
    })),
  ];

  const terms: string[] = [];
  if (card.minSeconds > 0) terms.push(`A reel has to run at least ${card.minSeconds} seconds to qualify.`);
  terms.push(`View counts are read from Instagram's analytics and locked ${card.countDays} days after posting. You're paid for the highest mark the reel reaches.`);
  terms.push(`Each shoot pays out on its ${card.maxPerShoot === 1 ? 'strongest reel' : `${card.maxPerShoot} strongest reels`}.`);
  terms.push(...card.extraTerms);

  return (
    <FieldShell contractorName={contractor.full_name}>
      <h1 className="font-serif" style={{ fontSize: 26, fontWeight: 400, margin: '0 0 6px' }}>Your rate card</h1>
      <p style={{ fontSize: 14, color: 'var(--ink-3)', margin: '0 0 22px', lineHeight: 1.55, maxWidth: '54ch' }}>
        Every reel earns the base. As it&rsquo;s watched, the pay steps up to the highest view mark it reaches on
        Instagram. These are your current rates.
      </p>

      <div style={{ border: '1px solid var(--rule)', borderRadius: 12, overflow: 'hidden', background: 'var(--paper-2, #fff)' }}>
        {rows.map((r, i) => (
          <div
            key={r.label}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 14,
              padding: '14px 18px',
              borderTop: i === 0 ? 'none' : '1px solid var(--rule)',
              background: r.top ? 'rgba(176,132,42,0.07)' : 'transparent',
            }}
          >
            <div>
              <span style={{ fontWeight: 600, fontSize: 15 }}>
                {r.label}
                {r.top && <span style={{ color: GOLD, fontSize: 12 }}> ★</span>}
              </span>
              <span style={{ fontSize: 11, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-4)', marginLeft: 8 }}>{r.sub}</span>
            </div>
            <span className="font-serif" style={{ fontSize: r.top ? 24 : 20, color: r.top ? GOLD : 'var(--ink)', fontWeight: r.top ? 600 : 400 }}>
              ${Math.round(r.cents / 100).toLocaleString('en-US')}
            </span>
          </div>
        ))}
      </div>

      {card.carouselCents > 0 && (
        <div style={{ marginTop: 12, border: '1px dashed var(--tide-deep)', borderRadius: 12, padding: '13px 16px', display: 'flex', gap: 14, alignItems: 'center' }}>
          <span className="font-serif" style={{ fontSize: 21, color: 'var(--tide-deep)', flexShrink: 0 }}>
            + ${Math.round(card.carouselCents / 100).toLocaleString('en-US')}
          </span>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600 }}>Carousel</div>
            <div style={{ fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.45 }}>
              Add a carousel from the same shoot. Photos or fresh clips both work, nothing pulled from the reel.
            </div>
          </div>
        </div>
      )}

      <section style={{ marginTop: 26 }}>
        <h2 style={{ fontSize: 11, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--ink-4)', margin: '0 0 10px' }}>
          The terms
        </h2>
        <ul style={{ margin: 0, padding: '0 0 0 18px', display: 'grid', gap: 8 }}>
          {terms.map((t) => (
            <li key={t} style={{ fontSize: 14, color: 'var(--ink-3)', lineHeight: 1.5 }}>{t}</li>
          ))}
        </ul>
      </section>

      <p style={{ fontSize: 12.5, color: 'var(--ink-4)', marginTop: 24, lineHeight: 1.5 }}>
        Reels are approved before posting and paid after the {card.countDays}-day count, monthly. Questions about a
        rate? Text Ryan below.
      </p>
    </FieldShell>
  );
}
