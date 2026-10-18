import { OverheadUpload } from '@/components/OverheadUpload';
import { OverheadDashboard } from '@/components/OverheadDashboard';
import type { OverheadAnalysis } from '@/lib/cost-analysis';

/**
 * The measured half of the Forecast: Rising Tide's own card (...3878) and
 * operating account (...5130), uploaded here and read back as the measured
 * months above. Until 2026-10-18 this lived on Cost Analysis, which retired
 * as a route; /cost-analysis now lands here (#actuals).
 *
 * The data is overhead_expenses through getOverhead(), the same rows and
 * the same rules categorizer as before. Nothing about the ingestion moved.
 */

function fmtDay(iso: string): string {
  return new Date(iso + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function ActualsSection({
  overhead,
  operatingLatestDate,
}: {
  overhead: OverheadAnalysis;
  /** Latest operating-account row; the card export usually runs ahead of it. */
  operatingLatestDate: string | null;
}) {
  // The data-age line names the operating export separately when it lags
  // the card, the same split the stale banner at the top of the page makes.
  const daysOld = overhead.daysSinceLatest;
  const stale = daysOld != null && daysOld > 35;
  const operatingBehind =
    !!operatingLatestDate && !!overhead.latestTxnDate && operatingLatestDate < overhead.latestTxnDate;
  const hint = overhead.latestTxnDate == null
    ? 'Nothing uploaded yet. Upload the card and operating exports.'
    : `Data through ${fmtDay(overhead.latestTxnDate)}${operatingBehind ? ` · operating account through ${fmtDay(operatingLatestDate!)}` : ''}${stale ? `. ${daysOld} days old: upload this month's exports.` : ''}`;

  return (
    <section
      id="actuals"
      className="max-w-[1100px] mx-auto px-10"
      style={{ paddingBottom: 56, width: '100%', scrollMarginTop: 90 }}
    >
      <div className="rule-bottom" style={{ display: 'flex', alignItems: 'baseline', gap: 14, paddingBottom: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        <h2
          style={{
            fontFamily: 'var(--font-inter), system-ui, sans-serif',
            fontSize: 13,
            fontWeight: 600,
            letterSpacing: '.08em',
            textTransform: 'uppercase',
            color: 'var(--ink)',
            margin: 0,
          }}
        >
          Actuals
        </h2>
        <span className="eyebrow">Chase card ...3878 + operating ...5130</span>
      </div>
      <OverheadUpload hint={hint} stale={stale || operatingBehind} />
      {!overhead.hasData ? (
        <div style={{ padding: 18, background: 'var(--paper-2)', border: '1px solid var(--rule)', fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.5 }}>
          No card or operating rows yet. Upload the Chase card (...3878) and operating (...5130) exports above.
        </div>
      ) : (
        <OverheadDashboard overhead={overhead} />
      )}
    </section>
  );
}
