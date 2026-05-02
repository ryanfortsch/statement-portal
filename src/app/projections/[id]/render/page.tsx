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
            {projection.property_address} is an exceptional home.
          </p>
          <p className="rt-cover-body">
            We are vacation rental management
            <br />
            for exceptional homes
            <br />
            across Cape Ann.
          </p>
        </div>
        <div className="rt-cover-right">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/rising-tide-logo.png" alt="Rising Tide" className="rt-cover-logo" />
          <div className="rt-cover-wordmark">RISING TIDE</div>
          <div className="rt-cover-sub">VACATION RENTAL MANAGEMENT</div>
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
  // Rising Tide: 2-decimal precision (4.99). Competitors: 1-decimal (industry-standard reporting).
  const competitors: { label: string; display: string }[] = [
    { label: 'National Average', display: '4.8' },
    { label: 'Atlantic Vacation Homes', display: '4.7' },
    { label: 'Vacasa', display: '4.5' },
  ];
  return (
    <section className="rt-slide">
      <Header label={footer} />
      <div className="rt-content-pad">
        <h2 className="rt-section-title">Why we obsess over guest service</h2>
        <div className="rt-rating-grid">
          {/* HERO: +18% Revenue lift, the through-line for the slide */}
          <div className="rt-rating-hero">
            <div className="rt-rating-hero-line">
              <span className="rt-rating-hero-pct">+18%</span>
              <span className="rt-rating-hero-word">Revenue</span>
            </div>
            <p className="rt-rating-hero-body">
              Airbnb listings with a 4.9+ star rating earn <strong>18% more revenue</strong> on average.<sup>(3)</sup>
            </p>
            <div className="rt-rating-hero-rule" />
            <p className="rt-rating-hero-tag">
              Five-star service is what we obsess over. It is also what compounds, year after year, into stronger bookings and higher rates.
            </p>
          </div>

          {/* Right-hand comparison card */}
          <div className="rt-rating-card">
            <div className="rt-eyebrow rt-rating-card-eyebrow">AVG. GUEST RATING <sup>(2)</sup></div>
            <div className="rt-rating-rt-block">
              <div className="rt-rating-rt-label">RISING TIDE</div>
              <div className="rt-rating-rt-value">4.99</div>
              <div className="rt-rating-rt-stars" aria-hidden="true">★★★★★</div>
            </div>
            <div className="rt-rating-comp-list">
              {competitors.map((c) => (
                <div key={c.label} className="rt-rating-comp-row">
                  <span className="rt-rating-comp-label">{c.label}</span>
                  <span className="rt-rating-comp-value">{c.display}<span className="rt-rating-comp-star">★</span></span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
      <Footer label={footer} />
    </section>
  );
}

function SlideYear1({ computed, footer }: { computed: ProjectionComputed; footer: string }) {
  const monthly = roundToThousand(computed.year1MonthlyAvg);
  // Scale the bars off the property's own peak month so the curve is readable
  // even for properties whose Year 2 amounts blow out the y-axis.
  const max = Math.max(...computed.monthlyYear1.map((m) => m.netPayout));
  // Format each month's payout as a compact dollar (e.g. "$8.3k" / "$0").
  const fmtCompact = (n: number) => {
    if (n < 100) return '$0';
    if (n < 1000) return `$${Math.round(n / 100) * 100 / 1000}k`;
    return `$${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  };
  return (
    <section className="rt-slide">
      <Header label={footer} />
      <div className="rt-content-pad">
        <h2 className="rt-section-title">Performance &mdash; Year 1</h2>
        <div className="rt-year-stat">
          <div className="rt-eyebrow">PROJECTED AVERAGE MONTHLY PAYOUT</div>
          <div className="rt-year-number">{fmtMoney(monthly)} <span className="rt-year-unit">/ mo.</span></div>
        </div>

        <div className="rt-month-strip">
          {computed.monthlyYear1.map((m) => {
            const h = max > 0 ? Math.max(2, (m.netPayout / max) * 100) : 0;
            const inactive = m.rampMultiplier === 0;
            return (
              <div key={m.monthIndex} className="rt-month-col">
                <div
                  className={`rt-month-amt${inactive ? ' rt-month-amt-inactive' : ''}`}
                >
                  {inactive ? '—' : fmtCompact(m.netPayout)}
                </div>
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
  const growthPct = computed.year1MonthlyAvg > 0
    ? Math.round(((computed.year2MonthlyAvg - computed.year1MonthlyAvg) / computed.year1MonthlyAvg) * 100)
    : 0;
  return (
    <section className="rt-slide">
      <Header label={footer} />
      <div className="rt-content-pad">
        <h2 className="rt-section-title">Performance &mdash; Year 2</h2>
        <p className="rt-y2-lead">
          After the first year, revenue typically improves as the property builds a strong review profile across platforms, generates repeat and direct bookings, and benefits from more refined pricing.
        </p>

        <div className="rt-y2-compare">
          <div className="rt-y2-side">
            <div className="rt-y2-cap">YEAR 1</div>
            <div className="rt-y2-amt">{fmtMoney(y1)}</div>
            <div className="rt-y2-sub">/ mo.</div>
          </div>

          <div className="rt-y2-arrow-wrap" aria-hidden="true">
            <div className="rt-y2-arrow-line" />
            <div className="rt-y2-arrow-pill">+{growthPct}%</div>
            <div className="rt-y2-arrow-head" />
          </div>

          <div className="rt-y2-side rt-y2-side-rt">
            <div className="rt-y2-cap rt-y2-cap-rt">YEAR 2</div>
            <div className="rt-y2-amt rt-y2-amt-rt">{fmtMoney(y2)}</div>
            <div className="rt-y2-sub">/ mo.</div>
          </div>
        </div>
      </div>
      <Footer label={footer} />
    </section>
  );
}

function SlideServices({ footer }: { footer: string }) {
  const cols: { num: string; eyebrow: string; lead: string; items: string[] }[] = [
    {
      num: '01',
      eyebrow: 'Guests',
      lead: 'Every traveler vetted, welcomed, and supported around the clock.',
      items: ['Guest screening and verification', '24/7 messaging and on-call support', 'Curated welcome and arrival experience', 'Five-star hospitality, every stay'],
    },
    {
      num: '02',
      eyebrow: 'Property',
      lead: 'The home stays in the condition your guests expect, and you do too.',
      items: ['Professional turnover and laundry', 'Routine inspections and maintenance', 'Inventory, supplies, and consumables', 'Vendor coordination on your behalf'],
    },
    {
      num: '03',
      eyebrow: 'Marketing',
      lead: 'Listed where guests look, priced where the market lands.',
      items: ['Airbnb, Vrbo, and direct channels', 'Dynamic, market-based pricing', 'Professional photography and copy', 'Direct-booking platform and SEO'],
    },
  ];
  return (
    <section className="rt-slide">
      <Header label={footer} />
      <div className="rt-content-pad">
        <h2 className="rt-section-title">Full service property management</h2>
        <p className="rt-services-lead">
          Three pillars of service for every property we manage. All included. No &agrave; la carte fees.
        </p>
        <div className="rt-services">
          {cols.map((col) => (
            <div key={col.eyebrow} className="rt-service-col">
              <div className="rt-service-num">{col.num}</div>
              <div className="rt-service-eyebrow">{col.eyebrow}</div>
              <p className="rt-service-lead">{col.lead}</p>
              <ul className="rt-service-list">
                {col.items.map((it) => (
                  <li key={it}>
                    <span className="rt-service-mark" aria-hidden="true">✓</span>
                    <span>{it}</span>
                  </li>
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
      <div className="rt-content-pad rt-owner-grid">
        <div className="rt-owner-left">
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
        <div className="rt-owner-right">
          <div className="rt-eyebrow rt-stmt-eyebrow">Your monthly statement</div>
          <StatementPreview />
        </div>
      </div>
      <Footer label={footer} />
    </section>
  );
}

/** Stylized mini statement that mirrors the editorial language of /statements/render — no real data, just enough visual cues for a prospect to picture what they'll receive each month. */
function StatementPreview() {
  return (
    <div className="rt-stmt-card">
      <div className="rt-stmt-mast">
        <div className="rt-stmt-mast-left">
          <div className="rt-stmt-brand">RISING TIDE</div>
          <div className="rt-stmt-period">OWNER STATEMENT &middot; APRIL 2026</div>
        </div>
        <div className="rt-stmt-mast-right">YOUR PROPERTY</div>
      </div>
      <div className="rt-stmt-hero">
        <div className="rt-stmt-eyebrow-sm">NET PAYOUT</div>
        <div className="rt-stmt-amount">$8,247</div>
      </div>
      <div className="rt-stmt-grid">
        <div>
          <div className="rt-stmt-eyebrow-sm">RESERVATIONS</div>
          <div className="rt-stmt-rows">
            {[
              ['Apr 4 – Apr 7', '$1,420'],
              ['Apr 11 – Apr 14', '$1,680'],
              ['Apr 18 – Apr 24', '$2,940'],
              ['Apr 26 – Apr 30', '$1,820'],
            ].map(([d, v]) => (
              <div key={d} className="rt-stmt-row">
                <span>{d}</span>
                <span>{v}</span>
              </div>
            ))}
          </div>
        </div>
        <div>
          <div className="rt-stmt-eyebrow-sm">FINANCIALS</div>
          <div className="rt-stmt-rows">
            <div className="rt-stmt-row"><span>Rental Revenue</span><span>$11,860</span></div>
            <div className="rt-stmt-row"><span>Mgmt Fee (25%)</span><span>$2,965</span></div>
            <div className="rt-stmt-row"><span>Cleaning</span><span>$648</span></div>
            <div className="rt-stmt-row rt-stmt-row-total"><span>Owner Payout</span><span>$8,247</span></div>
          </div>
        </div>
      </div>
      <div className="rt-stmt-foot">SAMPLE &middot; FOR ILLUSTRATION</div>
    </div>
  );
}

function SlideClose({ footer }: { footer: string }) {
  return (
    <section className="rt-slide">
      <Header label={footer} />
      <div className="rt-content-pad">
        <h2 className="rt-section-title">The Rising Tide Difference</h2>
        <div className="rt-close-grid">
          <div className="rt-close-text">
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
          <div className="rt-close-portrait">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/allie-obrien.jpg" alt="Allie O'Brien, Owner of Rising Tide" />
            <div className="rt-close-portrait-rule" />
            <div className="rt-close-portrait-caption">A North Shore native.</div>
          </div>
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
          <li>
            <span className="rt-en-num">(3)</span>
            Source: CoStar. Airbnb listings with a 4.9+ star rating earn 18% more revenue on average than lower-rated comparable listings.
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

  /* ── Ratings (slide 5) — +18% revenue hero on the left, comparison card on the right ── */
  .rt-rating-grid {
    margin-top: 32px;
    flex: 1;
    display: grid;
    grid-template-columns: 1.5fr 1fr;
    gap: 56px;
    align-items: center;
  }
  .rt-rating-hero { display: flex; flex-direction: column; }
  .rt-rating-hero-line {
    display: flex;
    align-items: baseline;
    gap: 18px;
    line-height: 1;
  }
  .rt-rating-hero-pct {
    font-family: var(--font-fraunces), "Times New Roman", serif;
    font-size: 124px;
    font-weight: 300;
    color: var(--signal);
    letter-spacing: -0.04em;
  }
  .rt-rating-hero-word {
    font-family: var(--font-fraunces), "Times New Roman", serif;
    font-size: 80px;
    font-weight: 300;
    color: var(--ink);
    letter-spacing: -0.025em;
  }
  .rt-rating-hero-body {
    margin: 24px 0 0;
    font-size: 18px;
    line-height: 1.5;
    color: var(--ink);
    max-width: 540px;
    font-weight: 400;
  }
  .rt-rating-hero-body strong { color: var(--signal); font-weight: 600; }
  .rt-rating-hero-rule { width: 56px; height: 2px; background: var(--ink); margin: 24px 0; }
  .rt-rating-hero-tag {
    margin: 0;
    font-family: var(--font-fraunces), "Times New Roman", serif;
    font-style: italic;
    font-size: 16px;
    line-height: 1.55;
    color: var(--ink-3);
    max-width: 480px;
    font-weight: 400;
  }

  /* Right card */
  .rt-rating-card {
    background: var(--paper-2);
    border: 1px solid var(--rule);
    padding: 28px 24px;
    display: flex;
    flex-direction: column;
    gap: 18px;
  }
  .rt-rating-card-eyebrow { color: var(--ink-3); }
  .rt-rating-rt-block {
    background: var(--ink);
    color: var(--paper);
    padding: 18px 18px 16px;
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
  }
  .rt-rating-rt-label {
    font-family: var(--font-fraunces), "Times New Roman", serif;
    font-size: 13px;
    letter-spacing: 0.18em;
    color: var(--paper-3);
    font-weight: 500;
    margin-bottom: 4px;
  }
  .rt-rating-rt-value {
    font-family: var(--font-fraunces), "Times New Roman", serif;
    font-size: 56px;
    line-height: 1;
    color: var(--paper);
    font-weight: 400;
    letter-spacing: -0.02em;
  }
  .rt-rating-rt-stars { margin-top: 6px; color: var(--signal); font-size: 16px; letter-spacing: 0.18em; }
  .rt-rating-comp-list { display: flex; flex-direction: column; }
  .rt-rating-comp-row {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    padding: 12px 0;
    border-bottom: 1px solid var(--rule);
    font-size: 14px;
    color: var(--ink);
  }
  .rt-rating-comp-row:last-child { border-bottom: 0; }
  .rt-rating-comp-label { color: var(--ink-3); }
  .rt-rating-comp-value {
    font-family: var(--font-fraunces), "Times New Roman", serif;
    font-size: 22px;
    color: var(--ink);
    font-weight: 400;
  }
  .rt-rating-comp-star { color: var(--ink-4); margin-left: 6px; font-size: 14px; }

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
    padding-top: 28px;
    border-top: 1px solid var(--rule);
    display: grid;
    grid-template-columns: repeat(12, 1fr);
    gap: 10px;
    height: 280px;
    align-items: end;
  }
  .rt-month-col {
    display: grid;
    grid-template-rows: auto 1fr auto;
    align-items: end;
    justify-items: center;
    height: 100%;
    gap: 6px;
  }
  .rt-month-amt {
    font-family: var(--font-fraunces), "Times New Roman", serif;
    font-size: 13px;
    color: var(--ink);
    font-weight: 400;
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.02em;
    line-height: 1;
  }
  .rt-month-amt-inactive { color: var(--ink-4); font-weight: 300; }
  .rt-month-bar-wrap { width: 100%; height: 100%; display: flex; align-items: flex-end; justify-content: center; }
  .rt-month-bar { width: 100%; background: var(--signal); min-height: 1px; }
  .rt-month-bar-inactive { background: var(--paper-3); min-height: 2px; }
  .rt-month-label { margin-top: 4px; font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--ink-4); }

  /* ── Year 2 (slide 7) — clean before/after with growth pill ── */
  .rt-y2-lead {
    margin: 18px 0 0;
    font-size: 16px;
    line-height: 1.6;
    color: var(--ink-3);
    max-width: 880px;
  }
  .rt-y2-compare {
    margin-top: 56px;
    flex: 1;
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    gap: 32px;
    align-items: center;
    padding: 24px 0 56px;
  }
  .rt-y2-side { text-align: center; display: flex; flex-direction: column; align-items: center; }
  .rt-y2-cap {
    font-size: 11px;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--ink-3);
    font-weight: 500;
    margin-bottom: 18px;
  }
  .rt-y2-cap-rt { color: var(--signal); }
  .rt-y2-amt {
    font-family: var(--font-fraunces), "Times New Roman", serif;
    font-size: 88px;
    line-height: 1;
    color: var(--ink-3);
    font-weight: 300;
    letter-spacing: -0.03em;
  }
  .rt-y2-amt-rt { color: var(--signal); font-size: 116px; }
  .rt-y2-sub {
    margin-top: 12px;
    font-family: var(--font-fraunces), "Times New Roman", serif;
    font-style: italic;
    font-size: 18px;
    color: var(--ink-3);
  }

  /* Arrow + pill between the two amounts */
  .rt-y2-arrow-wrap {
    position: relative;
    width: 220px;
    height: 60px;
    display: flex;
    align-items: center;
  }
  .rt-y2-arrow-line {
    position: absolute;
    top: 50%;
    left: 0;
    right: 14px;
    height: 2px;
    background: var(--signal);
    transform: translateY(-50%);
  }
  .rt-y2-arrow-head {
    position: absolute;
    top: 50%;
    right: 0;
    width: 0;
    height: 0;
    border-left: 14px solid var(--signal);
    border-top: 9px solid transparent;
    border-bottom: 9px solid transparent;
    transform: translateY(-50%);
  }
  .rt-y2-arrow-pill {
    position: absolute;
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    background: var(--signal);
    color: var(--paper);
    font-family: var(--font-fraunces), "Times New Roman", serif;
    font-size: 26px;
    font-weight: 400;
    padding: 8px 22px;
    border-radius: 999px;
    letter-spacing: -0.01em;
    line-height: 1;
    box-shadow: 0 4px 14px rgba(200, 90, 58, 0.22);
  }

  /* ── Services (slide 8) ── */
  .rt-services-lead {
    margin: 14px 0 0;
    font-size: 15px;
    line-height: 1.55;
    color: var(--ink-3);
    max-width: 720px;
    font-style: italic;
  }
  .rt-services {
    margin-top: 36px;
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 36px;
    max-width: 1100px;
  }
  .rt-service-col {
    border-top: 2px solid var(--ink);
    padding-top: 18px;
    display: flex;
    flex-direction: column;
  }
  .rt-service-num {
    font-family: var(--font-fraunces), "Times New Roman", serif;
    font-size: 36px;
    color: var(--signal);
    font-weight: 300;
    line-height: 1;
    margin-bottom: 10px;
  }
  .rt-service-eyebrow {
    font-family: var(--font-fraunces), "Times New Roman", serif;
    font-size: 22px;
    color: var(--ink);
    line-height: 1.2;
    font-weight: 400;
    margin-bottom: 8px;
  }
  .rt-service-lead {
    font-size: 13px;
    line-height: 1.5;
    color: var(--ink-3);
    margin: 0 0 16px;
    min-height: 60px;
  }
  .rt-service-list { margin: 0; padding: 0; list-style: none; }
  .rt-service-list li {
    display: flex;
    gap: 10px;
    align-items: flex-start;
    padding: 9px 0;
    border-bottom: 1px solid var(--rule);
    font-size: 13px;
    color: var(--ink);
    line-height: 1.4;
  }
  .rt-service-list li:last-child { border-bottom: 0; }
  .rt-service-mark { color: var(--signal); font-size: 12px; flex-shrink: 0; padding-top: 2px; }

  /* ── Owner control (slide 9) ── */
  .rt-owner-grid {
    display: grid !important;
    grid-template-columns: 1fr 1fr;
    gap: 56px;
    align-items: start;
  }
  .rt-owner-left { display: flex; flex-direction: column; }
  .rt-owner-right { display: flex; flex-direction: column; gap: 14px; }
  .rt-stmt-eyebrow { color: var(--ink-4); }
  .rt-checks {
    margin: 28px 0 0;
    padding: 0;
    list-style: none;
  }
  .rt-check-row {
    display: flex;
    align-items: center;
    gap: 18px;
    padding: 14px 0;
    border-bottom: 1px solid var(--rule);
    font-family: var(--font-fraunces), "Times New Roman", serif;
    font-size: 22px;
    color: var(--ink);
    font-weight: 400;
  }
  .rt-check-mark { color: var(--signal); font-size: 20px; line-height: 1; }

  /* ── Mini statement preview (right column of owner control slide) ── */
  .rt-stmt-card {
    background: var(--paper);
    border: 1px solid var(--ink);
    box-shadow: 0 4px 18px rgba(30, 46, 52, 0.08);
    padding: 18px 20px 14px;
    aspect-ratio: 8.5 / 11;
    max-height: 460px;
    display: flex;
    flex-direction: column;
    gap: 10px;
    font-family: var(--font-inter), system-ui, sans-serif;
  }
  .rt-stmt-mast {
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    border-bottom: 1px solid var(--ink);
    padding-bottom: 8px;
  }
  .rt-stmt-brand {
    font-family: var(--font-fraunces), "Times New Roman", serif;
    font-size: 13px;
    letter-spacing: 0.16em;
    color: var(--ink);
    font-weight: 500;
  }
  .rt-stmt-period { font-size: 7px; letter-spacing: 0.18em; color: var(--ink-4); margin-top: 2px; font-weight: 500; }
  .rt-stmt-mast-right { font-size: 7px; letter-spacing: 0.18em; color: var(--ink-4); font-weight: 500; }
  .rt-stmt-hero { padding: 6px 0; border-bottom: 1px solid var(--rule); }
  .rt-stmt-eyebrow-sm { font-size: 7px; letter-spacing: 0.2em; color: var(--ink-4); text-transform: uppercase; font-weight: 500; margin-bottom: 4px; }
  .rt-stmt-amount {
    font-family: var(--font-fraunces), "Times New Roman", serif;
    font-size: 28px;
    color: var(--signal);
    font-weight: 400;
    letter-spacing: -0.02em;
    line-height: 1;
  }
  .rt-stmt-grid {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 14px;
    flex: 1;
  }
  .rt-stmt-rows { display: flex; flex-direction: column; }
  .rt-stmt-row {
    display: flex;
    justify-content: space-between;
    padding: 4px 0;
    border-bottom: 1px solid var(--rule-soft);
    font-size: 8px;
    color: var(--ink-3);
  }
  .rt-stmt-row span:last-child { color: var(--ink); font-variant-numeric: tabular-nums; }
  .rt-stmt-row-total { border-top: 1px solid var(--ink); margin-top: 4px; padding-top: 5px; }
  .rt-stmt-row-total span { color: var(--ink) !important; font-weight: 500; }
  .rt-stmt-foot {
    text-align: center;
    font-size: 6px;
    letter-spacing: 0.2em;
    color: var(--ink-4);
    text-transform: uppercase;
    border-top: 1px solid var(--rule);
    padding-top: 6px;
  }

  /* ── Closing (slide 10) ── */
  .rt-close-grid {
    margin-top: 32px;
    display: grid;
    grid-template-columns: 1.6fr 1fr;
    gap: 64px;
    align-items: start;
    flex: 1;
  }
  .rt-close-text { display: flex; flex-direction: column; }
  .rt-close-lead {
    margin-top: 0;
    font-family: var(--font-fraunces), "Times New Roman", serif;
    font-size: 26px;
    line-height: 1.35;
    color: var(--ink);
    font-weight: 300;
    max-width: 560px;
  }
  .rt-close-body { margin-top: 22px; font-size: 14px; line-height: 1.65; color: var(--ink-3); max-width: 560px; }
  .rt-signature { margin-top: 32px; }
  .rt-sig-name {
    font-size: 14px;
    letter-spacing: 0.22em;
    color: var(--signal);
    font-weight: 600;
    text-transform: uppercase;
  }
  .rt-sig-title { margin-top: 4px; font-size: 11px; letter-spacing: 0.18em; color: var(--ink-3); text-transform: uppercase; }
  .rt-close-portrait { display: flex; flex-direction: column; align-items: flex-start; gap: 14px; }
  .rt-close-portrait img {
    width: 100%;
    max-width: 320px;
    aspect-ratio: 4 / 5;
    object-fit: cover;
    background: var(--paper-2);
  }
  .rt-close-portrait-rule { width: 48px; height: 2px; background: var(--signal); margin-top: 4px; }
  .rt-close-portrait-caption {
    font-family: var(--font-fraunces), "Times New Roman", serif;
    font-style: italic;
    font-size: 16px;
    color: var(--ink-3);
  }

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
