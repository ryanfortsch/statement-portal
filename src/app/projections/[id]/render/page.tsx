import { notFound } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import type { ProjectionRow } from '@/lib/projections-types';
import { latestAirDnaMonth } from '@/lib/projections-airdna';
import {
  computeProjection,
  fmtMoney,
  fmtMoneyRange,
  fmtMonthYear,
  roundToThousand,
  type ProjectionComputed,
} from '@/lib/projections-model';

export const dynamic = 'force-dynamic';

async function getProjection(id: string): Promise<ProjectionRow | null> {
  const { data } = await supabase.from('projections').select('*').eq('id', id).maybeSingle();
  return (data as ProjectionRow | null) ?? null;
}

export default async function ProjectionRenderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const projection = await getProjection(id);
  if (!projection) notFound();
  const c = computeProjection(projection);

  const monthYear = fmtMonthYear(projection.presentation_month);
  const propertyTag = `${projection.property_address}${projection.property_city ? `, ${projection.property_city.split(',')[0].toUpperCase()}` : ''}`.toUpperCase();
  const footerLabel = `${monthYear} | ${propertyTag}`;
  const greetingName = (projection.prospect_first_name || projection.prospect_name.split(/[, ]/)[0]).toUpperCase();

  return (
    <>
      {/* Inline CSS so this page is fully self-contained for print */}
      <style>{deckCss}</style>

      <div className="rt-deck">
        <SlideCover projection={projection} monthYear={monthYear} footer={footerLabel} />
        <SlideHero projection={projection} computed={c} monthYear={monthYear} footer={footerLabel} greetingName={greetingName} />
        <SlideImagePlaceholder projection={projection} footer={footerLabel} />
        <SlidePillars footer={footerLabel} />
        <SlideRatings footer={footerLabel} />
        <SlideYear1 computed={c} footer={footerLabel} />
        <SlideYear2 computed={c} footer={footerLabel} />
        <SlideServices footer={footerLabel} />
        <SlideOwnerControl footer={footerLabel} />
        <SlideClose footer={footerLabel} />
        <SlideEndnotes footer={footerLabel} />
      </div>
    </>
  );
}

// ─── Slides ─────────────────────────────────────────────────────────────────

function SlideCover({
  projection,
  monthYear,
  footer,
}: {
  projection: ProjectionRow;
  monthYear: string;
  footer: string;
}) {
  return (
    <section className="rt-slide rt-slide-cover">
      <div className="rt-cover-grid">
        <div className="rt-cover-left">
          <div className="rt-eyebrow rt-eyebrow-light">{monthYear}</div>
          <h1 className="rt-cover-title">
            {projection.property_address}
            {projection.property_city ? <>, {projection.property_city.split(',')[0]}</> : null}
          </h1>
          <div className="rt-cover-rule" />
          <p className="rt-cover-tag">
            {projection.property_address.split(' ').slice(1).join(' ') || projection.property_address} is an exceptional home.
          </p>
          <p className="rt-cover-body">
            Rising Tide is a boutique manager
            <br />
            specializing in exceptional homes
            <br />
            across Cape Ann.
          </p>
        </div>
        <div className="rt-cover-right">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/rising-tide-logo.png" alt="Rising Tide" className="rt-cover-logo" />
          <div className="rt-cover-wordmark">RISING TIDE</div>
          <div className="rt-cover-sub">SHORT TERM RENTAL MANAGEMENT</div>
        </div>
      </div>
      <Footer label={footer} dark />
    </section>
  );
}

