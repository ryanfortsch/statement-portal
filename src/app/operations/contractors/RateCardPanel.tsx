import { CopyCode } from '@/app/field/CopyCode';
import { SubmitButton } from '@/components/SubmitButton';
import { dollars, type ContractorRow } from '@/lib/field-types';
import type { RateCard } from '@/lib/creative-rates';
import { saveRateCardAction, resetRateCardAction } from './rate-card-actions';

/**
 * Creative rate card surfaces on the roster page: the standard card panel
 * (replaces the old hardcoded rates row) and the per-talent strip on each
 * contributor's card. Both edit through the same form; a talent's saved card
 * is a full copy, so "Reset to standard" just deletes it.
 */

/** "1k" / "2.5k" / "500" - compact view-count label for inline summaries. */
function kLabel(views: number): string {
  if (views < 1000) return String(views);
  const k = views / 1000;
  return `${Number.isInteger(k) ? k : k.toFixed(1)}k`;
}

/** One-line pay summary: "$125 base · $250 at 1k · $500 at 5k+ · +$100 carousel". */
function summaryParts(card: RateCard): string[] {
  const parts = [`${dollars(card.baseCents)} base`];
  card.tiers.forEach((t, i) => {
    parts.push(`${dollars(t.cents)} at ${kLabel(t.views)}${i === card.tiers.length - 1 ? '+' : ''}`);
  });
  if (card.carouselCents > 0) parts.push(`+${dollars(card.carouselCents)} carousel`);
  return parts;
}

function termsLine(card: RateCard): string {
  const bits = [
    `${card.minSeconds}s minimum`,
    `views locked at ${card.countDays} days`,
    `up to ${card.maxPerShoot} reel${card.maxPerShoot === 1 ? '' : 's'} per shoot`,
  ];
  return bits.join(' · ');
}

