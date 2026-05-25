'use client';

import { useState } from 'react';
import type { OverheadAnalysis } from '@/lib/cost-analysis';

/**
 * Rising Tide overhead dashboard (Financials > Cost Analysis).
 *
 * High-level by default, drill-down on click: category -> vendor -> the
 * individual charges. Figures are shown as exact actuals (no rounding). A
 * proactive "Opportunities" panel surfaces costs worth trimming, computed in
 * getOverhead() so this component stays a pure renderer.
 */

function fmt(n: number): string {
  return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function monthShort(m: string): string {
  return new Date(m + '-01T00:00:00').toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
}

export function OverheadDashboard({ overhead }: { overhead: OverheadAnalysis }) {
  const months = overhead.months;
  const trendMonths = months.slice(-6);
  // Run-rate KPIs use COMPLETE months only -- the current calendar month is
  // partial (data lands mid-month), so including it would understate the rate
  // and a month-over-month delta against it would be meaningless.
  const completeMonths = months.filter(m => m < overhead.currentMonth);
  const t12 = completeMonths.slice(-12);
  const trailing12 = t12.reduce((s, m) => s + (overhead.byMonthTotal[m] || 0), 0);
  const avgPerMonth = t12.length ? trailing12 / t12.length : 0;
  const ytdYear = overhead.currentMonth.slice(0, 4);
  const ytdMonths = months.filter(m => m.startsWith(ytdYear));
  const ytd = ytdMonths.reduce((s, m) => s + (overhead.byMonthTotal[m] || 0), 0);

  const [openCats, setOpenCats] = useState<Set<string>>(new Set());
  const [openVendors, setOpenVendors] = useState<Set<string>>(new Set());
  const toggle = (set: Set<string>, key: string) => {
    const next = new Set(set);
    if (next.has(key)) next.delete(key); else next.add(key);
    return next;
  };

  // The drill-down table covers exactly the months shown (the window), so every
  // row's months sum to its Total. Categories/vendors with nothing in the
  // window are dropped, and ordering follows windowed spend.
  const windowMonths = trendMonths;
  const sumWindow = (byMonth: Record<string, number>) => windowMonths.reduce((s, m) => s + (byMonth[m] || 0), 0);
  const rangeLabel = windowMonths.length
    ? `${monthShort(windowMonths[0])} – ${monthShort(windowMonths[windowMonths.length - 1])}`
    : '';
  const grandWindow = windowMonths.reduce((s, m) => s + (overhead.byMonthTotal[m] || 0), 0);
  const catRows = overhead.detail
    .map(c => ({ cat: c, win: windowMonths.reduce((s, m) => s + (overhead.byMonthCategory[m]?.[c.category] || 0), 0) }))
    .filter(r => r.win > 0.005)
    .sort((a, b) => b.win - a.win);

  return (
    <div>
      {/* Headline KPIs — exact actuals, complete months only (no partial-month
          headline, no all-time total). */}
      <div style={{ borderTop: '1px solid var(--ink)', borderBottom: '1px solid var(--ink)', display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)' }}>
        <Stat label="Avg / month" value={fmt(avgPerMonth)} sub={`last ${t12.length} full month${t12.length === 1 ? '' : 's'}`} />
        <Stat label="Trailing 12-mo" value={fmt(trailing12)} sub={`${t12.length} full month${t12.length === 1 ? '' : 's'}`} />
        <Stat label={`${ytdYear} to date`} value={fmt(ytd)} sub={`${ytdMonths.length} month${ytdMonths.length === 1 ? '' : 's'}`} last />
      </div>

      {/* Notable / recurring costs — factual readout (actual totals over the
          period on file), no advice, no annualized estimates. */}
      {overhead.insights.length > 0 && (
        <div style={{ marginTop: 22 }}>
          <div className="eyebrow" style={{ marginBottom: 10 }}>Notable & recurring costs</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 10 }}>
            {overhead.insights.map(ins => (
              <div key={ins.id} style={{ border: '1px solid var(--rule)', borderLeft: '2px solid var(--ink-3)', background: 'var(--paper-2)', padding: '12px 14px' }}>
                <div className="flex items-baseline justify-between" style={{ gap: 8, marginBottom: 4 }}>
                  <span className="font-serif" style={{ fontSize: 15, fontWeight: 500, color: 'var(--ink)', lineHeight: 1.2 }}>{ins.title}</span>
                  <span className="font-serif tabular-nums" style={{ fontSize: 15, color: 'var(--ink)', whiteSpace: 'nowrap' }}>{fmt(ins.amount)}</span>
                </div>
                <div style={{ fontSize: 11.5, color: 'var(--ink-3)', lineHeight: 1.5 }}>
                  <span style={{ textTransform: 'uppercase', letterSpacing: '.08em', fontSize: 9, color: 'var(--ink-4)' }}>{ins.timeframe}</span>
                  {' · '}{ins.detail}
                </div>
              </div>
            ))}
          </div>
          <div style={{ fontSize: 10.5, color: 'var(--ink-4)', marginTop: 8 }}>Actual totals over the {completeMonths.length + (months.length > completeMonths.length ? 1 : 0)} months on file. Not annualized.</div>
        </div>
      )}

      {/* Where it goes — interactive drill-down with the 6-month trend inline */}
      <div style={{ marginTop: 26 }}>
        <div className="flex items-baseline justify-between" style={{ marginBottom: 8 }}>
          <div className="eyebrow">Where it goes</div>
          <div style={{ fontSize: 10, color: 'var(--ink-4)' }}>click a category, then a vendor, to drill in</div>
        </div>
        <table className="w-full tabular-nums" style={{ borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ fontSize: 9, fontWeight: 600, letterSpacing: '.12em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>
              <th style={{ textAlign: 'left', padding: '8px 6px', borderBottom: '1px solid var(--ink)' }}>Category</th>
              {trendMonths.map(m => (
                <th key={m} style={{ textAlign: 'right', padding: '8px 6px', borderBottom: '1px solid var(--ink)' }}>
                  {monthShort(m)}{m === overhead.currentMonth ? <span style={{ color: 'var(--ink-4)', fontWeight: 400 }}> mtd</span> : ''}
                </th>
              ))}
              <th style={{ textAlign: 'right', padding: '8px 6px', borderBottom: '1px solid var(--ink)' }}>
                Total
                {rangeLabel && <div style={{ fontSize: 8, fontWeight: 400, letterSpacing: '.04em', color: 'var(--ink-4)' }}>{rangeLabel}</div>}
              </th>
            </tr>
          </thead>
          <tbody>
            {catRows.map(({ cat, win }) => {
              const catOpen = openCats.has(cat.category);
              return (
                <CategoryGroup
                  key={cat.category}
                  cat={cat}
                  winTotal={win}
                  trendMonths={trendMonths}
                  byMonthCategory={overhead.byMonthCategory}
                  sumWindow={sumWindow}
                  open={catOpen}
                  onToggle={() => setOpenCats(s => toggle(s, cat.category))}
                  openVendors={openVendors}
                  onToggleVendor={(vk) => setOpenVendors(s => toggle(s, vk))}
                />
              );
            })}
            <tr style={{ borderTop: '1.5px solid var(--ink)', fontWeight: 600 }}>
              <td style={{ padding: '10px 6px' }}>Total</td>
              {trendMonths.map(m => (
                <td key={m} style={{ padding: '10px 6px', textAlign: 'right', fontFamily: 'var(--font-fraunces)' }}>{fmt(overhead.byMonthTotal[m] || 0)}</td>
              ))}
              <td style={{ padding: '10px 6px', textAlign: 'right', fontFamily: 'var(--font-fraunces)' }}>{fmt(grandWindow)}</td>
            </tr>
          </tbody>
        </table>
      </div>

      <p style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 12, maxWidth: 760, lineHeight: 1.5 }}>
        Card (*3878) + operating (*5130), exact actuals. Columns and Total cover the months shown
        ({rangeLabel}); each row adds across to its Total. Personal/gray spend (gas, meals, streaming) and internal
        transfers are excluded, so this is real business overhead only.{overhead.latestTxnDate ? ` The current month (mtd) is still filling in.` : ''}
      </p>
    </div>
  );
}

