'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { supabase, debugInfo } from '@/lib/supabase';
import { Suspense } from 'react';
import Link from 'next/link';

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

function ConfidenceDot({ level }: { level: string }) {
  const colors: Record<string, string> = {
    green: 'bg-emerald-400',
    yellow: 'bg-amber-400',
    red: 'bg-red-400',
  };
  return (
    <span className={`inline-block w-2 h-2 rounded-full ${colors[level] || colors.red}`} />
  );
}

function PlatformPill({ platform }: { platform: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    'Airbnb': { label: 'Airbnb', cls: 'bg-rose-50 text-rose-600 ring-1 ring-rose-200' },
    'HomeAway': { label: 'VRBO', cls: 'bg-sky-50 text-sky-600 ring-1 ring-sky-200' },
    'Manual': { label: 'Direct', cls: 'bg-violet-50 text-violet-600 ring-1 ring-violet-200' },
    'Booking.com': { label: 'Booking', cls: 'bg-indigo-50 text-indigo-600 ring-1 ring-indigo-200' },
  };
  const p = map[platform] || { label: platform, cls: 'bg-gray-50 text-gray-500 ring-1 ring-gray-200' };
  return <span className={`text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full ${p.cls}`}>{p.label}</span>;
}

function StatLine({ label, value, highlight, negative }: { label: string; value: string; highlight?: boolean; negative?: boolean }) {
  return (
    <div className="flex items-center justify-between py-2">
      <span className="text-[13px] text-gray-500">{label}</span>
      <span className={`text-[13px] font-medium tabular-nums ${highlight ? 'text-[#1E2E34] font-semibold' : negative ? 'text-gray-900' : 'text-gray-900'}`}>
        {negative && value !== '$0.00' ? `-${value}` : value}
      </span>
    </div>
  );
}