/** The standard-card panel at the top of the Creative roster. */
export function RateCardPanel({ card, base }: { card: RateCard; base: string }) {
  return (
    <div id="rate-card" style={{ border: '1px solid var(--rule)', borderRadius: 12, background: 'var(--paper-2, #fff)', padding: '16px 18px', marginBottom: 22 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: 10, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--tide-deep)', fontWeight: 600 }}>
            Reel rate card · standard
          </div>
          <div className="font-serif" style={{ fontSize: 18, marginTop: 4 }}>Social Media Contributor</div>
        </div>
        <a
          href="/operations/contractors/rate-card"
          target="_blank"
          rel="noopener noreferrer"
          style={{ fontSize: 13, color: 'var(--tide-deep)', textDecoration: 'none', fontWeight: 600 }}
        >
          Print card ↗
        </a>
      </div>
      <p style={{ fontSize: 13, color: 'var(--ink-3)', lineHeight: 1.55, marginTop: 6, marginBottom: 12, maxWidth: 560 }}>
        A content role, not a route. They shoot and edit at our homes and deliver ready-to-post assets for Stay Cape
        Ann and Rising Tide. No packets: you approve delivered assets and pay monthly against this card. Every reel
        earns the base; pay steps up to the highest Instagram view mark it reaches. Customize one talent&rsquo;s rates
        from their card below.
      </p>

      {/* The ladder, as chips */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
        <RateChip label="Base / reel" value={dollars(card.baseCents)} />
        {card.tiers.map((t, i) => (
          <RateChip
            key={t.views}
            label={`${t.views.toLocaleString('en-US')}${i === card.tiers.length - 1 ? '+' : ''} IG views`}
            value={dollars(t.cents)}
            highlight={i === card.tiers.length - 1}
          />
        ))}
        {card.carouselCents > 0 && <RateChip label="Carousel add-on" value={`+${dollars(card.carouselCents)}`} />}
      </div>
      <div style={{ fontSize: 12, color: 'var(--ink-4)', marginBottom: 12 }}>
        {termsLine(card)}
        {card.extraTerms.map((t) => (
          <div key={t}>{t}</div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 13 }}>
        <span style={{ color: 'var(--ink-4)' }}>Public application</span>
        <CopyCode value={`${base}/field/apply?trade=creative`} mono={false} />
        <span style={{ color: 'var(--rule)' }}>·</span>
        <a
          href="/operations/contractors/hiring-package"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: 'var(--tide-deep)', textDecoration: 'none', fontWeight: 600 }}
        >
          Full hiring package ↗
        </a>
      </div>

      <details style={{ marginTop: 12 }}>
        <summary style={summaryBtn}>Edit standard card</summary>
        <RateCardForm card={card} contractorId={null} />
      </details>
    </div>
  );
}

/** Per-talent strip inside a creative contributor's roster card. */
export function TalentRateStrip({ c, card, isCustom }: { c: ContractorRow; card: RateCard; isCustom: boolean }) {
  const firstName = c.full_name.split(' ')[0] || c.full_name;
  return (
    <div id={`rc-${c.id}`} style={{ marginTop: 13, paddingTop: 12, borderTop: '1px solid var(--rule)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-4)' }}>Rate card</span>
        <span
          style={{
            fontSize: 10,
            fontWeight: 600,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: isCustom ? 'var(--signal)' : 'var(--ink-4)',
            border: `1px solid ${isCustom ? 'var(--signal)' : 'var(--rule)'}`,
            borderRadius: 999,
            padding: '1px 8px',
          }}
        >
          {isCustom ? 'Custom' : 'Standard'}
        </span>
        <span style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>{summaryParts(card).join(' · ')}</span>
        <a
          href={`/operations/contractors/rate-card?contractor=${c.id}`}
          target="_blank"
          rel="noopener noreferrer"
          style={{ fontSize: 12, color: 'var(--tide-deep)', textDecoration: 'none', fontWeight: 600, marginLeft: 'auto' }}
        >
          Print for {firstName} ↗
        </a>
      </div>
      <details style={{ marginTop: 8 }}>
        <summary style={summaryBtn}>{isCustom ? `Edit ${firstName}'s card` : `Customize for ${firstName}`}</summary>
        <RateCardForm card={card} contractorId={c.id} />
        {isCustom && (
          <form action={resetRateCardAction} style={{ margin: '10px 0 0' }}>
            <input type="hidden" name="contractor_id" value={c.id} />
            <SubmitButton label="Reset to standard card" busyLabel="Resetting…" style={resetBtn} spinnerTone="ink" />
          </form>
        )}
      </details>
    </div>
  );
}

function RateChip({ label, value, highlight = false }: { label: string; value: string; highlight?: boolean }) {
  return (
    <span
      style={{
        fontSize: 12,
        color: 'var(--ink-3)',
        border: `1px solid ${highlight ? 'var(--signal)' : 'var(--rule)'}`,
        borderRadius: 999,
        padding: '3px 10px',
        background: highlight ? 'rgba(200,90,58,0.05)' : 'transparent',
      }}
    >
      {label} <strong style={{ color: 'var(--ink)' }}>{value}</strong>
    </span>
  );
}

/** The shared editor. Eight rung rows (Dotti's real ladder already uses six);
 *  blank rows are dropped on save, so removing a rung = clearing its inputs,
 *  adding one = filling a blank row. */
function RateCardForm({ card, contractorId }: { card: RateCard; contractorId: string | null }) {
  const rows = [0, 1, 2, 3, 4, 5, 6, 7];
  return (
    <form action={saveRateCardAction} style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 14, maxWidth: 560 }}>
      {contractorId && <input type="hidden" name="contractor_id" value={contractorId} />}

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <label style={lbl}>
          Base per reel ($)
          <input name="base" type="number" step="any" min={0} defaultValue={card.baseCents / 100} required style={{ ...inp, width: 110 }} />
        </label>
        <label style={lbl}>
          Carousel add-on ($, 0 = none)
          <input name="carousel" type="number" step="any" min={0} defaultValue={card.carouselCents / 100} style={{ ...inp, width: 110 }} />
        </label>
      </div>

      <div>
        <div style={{ fontSize: 11, color: 'var(--ink-4)', marginBottom: 6 }}>
          View rungs - pay steps up to the highest mark reached. Blank rows are dropped.
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '130px 110px', gap: '6px 10px', alignItems: 'center' }}>
          <span style={hdr}>IG views reached</span>
          <span style={hdr}>Pays ($)</span>
          {rows.map((i) => {
            const t = card.tiers[i];
            return (
              <RungRow key={i} i={i} views={t?.views} pay={t ? t.cents / 100 : undefined} />
            );
          })}
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <label style={lbl}>
          Minimum length (seconds)
          <input name="min_seconds" type="number" min={0} max={600} defaultValue={card.minSeconds} style={{ ...inp, width: 110 }} />
        </label>
        <label style={lbl}>
          Views counted at (days)
          <input name="count_days" type="number" min={1} max={90} defaultValue={card.countDays} style={{ ...inp, width: 110 }} />
        </label>
        <label style={lbl}>
          Max reels per shoot
          <input name="max_per_shoot" type="number" min={1} max={10} defaultValue={card.maxPerShoot} style={{ ...inp, width: 110 }} />
        </label>
      </div>

      <label style={{ ...lbl, maxWidth: 560 }}>
        Extra terms (one per line, shown in the card&rsquo;s fine print)
        <textarea name="extra_terms" rows={3} defaultValue={card.extraTerms.join('\n')} style={{ ...inp, width: '100%', minWidth: 0, resize: 'vertical', fontFamily: 'inherit' }} />
      </label>

      <div>
        <SubmitButton label={contractorId ? 'Save custom card' : 'Save standard card'} busyLabel="Saving…" style={saveBtn} />
      </div>
    </form>
  );
}

function RungRow({ i, views, pay }: { i: number; views?: number; pay?: number }) {
  return (
    <>
      <input name={`tier_views_${i}`} type="number" min={1} step="any" defaultValue={views} placeholder={views ? undefined : 'views'} style={inp} />
      <input name={`tier_pay_${i}`} type="number" min={0} step="any" defaultValue={pay} placeholder={pay != null ? undefined : '$'} style={inp} />
    </>
  );
}

const lbl: React.CSSProperties = { fontSize: 11, color: 'var(--ink-4)', display: 'flex', flexDirection: 'column', gap: 4 };
const hdr: React.CSSProperties = { fontSize: 10, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-4)' };
const inp: React.CSSProperties = {
  font: 'inherit',
  fontSize: 14,
  color: 'var(--ink)',
  background: 'var(--paper)',
  border: '1px solid var(--rule)',
  padding: '7px 9px',
  borderRadius: 6,
  minWidth: 0,
};
const summaryBtn: React.CSSProperties = {
  cursor: 'pointer',
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--tide-deep)',
  userSelect: 'none',
};
const saveBtn: React.CSSProperties = {
  background: 'var(--ink)',
  color: 'var(--paper)',
  border: 'none',
  cursor: 'pointer',
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '0.12em',
  textTransform: 'uppercase',
  padding: '9px 16px',
  borderRadius: 6,
};
const resetBtn: React.CSSProperties = {
  background: 'var(--paper)',
  border: '1px solid var(--rule)',
  borderRadius: 999,
  cursor: 'pointer',
  color: 'var(--signal)',
  fontSize: 11,
  fontWeight: 500,
  padding: '4px 12px',
};