function CategoryGroup({
  cat, winTotal, trendMonths, byMonthCategory, sumWindow, open, onToggle, openVendors, onToggleVendor,
}: {
  cat: OverheadAnalysis['detail'][number];
  winTotal: number;
  trendMonths: string[];
  byMonthCategory: Record<string, Record<string, number>>;
  sumWindow: (byMonth: Record<string, number>) => number;
  open: boolean;
  onToggle: () => void;
  openVendors: Set<string>;
  onToggleVendor: (key: string) => void;
}) {
  const span = trendMonths.length + 2;
  // Only vendors with spend in the visible window, biggest first.
  const vendorsInWindow = cat.vendors
    .map(v => ({ v, win: sumWindow(v.byMonth) }))
    .filter(x => x.win > 0.005)
    .sort((a, b) => b.win - a.win);
  return (
    <>
      <tr
        onClick={onToggle}
        style={{ borderBottom: '1px solid var(--rule-soft)', cursor: 'pointer', background: open ? 'var(--paper-2)' : 'transparent' }}
      >
        <td style={{ padding: '9px 6px', color: 'var(--ink)', fontFamily: 'var(--font-fraunces)', fontWeight: 500 }}>
          <span style={{ display: 'inline-block', width: 12, color: 'var(--ink-3)' }}>{open ? '−' : '+'}</span>
          {cat.category}
          <span style={{ marginLeft: 8, fontSize: 10, color: 'var(--ink-4)', fontFamily: 'var(--font-inter, inherit)' }}>{vendorsInWindow.length} vendor{vendorsInWindow.length === 1 ? '' : 's'}</span>
        </td>
        {trendMonths.map(m => {
          const v = byMonthCategory[m]?.[cat.category];
          return (
            <td key={m} style={{ padding: '9px 6px', textAlign: 'right', color: v ? 'var(--ink-2)' : 'var(--ink-4)' }}>
              {v ? fmt(v) : '—'}
            </td>
          );
        })}
        <td style={{ padding: '9px 6px', textAlign: 'right', fontFamily: 'var(--font-fraunces)', color: 'var(--ink)' }}>{fmt(winTotal)}</td>
      </tr>

      {open && vendorsInWindow.map(({ v, win }) => {
        const vkey = `${cat.category}::${v.vendor}`;
        const vOpen = openVendors.has(vkey);
        return (
          <CategoryVendor
            key={vkey}
            vendor={v}
            winTotal={win}
            trendMonths={trendMonths}
            span={span}
            open={vOpen}
            onToggle={() => onToggleVendor(vkey)}
          />
        );
      })}
    </>
  );
}

