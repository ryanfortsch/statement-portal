'use client';

import { useEffect, useState, useCallback } from 'react';
import { useSearchParams } from 'next/navigation';
import { supabase, debugInfo } from '@/lib/supabase';
import { Suspense } from 'react';
import Link from 'next/link';

/* ─── Types ─── */
type Reservation = {
  id: string;
  guest_name: string;
  confirmation_code: string;
  check_in: string;
  check_out: string;
  nights: number;
  platform: string;
  guesty_rental_income: number;
  stripe_fee: number;
  adjusted_revenue: number;
  bank_deposit_amount: number | null;
  bank_match_status: string;
};

type CleaningEvent = {
  id: string;
  checkout_date: string;
  guest_name: string;
  invoice_no: string | null;
  invoice_amount: number | null;
  bank_charge_amount: number | null;
  bank_charge_date: string | null;
  amount: number;
  source: string;
};

type DataGap = {
  id: string;
  gap_type: string;
  description: string;
  severity: string;
  expected_data: string;
  resolved: boolean;
  upload_id: string | null;
};

type PropertyStatement = {
  id: string;
  property_id: string;
  property_name: string;
  owner_name: string;
  management_fee_pct: number;
  rental_revenue: number;
  management_fee: number;
  cleaning_total: number;
  repairs_total: number;
  tax_remittance: number;
  owner_payout: number;
  num_stays: number;
  nights_booked: number;
  has_guesty_statement: boolean;
  has_platform_csv: boolean;
  has_bank_csv: boolean;
  confidence: string;
  notes: string | null;
  reservations?: Reservation[];
  cleaning_events?: CleaningEvent[];
  data_gaps?: DataGap[];
};

type StatementPeriod = {
  id: string;
  month: string;
  status: string;
  property_statements?: PropertyStatement[];
};

/* ─── Formatters ─── */
function fmt(amount: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}

