/**
 * "Cleaning costs" section for the Forecast page.
 *
 * Async server component: awaits getCleaningCosts() (a Gmail pull of Cape
 * Ann Elite invoices) and renders a property x month grid for the trailing
 * 12 months. Purely additive reporting — it does not touch the forecast
 * model. The page Suspense-streams this so the Gmail pull never blocks the
 * rest of the forecast.
 *
 * Visual language is borrowed from ForecastClient's per-property tables:
 * dark-ink header, warm paper background, mono tabular cells, compact
 * month labels.
 */

import { MONTH_LABELS } from '@/lib/forecast-model';
import { getProperty } from '@/lib/properties';
import { getCleaningCosts, UNATTRIBUTED_KEY } from '@/lib/forecast-cleaning';

/** Whole dollars, no cents. Zero renders as an em-dash for a calm grid. */
function fmtUsd(n: number): string {
  if (!n) return '—';
  return `$${Math.round(n).toLocaleString('en-US')}`;
}

/** "Jul 25" style label for a YYYY-MM column header. */
function fmtMonth(ym: string): string {
  const [y, m] = ym.split('-');
  const label = MONTH_LABELS[parseInt(m, 10) - 1] ?? m;
  return `${label} ${y.slice(2)}`;
}

/**
 * Readable display name for a property slug. Prefers the canonical
 * PROPERTIES entry; falls back to title-casing the slug
 * (e.g. "17_beach_rd" → "17 Beach Rd") if it isn't a known property.
 */
function displayName(slug: string): string {
  if (slug === UNATTRIBUTED_KEY) return 'Unattributed';
  const known = getProperty(slug);
  if (known) return known.name;
  return slug
    .split('_')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}

function thStyle(first?: boolean, totals?: boolean): React.CSSProperties {
  return {
    background: totals ? 'var(--ink-2)' : 'var(--ink)',
    color: 'var(--paper)',
    padding: '9px 9px',
    textAlign: first ? 'left' : 'center',
    fontWeight: 500,
    fontSize: 10,
    letterSpacing: '.04em',
    textTransform: 'uppercase',
    whiteSpace: 'nowrap',
    width: first ? 200 : 'auto',
  };
}

function cellStyle(extra?: React.CSSProperties): React.CSSProperties {
  return {
    padding: '6px 9px',
    textAlign: 'right',
    borderBottom: '1px solid var(--rule)',
    fontFamily: 'var(--font-mono-dash), monospace',
    fontSize: 11,
    whiteSpace: 'nowrap',
    fontVariantNumeric: 'tabular-nums',
    ...extra,
  };
}

function labelCellStyle(extra?: React.CSSProperties): React.CSSProperties {
  return {
    padding: '6px 12px',
    textAlign: 'left',
    borderBottom: '1px solid var(--rule)',
    fontFamily: 'var(--font-inter), system-ui, sans-serif',
    fontSize: 11.5,
    color: 'var(--ink-2)',
    whiteSpace: 'nowrap',
    ...extra,
  };
}

export async function CleaningCostsSection() {
  const data = await getCleaningCosts();

  return (
    <section
      className="max-w-[1100px] mx-auto px-10"
      style={{ paddingBottom: 32, width: '100%' }}
    >
      {/* Section heading — matches ForecastClient's SectionTitle. */}
      <div
        className="rule-bottom"
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: 14,
          paddingBottom: 8,
          marginBottom: 4,
        }}
      >
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
          Cleaning costs
        </h2>
        <span className="eyebrow">
          Cape Ann Elite invoices · trailing 12 months · via Gmail
        </span>
      </div>

      {data.empty ? (
        <div
          style={{
            marginTop: 14,
            border: '1px solid var(--rule)',
            background: 'var(--paper)',
            padding: '24px',
            color: 'var(--ink-3)',
            fontSize: 13,
            fontStyle: 'italic',
          }}
        >
          Cleaning invoice data unavailable
        </div>
      ) : (
        <div
          style={{
            marginTop: 14,
            border: '1px solid var(--rule)',
            background: 'var(--paper)',
            overflowX: 'auto',
          }}
        >
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: 11.5,
              background: 'var(--paper)',
            }}
          >
            <thead>
              <tr>
                <th style={thStyle(true)}>Property</th>
                {data.months.map((m) => (
                  <th key={m} style={thStyle()}>
                    {fmtMonth(m)}
                  </th>
                ))}
                <th style={thStyle(false, true)}>12-mo total</th>
              </tr>
            </thead>
            <tbody>
              {data.properties.map((row) => {
                const isUnattributed = row.propertyId === UNATTRIBUTED_KEY;
                return (
                  <tr
                    key={row.propertyId}
                    style={
                      isUnattributed
                        ? { background: 'rgba(200, 90, 58, 0.04)' }
                        : undefined
                    }
                  >
                    <td
                      style={labelCellStyle(
                        isUnattributed
                          ? { color: 'var(--ink-3)', fontStyle: 'italic' }
                          : { fontWeight: 500 }
                      )}
                    >
                      {displayName(row.propertyId)}
                    </td>
                    {data.months.map((m) => {
                      const v = row.byMonth[m] ?? 0;
                      return (
                        <td
                          key={m}
                          style={cellStyle({
                            color: v === 0 ? 'var(--ink-4)' : 'var(--ink)',
                            opacity: v === 0 ? 0.5 : 1,
                          })}
                        >
                          {fmtUsd(v)}
                        </td>
                      );
                    })}
                    <td
                      style={cellStyle({
                        fontWeight: 600,
                        background: 'var(--paper-2)',
                      })}
                    >
                      {fmtUsd(row.total)}
                    </td>
                  </tr>
                );
              })}

              {/* Portfolio totals row — dark ink, matches ForecastClient. */}
              <tr>
                <td
                  style={labelCellStyle({
                    background: 'var(--ink)',
                    color: 'var(--paper)',
                    fontWeight: 700,
                  })}
                >
                  ◆ Portfolio cleaning
                </td>
                {data.months.map((m) => (
                  <td
                    key={m}
                    style={cellStyle({
                      background: 'var(--ink)',
                      color: 'var(--paper)',
                      fontWeight: 600,
                    })}
                  >
                    {fmtUsd(data.totalsByMonth[m] ?? 0)}
                  </td>
                ))}
                <td
                  style={cellStyle({
                    background: 'var(--ink-2)',
                    color: 'var(--paper)',
                    fontWeight: 700,
                  })}
                >
                  {fmtUsd(data.grandTotal)}
                </td>
              </tr>
            </tbody>
          </table>

          <div
            style={{
              padding: '10px 16px',
              fontSize: 11,
              lineHeight: 1.55,
              color: 'var(--ink-3)',
              borderTop: '1px solid var(--rule)',
              background: 'var(--paper-2)',
            }}
          >
            <strong style={{ color: 'var(--ink-2)' }}>Source:</strong>{' '}
            {data.invoiceCount} Cape Ann Elite invoice
            {data.invoiceCount === 1 ? '' : 's'} parsed from QuickBooks
            notification emails in the Rising Tide Gmail inbox. Property is
            matched from the invoice greeting line; invoices whose property
            could not be read fall into the{' '}
            <em>Unattributed</em> row. Reporting only — these figures do not
            feed the forecast model.
          </div>
        </div>
      )}
    </section>
  );
}