function CategoryVendor({
  vendor, winTotal, trendMonths, span, open, onToggle,
}: {
  vendor: OverheadAnalysis['detail'][number]['vendors'][number];
  winTotal: number;
  trendMonths: string[];
  span: number;
  open: boolean;
  onToggle: () => void;
}) {
  const windowSet = new Set(trendMonths);
  // Charges within the visible window only, so they sum to the row's Total.
  const txns = vendor.txns.filter(t => t.date && windowSet.has(t.date.slice(0, 7)));
  return (
    <>
      <tr onClick={onToggle} style={{ borderBottom: '1px dotted var(--rule)', cursor: 'pointer' }}>
        <td style={{ padding: '7px 6px 7px 22px', color: 'var(--ink-2)' }}>
          <span style={{ display: 'inline-block', width: 12, color: 'var(--ink-4)' }}>{open ? '−' : '+'}</span>
          {vendor.vendor}
        </td>
        {trendMonths.map(m => {
          const v = vendor.byMonth[m];
          return (
            <td key={m} style={{ padding: '7px 6px', textAlign: 'right', color: v ? 'var(--ink-2)' : 'var(--ink-4)', fontSize: 11 }}>
              {v ? fmt(v) : '—'}
            </td>
          );
        })}
        <td style={{ padding: '7px 6px', textAlign: 'right', color: 'var(--ink)' }}>{fmt(winTotal)}</td>
      </tr>
      {open && (
        <tr>
          <td colSpan={span} style={{ padding: 0 }}>
            <div style={{ background: 'var(--paper-2)', borderBottom: '1px solid var(--rule)', padding: '6px 6px 8px 22px' }}>
              <table className="w-full tabular-nums" style={{ borderCollapse: 'collapse', fontSize: 11 }}>
                <tbody>
                  {txns.map((t, i) => (
                    <tr key={i} style={{ borderBottom: i < txns.length - 1 ? '1px dotted var(--rule-soft)' : 'none' }}>
                      <td style={{ padding: '4px 8px 4px 0', color: 'var(--ink-3)', whiteSpace: 'nowrap', width: 88 }}>{t.date || '—'}</td>
                      <td style={{ padding: '4px 8px', color: 'var(--ink-2)' }}>
                        {t.description}
                        <span style={{ marginLeft: 6, fontSize: 9, color: 'var(--ink-4)', textTransform: 'uppercase', letterSpacing: '.08em' }}>{t.account === 'card' ? 'card' : 'oper'}</span>
                      </td>
                      <td style={{ padding: '4px 0', textAlign: 'right', color: 'var(--ink)', whiteSpace: 'nowrap' }}>{fmt(t.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function Stat({ label, value, sub, accent, last }: { label: string; value: string; sub?: string; accent?: boolean; last?: boolean }) {
  return (
    <div style={{ padding: '18px 20px', borderRight: last ? 'none' : '1px solid var(--rule)' }}>
      <div className="eyebrow" style={{ marginBottom: 8 }}>{label}</div>
      <div className="font-serif tabular-nums" style={{ fontSize: 24, fontWeight: 400, color: accent ? 'var(--signal)' : 'var(--ink)', lineHeight: 1.05 }}>{value}</div>
      {sub && <div style={{ marginTop: 6, fontSize: 11, color: 'var(--ink-3)' }}>{sub}</div>}
    </div>
  );
}