function SlideHero({
  projection,
  computed,
  monthYear,
  footer,
  greetingName,
}: {
  projection: ProjectionRow;
  computed: ProjectionComputed;
  monthYear: string;
  footer: string;
  greetingName: string;
}) {
  const range = fmtMoneyRange(computed.heroLow, computed.heroHigh);
  return (
    <section className="rt-slide">
      <Header label={`${monthYear} | ${projection.property_address.toUpperCase()}${projection.property_city ? `, ${projection.property_city.split(',')[0].toUpperCase()}` : ''}`} />
      <div className="rt-hero-block">
        <div className="rt-hero-number">{range}</div>
        <div className="rt-hero-eyebrow">PROJECTED ANNUAL NET PAYOUTS TO {greetingName}</div>
        <p className="rt-hero-disclaimer">
          Year 1 estimate, net of management fees and cleaning expenses, based on comparable property performance. <sup>(1)</sup>
        </p>
      </div>
      <Footer label={footer} />
    </section>
  );
}

function SlideImagePlaceholder({ projection, footer }: { projection: ProjectionRow; footer: string }) {
  return (
    <section className="rt-slide">
      <Header label={footer} />
      <div className="rt-image-frame">
        <div className="rt-image-placeholder">
          <div className="rt-eyebrow">RENDERING FOR VISUALIZATION PURPOSES</div>
          <div className="rt-image-text">{projection.property_address}</div>
          <div className="rt-image-sub">Drop a property photo into this slide before sending</div>
        </div>
      </div>
      <Footer label={footer} />
    </section>
  );
}

function SlidePillars({ footer }: { footer: string }) {
  return (
    <section className="rt-slide">
      <Header label={footer} />
      <div className="rt-content-pad">
        <h2 className="rt-section-title">A few ways Rising Tide generates higher earnings for your property</h2>
        <div className="rt-pillars">
          <Pillar n="1" title="Be everywhere" body="Maximize visibility across platforms" />
          <Pillar n="2" title="Maintain high rates" body="Focus on revenue and high-quality bookings" />
          <Pillar n="3" title="Deliver exceptional guest service, every time" body="Consistent 5-star hospitality" />
        </div>
      </div>
      <Footer label={footer} />
    </section>
  );
}

function Pillar({ n, title, body }: { n: string; title: string; body: string }) {
  return (
    <div className="rt-pillar">
      <div className="rt-pillar-num">{n}</div>
      <div className="rt-pillar-title">{title}</div>
      <div className="rt-pillar-body">{body}</div>
    </div>
  );
}

function SlideRatings({ footer }: { footer: string }) {
  const data: { label: string; value: number; rt?: boolean }[] = [
    { label: 'RISING TIDE', value: 4.98, rt: true },
    { label: 'National Average', value: 4.8 },
    { label: 'Atlantic Vacation Homes', value: 4.7 },
    { label: 'Vacasa', value: 4.5 },
  ];
  // Bar scale: visualize across [4.0, 5.0] for visual differentiation
  const minScale = 4.0;
  const maxScale = 5.0;
  const pct = (v: number) => Math.max(0, Math.min(100, ((v - minScale) / (maxScale - minScale)) * 100));
  return (
    <section className="rt-slide">
      <Header label={footer} />
      <div className="rt-content-pad">
        <h2 className="rt-section-title">Why we obsess over guest service</h2>
        <div className="rt-eyebrow" style={{ marginTop: 18, marginBottom: 24 }}>AVG. GUEST RATING <sup>(2)</sup></div>
        <div className="rt-rating-bars">
          {data.map((d) => (
            <div key={d.label} className="rt-rating-row">
              <div className={`rt-rating-label${d.rt ? ' rt-rating-label-rt' : ''}`}>{d.label}</div>
              <div className="rt-rating-track">
                <div
                  className={`rt-rating-fill${d.rt ? ' rt-rating-fill-rt' : ''}`}
                  style={{ width: `${pct(d.value)}%` }}
                />
              </div>
              <div className={`rt-rating-value${d.rt ? ' rt-rating-value-rt' : ''}`}>{d.value.toFixed(2)}</div>
            </div>
          ))}
        </div>
      </div>
      <Footer label={footer} />
    </section>
  );
}