function fmtDate(dateStr: string): string {
  if (!dateStr) return '--';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function monthLabel(m: string): string {
  const d = new Date(m + '-01T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}

function monthShort(m: string): string {
  const d = new Date(m + '-01T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
}

/* ─── Icons (inline SVGs) ─── */
function IconCheck({ className = 'w-4 h-4' }: { className?: string }) {
  return <svg className={className} fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/></svg>;
}

function IconChevron({ open, className = 'w-5 h-5' }: { open: boolean; className?: string }) {
  return (
    <svg className={`${className} transition-transform duration-200 ${open ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 9l-7 7-7-7" />
    </svg>
  );
}

function IconDownload({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
    </svg>
  );
}

function IconSync({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  );
}

function IconWarning({ className = 'w-4 h-4' }: { className?: string }) {
  return <svg className={className} fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd"/></svg>;
}

/* ─── Shared Components ─── */
function PlatformBadge({ platform }: { platform: string }) {
  const map: Record<string, { label: string; bg: string; text: string; ring: string }> = {
    'Airbnb':      { label: 'Airbnb',  bg: 'bg-rose-50',    text: 'text-rose-700',   ring: 'ring-rose-200/60' },
    'HomeAway':    { label: 'VRBO',    bg: 'bg-blue-50',    text: 'text-blue-700',   ring: 'ring-blue-200/60' },
    'Manual':      { label: 'Direct',  bg: 'bg-violet-50',  text: 'text-violet-700', ring: 'ring-violet-200/60' },
    'Booking.com': { label: 'Booking', bg: 'bg-indigo-50',  text: 'text-indigo-700', ring: 'ring-indigo-200/60' },
  };
  const p = map[platform] || { label: platform, bg: 'bg-gray-50', text: 'text-gray-600', ring: 'ring-gray-200/60' };
  return (
    <span className={`inline-flex items-center text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-md ${p.bg} ${p.text} ring-1 ${p.ring}`}>
      {p.label}
    </span>
  );
}

function ConfidenceIndicator({ level }: { level: string }) {
  const config: Record<string, { color: string; label: string; bg: string }> = {
    green:  { color: 'bg-emerald-500', label: 'Verified',  bg: 'bg-emerald-500/10' },
    yellow: { color: 'bg-amber-500',   label: 'Partial',   bg: 'bg-amber-500/10' },
    red:    { color: 'bg-red-500',     label: 'Incomplete', bg: 'bg-red-500/10' },
  };
  const c = config[level] || config.red;
  return (
    <div className="flex items-center gap-1.5">
      <span className={`w-2 h-2 rounded-full ${c.color}`} />
    </div>
  );
}

function DataSourceChip({ active, label }: { active: boolean; label: string }) {
  return (
    <span className={`inline-flex items-center gap-1 text-[11px] font-medium px-2 py-0.5 rounded-md transition-colors ${
      active ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-400'
    }`}>
      {active ? <IconCheck className="w-3 h-3" /> : <span className="w-3 h-3 inline-flex items-center justify-center text-[10px]">-</span>}
      {label}
    </span>
  );
}

function KPICard({ label, value, accent, sub }: { label: string; value: string; accent?: string; sub?: string }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-4 hover:shadow-sm transition-shadow">
      <p className="text-[11px] font-medium text-gray-400 uppercase tracking-wider">{label}</p>
      <p className={`text-xl font-bold tabular-nums mt-1 ${accent || 'text-[#1E2E34]'}`}>{value}</p>
      {sub && <p className="text-[11px] text-gray-400 mt-0.5">{sub}</p>}
    </div>
  );
}

/* ─── Property Card ─── */
function PropertyCard({ prop, month, reviewsCsv }: { prop: PropertyStatement; month: string; reviewsCsv?: string }) {
  const [expanded, setExpanded] = useState(false);
  const [generating, setGenerating] = useState(false);
  const gaps = prop.data_gaps?.filter(g => !g.resolved) || [];
  const reservations = prop.reservations || [];
  const cleaning = prop.cleaning_events || [];
  const bankMatched = reservations.filter(r => r.bank_match_status === 'matched').length;
  const pctMatched = reservations.length > 0 ? Math.round((bankMatched / reservations.length) * 100) : 0;

  function downloadStatement(e: React.MouseEvent) {
    e.stopPropagation();
    const csvParam = reviewsCsv ? `&csv=${btoa(reviewsCsv)}` : '';
    window.open(`/statement?id=${prop.id}&month=${month}${csvParam}`, '_blank');
  }

  return (
    <div className={`bg-white rounded-xl border transition-all duration-200 ${
      expanded ? 'border-gray-200 shadow-md ring-1 ring-gray-100' : 'border-gray-100 hover:border-gray-200 hover:shadow-sm'
    }`}>
      {/* Card Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-6 py-5 flex items-center justify-between group"
      >
        <div className="flex items-center gap-4">
          <ConfidenceIndicator level={prop.confidence} />
          <div className="text-left">
            <div className="flex items-center gap-2">
              <h3 className="text-[15px] font-semibold text-[#1E2E34] tracking-tight">{prop.property_name}</h3>
              {gaps.length > 0 && (
                <span className="bg-amber-50 text-amber-700 text-[10px] font-semibold px-2 py-0.5 rounded-md ring-1 ring-amber-200/60">
                  {gaps.length} gap{gaps.length > 1 ? 's' : ''}
                </span>
              )}
            </div>
            <p className="text-[12px] text-gray-400 mt-0.5">{prop.owner_name} &middot; {prop.management_fee_pct}% management fee</p>
          </div>
        </div>
        <div className="flex items-center gap-8">
          <div className="text-right hidden sm:block">
            <p className="text-[10px] text-gray-400 uppercase tracking-wider font-medium">Revenue</p>
            <p className="text-[14px] font-semibold text-gray-700 tabular-nums mt-0.5">{fmt(prop.rental_revenue)}</p>
          </div>
          <div className="text-right hidden md:block">
            <p className="text-[10px] text-gray-400 uppercase tracking-wider font-medium">Stays</p>
            <p className="text-[14px] font-semibold text-gray-700 tabular-nums mt-0.5">{prop.num_stays}</p>
          </div>
          <div className="text-right hidden md:block">
            <p className="text-[10px] text-gray-400 uppercase tracking-wider font-medium">Cleaning</p>
            <p className="text-[14px] font-semibold text-gray-700 tabular-nums mt-0.5">{fmt(prop.cleaning_total)}</p>
          </div>
          <div className="text-right">
            <p className="text-[10px] text-gray-400 uppercase tracking-wider font-medium">Owner Payout</p>
            <p className="text-[17px] font-bold text-[#1E2E34] tabular-nums mt-0.5">{fmt(prop.owner_payout)}</p>
          </div>
          <IconChevron open={expanded} className="w-5 h-5 text-gray-300 group-hover:text-gray-500" />
        </div>
      </button>

      {/* Expanded Detail */}
      {expanded && (
        <div className="border-t border-gray-100 animate-in">
          {/* Data Sources Bar */}
          <div className="px-6 py-3 bg-gradient-to-r from-gray-50/80 to-transparent flex items-center gap-3">
            <span className="text-[10px] text-gray-400 uppercase tracking-wider font-medium mr-1">Sources</span>
            <DataSourceChip active={prop.has_guesty_statement} label="Guesty" />
            <DataSourceChip active={prop.has_platform_csv} label="Platform" />
            <DataSourceChip active={prop.has_bank_csv} label="Bank" />
            <div className="flex-1" />
            {prop.has_bank_csv && (
              <span className="text-[11px] text-gray-400">
                Bank verified: <span className={`font-semibold ${pctMatched === 100 ? 'text-emerald-600' : pctMatched >= 50 ? 'text-amber-600' : 'text-red-500'}`}>{pctMatched}%</span>
              </span>
            )}
          </div>

          <div className="px-6 py-6 space-y-8">
            {/* Financial Summary */}
            <div className="grid grid-cols-2 gap-8">
              <div>
                <h4 className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-3">Financial Summary</h4>
                <div className="space-y-0">
                  <div className="flex items-center justify-between py-2.5 border-b border-gray-50">
                    <span className="text-[13px] text-gray-500">Gross Revenue</span>
                    <span className="text-[13px] font-medium text-gray-900 tabular-nums">{fmt(prop.rental_revenue)}</span>
                  </div>
                  <div className="flex items-center justify-between py-2.5 border-b border-gray-50">
                    <span className="text-[13px] text-gray-500">Management ({prop.management_fee_pct}%)</span>
                    <span className="text-[13px] font-medium text-red-500 tabular-nums">-{fmt(prop.management_fee)}</span>
                  </div>
                  <div className="flex items-center justify-between py-2.5 border-b border-gray-50">
                    <span className="text-[13px] text-gray-500">Cleaning</span>
                    <span className="text-[13px] font-medium text-red-500 tabular-nums">-{fmt(prop.cleaning_total)}</span>
                  </div>
                  {prop.repairs_total > 0 && (
                    <div className="flex items-center justify-between py-2.5 border-b border-gray-50">
                      <span className="text-[13px] text-gray-500">Repairs</span>
                      <span className="text-[13px] font-medium text-red-500 tabular-nums">-{fmt(prop.repairs_total)}</span>
                    </div>
                  )}
                </div>
                <div className="flex items-center justify-between pt-3 mt-1">
                  <span className="text-[14px] font-bold text-[#1E2E34]">Owner Payout</span>
                  <span className="text-[18px] font-bold text-[#1E2E34] tabular-nums">{fmt(prop.owner_payout)}</span>
                </div>
              </div>

              {/* Quick Stats */}
              <div>
                <h4 className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-3">Performance</h4>
                <div className="grid grid-cols-2 gap-3">
                  <div className="bg-gray-50 rounded-lg p-3 text-center">
                    <p className="text-[20px] font-bold text-[#1E2E34] tabular-nums">{prop.num_stays}</p>
                    <p className="text-[11px] text-gray-400 mt-0.5">Stays</p>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-3 text-center">
                    <p className="text-[20px] font-bold text-[#1E2E34] tabular-nums">{prop.nights_booked}</p>
                    <p className="text-[11px] text-gray-400 mt-0.5">Nights</p>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-3 text-center">
                    <p className="text-[20px] font-bold text-[#C9A84C] tabular-nums">{fmt(prop.management_fee)}</p>
                    <p className="text-[11px] text-gray-400 mt-0.5">Mgmt Fee</p>
                  </div>
                  <div className="bg-gray-50 rounded-lg p-3 text-center">
                    <p className="text-[20px] font-bold tabular-nums text-[#1E2E34]">
                      {prop.nights_booked > 0 ? fmt(prop.rental_revenue / prop.nights_booked) : '$0'}
                    </p>
                    <p className="text-[11px] text-gray-400 mt-0.5">Avg/Night</p>
                  </div>
                </div>
              </div>
            </div>

            {/* Reservations Table */}
            {reservations.length > 0 && (
              <div>
                <h4 className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-3">Reservations</h4>
                <div className="overflow-x-auto rounded-lg border border-gray-100">
                  <table className="w-full text-[12px]">
                    <thead>
                      <tr className="bg-gray-50 text-[10px] text-gray-500 uppercase tracking-wider">
                        <th className="text-left font-medium px-4 py-2.5">Guest</th>
                        <th className="text-left font-medium px-3 py-2.5">Dates</th>
                        <th className="text-center font-medium px-2 py-2.5">Nts</th>
                        <th className="text-center font-medium px-3 py-2.5">Channel</th>
                        <th className="text-right font-medium px-3 py-2.5">Guesty</th>
                        <th className="text-right font-medium px-3 py-2.5">Stripe</th>
                        <th className="text-right font-medium px-3 py-2.5">Net Revenue</th>
                        <th className="text-center font-medium px-4 py-2.5">Bank</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {reservations.map((r) => (
                        <tr key={r.id} className="hover:bg-blue-50/30 transition-colors">
                          <td className="px-4 py-3 font-medium text-gray-900">{r.guest_name}</td>
                          <td className="px-3 py-3 text-gray-500 whitespace-nowrap">{fmtDate(r.check_in)} - {fmtDate(r.check_out)}</td>
                          <td className="px-2 py-3 text-center text-gray-500">{r.nights}</td>
                          <td className="px-3 py-3 text-center"><PlatformBadge platform={r.platform} /></td>
                          <td className="px-3 py-3 text-right text-gray-600 tabular-nums">{fmt(r.guesty_rental_income)}</td>
                          <td className="px-3 py-3 text-right tabular-nums">
                            {r.stripe_fee > 0 ? <span className="text-red-400">-{fmt(r.stripe_fee)}</span> : <span className="text-gray-300">--</span>}
                          </td>
                          <td className="px-3 py-3 text-right font-semibold text-gray-900 tabular-nums">{fmt(r.adjusted_revenue)}</td>
                          <td className="px-4 py-3 text-center">
                            {r.bank_match_status === 'matched' ? (
                              <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-emerald-100 text-emerald-600">
                                <IconCheck className="w-3 h-3" />
                              </span>
                            ) : (
                              <span className="inline-flex items-center justify-center w-5 h-5 rounded-full bg-gray-100 text-gray-400 text-[10px]">--</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="bg-gray-50 text-[11px] font-semibold text-gray-600">
                        <td className="px-4 py-2.5" colSpan={4}>Totals</td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{fmt(reservations.reduce((s, r) => s + r.guesty_rental_income, 0))}</td>
                        <td className="px-3 py-2.5 text-right text-red-400 tabular-nums">
                          {reservations.reduce((s, r) => s + r.stripe_fee, 0) > 0 ? `-${fmt(reservations.reduce((s, r) => s + r.stripe_fee, 0))}` : '--'}
                        </td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{fmt(prop.rental_revenue)}</td>
                        <td className="px-4 py-2.5 text-center text-gray-400">{bankMatched}/{reservations.length}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            )}

            {/* Cleaning Events */}
            {cleaning.length > 0 && (
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider">
                    Cleaning Charges
                  </h4>
                  <span className="text-[12px] font-medium text-gray-500 tabular-nums">{fmt(prop.cleaning_total)} total</span>
                </div>
                <div className="rounded-lg border border-gray-100 divide-y divide-gray-50 overflow-hidden">
                  {cleaning.map((ce) => (
                    <div key={ce.id} className="flex items-center justify-between px-4 py-2.5 text-[12px] hover:bg-gray-50/50 transition-colors">
                      <div className="flex items-center gap-3">
                        <span className="text-gray-400 w-16 tabular-nums text-[11px]">
                          {ce.bank_charge_date ? fmtDate(ce.bank_charge_date) : (ce.checkout_date ? fmtDate(ce.checkout_date) : '--')}
                        </span>
                        <span className={ce.guest_name ? 'text-gray-700 font-medium' : 'text-gray-400 italic'}>
                          {ce.guest_name || (ce.invoice_no ? `Invoice ${ce.invoice_no}` : 'Unmatched charge')}
                        </span>
                        {ce.checkout_date && ce.guest_name && (
                          <span className="text-gray-300 text-[11px]">checkout {fmtDate(ce.checkout_date)}</span>
                        )}
                        {ce.source === 'corroborated' && (
                          <span className="inline-flex items-center gap-1 bg-emerald-50 text-emerald-700 text-[10px] font-semibold px-1.5 py-0.5 rounded ring-1 ring-emerald-200/60">
                            <IconCheck className="w-2.5 h-2.5" /> Verified
                          </span>
                        )}
                        {ce.source === 'invoice' && (
                          <span className="inline-flex items-center gap-1 bg-blue-50 text-blue-700 text-[10px] font-semibold px-1.5 py-0.5 rounded ring-1 ring-blue-200/60">
                            Invoice only
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-3">
                        {ce.invoice_no && <span className="text-gray-300 text-[10px] font-mono">#{ce.invoice_no}</span>}
                        <span className="font-semibold text-gray-700 tabular-nums">{fmt(ce.amount)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Data Gaps */}
            {gaps.length > 0 && (
              <div>
                <h4 className="text-[11px] font-semibold text-amber-600 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                  <IconWarning className="w-3.5 h-3.5" />
                  Data Gaps
                </h4>
                <div className="space-y-2">
                  {gaps.map((gap) => (
                    <div key={gap.id} className={`rounded-lg px-4 py-3 text-[12px] border ${
                      gap.severity === 'critical' ? 'bg-red-50 border-red-100 text-red-700' :
                      gap.severity === 'warning' ? 'bg-amber-50 border-amber-100 text-amber-700' :
                      'bg-gray-50 border-gray-100 text-gray-600'
                    }`}>
                      <p className="font-medium">{gap.description}</p>
                      {gap.expected_data && <p className="text-[11px] opacity-60 mt-1">{gap.expected_data}</p>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center gap-3 pt-2 border-t border-gray-100">
              <button
                onClick={downloadStatement}
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-[#1E2E34] text-white text-[12px] font-medium rounded-lg hover:bg-[#2a3f47] transition-colors shadow-sm"
              >
                <IconDownload className="w-3.5 h-3.5" />
                View Statement
              </button>
              <Link
                href="/upload"
                className="inline-flex items-center gap-2 px-5 py-2.5 border border-gray-200 text-gray-600 text-[12px] font-medium rounded-lg hover:bg-gray-50 transition-colors"
              >
                Re-upload Data
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Main Dashboard ─── */
function DashboardContent() {
  const searchParams = useSearchParams();
  const [period, setPeriod] = useState<StatementPeriod | null>(null);
  const [periods, setPeriods] = useState<{ month: string; status: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedMonth, setSelectedMonth] = useState('');
  const [authenticated, setAuthenticated] = useState(false);
  const [inputCode, setInputCode] = useState('');
  const [authError, setAuthError] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ total: number; matched: number; inserted: number; skipped: number } | null>(null);
  const [reviewsCsv, setReviewsCsv] = useState<string>('');

  const expectedToken = process.env.NEXT_PUBLIC_PORTAL_TOKEN;
  const urlToken = searchParams.get('key');

  useEffect(() => {
    const cookie = document.cookie.split('; ').find(c => c.startsWith('rt_auth='));
    if (cookie && cookie.split('=')[1] === '1') {
      setAuthenticated(true);
      return;
    }
    if (urlToken && urlToken === expectedToken) {
      setAuthenticated(true);
      document.cookie = 'rt_auth=1; path=/; max-age=86400; SameSite=Lax';
    }
    if (!expectedToken) setAuthenticated(true);
  }, [urlToken, expectedToken]);

  const loadPeriod = useCallback(async (month: string) => {
    setLoading(true);
    try {
      const { data: periodData, error: periodError } = await supabase
        .from('statement_periods').select('*').eq('month', month).single();
      if (periodError) throw periodError;

      const { data: props, error: propsError } = await supabase
        .from('property_statements').select('*').eq('period_id', periodData.id).order('property_name');
      if (propsError) throw propsError;

      const enrichedProps = await Promise.all(
        (props || []).map(async (prop: PropertyStatement) => {
          const [resResult, cleanResult, gapResult] = await Promise.all([
            supabase.from('reservations').select('*').eq('property_statement_id', prop.id).order('check_out'),
            supabase.from('cleaning_events').select('*').eq('property_statement_id', prop.id),
            supabase.from('data_gaps').select('*').eq('property_statement_id', prop.id),
          ]);
          return { ...prop, reservations: resResult.data || [], cleaning_events: cleanResult.data || [], data_gaps: gapResult.data || [] };
        })
      );

      setPeriod({ ...periodData, property_statements: enrichedProps });
      setSelectedMonth(month);
    } catch (err) {
      setError('load_failed: ' + (err instanceof Error ? err.message : JSON.stringify(err)));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!authenticated) { setLoading(false); return; }
    (async () => {
      setLoading(true);
      try {
        const { data, error: err } = await supabase
          .from('statement_periods')
          .select('month, status')
          .order('month', { ascending: false })
          .limit(24);
        if (err) throw err;
        if (!data || data.length === 0) { setError('no_data'); setLoading(false); return; }
        setPeriods(data);
        await loadPeriod(selectedMonth || data[0].month);
      } catch (err) {
        setError('load_failed: ' + (err instanceof Error ? err.message : JSON.stringify(err)));
      } finally {
        setLoading(false);
      }
    })();
  }, [authenticated]);

  async function syncInvoices() {
    if (!selectedMonth) return;
    setSyncing(true);
    setSyncResult(null);
    try {
      const res = await fetch('/api/sync-invoices', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ month: selectedMonth }),
      });
      const data = await res.json();
      if (data.success) {
        setSyncResult({ total: data.total_invoices_found, matched: data.matched, inserted: data.inserted, skipped: data.skipped });
        await loadPeriod(selectedMonth);
      } else {
        setSyncResult({ total: 0, matched: 0, inserted: 0, skipped: 0 });
      }
    } catch {
      setSyncResult({ total: 0, matched: 0, inserted: 0, skipped: 0 });
    } finally {
      setSyncing(false);
    }
  }

  /* ─── Login Screen ─── */
  if (!authenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-[#1E2E34] via-[#263940] to-[#1E2E34]">
        <div className="w-full max-w-sm mx-auto px-8">
          <div className="bg-white/[0.03] backdrop-blur-xl rounded-2xl border border-white/10 p-10 shadow-2xl">
            <div className="text-center mb-10">
              {/* Logo mark */}
              <div className="w-14 h-14 bg-gradient-to-br from-[#C9A84C] to-[#B8953D] rounded-xl flex items-center justify-center mx-auto mb-5 shadow-lg shadow-[#C9A84C]/20">
                <svg className="w-7 h-7 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M3 17l6-6 4 4 8-8" strokeLinecap="round" strokeLinejoin="round"/>
                  <path d="M17 7h4v4" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
              <h1 className="text-xl font-bold text-white tracking-tight">Rising Tide</h1>
              <p className="text-white/40 text-[13px] mt-1.5 font-light">Owner Statement Portal</p>
            </div>
            <form onSubmit={(e) => {
              e.preventDefault();
              if (inputCode === expectedToken) {
                setAuthenticated(true);
                setAuthError(false);
                document.cookie = 'rt_auth=1; path=/; max-age=86400; SameSite=Lax';
              } else {
                setAuthError(true);
              }
            }}>
              <input
                type="password"
                placeholder="Enter access code"
                value={inputCode}
                onChange={(e) => { setInputCode(e.target.value); setAuthError(false); }}
                className="w-full px-4 py-3.5 bg-white/[0.06] border border-white/10 rounded-xl text-center text-sm text-white tracking-widest placeholder:text-white/20 focus:border-[#C9A84C]/50 focus:ring-1 focus:ring-[#C9A84C]/30 focus:outline-none transition-colors"
                autoFocus
              />
              {authError && (
                <p className="text-red-400 text-[12px] text-center mt-3">Invalid access code</p>
              )}
              <button type="submit" className="w-full mt-4 bg-gradient-to-r from-[#C9A84C] to-[#B8953D] text-white py-3 rounded-xl text-[13px] font-semibold hover:from-[#D4B35A] hover:to-[#C9A84C] transition-all shadow-lg shadow-[#C9A84C]/20">
                Continue
              </button>
            </form>
          </div>
          <p className="text-center text-white/20 text-[11px] mt-6">Rising Tide STR &middot; Cape Ann MA</p>
        </div>
      </div>
    );
  }

  /* ─── Empty / Error States ─── */
  if (error === 'no_data') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#fafbfc]">
        <div className="text-center max-w-sm mx-auto">
          <div className="w-16 h-16 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-5">
            <svg className="w-8 h-8 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
            </svg>
          </div>
          <h1 className="text-lg font-semibold text-gray-900 mb-2">No statements yet</h1>
          <p className="text-gray-400 text-[13px] mb-6">Upload your first owner statement to get started.</p>
          <Link href="/upload" className="inline-flex items-center gap-2 px-6 py-3 bg-[#1E2E34] text-white rounded-xl text-[13px] font-semibold hover:bg-[#2a3f47] transition-colors shadow-lg shadow-[#1E2E34]/20">
            Upload Data
          </Link>
        </div>
      </div>
    );
  }

  if (error && error.startsWith('load_failed')) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#fafbfc]">
        <div className="text-center max-w-md mx-auto px-6">
          <div className="w-16 h-16 bg-red-50 rounded-2xl flex items-center justify-center mx-auto mb-5">
            <svg className="w-8 h-8 text-red-400" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
            </svg>
          </div>
          <h1 className="text-lg font-semibold text-gray-900 mb-2">Connection Error</h1>
          <p className="text-gray-400 text-[13px]">Could not reach the database. Check your connection and try again.</p>
          <p className="text-red-400 text-[11px] mt-4 break-all font-mono bg-red-50 rounded-lg p-3">{error}</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#fafbfc] gap-3">
        <div className="w-8 h-8 border-2 border-[#1E2E34] border-t-transparent rounded-full animate-spin" />
        <p className="text-gray-400 text-[12px]">Loading statements...</p>
      </div>
    );
  }

  if (!period) return null;

  const props = period.property_statements || [];
  const totalPayout = props.reduce((s, p) => s + p.owner_payout, 0);
  const totalRevenue = props.reduce((s, p) => s + p.rental_revenue, 0);
  const totalMgmt = props.reduce((s, p) => s + p.management_fee, 0);
  const totalCleaning = props.reduce((s, p) => s + p.cleaning_total, 0);
  const totalGaps = props.reduce((s, p) => s + (p.data_gaps?.filter(g => !g.resolved).length || 0), 0);
  const totalStays = props.reduce((s, p) => s + p.num_stays, 0);
  const totalNights = props.reduce((s, p) => s + p.nights_booked, 0);

  return (
    <div className="min-h-screen bg-[#fafbfc]">
      {/* ─── Top Navigation ─── */}
      <header className="bg-[#1E2E34] sticky top-0 z-50 shadow-lg shadow-[#1E2E34]/10">
        <div className="max-w-6xl mx-auto px-8">
          <div className="flex items-center justify-between h-16">
            {/* Left: Brand + Period */}
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 bg-gradient-to-br from-[#C9A84C] to-[#B8953D] rounded-lg flex items-center justify-center shadow-sm">
                  <svg className="w-4 h-4 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M3 17l6-6 4 4 8-8" strokeLinecap="round" strokeLinejoin="round"/>
                    <path d="M17 7h4v4" strokeLinecap="round" strokeLinejoin="round"/>
                  </svg>
                </div>
                <span className="text-white font-semibold text-[15px] tracking-tight">Rising Tide</span>
              </div>
              <div className="w-px h-6 bg-white/10" />
              {periods.length > 1 ? (
                <select
                  value={selectedMonth}
                  onChange={(e) => loadPeriod(e.target.value)}
                  className="bg-white/[0.06] text-white/90 text-[13px] font-medium border border-white/10 rounded-lg px-3 py-1.5 outline-none cursor-pointer hover:bg-white/[0.10] transition-colors appearance-none"
                  style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3E%3Cpath stroke='rgba(255,255,255,0.4)' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3E%3C/svg%3E")`, backgroundRepeat: 'no-repeat', backgroundPosition: 'right 8px center', backgroundSize: '16px', paddingRight: '28px' }}
                >
                  {periods.map(p => (
                    <option key={p.month} value={p.month} className="text-gray-900 bg-white">{monthLabel(p.month)}</option>
                  ))}
                </select>
              ) : (
                <span className="text-white/70 text-[13px] font-medium">{monthLabel(selectedMonth)}</span>
              )}
            </div>

            {/* Right: Actions */}
            <div className="flex items-center gap-2">
              <button
                onClick={syncInvoices}
                disabled={syncing}
                className="inline-flex items-center gap-2 px-4 py-2 bg-[#C9A84C]/15 text-[#C9A84C] text-[12px] font-semibold rounded-lg hover:bg-[#C9A84C]/25 disabled:opacity-50 transition-colors border border-[#C9A84C]/20"
              >
                {syncing ? (
                  <>
                    <div className="w-3.5 h-3.5 border-2 border-[#C9A84C] border-t-transparent rounded-full animate-spin" />
                    Syncing...
                  </>
                ) : (
                  <>
                    <IconSync className="w-3.5 h-3.5" />
                    Sync Invoices
                  </>
                )}
              </button>
              <label className={`inline-flex items-center gap-2 px-4 py-2 text-[12px] font-semibold rounded-lg transition-colors border cursor-pointer ${
                reviewsCsv ? 'bg-emerald-500/15 text-emerald-400 border-emerald-400/20' : 'bg-white/5 text-white/70 border-white/10 hover:bg-white/10'
              }`}>
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                {reviewsCsv ? 'Reviews Loaded' : 'Reviews CSV'}
                <input
                  type="file"
                  accept=".csv"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      const reader = new FileReader();
                      reader.onload = () => setReviewsCsv(reader.result as string);
                      reader.readAsText(file);
                    }
                  }}
                />
              </label>
              <Link href="/upload" className="inline-flex items-center gap-2 px-4 py-2 bg-white/10 text-white/90 text-[12px] font-semibold rounded-lg hover:bg-white/20 transition-colors border border-white/10">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                </svg>
                Upload
              </Link>
            </div>
          </div>
        </div>
      </header>

      {/* ─── KPI Cards ─── */}
      <div className="bg-white border-b border-gray-100">
        <div className="max-w-6xl mx-auto px-8 py-6">
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <KPICard label="Properties" value={String(props.length)} sub={`${totalNights} total nights`} />
            <KPICard label="Stays" value={String(totalStays)} sub={`${props.length > 0 ? (totalStays / props.length).toFixed(1) : 0} avg/property`} />
            <KPICard label="Revenue" value={fmt(totalRevenue)} sub={totalNights > 0 ? `${fmt(totalRevenue / totalNights)}/night avg` : undefined} />
            <KPICard label="Mgmt Fees" value={fmt(totalMgmt)} accent="text-[#C9A84C]" sub={`${totalRevenue > 0 ? ((totalMgmt / totalRevenue) * 100).toFixed(1) : 0}% effective rate`} />
            <KPICard label="Cleaning" value={fmt(totalCleaning)} sub={`${fmt(totalStays > 0 ? totalCleaning / totalStays : 0)} avg/stay`} />
            <KPICard label="Owner Payouts" value={fmt(totalPayout)} accent="text-emerald-600" sub={`${totalRevenue > 0 ? ((totalPayout / totalRevenue) * 100).toFixed(0) : 0}% of revenue`} />
          </div>

          {/* Gaps Alert */}
          {totalGaps > 0 && (
            <div className="mt-4 flex items-center gap-2 text-[12px] text-amber-600 bg-amber-50 rounded-lg px-4 py-2.5 border border-amber-100">
              <IconWarning className="w-4 h-4 shrink-0" />
              <span>{totalGaps} data gap{totalGaps > 1 ? 's' : ''} across {props.filter(p => (p.data_gaps?.filter(g => !g.resolved).length || 0) > 0).length} propert{props.filter(p => (p.data_gaps?.filter(g => !g.resolved).length || 0) > 0).length === 1 ? 'y' : 'ies'} requiring attention</span>
            </div>
          )}
        </div>
      </div>

      {/* ─── Sync Result Toast ─── */}
      {syncResult && (
        <div className="max-w-6xl mx-auto px-8 pt-5">
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl px-5 py-3.5 flex items-center justify-between shadow-sm">
            <div className="flex items-center gap-2.5 text-[13px] text-emerald-700">
              <span className="w-6 h-6 bg-emerald-100 rounded-full flex items-center justify-center shrink-0">
                <IconCheck className="w-3.5 h-3.5 text-emerald-600" />
              </span>
              <span>
                Invoice sync complete: <strong>{syncResult.total}</strong> found, <strong>{syncResult.matched}</strong> matched to bank charges, <strong>{syncResult.inserted}</strong> new, <strong>{syncResult.skipped}</strong> skipped
              </span>
            </div>
            <button onClick={() => setSyncResult(null)} className="text-emerald-400 hover:text-emerald-600 p-1 rounded-lg hover:bg-emerald-100 transition-colors">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
            </button>
          </div>
        </div>
      )}

      {/* ─── Property Cards ─── */}
      <main className="max-w-6xl mx-auto px-8 py-6 space-y-3">
        {props.length === 0 ? (
          <div className="text-center py-20">
            <div className="w-16 h-16 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <svg className="w-8 h-8 text-gray-300" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" />
              </svg>
            </div>
            <p className="text-gray-400 text-[14px]">No properties uploaded for {monthLabel(selectedMonth)}.</p>
            <Link href="/upload" className="inline-flex items-center gap-2 mt-4 text-[#1E2E34] text-[13px] font-semibold hover:underline underline-offset-2">
              Upload statement data
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" /></svg>
            </Link>
          </div>
        ) : (
          props.map((prop) => <PropertyCard key={prop.id} prop={prop} month={selectedMonth} reviewsCsv={reviewsCsv} />)
        )}
      </main>

      {/* ─── Footer ─── */}
      <footer className="border-t border-gray-100 mt-8">
        <div className="max-w-6xl mx-auto px-8 py-4 flex items-center justify-between">
          <p className="text-[11px] text-gray-400">Rising Tide STR &middot; 85 Eastern Ave, Gloucester, MA 01930</p>
          <p className="text-[11px] text-gray-300">Cape Ann MA</p>
        </div>
      </footer>
    </div>
  );
}

export default function Home() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#fafbfc] gap-3">
        <div className="w-8 h-8 border-2 border-[#1E2E34] border-t-transparent rounded-full animate-spin" />
        <p className="text-gray-400 text-[12px]">Loading...</p>
      </div>
    }>
      <DashboardContent />
    </Suspense>
  );
}
