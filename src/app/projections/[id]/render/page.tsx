import { notFound } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import type { ProjectionRow } from '@/lib/projections-types';
import { latestAirDnaMonth } from '@/lib/projections-airdna';
import {
  computeProjection,
  fmtMoney,
  fmtMoneyRange,
  fmtMonthYear,
  fmtPercent,
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
        <SlidePillars footer={footerLabel} />
        <SlideRatings footer={footerLabel} />
        <SlideLocal projection={projection} footer={footerLabel} />
        <SlideYear1 computed={c} footer={footerLabel} />
        {projection.apply_ramp && <SlideRamp projection={projection} computed={c} footer={footerLabel} />}
        {/* Opt-in line-item detail for owners who want it. Placed right
            after Year 1 so the prospect reads it as a zoom-in on the
            monthly average they just saw. */}
        {projection.include_monthly_breakdown && (
          <SlideMonthlyBreakdown computed={c} footer={footerLabel} />
        )}
        <SlideYear2 computed={c} footer={footerLabel} />
        <SlideServices footer={footerLabel} />
        <SlideOwnerControl projection={projection} computed={c} footer={footerLabel} />
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
          <div className="rt-eyebrow rt-eyebrow-light" style={{ marginBottom: 8 }}>Prepared for {projection.prospect_name}</div>
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
            We specialize in vacation rental management for exceptional homes across Cape Ann.
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
  // Monthly anchor: approximate per-month range so the prospect has a
  // concrete monthly number to react to alongside the annual range.
  const monthlyLow = Math.round(computed.heroLow / 12 / 100) * 100;
  const monthlyHigh = Math.round(computed.heroHigh / 12 / 100) * 100;
  const monthlyAnchor = `≈ ${fmtMoney(monthlyLow)} - ${fmtMoney(monthlyHigh)} per month`;
  return (
    <section className="rt-slide">
      <Header label={`${monthYear} | ${projection.property_address.toUpperCase()}${projection.property_city ? `, ${projection.property_city.split(',')[0].toUpperCase()}` : ''}`} />
      <div className="rt-hero-block">
        <div className="rt-hero-number">{range}</div>
        <div className="rt-hero-eyebrow">PROJECTED ANNUAL NET PAYOUTS TO {greetingName}</div>
        <div className="rt-hero-monthly">{monthlyAnchor}</div>
        <p className="rt-hero-disclaimer">
          Year 1 estimate, net of management fees and cleaning expenses, based on comparable property performance. <sup>(1)</sup>
        </p>
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
              Five-star service is what we obsess over. It is also what builds stronger bookings and higher rates, year after year.
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
  // Show actual values, not rounded. Dotti wants the real number.
  const monthly = Math.round(computed.year1MonthlyAvg);
  const max = Math.max(...computed.monthlyYear1.map((m) => m.netPayout));
  return (
    <section className="rt-slide">
      <Header label={footer} />
      <div className="rt-content-pad">
        <h2 className="rt-section-title">Year 1 Performance</h2>
        <div className="rt-year-stat">
          <div className="rt-eyebrow">PROJECTED AVERAGE MONTHLY PAYOUT</div>
          <div className="rt-year-number">{fmtMoney(monthly)} <span className="rt-year-unit">/ mo.</span></div>
        </div>

        <div className="rt-month-strip">
          {computed.monthlyYear1.map((m) => {
            const inactive = m.rampMultiplier === 0;
            const h = max > 0 && !inactive ? Math.max(2, (m.netPayout / max) * 100) : 0;
            return (
              <div key={m.monthIndex} className="rt-month-col">
                <div className="rt-month-amt">
                  {inactive ? '' : fmtMoney(Math.round(m.netPayout))}
                </div>
                <div className="rt-month-bar-wrap">
                  {!inactive && (
                    <div
                      className="rt-month-bar"
                      style={{ height: `${h}%` }}
                    />
                  )}
                </div>
                <div className={`rt-month-label${inactive ? ' rt-month-label-inactive' : ''}`}>{m.monthLabel}</div>
              </div>
            );
          })}
        </div>
      </div>
      <Footer label={footer} />
    </section>
  );
}

/**
 * Year 1 monthly breakdown slide. Opt-in (projection.include_monthly_breakdown)
 * for owners who want line-item detail behind the average. Table layout:
 *
 *   Month | Gross Revenue | Cleaning | Mgmt Fee | Owner Payout
 *
 * Uses monthlyYear1Ramped when ramp is on so the table matches the
 * Launch ramp slide's calendar; otherwise full-year monthlyYear1.
 * Inactive (pre-go-live) months render as dashes so the prospect can see
 * the runway clearly. Totals row at the bottom keys numbers against the
 * Year 1 Performance slide's average.
 */
function SlideMonthlyBreakdown({ computed, footer }: { computed: ProjectionComputed; footer: string }) {
  const rows = computed.inputs.apply_ramp ? computed.monthlyYear1Ramped : computed.monthlyYear1;
  const totals = rows.reduce(
    (acc, m) => ({
      gross: acc.gross + m.grossRevenue,
      cleaning: acc.cleaning + m.cleaningExpense,
      mgmt: acc.mgmt + m.managementFee,
      net: acc.net + m.netPayout,
    }),
    { gross: 0, cleaning: 0, mgmt: 0, net: 0 },
  );
  return (
    <section className="rt-slide">
      <Header label={footer} />
      <div className="rt-content-pad">
        <h2 className="rt-section-title">Year 1 monthly detail</h2>
        <p className="rt-section-sub">
          The same Year 1 projection broken out month-by-month: gross revenue, cleaning, the management
          fee, and your net payout.
        </p>
        {(() => {
          // Transposed layout: months across the top (matching the
          // Property Analyzer spreadsheet), the four line items as rows,
          // and a Full Year column on the right in place of a totals row.
          // Keeps the table to 5 rows so it never overflows the slide the
          // way the 13-row vertical version did.
          const money = (n: number) => fmtMoney(Math.round(n));
          const metrics: Array<{
            label: string;
            get: (m: (typeof rows)[number]) => number;
            total: number;
            net?: boolean;
          }> = [
            { label: 'Gross revenue', get: (m) => m.grossRevenue, total: totals.gross },
            { label: 'Cleaning', get: (m) => m.cleaningExpense, total: totals.cleaning },
            { label: 'Mgmt fee', get: (m) => m.managementFee, total: totals.mgmt },
            { label: 'Owner payout', get: (m) => m.netPayout, total: totals.net, net: true },
          ];
          return (
            <table className="rt-mb-table">
              <thead>
                <tr>
                  <th className="rt-mb-th rt-mb-th-metric" />
                  {rows.map((m) => (
                    <th
                      key={m.monthIndex}
                      className={`rt-mb-th rt-mb-th-mo${m.rampMultiplier === 0 ? ' rt-mb-th-inactive' : ''}`}
                    >
                      {m.monthLabel}
                    </th>
                  ))}
                  <th className="rt-mb-th rt-mb-th-year">Full year</th>
                </tr>
              </thead>
              <tbody>
                {metrics.map((metric) => (
                  <tr key={metric.label} className={metric.net ? 'rt-mb-row-net' : ''}>
                    <td className="rt-mb-td rt-mb-td-metric">{metric.label}</td>
                    {rows.map((m) => {
                      const inactive = m.rampMultiplier === 0;
                      return (
                        <td
                          key={m.monthIndex}
                          className={`rt-mb-td rt-mb-td-num${inactive ? ' rt-mb-td-inactive' : ''}`}
                        >
                          {inactive ? '—' : money(metric.get(m))}
                        </td>
                      );
                    })}
                    <td className="rt-mb-td rt-mb-td-num rt-mb-td-year">{money(metric.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          );
        })()}

        {/* Definition legend — a one-line plain-English gloss per line item
            so an owner reading the deck cold knows exactly what each row
            means. The management-fee definition pulls the live fee %. */}
        <div className="rt-mb-legend">
          <div className="rt-mb-def">
            <div className="rt-mb-def-term">Gross revenue</div>
            <div className="rt-mb-def-body">What guests pay for their stays, before any costs.</div>
          </div>
          <div className="rt-mb-def">
            <div className="rt-mb-def-term">Cleaning</div>
            <div className="rt-mb-def-body">Per-turnover cleaning, billed through at cost.</div>
          </div>
          <div className="rt-mb-def">
            <div className="rt-mb-def-term">Mgmt fee</div>
            <div className="rt-mb-def-body">
              Rising Tide&rsquo;s {fmtPercent(computed.inputs.mgmt_fee_pct)}, charged only on what the home earns.
            </div>
          </div>
          <div className="rt-mb-def rt-mb-def-net">
            <div className="rt-mb-def-term">Owner payout</div>
            <div className="rt-mb-def-body">What lands in your account that month.</div>
          </div>
        </div>
      </div>
      <Footer label={footer} />
    </section>
  );
}

/**
 * Launch ramp slide. Conditionally rendered when apply_ramp is true. Walks
 * the prospect through the calendar-year reality of starting mid-year:
 * partial seasonal capture this year, run-rate from Year 2.
 */
function SlideRamp({
  projection,
  computed,
  footer,
}: {
  projection: ProjectionRow;
  computed: ProjectionComputed;
  footer: string;
}) {
  const calendarNet = Math.round(computed.year1Ramped.netPayout);
  const runRateNet = Math.round(computed.year1.mid.netPayout);
  const activeMonths = computed.year1Ramped.activeMonthCount;
  const fraction = computed.year1Ramped.effectiveAnnualizedMultiplier;
  const startMonthLabel = MONTH_NAMES[(projection.start_month - 1) % 12] ?? 'mid-year';
  const presentationYear = (() => {
    const y = projection.presentation_month?.split('-')[0];
    return y ? Number(y) : new Date().getFullYear();
  })();
  return (
    <section className="rt-slide">
      <Header label={footer} />
      <div className="rt-content-pad">
        <h2 className="rt-section-title">Launch year</h2>
        <p className="rt-y2-lead">
          {projection.property_address} goes live in {startMonthLabel} {presentationYear}. Your first calendar year captures partial seasonality. About {Math.round(fraction * 100)}% of a full seasonal year, across {activeMonths} active months. From Year 2 onward, the property operates at full run rate.
        </p>

        <div className="rt-y2-compare">
          <div className="rt-y2-side">
            <div className="rt-y2-cap">CALENDAR {presentationYear}</div>
            <div className="rt-y2-amt">{fmtMoney(calendarNet)}</div>
            <div className="rt-y2-sub">{activeMonths} active months</div>
          </div>

          <div className="rt-y2-arrow-wrap" aria-hidden="true">
            <div className="rt-y2-arrow-line" />
            <div className="rt-y2-arrow-pill">RUN&nbsp;RATE</div>
            <div className="rt-y2-arrow-head" />
          </div>

          <div className="rt-y2-side rt-y2-side-rt">
            <div className="rt-y2-cap rt-y2-cap-rt">YEAR 1 RUN RATE</div>
            <div className="rt-y2-amt rt-y2-amt-rt">{fmtMoney(runRateNet)}</div>
            <div className="rt-y2-sub">full seasonal year</div>
          </div>
        </div>
      </div>
      <Footer label={footer} />
    </section>
  );
}

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function SlideYear2({ computed, footer }: { computed: ProjectionComputed; footer: string }) {
  // Show actual values, not rounded.
  const y1 = Math.round(computed.year1MonthlyAvg);
  const y2 = Math.round(computed.year2MonthlyAvg);
  const growthPct = computed.year1MonthlyAvg > 0
    ? Math.round(((computed.year2MonthlyAvg - computed.year1MonthlyAvg) / computed.year1MonthlyAvg) * 100)
    : 0;
  return (
    <section className="rt-slide">
      <Header label={footer} />
      <div className="rt-content-pad">
        <h2 className="rt-section-title">Year 2 Performance</h2>
        <p className="rt-y2-lead">
          Year 2 typically sees +10%. By then your home has a stronger review profile, more direct and repeat bookings, and pricing tightened with a year of real data behind it.
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
      items: ['Guest screening and verification', '24/7 messaging and on-call support', 'Five-star hospitality, every stay'],
    },
    {
      num: '02',
      eyebrow: 'Property',
      lead: 'The home stays in the condition your guests expect, and you do too.',
      items: ['Professional turnover and laundry', 'Routine inspections and maintenance', 'Inventory, supplies, and consumables'],
    },
    {
      num: '03',
      eyebrow: 'Marketing',
      lead: 'Listed where guests look, priced where the market lands.',
      items: ['Airbnb, Vrbo, and direct channels', 'Dynamic, market-based pricing', 'Professional photography and copy'],
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

/**
 * Local-focus slide. Captures the same message as the "Cape Ann, done right"
 * section on risingtidestr.com: small portfolio, hyper-local, Gloucester
 * HQ ten minutes from every home. No real map illustration in v1; the
 * editorial "10 minutes" stat carries the slide.
 */
function SlideLocal({ projection, footer }: { projection: ProjectionRow; footer: string }) {
  const items: { title: string; body: string }[] = [
    {
      title: 'HQ in the heart of Cape Ann.',
      body: 'Rising Tide is based at 85 Eastern Ave in Gloucester. Minutes from every home we manage.',
    },
    {
      title: 'Supplies staged and ready.',
      body: 'Linens, consumables, and maintenance gear stocked on-site. No waiting on shipments mid-stay.',
    },
    {
      title: 'On the ground when it counts.',
      body: 'When something needs attention, we&rsquo;re already close. No third-party dispatch, no out-of-state call center.',
    },
  ];
  return (
    <section className="rt-slide">
      <Header label={footer} />
      <div className="rt-content-pad">
        <h2 className="rt-section-title">Cape Ann, done right.</h2>

        <div className="rt-local-grid">
          <div className="rt-local-left">
            <ul className="rt-local-list">
              {items.map((it) => (
                <li key={it.title}>
                  <span className="rt-local-mark" aria-hidden="true">✓</span>
                  <div>
                    <div className="rt-local-h">{it.title}</div>
                    <p className="rt-local-b" dangerouslySetInnerHTML={{ __html: it.body }} />
                  </div>
                </li>
              ))}
            </ul>
          </div>
          <div className="rt-local-right">
            <div className="rt-local-stat">
              <span className="rt-local-num">{projection.drive_time_minutes ?? 10}</span>
              <span className="rt-local-unit">min.</span>
            </div>
            <div className="rt-local-stat-cap">{projection.drive_time_minutes ? `FROM HQ TO ${projection.property_address.toUpperCase()}` : 'FROM EVERY HOME WE MANAGE'}</div>
            <div className="rt-local-rule" />
            <div className="rt-local-hq">
              <div className="rt-local-hq-label">RISING TIDE HQ</div>
              <div className="rt-local-hq-addr">85 Eastern Ave</div>
              <div className="rt-local-hq-addr">Gloucester, MA</div>
            </div>
          </div>
        </div>
      </div>
      <Footer label={footer} />
    </section>
  );
}

function SlideOwnerControl({
  projection,
  computed,
  footer,
}: {
  projection: ProjectionRow;
  computed: ProjectionComputed;
  footer: string;
}) {
  const items = [
    'Block dates and schedule owner stays via the Owner Portal',
    'Net payout deposited monthly via ACH',
    'Real-time bookings and performance dashboard',
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
          <StatementPreview projection={projection} computed={computed} />
        </div>
      </div>
      <Footer label={footer} />
    </section>
  );
}

/**
 * Mini owner statement personalized to the prospect. The example statement
 * is for the projection's presentation month (so a deck dated May 2026
 * shows a May 2026 statement), and the Owner Payout in the hero matches
 * the model's projected net for that specific month — not the year
 * average. Easter egg: prospects see the seasonal payout for the month
 * the deck is going out.
 *
 *   target net = computed.monthlyYear1[<presentation_month>].netPayout
 *   cleaning   = 4 turns × per-turn (capped at $325, same as the model)
 *   revenue    = (target net + cleaning) / (1 − mgmt fee %)
 *   mgmt fee   = revenue × mgmt fee %
 *
 * Reservations are split across 4 stays (3+3+6+4 = 16 nights) using fixed
 * share percentages so the visual doesn't shift between properties. The
 * last reservation absorbs the rounding remainder so individual rows sum
 * exactly to the revenue line.
 */
function StatementPreview({
  projection,
  computed,
}: {
  projection: ProjectionRow;
  computed: ProjectionComputed;
}) {
  // ─── Pick the example month from the projection's presentation date ───
  // presentation_month is "YYYY-MM". Default to May 2026 if absent/invalid
  // so the preview always has something to render.
  const [presYearStr, presMonthStr] = (projection.presentation_month ?? '2026-05').split('-');
  const presYear = Number(presYearStr) || 2026;
  const presMonth1 = Math.min(12, Math.max(1, Number(presMonthStr) || 5));
  const monthIdx = presMonth1 - 1;
  const monthDate = new Date(presYear, monthIdx, 1);
  const monthLong = monthDate.toLocaleDateString('en-US', { month: 'long' });
  const monthShort = monthDate.toLocaleDateString('en-US', { month: 'short' });
  const monthNum = String(presMonth1).padStart(2, '0');
  const daysInMonth = new Date(presYear, monthIdx + 1, 0).getDate();
  // Issued on the 5th of the following month (typical owner-payout cadence).
  const issuedLabel = new Date(presYear, monthIdx + 1, 5).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  // ─── Anchor: that month's projected net from the model ─────────────────
  const targetNet = computed.monthlyYear1[monthIdx].netPayout;
  const mgmtFeePct = projection.mgmt_fee_pct;
  const mgmtFeePctDisplay = Math.round(mgmtFeePct * 100);

  // Cleaning: per-turn from the property's own settings, capped at $325 to
  // match the model, × 4 turns (typical month).
  const perTurn = Math.min(
    325,
    projection.base_cleaning + Math.max(0, projection.bedrooms - 2) * projection.addl_cleaning_per_br,
  );
  const turnoverCount = 4;
  const cleaning = perTurn * turnoverCount;

  // Work back from targetNet so every line reconciles to the month's net.
  const revenue = (targetNet + cleaning) / (1 - mgmtFeePct);
  const mgmtFee = revenue * mgmtFeePct;

  // Reservation date pattern: 4 stays, 16 nights, spread across the month.
  // Pattern works for months with ≥ 30 days; for shorter months (Feb) the
  // last stay clamps to the end of the month so we don't overrun.
  const endDay = Math.min(30, daysInMonth);
  const stays: { guest: string; dates: string; channel: string; share: number }[] = [
    { guest: 'Sofia G.', dates: `${monthShort} 4 → 7`,           channel: 'Vrbo',   share: 0.18 },
    { guest: 'James K.', dates: `${monthShort} 11 → 14`,         channel: 'Airbnb', share: 0.20 },
    { guest: 'Priya S.', dates: `${monthShort} 18 → 24`,         channel: 'Airbnb', share: 0.39 },
    { guest: 'Mike R.',  dates: `${monthShort} 26 → ${endDay}`,  channel: 'Direct', share: 0.23 },
  ];
  const partial = stays.slice(0, -1).map((s) => Math.round(revenue * s.share * 100) / 100);
  const last = Math.round((revenue - partial.reduce((a, b) => a + b, 0)) * 100) / 100;
  const amounts = [...partial, last];

  // Display helpers
  const totalNights = 16;
  const occupancy = Math.round((totalNights / daysInMonth) * 100);
  const adr = Math.round(revenue / totalNights);
  const adrLabel = '$' + adr.toLocaleString('en-US');  // commas for >= $1,000
  const f2 = (n: number) => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  // Hero net: split into whole dollars + cents superscript
  const netWhole = Math.floor(targetNet);
  const netCents = Math.round((targetNet - netWhole) * 100).toString().padStart(2, '0');

  // Header-line property tag (uppercased city if present)
  const propertyHeader = `${projection.property_address.toUpperCase()}${projection.property_city ? ` · ${projection.property_city.split(',')[0].toUpperCase()}` : ''}`;
  const propertyAddressee = `${projection.property_address}${projection.property_city ? `, ${projection.property_city.split(',')[0]}` : ''}`;
  const ownerName = projection.prospect_full_legal || projection.prospect_name;

  return (
    <div className="rt-stmt-card">
      {/* Masthead */}
      <div className="rt-stmt-mast">
        <span><b>Rising Tide</b> &middot; Vacation Rentals</span>
        <span>Owner Statement &middot; No. {monthNum} / {presYear}</span>
        <span>allie@risingtidestr.com</span>
      </div>

      {/* Header row: logo + headline */}
      <div className="rt-stmt-head">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/rising-tide-logo.png" alt="" className="rt-stmt-logo" />
        <div className="rt-stmt-headline">
          <div className="rt-stmt-kicker">{monthLong} &middot; {presYear}</div>
          <div className="rt-stmt-display">{monthLong} <em>Statement</em></div>
          <div className="rt-stmt-display-sub">{propertyHeader}</div>
        </div>
      </div>

      {/* Addressee */}
      <div className="rt-stmt-addressee">
        <div>
          <div className="rt-stmt-cell-label">Prepared for</div>
          <div className="rt-stmt-cell-val">{ownerName}</div>
          <div className="rt-stmt-cell-sub">{propertyAddressee}</div>
        </div>
        <div>
          <div className="rt-stmt-cell-label">Period</div>
          <div className="rt-stmt-cell-val">{`${monthShort} 1 to ${monthShort} ${daysInMonth}, ${presYear}`}</div>
          <div className="rt-stmt-cell-sub">30 days &middot; {totalNights} nights booked</div>
        </div>
        <div>
          <div className="rt-stmt-cell-label">Issued &middot; Payout</div>
          <div className="rt-stmt-cell-val">{issuedLabel}</div>
          <div className="rt-stmt-cell-sub">Direct deposit</div>
        </div>
      </div>

      {/* Hero */}
      <div className="rt-stmt-hero">
        <div>
          <div className="rt-stmt-payout-label">Owner Payout</div>
          <div className="rt-stmt-payout-amt">
            <span className="rt-stmt-dollar">$</span>
            <span>{netWhole.toLocaleString('en-US')}</span>
            <span className="rt-stmt-cents">.{netCents}</span>
          </div>
        </div>
        <div className="rt-stmt-mini-grid">
          <div className="rt-stmt-mini">
            <div className="rt-stmt-mini-label">Stays</div>
            <div className="rt-stmt-mini-val">{stays.length}</div>
          </div>
          <div className="rt-stmt-mini">
            <div className="rt-stmt-mini-label">Nights</div>
            <div className="rt-stmt-mini-val">{totalNights}<span className="rt-stmt-mini-u">/{daysInMonth}</span></div>
            <div className="rt-stmt-mini-sub">{occupancy}% occupancy</div>
          </div>
          <div className="rt-stmt-mini">
            <div className="rt-stmt-mini-label">ADR</div>
            <div className="rt-stmt-mini-val">{adrLabel}</div>
          </div>
        </div>
      </div>

      {/* Two-column: reservations + financials */}
      <div className="rt-stmt-twocol">
        <div>
          <div className="rt-stmt-sec-head">
            <span className="rt-stmt-sec-num">01</span>
            <span className="rt-stmt-sec-title">Reservations</span>
            <span className="rt-stmt-sec-meta">{stays.length} stays</span>
          </div>
          <div className="rt-stmt-rows">
            {stays.map((s, i) => (
              <div key={s.guest} className="rt-stmt-row">
                <span className="rt-stmt-guest">{s.guest}</span>
                <span className="rt-stmt-dates">{s.dates}</span>
                <span className="rt-stmt-channel" data-ch={s.channel}>{s.channel}</span>
                <span className="rt-stmt-amt">{f2(amounts[i])}</span>
              </div>
            ))}
          </div>
        </div>
        <div>
          <div className="rt-stmt-sec-head">
            <span className="rt-stmt-sec-num">02</span>
            <span className="rt-stmt-sec-title">Financials</span>
            <span className="rt-stmt-sec-meta">Net {f2(targetNet)}</span>
          </div>
          <div className="rt-stmt-rows">
            <div className="rt-stmt-fin"><span>Rental Revenue</span><span>{f2(revenue)}</span></div>
            <div className="rt-stmt-fin"><span>Mgmt Fee <small>({mgmtFeePctDisplay}%)</small></span><span className="rt-stmt-neg">−{f2(mgmtFee)}</span></div>
            <div className="rt-stmt-fin"><span>Cleaning <small>({turnoverCount} turns)</small></span><span className="rt-stmt-neg">−{f2(cleaning)}</span></div>
            <div className="rt-stmt-fin rt-stmt-fin-total"><span>Owner Payout</span><span>{f2(targetNet)}</span></div>
          </div>
        </div>
      </div>
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
            <div className="rt-cta">
              <div className="rt-cta-label">Next step</div>
              <div className="rt-cta-body">
                Reply to this email or call <span className="rt-cta-num">(978) 865-2387</span> to schedule a property walkthrough.
              </div>
            </div>
            <div className="rt-signature">
              <div className="rt-sig-name">ALLIE O&rsquo;BRIEN</div>
              <div className="rt-sig-title">OWNER, RISING TIDE</div>
            </div>
          </div>
          <div className="rt-close-portrait">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/allie-obrien.jpg" alt="Allie O'Brien, Owner of Rising Tide" />
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
  .rt-hero-monthly {
    margin-top: 12px;
    font-family: var(--font-fraunces), "Times New Roman", serif;
    font-style: italic;
    font-size: 22px;
    color: var(--ink-3);
    font-weight: 300;
  }
  .rt-hero-disclaimer {
    margin-top: 28px;
    max-width: 720px;
    font-size: 13px;
    line-height: 1.6;
    color: var(--ink-3);
    font-style: italic;
  }

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

  /* ── Ratings (slide 5): +18% revenue hero on the left, comparison card on the right ── */
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

  /* Sub-title under .rt-section-title for slides that need a line of
     context above the data (used by the monthly breakdown slide). */
  .rt-section-sub {
    margin: 4px 0 28px;
    font-size: 16px;
    line-height: 1.5;
    color: var(--ink-3);
    max-width: 720px;
  }

  /* ── Year 1 monthly breakdown table (opt-in slide) ──
     Transposed: months across the top, four line items as rows, Full
     Year on the right. Compact so 14 columns fit the slide width. */
  .rt-mb-table {
    margin-top: 22px;
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
    font-variant-numeric: tabular-nums;
    font-family: var(--font-inter), system-ui, sans-serif;
  }
  /* Month / Full-year headers — sit in a soft band so the row of months
     reads as a unit rather than floating labels. */
  .rt-mb-th {
    text-align: right;
    padding: 11px 7px;
    background: var(--paper-2);
    border-bottom: 1.5px solid var(--ink);
    font-size: 10.5px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--ink-3);
    font-weight: 600;
    white-space: nowrap;
  }
  .rt-mb-th-metric {
    width: 118px;
    background: transparent;
    border-bottom-color: var(--ink);
  }
  .rt-mb-th-mo { width: auto; }
  .rt-mb-th-inactive { color: var(--ink-4); }
  .rt-mb-th-year {
    width: 96px;
    color: var(--ink);
    background: var(--paper-3, #efe7d6);
  }
  /* Body cells */
  .rt-mb-td {
    padding: 12px 7px;
    border-bottom: 1px solid var(--rule);
    font-size: 12.5px;
    color: var(--ink-3);
    text-align: right;
    white-space: nowrap;
  }
  .rt-mb-td-metric {
    text-align: left;
    font-family: var(--font-fraunces), "Times New Roman", serif;
    font-size: 15px;
    letter-spacing: -0.01em;
    color: var(--ink);
    white-space: nowrap;
  }
  .rt-mb-td-inactive { color: var(--ink-4); }
  /* Full-year column: the per-line annual total, tinted + inked so it
     reads as the headline of each row. */
  .rt-mb-td-year {
    background: var(--paper-2);
    border-left: 1px solid var(--rule);
    font-weight: 700;
    color: var(--ink);
  }
  /* Owner-payout row: the number that matters. A warm signal band runs
     the full width so the eye lands here, with the figures inked + larger
     and the row label in serif signal. */
  .rt-mb-row-net .rt-mb-td {
    background: rgba(200, 90, 58, 0.08);
    border-top: 2px solid var(--signal);
    border-bottom: none;
    padding-top: 13px;
    padding-bottom: 13px;
    font-weight: 700;
    font-size: 13.5px;
    color: var(--ink);
  }
  .rt-mb-row-net .rt-mb-td-metric { color: var(--signal); font-weight: 600; }
  .rt-mb-row-net .rt-mb-td-year { background: rgba(200, 90, 58, 0.16); }

  /* Definition legend below the table — four plain-English glosses. */
  .rt-mb-legend {
    margin-top: 28px;
    padding-top: 20px;
    border-top: 1px solid var(--rule);
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 28px;
  }
  .rt-mb-def-term {
    font-size: 10.5px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    font-weight: 600;
    color: var(--ink-3);
    margin-bottom: 5px;
  }
  .rt-mb-def-net .rt-mb-def-term { color: var(--signal); }
  .rt-mb-def-body {
    font-size: 12.5px;
    line-height: 1.5;
    color: var(--ink-3);
  }

  .rt-month-strip {
    margin-top: auto;
    padding-top: 28px;
    border-top: 1px solid var(--ink);
    display: grid;
    grid-template-columns: repeat(12, 1fr);
    gap: 6px;
    height: 320px;
    align-items: end;
  }
  .rt-month-col {
    display: grid;
    grid-template-rows: 18px 1fr auto;
    align-items: end;
    justify-items: center;
    height: 100%;
    gap: 6px;
  }
  .rt-month-amt {
    font-family: var(--font-fraunces), "Times New Roman", serif;
    font-size: 12px;
    color: var(--ink);
    font-weight: 400;
    font-variant-numeric: tabular-nums;
    letter-spacing: -0.02em;
    line-height: 1;
    white-space: nowrap;
  }
  .rt-month-bar-wrap {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: flex-end;
    justify-content: center;
  }
  .rt-month-bar {
    width: 60%;
    background: var(--signal);
    min-height: 1px;
  }
  .rt-month-label {
    margin-top: 4px;
    font-size: 11px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--ink-3);
    font-weight: 500;
  }
  .rt-month-label-inactive { color: var(--ink-4); font-weight: 400; }

  /* ── Year 2 (slide 7): clean before/after with growth pill ── */
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

  /* ── Local focus slide ── */
  .rt-local-grid {
    margin-top: 36px;
    flex: 1;
    display: grid;
    grid-template-columns: 1.2fr 1fr;
    gap: 64px;
    align-items: center;
  }
  .rt-local-left { display: flex; flex-direction: column; }
  .rt-local-list { margin: 0; padding: 0; list-style: none; }
  .rt-local-list li {
    display: grid;
    grid-template-columns: 28px 1fr;
    gap: 14px;
    padding: 18px 0;
    border-bottom: 1px solid var(--rule);
    align-items: start;
  }
  .rt-local-list li:first-child { border-top: 1px solid var(--ink); }
  .rt-local-list li:last-child { border-bottom: 1px solid var(--ink); }
  .rt-local-mark {
    color: var(--signal);
    font-size: 18px;
    font-weight: 600;
    line-height: 1;
    padding-top: 2px;
  }
  .rt-local-h {
    font-family: var(--font-fraunces), "Times New Roman", serif;
    font-size: 18px;
    color: var(--ink);
    font-weight: 500;
    letter-spacing: -0.01em;
    margin-bottom: 4px;
  }
  .rt-local-b {
    margin: 0;
    font-size: 13px;
    line-height: 1.55;
    color: var(--ink-3);
    max-width: 460px;
  }
  .rt-local-right {
    background: var(--paper-2);
    border-left: 3px solid var(--signal);
    padding: 36px 32px;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
  }
  .rt-local-stat { display: flex; align-items: baseline; gap: 12px; }
  .rt-local-num {
    font-family: var(--font-fraunces), "Times New Roman", serif;
    font-size: 156px;
    line-height: 1;
    font-weight: 300;
    color: var(--signal);
    letter-spacing: -0.05em;
  }
  .rt-local-unit {
    font-family: var(--font-fraunces), "Times New Roman", serif;
    font-size: 32px;
    font-style: italic;
    font-weight: 300;
    color: var(--ink-3);
    letter-spacing: -0.01em;
  }
  .rt-local-stat-cap {
    margin-top: 8px;
    font-size: 11px;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--ink);
    font-weight: 600;
    max-width: 240px;
    line-height: 1.45;
  }
  .rt-local-rule { width: 48px; height: 2px; background: var(--ink); margin: 24px 0 18px; }
  .rt-local-hq-label {
    font-size: 10px;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--ink-4);
    font-weight: 500;
    margin-bottom: 6px;
  }
  .rt-local-hq-addr {
    font-family: var(--font-fraunces), "Times New Roman", serif;
    font-size: 17px;
    font-weight: 400;
    color: var(--ink);
    line-height: 1.4;
  }

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

  /* ── Mini statement preview, mirrors src/app/statements/render layout ── */
  .rt-stmt-card {
    background: var(--paper);
    border: 1px solid var(--ink-3);
    box-shadow: 0 8px 28px rgba(30, 46, 52, 0.12);
    padding: 12px 14px;
    aspect-ratio: 8.5 / 11;
    max-height: 480px;
    display: flex;
    flex-direction: column;
    gap: 8px;
    font-family: var(--font-inter), system-ui, sans-serif;
    color: var(--ink);
  }

  /* Masthead: three-up, thin rule beneath */
  .rt-stmt-mast {
    display: grid;
    grid-template-columns: 1fr auto 1fr;
    gap: 8px;
    align-items: baseline;
    font-size: 6px;
    letter-spacing: 0.06em;
    color: var(--ink-3);
    border-bottom: 1px solid var(--ink);
    padding-bottom: 5px;
  }
  .rt-stmt-mast > :first-child { text-align: left; }
  .rt-stmt-mast > :nth-child(2) { text-align: center; }
  .rt-stmt-mast > :last-child { text-align: right; }
  .rt-stmt-mast b {
    font-family: var(--font-fraunces), "Times New Roman", serif;
    font-weight: 600;
    color: var(--ink);
    letter-spacing: 0.02em;
    font-size: 7px;
  }

  /* Header row: logo + headline */
  .rt-stmt-head {
    display: grid;
    grid-template-columns: 32px 1fr;
    gap: 12px;
    align-items: center;
    padding: 4px 0 6px;
  }
  .rt-stmt-logo { width: 32px; height: 32px; }
  .rt-stmt-headline { display: flex; flex-direction: column; }
  .rt-stmt-kicker {
    font-size: 6px;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--ink-4);
    font-weight: 500;
  }
  .rt-stmt-display {
    font-family: var(--font-fraunces), "Times New Roman", serif;
    font-size: 22px;
    line-height: 1;
    font-weight: 400;
    color: var(--ink);
    letter-spacing: -0.02em;
    margin-top: 2px;
  }
  .rt-stmt-display em {
    font-style: italic;
    font-weight: 300;
    color: var(--tide-deep);
  }
  .rt-stmt-display-sub {
    margin-top: 4px;
    font-size: 6px;
    letter-spacing: 0.22em;
    color: var(--ink-3);
    font-weight: 500;
  }

  /* Addressee row: 3 cells with thin rules */
  .rt-stmt-addressee {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 10px;
    border-top: 1px solid var(--rule);
    border-bottom: 1px solid var(--rule);
    padding: 6px 0;
  }
  .rt-stmt-cell-label {
    font-size: 5.5px;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--ink-4);
    font-weight: 500;
  }
  .rt-stmt-cell-val {
    margin-top: 2px;
    font-family: var(--font-fraunces), "Times New Roman", serif;
    font-size: 9px;
    color: var(--ink);
    font-weight: 500;
    line-height: 1.15;
  }
  .rt-stmt-cell-sub { font-size: 6px; color: var(--ink-3); margin-top: 2px; }

  /* Hero payout */
  .rt-stmt-hero {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 10px;
    align-items: end;
    padding: 6px 0;
  }
  .rt-stmt-payout-label {
    font-size: 6px;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--ink-4);
    font-weight: 500;
    margin-bottom: 2px;
  }
  .rt-stmt-payout-amt {
    font-family: var(--font-fraunces), "Times New Roman", serif;
    font-size: 30px;
    color: var(--signal);
    line-height: 1;
    font-weight: 400;
    letter-spacing: -0.025em;
  }
  .rt-stmt-dollar { font-size: 18px; vertical-align: top; margin-right: 1px; }
  .rt-stmt-cents { font-size: 14px; color: var(--ink-3); margin-left: 1px; }

  .rt-stmt-mini-grid {
    display: grid;
    grid-auto-flow: column;
    gap: 10px;
    align-items: end;
  }
  .rt-stmt-mini { text-align: right; }
  .rt-stmt-mini-label {
    font-size: 5.5px;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--ink-4);
    font-weight: 500;
  }
  .rt-stmt-mini-val {
    font-family: var(--font-fraunces), "Times New Roman", serif;
    font-size: 13px;
    color: var(--ink);
    font-weight: 500;
    line-height: 1;
    margin-top: 2px;
  }
  /* /<days> sits in line with the main number. Same font-size as parent
     so baselines align; muted color carries the visual subordination. */
  .rt-stmt-mini-u { color: var(--ink-4); margin-left: 1px; font-weight: 400; }
  .rt-stmt-mini-sub { font-size: 5.5px; color: var(--ink-3); margin-top: 1px; }

  /* Two-column: reservations + financials */
  .rt-stmt-twocol {
    flex: 1;
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 12px;
    border-top: 1px solid var(--rule);
    padding-top: 6px;
  }
  .rt-stmt-sec-head {
    display: grid;
    grid-template-columns: auto 1fr auto;
    gap: 6px;
    align-items: baseline;
    padding-bottom: 4px;
    border-bottom: 1px solid var(--ink);
    margin-bottom: 4px;
  }
  .rt-stmt-sec-num {
    font-family: var(--font-fraunces), "Times New Roman", serif;
    font-size: 9px;
    color: var(--signal);
    font-weight: 400;
  }
  .rt-stmt-sec-title {
    font-family: var(--font-fraunces), "Times New Roman", serif;
    font-size: 10px;
    color: var(--ink);
    font-weight: 500;
  }
  .rt-stmt-sec-meta {
    font-size: 5.5px;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--ink-4);
    font-weight: 500;
  }
  .rt-stmt-rows { display: flex; flex-direction: column; }
  .rt-stmt-row {
    display: grid;
    grid-template-columns: 1fr 1fr auto auto;
    gap: 4px;
    padding: 3px 0;
    border-bottom: 1px solid var(--rule-soft);
    font-size: 6.5px;
    color: var(--ink);
    align-items: baseline;
  }
  .rt-stmt-guest { font-weight: 500; }
  .rt-stmt-dates { color: var(--ink-3); }
  .rt-stmt-channel {
    font-size: 5.5px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--ink-3);
    padding: 1px 4px;
    border: 1px solid var(--rule);
    border-radius: 999px;
  }
  .rt-stmt-amt { font-variant-numeric: tabular-nums; text-align: right; font-weight: 500; }
  .rt-stmt-fin {
    display: flex;
    justify-content: space-between;
    padding: 3px 0;
    border-bottom: 1px solid var(--rule-soft);
    font-size: 7px;
    color: var(--ink);
    align-items: baseline;
  }
  .rt-stmt-fin small { color: var(--ink-4); margin-left: 2px; font-size: 5.5px; }
  .rt-stmt-fin span:last-child { font-variant-numeric: tabular-nums; font-weight: 500; }
  .rt-stmt-neg { color: var(--negative) !important; }
  .rt-stmt-fin-total {
    border-top: 1.5px solid var(--ink);
    border-bottom: 0;
    margin-top: 3px;
    padding-top: 4px;
    font-weight: 600;
  }
  .rt-stmt-fin-total span:last-child { color: var(--signal); }

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
  .rt-cta {
    margin-top: 28px;
    padding: 16px 18px;
    background: var(--paper-2);
    border-left: 3px solid var(--signal);
    max-width: 560px;
  }
  .rt-cta-label {
    font-size: 10px;
    letter-spacing: 0.22em;
    text-transform: uppercase;
    color: var(--signal);
    font-weight: 600;
    margin-bottom: 6px;
  }
  .rt-cta-body {
    font-family: var(--font-fraunces), "Times New Roman", serif;
    font-size: 17px;
    line-height: 1.45;
    color: var(--ink);
    font-weight: 400;
  }
  .rt-cta-num {
    color: var(--signal);
    white-space: nowrap;
  }
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
    /* Source is 1600×2400 (2:3 portrait). Let it render at its native ratio
       so the top of her head isn't cropped by an aspect-ratio override. */
    width: 100%;
    max-width: 280px;
    height: auto;
    display: block;
    background: var(--paper-2);
  }
  /* ── Endnotes (slide 10) ── */
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