function SlideYear1({ computed, footer }: { computed: ProjectionComputed; footer: string }) {
  const monthly = roundToThousand(computed.year1MonthlyAvg);
  // Build a tiny 12-month bar visualization of the seasonal curve
  const max = Math.max(...computed.monthlyYear2.map((m) => m.netPayout));
  return (
    <section className="rt-slide">
      <Header label={footer} />
      <div className="rt-content-pad">
        <h2 className="rt-section-title">Performance &mdash; Year 1</h2>
        <div className="rt-year-stat">
          <div className="rt-eyebrow">PROJECTED MONTHLY PAYOUTS</div>
          <div className="rt-year-number">{fmtMoney(monthly)} <span className="rt-year-unit">/ mo.</span></div>
        </div>

        <div className="rt-month-strip">
          {computed.monthlyYear1.map((m) => {
            const h = max > 0 ? Math.max(2, (m.netPayout / max) * 100) : 0;
            const inactive = m.rampMultiplier === 0;
            return (
              <div key={m.monthIndex} className="rt-month-col">
                <div className="rt-month-bar-wrap">
                  <div
                    className={`rt-month-bar${inactive ? ' rt-month-bar-inactive' : ''}`}
                    style={{ height: `${h}%` }}
                  />
                </div>
                <div className="rt-month-label">{m.monthLabel}</div>
              </div>
            );
          })}
        </div>
      </div>
      <Footer label={footer} />
    </section>
  );
}

function SlideYear2({ computed, footer }: { computed: ProjectionComputed; footer: string }) {
  const y1 = roundToThousand(computed.year1MonthlyAvg);
  const y2 = roundToThousand(computed.year2MonthlyAvg);
  const max = Math.max(y1, y2) * 1.15;
  const pct = (v: number) => (max > 0 ? (v / max) * 100 : 0);
  return (
    <section className="rt-slide">
      <Header label={footer} />
      <div className="rt-content-pad">
        <h2 className="rt-section-title">Performance &mdash; Year 2</h2>
        <div className="rt-y2-grid">
          <div className="rt-y2-left">
            <div className="rt-eyebrow">PROJECTED MONTHLY PAYOUTS</div>
            <p className="rt-y2-body">
              After the first year, revenue typically improves as the property builds a strong review profile across platforms, generates repeat and direct bookings, and benefits from more refined pricing.
            </p>
          </div>
          <div className="rt-y2-right">
            <div className="rt-y2-bars">
              <div className="rt-y2-col">
                <div className="rt-y2-amt">{fmtMoney(y1)}</div>
                <div className="rt-y2-bar" style={{ height: `${pct(y1)}%` }} />
                <div className="rt-y2-cap">YEAR 1</div>
              </div>
              <div className="rt-y2-col">
                <div className="rt-y2-amt rt-y2-amt-rt">{fmtMoney(y2)}</div>
                <div className="rt-y2-bar rt-y2-bar-rt" style={{ height: `${pct(y2)}%` }} />
                <div className="rt-y2-cap">YEAR 2</div>
              </div>
            </div>
          </div>
        </div>
      </div>
      <Footer label={footer} />
    </section>
  );
}