function PropertyCard({ prop }: { prop: PropertyStatement }) {
  const [expanded, setExpanded] = useState(false);
  const gaps = prop.data_gaps?.filter(g => !g.resolved) || [];
  const reservations = prop.reservations || [];
  const cleaning = prop.cleaning_events || [];

  return (
    <div className={`bg-white rounded-lg border ${expanded ? 'border-gray-200 shadow-sm' : 'border-gray-100'}`}>
      {/* Card Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-5 py-4 flex items-center justify-between hover:bg-gray-50/60"
      >
        <div className="flex items-center gap-3">
          <ConfidenceDot level={prop.confidence} />
          <div className="text-left">
            <h3 className="text-[14px] font-semibold text-[#1E2E34]">{prop.property_name}</h3>
            <p className="text-[12px] text-gray-400 mt-0.5">{prop.owner_name} / {prop.management_fee_pct}% fee</p>
          </div>
          {gaps.length > 0 && (
            <span className="ml-2 bg-amber-50 text-amber-700 text-[10px] font-semibold px-2 py-0.5 rounded-full ring-1 ring-amber-200">
              {gaps.length} gap{gaps.length > 1 ? 's' : ''}
            </span>
          )}
        </div>
        <div className="flex items-center gap-6">
          <div className="text-right hidden sm:block">
            <p className="text-[11px] text-gray-400 uppercase tracking-wider">Revenue</p>
            <p className="text-[13px] font-semibold text-gray-700 tabular-nums">{fmt(prop.rental_revenue)}</p>
          </div>
          <div className="text-right">
            <p className="text-[11px] text-gray-400 uppercase tracking-wider">Payout</p>
            <p className="text-[15px] font-bold text-[#1E2E34] tabular-nums">{fmt(prop.owner_payout)}</p>
          </div>
          <svg className={`w-4 h-4 text-gray-300 ${expanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-gray-100">
          {/* Data sources */}
          <div className="px-5 py-2.5 bg-gray-50/60 flex items-center gap-4 text-[11px]">
            <span className={`flex items-center gap-1 ${prop.has_guesty_statement ? 'text-emerald-600' : 'text-gray-300'}`}>
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/></svg>
              Guesty PDF
            </span>
            <span className={`flex items-center gap-1 ${prop.has_platform_csv ? 'text-emerald-600' : 'text-gray-300'}`}>
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/></svg>
              Platform CSV
            </span>
            <span className={`flex items-center gap-1 ${prop.has_bank_csv ? 'text-emerald-600' : 'text-gray-300'}`}>
              <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/></svg>
              Bank CSV
            </span>
          </div>

          <div className="px-5 py-5 space-y-6">
            {/* P&L Summary */}
            <div className="max-w-sm">
              <h4 className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-1">P&L Summary</h4>
              <div className="divide-y divide-gray-50">
                <StatLine label={`Revenue (${prop.num_stays} stays, ${prop.nights_booked} nights)`} value={fmt(prop.rental_revenue)} />
                <StatLine label={`Management (${prop.management_fee_pct}%)`} value={fmt(prop.management_fee)} negative />
                <StatLine label="Cleaning" value={fmt(prop.cleaning_total)} negative />
                {prop.repairs_total > 0 && <StatLine label="Repairs" value={fmt(prop.repairs_total)} negative />}
              </div>
              <div className="mt-2 pt-2 border-t border-gray-200 flex items-center justify-between">
                <span className="text-[13px] font-semibold text-[#1E2E34]">Owner Payout</span>
                <span className="text-[15px] font-bold text-[#1E2E34] tabular-nums">{fmt(prop.owner_payout)}</span>
              </div>
            </div>

            {/* Reservations */}
            {reservations.length > 0 && (
              <div>
                <h4 className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Reservations</h4>
                <div className="overflow-x-auto -mx-5">
                  <table className="w-full text-[12px] min-w-[680px]">
                    <thead>
                      <tr className="text-[10px] text-gray-400 uppercase tracking-wider border-b border-gray-100">
                        <th className="text-left font-medium px-5 py-2">Guest</th>
                        <th className="text-left font-medium px-3 py-2">Dates</th>
                        <th className="text-center font-medium px-2 py-2">Nts</th>
                        <th className="text-left font-medium px-3 py-2">Channel</th>
                        <th className="text-right font-medium px-3 py-2">Guesty</th>
                        <th className="text-right font-medium px-3 py-2">Stripe</th>
                        <th className="text-right font-medium px-3 py-2">Net</th>
                        <th className="text-center font-medium px-5 py-2">Bank</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reservations.map((r) => (
                        <tr key={r.id} className="border-b border-gray-50 hover:bg-gray-50/50">
                          <td className="px-5 py-2.5 font-medium text-gray-900">{r.guest_name}</td>
                          <td className="px-3 py-2.5 text-gray-500">{fmtDate(r.check_in)} - {fmtDate(r.check_out)}</td>
                          <td className="px-2 py-2.5 text-center text-gray-500">{r.nights}</td>
                          <td className="px-3 py-2.5"><PlatformPill platform={r.platform} /></td>
                          <td className="px-3 py-2.5 text-right text-gray-600 tabular-nums">{fmt(r.guesty_rental_income)}</td>
                          <td className="px-3 py-2.5 text-right text-gray-400 tabular-nums">{r.stripe_fee > 0 ? `-${fmt(r.stripe_fee)}` : '--'}</td>
                          <td className="px-3 py-2.5 text-right font-medium text-gray-900 tabular-nums">{fmt(r.adjusted_revenue)}</td>
                          <td className="px-5 py-2.5 text-center">
                            {r.bank_match_status === 'matched' ? (
                              <span className="text-emerald-500">
                                <svg className="w-3.5 h-3.5 inline" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd"/></svg>
                              </span>
                            ) : (
                              <span className="text-gray-300">--</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-gray-200 text-[11px] font-semibold text-gray-600">
                        <td className="px-5 py-2" colSpan={4}>Totals</td>
                        <td className="px-3 py-2 text-right tabular-nums">{fmt(reservations.reduce((s, r) => s + r.guesty_rental_income, 0))}</td>
                        <td className="px-3 py-2 text-right text-red-400 tabular-nums">{fmt(reservations.reduce((s, r) => s + r.stripe_fee, 0))}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{fmt(prop.rental_revenue)}</td>
                        <td className="px-5 py-2 text-center text-gray-400">
                          {reservations.filter(r => r.bank_match_status === 'matched').length}/{reservations.length}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            )}

            {/* Cleaning */}
            {cleaning.length > 0 && (
              <div>
                <h4 className="text-[11px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
                  Cleaning Charges <span className="text-gray-300 font-normal normal-case">({fmt(prop.cleaning_total)} total)</span>
                </h4>
                <div className="space-y-1">
                  {cleaning.map((ce) => (
                    <div key={ce.id} className="flex items-center justify-between bg-gray-50/80 rounded px-4 py-2 text-[12px]">
                      <div className="flex items-center gap-3">
                        <span className="text-gray-400 w-14 tabular-nums">{ce.bank_charge_date ? fmtDate(ce.bank_charge_date) : '--'}</span>
                        <span className={ce.guest_name ? 'text-gray-700' : 'text-gray-400 italic'}>{ce.guest_name || 'Unmatched'}</span>
                        {ce.checkout_date && <span className="text-gray-300 text-[11px]">out {fmtDate(ce.checkout_date)}</span>}
                      </div>
                      <span className="font-medium text-gray-700 tabular-nums">{fmt(ce.amount)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Data Gaps */}
            {gaps.length > 0 && (
              <div>
                <h4 className="text-[11px] font-semibold text-amber-600 uppercase tracking-wider mb-2">Data Gaps</h4>
                <div className="space-y-1.5">
                  {gaps.map((gap) => (
                    <div key={gap.id} className={`rounded px-4 py-2.5 text-[12px] ${
                      gap.severity === 'critical' ? 'bg-red-50 text-red-700' :
                      gap.severity === 'warning' ? 'bg-amber-50 text-amber-700' :
                      'bg-gray-50 text-gray-600'
                    }`}>
                      <p>{gap.description}</p>
                      {gap.expected_data && <p className="text-[11px] opacity-60 mt-0.5">{gap.expected_data}</p>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

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

  useEffect(() => {
    if (authenticated) loadPeriods();
    else setLoading(false);
  }, [authenticated]);

  async function loadPeriods() {
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
  }

  async function loadPeriod(month: string) {
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
  }

  // Login screen
  if (!authenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f8f9fa]">
        <div className="w-full max-w-xs mx-auto px-6">
          <div className="text-center mb-10">
            <div className="w-10 h-10 bg-[#1E2E34] rounded-lg flex items-center justify-center mx-auto mb-5">
              <svg className="w-5 h-5 text-[#C9A84C]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 17l6-6 4 4 8-8" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M17 7h4v4" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </div>
            <h1 className="text-lg font-semibold text-[#1E2E34] tracking-tight">Rising Tide</h1>
            <p className="text-gray-400 text-[13px] mt-1">Owner Statement Portal</p>
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
              placeholder="Access code"
              value={inputCode}
              onChange={(e) => { setInputCode(e.target.value); setAuthError(false); }}
              className="w-full px-4 py-3 border border-gray-200 rounded-lg text-center text-sm tracking-widest focus:border-[#1E2E34] bg-white placeholder:text-gray-300"
              autoFocus
            />
            {authError && <p className="text-red-500 text-[12px] text-center mt-2">Invalid code</p>}
            <button type="submit" className="w-full mt-3 bg-[#1E2E34] text-white py-2.5 rounded-lg text-[13px] font-medium hover:bg-[#2a3f47]">
              Continue
            </button>
          </form>
        </div>
      </div>
    );
  }

  if (error === 'no_data') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f8f9fa]">
        <div className="text-center">
          <p className="text-gray-300 text-5xl font-light mb-4">0</p>
          <h1 className="text-base font-semibold text-gray-900 mb-1">No statements yet</h1>
          <p className="text-gray-400 text-[13px]">Upload your first owner statement to get started.</p>
          <Link href="/upload" className="inline-block mt-5 px-5 py-2.5 bg-[#1E2E34] text-white rounded-lg text-[13px] font-medium hover:bg-[#2a3f47]">
            Upload Data
          </Link>
        </div>
      </div>
    );
  }

  if (error && error.startsWith('load_failed')) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f8f9fa]">
        <div className="text-center max-w-md mx-auto px-4">
          <h1 className="text-base font-semibold text-gray-900 mb-2">Connection Error</h1>
          <p className="text-gray-400 text-[13px]">Could not reach the database.</p>
          <p className="text-red-400 text-[11px] mt-4 break-all font-mono">{error}</p>
          <p className="text-gray-300 text-[11px] mt-2">URL: {debugInfo.url || 'NOT SET'} | Key: {debugInfo.keyPrefix}</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f8f9fa]">
        <div className="w-5 h-5 border-2 border-[#1E2E34] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!period) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#f8f9fa]">
        <div className="text-center">
          <h1 className="text-base font-semibold text-gray-900 mb-1">No Data</h1>
          <p className="text-gray-400 text-[13px]">No statement periods found.</p>
        </div>
      </div>
    );
  }

  const props = period.property_statements || [];
  const totalPayout = props.reduce((s, p) => s + p.owner_payout, 0);
  const totalRevenue = props.reduce((s, p) => s + p.rental_revenue, 0);
  const totalMgmt = props.reduce((s, p) => s + p.management_fee, 0);
  const totalCleaning = props.reduce((s, p) => s + p.cleaning_total, 0);
  const totalGaps = props.reduce((s, p) => s + (p.data_gaps?.filter(g => !g.resolved).length || 0), 0);
  const totalStays = props.reduce((s, p) => s + p.num_stays, 0);
  const totalNights = props.reduce((s, p) => s + p.nights_booked, 0);

  return (
    <div className="min-h-screen bg-[#f8f9fa]">
      {/* Header */}
      <header className="bg-[#1E2E34] sticky top-0 z-50">
        <div className="max-w-5xl mx-auto px-6">
          <div className="flex items-center justify-between h-14">
            <div className="flex items-center gap-3">
              <svg className="w-5 h-5 text-[#C9A84C]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M3 17l6-6 4 4 8-8" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M17 7h4v4" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              <span className="text-white/90 font-medium text-[14px]">Rising Tide</span>
              <span className="text-white/30 mx-1">/</span>
              {periods.length > 1 ? (
                <select
                  value={selectedMonth}
                  onChange={(e) => loadPeriod(e.target.value)}
                  className="bg-transparent text-white/70 text-[13px] border-none outline-none cursor-pointer appearance-none hover:text-white"
                >
                  {periods.map(p => (
                    <option key={p.month} value={p.month} className="text-gray-900 bg-white">{monthLabel(p.month)}</option>
                  ))}
                </select>
              ) : (
                <span className="text-white/70 text-[13px]">{monthLabel(selectedMonth)}</span>
              )}
            </div>
            <Link href="/upload" className="px-3.5 py-1.5 bg-white/10 text-white/80 text-[12px] font-medium rounded-md hover:bg-white/20 hover:text-white">
              Upload
            </Link>
          </div>
        </div>
      </header>

      {/* Summary stats */}
      <div className="bg-white border-b border-gray-100">
        <div className="max-w-5xl mx-auto px-6 py-4">
          <div className="flex items-center gap-8 overflow-x-auto">
            <div>
              <p className="text-[10px] text-gray-400 uppercase tracking-wider font-medium">Properties</p>
              <p className="text-[18px] font-bold text-[#1E2E34] tabular-nums mt-0.5">{props.length}</p>
            </div>
            <div className="w-px h-8 bg-gray-100" />
            <div>
              <p className="text-[10px] text-gray-400 uppercase tracking-wider font-medium">Stays</p>
              <p className="text-[18px] font-bold text-[#1E2E34] tabular-nums mt-0.5">{totalStays}</p>
            </div>
            <div className="w-px h-8 bg-gray-100" />
            <div>
              <p className="text-[10px] text-gray-400 uppercase tracking-wider font-medium">Revenue</p>
              <p className="text-[18px] font-bold text-[#1E2E34] tabular-nums mt-0.5">{fmt(totalRevenue)}</p>
            </div>
            <div className="w-px h-8 bg-gray-100" />
            <div>
              <p className="text-[10px] text-gray-400 uppercase tracking-wider font-medium">Mgmt Fees</p>
              <p className="text-[18px] font-bold text-[#C9A84C] tabular-nums mt-0.5">{fmt(totalMgmt)}</p>
            </div>
            <div className="w-px h-8 bg-gray-100" />
            <div>
              <p className="text-[10px] text-gray-400 uppercase tracking-wider font-medium">Cleaning</p>
              <p className="text-[18px] font-bold text-[#1E2E34] tabular-nums mt-0.5">{fmt(totalCleaning)}</p>
            </div>
            <div className="w-px h-8 bg-gray-100" />
            <div>
              <p className="text-[10px] text-gray-400 uppercase tracking-wider font-medium">Owner Payouts</p>
              <p className="text-[18px] font-bold text-emerald-600 tabular-nums mt-0.5">{fmt(totalPayout)}</p>
            </div>
          </div>
          {totalGaps > 0 && (
            <div className="mt-3 flex items-center gap-2 text-[12px] text-amber-600">
              <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20"><path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd"/></svg>
              {totalGaps} data gap{totalGaps > 1 ? 's' : ''} across {props.filter(p => (p.data_gaps?.filter(g => !g.resolved).length || 0) > 0).length} properties
            </div>
          )}
        </div>
      </div>

      {/* Property cards */}
      <main className="max-w-5xl mx-auto px-6 py-5 space-y-2">
        {props.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-gray-400 text-[13px]">No properties uploaded for this period.</p>
            <Link href="/upload" className="inline-block mt-3 text-[#1E2E34] text-[13px] font-medium underline underline-offset-2">
              Upload statement data
            </Link>
          </div>
        ) : (
          props.map((prop) => <PropertyCard key={prop.id} prop={prop} />)
        )}
      </main>
    </div>
  );
}

export default function Home() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-[#f8f9fa]">
        <div className="w-5 h-5 border-2 border-[#1E2E34] border-t-transparent rounded-full animate-spin" />
      </div>
    }>
      <DashboardContent />
    </Suspense>
  );
}