function SlideServices({ footer }: { footer: string }) {
  const cols: { title: string; items: string[] }[] = [
    { title: 'GUESTS', items: ['Guest screening', '24/7 guest services', '5-star experience'] },
    { title: 'PROPERTY', items: ['Turnover management', 'Property maintenance', 'Inventory and supplies'] },
    { title: 'MARKETING', items: ['Airbnb, Vrbo, and more', 'Market-based pricing', 'Direct booking platform'] },
  ];
  return (
    <section className="rt-slide">
      <Header label={footer} />
      <div className="rt-content-pad">
        <h2 className="rt-section-title">Full service property management</h2>
        <div className="rt-services">
          {cols.map((col) => (
            <div key={col.title} className="rt-service-col">
              <div className="rt-eyebrow">{col.title}</div>
              <ul className="rt-service-list">
                {col.items.map((it) => (
                  <li key={it}>{it}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
      <Footer label={footer} />
    </section>
  );
}

function SlideOwnerControl({ footer }: { footer: string }) {
  const items = [
    'Schedule owner stays',
    'Detailed monthly reporting',
    'Track property performance',
    'Visibility into future payouts',
  ];
  return (
    <section className="rt-slide">
      <Header label={footer} />
      <div className="rt-content-pad rt-owner-pad">
        <h2 className="rt-section-title">Owner control &amp; transparency</h2>
        <ul className="rt-checks">
          {items.map((it) => (
            <li key={it} className="rt-check-row">
              <span className="rt-check-mark">✔</span>
              <span>{it}</span>
            </li>
          ))}
        </ul>
      </div>
      <Footer label={footer} />
    </section>
  );
}

function SlideClose({ footer }: { footer: string }) {
  return (
    <section className="rt-slide">
      <Header label={footer} />
      <div className="rt-content-pad">
        <h2 className="rt-section-title">The Rising Tide Difference</h2>
        <p className="rt-close-lead">
          By keeping our portfolio intentionally small, we&rsquo;re able to give each property the attention it requires.
        </p>
        <p className="rt-close-body">
          Thank you for considering Rising Tide for full-service property management. As a North Shore Massachusetts native, I care deeply about how homes are cared for and how this region is experienced by those who visit. We look forward to the possibility of working together and are happy to answer any questions.
        </p>
        <div className="rt-signature">
          <div className="rt-sig-name">ALLIE O&rsquo;BRIEN</div>
          <div className="rt-sig-title">OWNER, RISING TIDE</div>
        </div>
      </div>
      <Footer label={footer} />
    </section>
  );
}

function SlideEndnotes({ footer }: { footer: string }) {
  return (
    <section className="rt-slide">
      <Header label={footer} />
      <div className="rt-content-pad">
        <h2 className="rt-section-title rt-section-title-sm">Endnotes</h2>
        <ol className="rt-endnotes">
          <li>
            <span className="rt-en-num">(1)</span>
            Estimated revenue figures are based on data from AirDNA as well as Rising Tide&rsquo;s professional judgment drawn from managing other vacation rental homes on Cape Ann. These projections account for seasonal trends and platform performance across Airbnb, VRBO, and direct booking channels. Actual results may vary due to property-specific factors, market fluctuations, economic conditions, and unforeseen events.
          </li>
          <li>
            <span className="rt-en-num">(2)</span>
            Source: AirDNA, Airbnb. Average star rating sourced from Airbnb as of {latestAirDnaMonth() || 'January 2026'}.
          </li>
        </ol>
      </div>
      <Footer label={footer} />
    </section>
  );
}

// ─── Shared header / footer ─────────────────────────────────────────────────
function Header({ label }: { label: string }) {
  return <div className="rt-header"><div className="rt-eyebrow">{label}</div></div>;
}

function Footer({ label, dark = false }: { label: string; dark?: boolean }) {
  return (
    <div className={`rt-footer${dark ? ' rt-footer-dark' : ''}`}>
      <div className="rt-eyebrow">{label}</div>
    </div>
  );
}

// ─── CSS ────────────────────────────────────────────────────────────────────
const deckCss = `
  /* 16:9 widescreen slide: 13.333in × 7.5in (1280 × 720 css px @ 96dpi) */
  @page { size: 13.333in 7.5in; margin: 0; }

  html, body { background: var(--ink); margin: 0; padding: 0; }

  .rt-deck {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 24px;
    padding: 24px 0;
    background: #0e1a1f;
  }

  .rt-slide {
    position: relative;
    width: 1280px;
    height: 720px;
    background: var(--paper);
    color: var(--ink);
    font-family: var(--font-inter), system-ui, sans-serif;
    overflow: hidden;
    box-shadow: 0 12px 40px rgba(0,0,0,0.18);
  }

  /* Cover slide has a distinct dark layout */
  .rt-slide-cover {
    background: var(--ink);
    color: var(--paper);
  }

  /* ── Print: each slide on its own page, no shadow, no gap ── */
  @media print {
    html, body { background: var(--paper); }
    .rt-deck { gap: 0; padding: 0; background: var(--paper); display: block; }
    .rt-slide { box-shadow: none; page-break-after: always; break-after: page; }
    .rt-slide:last-child { page-break-after: auto; break-after: auto; }
  }

  /* ── Eyebrow style (overridden on dark cover) ── */
  .rt-eyebrow {
    font-size: 12px;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--ink-4);
    font-weight: 500;
  }
  .rt-eyebrow-light { color: var(--paper-3); }

  /* ── Slide chrome (header / footer) ── */
  .rt-header {
    position: absolute;
    top: 36px;
    left: 64px;
    right: 64px;
  }
  .rt-footer {
    position: absolute;
    bottom: 36px;
    left: 64px;
    right: 64px;
  }
  .rt-footer-dark .rt-eyebrow { color: var(--paper-3); }

  /* ── Cover slide ── */
  .rt-cover-grid {
    height: 100%;
    display: grid;
    grid-template-columns: 1.4fr 1fr;
    gap: 64px;
    padding: 96px 96px 130px;
  }
  .rt-cover-left { display: flex; flex-direction: column; justify-content: center; }
  .rt-cover-right {
    border-left: 1px solid var(--paper-3);
    padding-left: 64px;
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 18px;
  }
  .rt-cover-title {
    font-family: var(--font-fraunces), "Times New Roman", serif;
    font-size: 64px;
    line-height: 1.0;
    font-weight: 300;
    letter-spacing: -0.025em;
    margin: 18px 0 24px;
    color: var(--paper);
  }
  .rt-cover-rule { width: 64px; height: 2px; background: var(--signal); }
  .rt-cover-tag {
    margin-top: 28px;
    font-family: var(--font-fraunces), "Times New Roman", serif;
    font-style: italic;
    font-size: 22px;
    line-height: 1.3;
    color: var(--paper);
    font-weight: 300;
  }
  .rt-cover-body {
    margin-top: 28px;
    font-size: 16px;
    line-height: 1.5;
    color: var(--paper-3);
  }
  .rt-cover-logo { width: 80px; height: 80px; }
  .rt-cover-wordmark {
    font-family: var(--font-fraunces), "Times New Roman", serif;
    font-size: 28px;
    letter-spacing: 0.12em;
    color: var(--paper);
    font-weight: 400;
  }
  .rt-cover-sub {
    font-size: 11px;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--paper-3);
  }

  /* ── Hero (slide 2) ── */
  .rt-hero-block {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 100px;
    text-align: center;
  }
  .rt-hero-number {
    font-family: var(--font-fraunces), "Times New Roman", serif;
    font-size: 116px;
    line-height: 1.0;
    font-weight: 300;
    letter-spacing: -0.04em;
    color: var(--ink);
  }
  .rt-hero-eyebrow {
    margin-top: 28px;
    font-size: 14px;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--signal);
    font-weight: 600;
  }
  .rt-hero-disclaimer {
    margin-top: 28px;
    max-width: 720px;
    font-size: 13px;
    line-height: 1.6;
    color: var(--ink-3);
    font-style: italic;
  }

  /* ── Image placeholder (slide 3) ── */
  .rt-image-frame {
    position: absolute;
    top: 96px;
    left: 96px;
    right: 96px;
    bottom: 96px;
    border: 1px dashed var(--rule);
    background: var(--paper-2);
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .rt-image-placeholder { text-align: center; padding: 0 32px; }
  .rt-image-text {
    margin-top: 14px;
    font-family: var(--font-fraunces), "Times New Roman", serif;
    font-size: 36px;
    color: var(--ink);
    font-weight: 300;
    letter-spacing: -0.02em;
  }
  .rt-image-sub { margin-top: 12px; font-size: 13px; color: var(--ink-4); }

  /* ── Generic content padding for slide bodies ── */
  .rt-content-pad { padding: 96px 96px 130px; height: 100%; box-sizing: border-box; display: flex; flex-direction: column; }
  .rt-section-title {
    font-family: var(--font-fraunces), "Times New Roman", serif;
    font-size: 44px;
    line-height: 1.1;
    font-weight: 300;
    letter-spacing: -0.025em;
    color: var(--ink);
    margin: 0 0 8px;
    max-width: 880px;
  }
  .rt-section-title-sm { font-size: 30px; }

  /* ── Pillars (slide 4) ── */
  .rt-pillars {
    margin-top: 48px;
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 32px;
  }
  .rt-pillar {
    border-top: 2px solid var(--ink);
    padding-top: 24px;
  }
  .rt-pillar-num {
    font-family: var(--font-fraunces), "Times New Roman", serif;
    font-size: 56px;
    color: var(--signal);
    line-height: 1;
    font-weight: 300;
    margin-bottom: 18px;
  }
  .rt-pillar-title {
    font-family: var(--font-fraunces), "Times New Roman", serif;
    font-size: 22px;
    color: var(--ink);
    line-height: 1.2;
    font-weight: 400;
    margin-bottom: 10px;
  }
  .rt-pillar-body { font-size: 14px; line-height: 1.55; color: var(--ink-3); }

  /* ── Ratings (slide 5) ── */
  .rt-rating-bars { display: flex; flex-direction: column; gap: 20px; max-width: 880px; }
  .rt-rating-row {
    display: grid;
    grid-template-columns: 240px 1fr 56px;
    align-items: center;
    gap: 24px;
  }
  .rt-rating-label { font-size: 14px; color: var(--ink-3); }
  .rt-rating-label-rt { color: var(--signal); font-weight: 600; letter-spacing: 0.06em; }
  .rt-rating-track { height: 26px; background: var(--paper-2); border-left: 2px solid var(--ink); position: relative; }
  .rt-rating-fill { height: 100%; background: var(--ink-3); }
  .rt-rating-fill-rt { background: var(--signal); }
  .rt-rating-value { font-family: var(--font-fraunces), "Times New Roman", serif; font-size: 22px; color: var(--ink); text-align: right; }
  .rt-rating-value-rt { color: var(--signal); }

  /* ── Year 1 (slide 6) ── */
  .rt-year-stat { margin-top: 48px; }
  .rt-year-number {
    margin-top: 10px;
    font-family: var(--font-fraunces), "Times New Roman", serif;
    font-size: 96px;
    line-height: 1;
    font-weight: 300;
    color: var(--ink);
    letter-spacing: -0.03em;
  }
  .rt-year-unit { font-size: 32px; color: var(--ink-3); letter-spacing: 0; }

  .rt-month-strip {
    margin-top: auto;
    padding-top: 32px;
    border-top: 1px solid var(--rule);
    display: grid;
    grid-template-columns: repeat(12, 1fr);
    gap: 12px;
    height: 220px;
    align-items: end;
  }
  .rt-month-col { display: flex; flex-direction: column; align-items: center; height: 100%; }
  .rt-month-bar-wrap { width: 100%; height: 88%; display: flex; align-items: flex-end; justify-content: center; }
  .rt-month-bar { width: 100%; background: var(--signal); }
  .rt-month-bar-inactive { background: var(--paper-3); }
  .rt-month-label { margin-top: 10px; font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--ink-4); }

  /* ── Year 2 (slide 7) ── */
  .rt-y2-grid {
    margin-top: 48px;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 64px;
    flex: 1;
  }
  .rt-y2-left { display: flex; flex-direction: column; justify-content: center; }
  .rt-y2-body { margin-top: 18px; font-size: 16px; line-height: 1.6; color: var(--ink-3); max-width: 460px; }
  .rt-y2-right { display: flex; align-items: center; justify-content: center; }
  .rt-y2-bars {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 56px;
    align-items: end;
    width: 100%;
    height: 380px;
    border-bottom: 2px solid var(--ink);
    padding-bottom: 24px;
  }
  .rt-y2-col { display: flex; flex-direction: column; align-items: center; height: 100%; justify-content: flex-end; }
  .rt-y2-amt {
    font-family: var(--font-fraunces), "Times New Roman", serif;
    font-size: 38px;
    color: var(--ink-3);
    margin-bottom: 14px;
    font-weight: 400;
  }
  .rt-y2-amt-rt { color: var(--signal); }
  .rt-y2-bar { width: 100%; background: var(--ink-3); min-height: 8px; }
  .rt-y2-bar-rt { background: var(--signal); }
  .rt-y2-cap { margin-top: 14px; font-size: 11px; letter-spacing: 0.22em; text-transform: uppercase; color: var(--ink-3); font-weight: 500; }

  /* ── Services (slide 8) ── */
  .rt-services {
    margin-top: 48px;
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 48px;
    max-width: 1040px;
  }
  .rt-service-col { border-top: 2px solid var(--ink); padding-top: 18px; }
  .rt-service-list { margin: 18px 0 0; padding: 0; list-style: none; }
  .rt-service-list li {
    padding: 10px 0;
    border-bottom: 1px solid var(--rule);
    font-size: 15px;
    color: var(--ink);
  }
  .rt-service-list li:last-child { border-bottom: 0; }

  /* ── Owner control (slide 9) ── */
  .rt-owner-pad { justify-content: center; padding-top: 0; padding-bottom: 0; }
  .rt-checks {
    margin: 36px 0 0;
    padding: 0;
    list-style: none;
    max-width: 720px;
  }
  .rt-check-row {
    display: flex;
    align-items: center;
    gap: 18px;
    padding: 18px 0;
    border-bottom: 1px solid var(--rule);
    font-family: var(--font-fraunces), "Times New Roman", serif;
    font-size: 24px;
    color: var(--ink);
    font-weight: 400;
  }
  .rt-check-mark { color: var(--signal); font-size: 22px; line-height: 1; }

  /* ── Closing (slide 10) ── */
  .rt-close-lead {
    margin-top: 28px;
    font-family: var(--font-fraunces), "Times New Roman", serif;
    font-size: 26px;
    line-height: 1.35;
    color: var(--ink);
    font-weight: 300;
    max-width: 880px;
  }
  .rt-close-body { margin-top: 22px; font-size: 15px; line-height: 1.65; color: var(--ink-3); max-width: 760px; }
  .rt-signature { margin-top: 36px; text-align: right; }
  .rt-sig-name {
    font-size: 14px;
    letter-spacing: 0.22em;
    color: var(--signal);
    font-weight: 600;
    text-transform: uppercase;
  }
  .rt-sig-title { margin-top: 4px; font-size: 11px; letter-spacing: 0.18em; color: var(--ink-3); text-transform: uppercase; }

  /* ── Endnotes (slide 11) ── */
  .rt-endnotes { margin-top: 24px; padding: 0; list-style: none; max-width: 960px; }
  .rt-endnotes li { padding: 14px 0; border-top: 1px solid var(--rule); font-size: 13px; line-height: 1.65; color: var(--ink-3); }
  .rt-endnotes li:last-child { border-bottom: 1px solid var(--rule); }
  .rt-en-num {
    display: inline-block;
    width: 36px;
    color: var(--signal);
    font-weight: 600;
    font-family: var(--font-fraunces), "Times New Roman", serif;
  }
`;
