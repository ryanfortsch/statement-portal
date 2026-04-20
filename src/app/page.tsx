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
    green: 'bg-emerald-500',
    yellow: 'bg-amber-400',
    red: 'bg-red-500',
  };
  return <span className={`inline-block w-2.5 h-2.5 rounded-full ${colors[level] || colors.red}`} />;
}

function PlatformPill({ platform }: { platform: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    'Airbnb': { label: 'Airbnb', cls: 'bg-rose-50 text-rose-700 border-rose-200' },
    'HomeAway': { label: 'VRBO', cls: 'bg-blue-50 text-blue-700 border-blue-200' },
    'Manual': { label: 'Direct', cls: 'bg-violet-50 text-violet-700 border-violet-200' },
    'Booking.com': { label: 'Booking', cls: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  };
  const p = map[platform] || { label: platform, cls: 'bg-gray-50 text-gray-600 border-gray-200' };
  return <span className={`text-[11px] font-medium px-2 py-0.5 rounded-md border ${p.cls}`}>{p.label}</span>;
}

function PropertyCard({ prop }: { prop: PropertyStatement }) {
  const [expanded, setExpanded] = useState(false);
  const gaps = prop.data_gaps?.filter(g => !g.resolved) || [];
  const reservations = prop.reservations || [];
  const cleaning = prop.cleaning_events || [];

  return (
    <div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
      {/* Card Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-6 py-5 flex items-center justify-between hover:bg-gray-50/50 transition-colors"
      >
        <div className="flex items-center gap-4">
          <ConfidenceDot level={prop.confidence} />
          <div className="text-left">
            <h3 className="text-base font-semibold text-gray-900">{prop.property_name}</h3>
            <p className="text-sm text-gray-400">{prop.owner_name}</p>
          </div>
          {gaps.length > 0 && (
            <span className="bg-red-100 text-red-700 text-[11px] font-semibold px-2 py-0.5 rounded-full">
              {gaps.length} gap{gaps.length > 1 ? 's' : ''}
            </span>
          )}
        </div>
        <div className="flex items-center gap-8">
          <div className="text-right hidden sm:block">
            <p className="text-xs text-gray-400">Revenue</p>
            <p className="text-sm font-semibold text-gray-700">{fmt(prop.rental_revenue)}</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-gray-400">Owner Payout</p>
            <p className="text-lg font-bold text-gray-900">{fmt(prop.owner_payout)}</p>
          </div>
          <svg className={`w-4 h-4 text-gray-300 transition-transform ${expanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {expanded && (
        <div className="border-t border-gray-100">
          {/* Data source indicators */}
          <div className="px-6 py-3 bg-gray-50/50 flex items-center gap-3 text-xs">
            <span className={prop.has_guesty_statement ? 'text-emerald-600' : 'text-red-500'}>
              {prop.has_guesty_statement ? '\u2713' : '\u2717'} Guesty
            </span>
            <span className={prop.has_platform_csv ? 'text-emerald-600' : 'text-red-500'}>
              {prop.has_platform_csv ? '\u2713' : '\u2717'} Platform
            </span>
            <span className={prop.has_bank_csv ? 'text-emerald-600' : 'text-red-500'}>
              {prop.has_bank_csv ? '\u2713' : '\u2717'} Bank
            </span>
          </div>

          <div className="px-6 py-5 space-y-6">
            {/* P&L Summary */}
            <div className="max-w-md">
              <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Statement Summary</h4>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-600">Rental Revenue <span className="text-gray-400">({prop.num_stays} stays, {prop.nights_booked} nights)</span></span>
                  <span className="font-medium text-gray-900">{fmt(prop.rental_revenue)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Management Fee ({prop.management_fee_pct}%)</span>
                  <span className="text-red-600">-{fmt(prop.management_fee)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Cleaning</span>
                  <span className="text-red-600">-{fmt(prop.cleaning_total)}</span>
                </div>
                {prop.repairs_total > 0 && (
                  <div className="flex justify-between">
                    <span className="text-gray-500">Repairs</span>
                    <span className="text-red-600">-{fmt(prop.repairs_total)}</span>
                  </div>
                )}
                <div className="border-t border-gray-200 pt-2 flex justify-between font-semibold">
                  <span className="text-gray-900">Owner Payout</span>
                  <span className="text-gray-900">{fmt(prop.owner_payout)}</span>
                </div>
              </div>
            </div>

            {/* Reservations Table */}
            {reservations.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">Reservations</h4>
                <div className="overflow-x-auto -mx-6">
                  <table className="w-full text-sm min-w-[700px]">
                    <thead>
                      <tr className="text-[11px] text-gray-400 uppercase tracking-wider border-b border-gray-100">
                        <th className="text-left font-medium px-6 py-2">Guest</th>
                        <th className="text-left font-medium px-3 py-2">Dates</th>
                        <th className="text-center font-medium px-3 py-2">Nts</th>
                        <th className="text-left font-medium px-3 py-2">Channel</th>
                        <th className="text-right font-medium px-3 py-2">Guesty</th>
                        <th className="text-right font-medium px-3 py-2">Stripe</th>
                        <th className="text-right font-medium px-3 py-2">Net</th>
                        <th className="text-center font-medium px-6 py-2">Bank</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {reservations.map((r) => (
                        <tr key={r.id} className="hover:bg-gray-50/50 transition-colors">
                          <td className="px-6 py-2.5 font-medium text-gray-900">{r.guest_name}</td>
                          <td className="px-3 py-2.5 text-gray-500 text-xs">{fmtDate(r.check_in)} - {fmtDate(r.check_out)}</td>
                          <td className="px-3 py-2.5 text-center text-gray-500">{r.nights}</td>
                          <td className="px-3 py-2.5"><PlatformPill platform={r.platform} /></td>
                          <td className="px-3 py-2.5 text-right text-gray-600">{fmt(r.guesty_rental_income)}</td>
                          <td className="px-3 py-2.5 text-right text-gray-400">{r.stripe_fee > 0 ? `-${fmt(r.stripe_fee)}` : '--'}</td>
                          <td className="px-3 py-2.5 text-right font-medium text-gray-900">{fmt(r.adjusted_revenue)}</td>
                          <td className="px-6 py-2.5 text-center">
                            {r.bank_match_status === 'matched' ? (
                              <span className="text-emerald-500 text-xs">{'\u2713'}</span>
                            ) : (
                              <span className="text-amber-400 text-xs">--</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-gray-200 text-xs font-semibold text-gray-700">
                        <td className="px-6 py-2" colSpan={4}>Totals</td>
                        <td className="px-3 py-2 text-right">{fmt(reservations.reduce((s, r) => s + r.guesty_rental_income, 0))}</td>
                        <td className="px-3 py-2 text-right text-red-500">{fmt(reservations.reduce((s, r) => s + r.stripe_fee, 0))}</td>
                        <td className="px-3 py-2 text-right">{fmt(prop.rental_revenue)}</td>
                        <td className="px-6 py-2 text-center text-gray-400">
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
                <h4 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">
                  Cleaning <span className="text-gray-300 font-normal">({fmt(prop.cleaning_total)})</span>
                </h4>
                <div className="space-y-1.5">
                  {cleaning.map((ce) => (
                    <div key={ce.id} className="flex items-center justify-between bg-gray-50 rounded-lg px-4 py-2.5 text-sm">
                      <div className="flex items-center gap-3">
                        <span className="text-gray-400 text-xs w-16">{ce.bank_charge_date ? fmtDate(ce.bank_charge_date) : '--'}</span>
                        <span className={ce.guest_name ? 'text-gray-800' : 'text-gray-400 italic'}>{ce.guest_name || 'Unmatched'}</span>
                        {ce.checkout_date && <span className="text-gray-300 text-xs">checkout {fmtDate(ce.checkout_date)}</span>}
                      </div>
                      <span className="font-medium text-gray-800">{fmt(ce.amount)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Data Gaps */}
            {gaps.length > 0 && (
              <div>
                <h4 className="text-xs font-semibold text-red-500 uppercase tracking-wider mb-3">Data Gaps</h4>
                <div className="space-y-2">
                  {gaps.map((gap) => (
                    <div key={gap.id} className={`rounded-lg px-4 py-3 text-sm border ${
                      gap.severity === 'critical' ? 'bg-red-50 border-red-200' :
                      gap.severity === 'warning' ? 'bg-amber-50 border-amber-200' :
                      'bg-gray-50 border-gray-200'
                    }`}>
                      <p className="text-gray-800">{gap.description}</p>
                      {gap.expected_data && <p className="text-xs text-gray-400 mt-1">{gap.expected_data}</p>}
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
    // Check cookie first
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
      <div className="min-h-screen flex items-center justify-center bg-[#F7F8F9]">
        <div className="w-full max-w-sm mx-auto px-6">
          <div className="text-center mb-8">
            <div className="w-12 h-12 bg-[#C9A84C] rounded-lg flex items-center justify-center mx-auto mb-4">
              <span className="text-white font-bold text-lg">RT</span>
            </div>
            <h1 className="text-xl font-bold text-[#1E2E34]">Rising Tide</h1>
            <p className="text-gray-400 text-sm mt-1">Owner Statement Portal</p>
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
              className="w-full px-4 py-3 border border-gray-200 rounded-xl text-center text-lg tracking-widest focus:outline-none focus:ring-2 focus:ring-[#1E2E34] focus:border-transparent bg-white"
              autoFocus
            />
            {authError && <p className="text-red-500 text-sm text-center mt-2">Invalid code</p>}
            <button type="submit" className="w-full mt-4 bg-[#1E2E34] text-white py-3 rounded-xl font-medium hover:bg-[#2a3f47] transition-colors">
              Enter
            </button>
          </form>
        </div>
      </div>
    );
  }

  if (error === 'no_data') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F7F8F9]">
        <div className="text-center">
          <div className="w-16 h-16 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
            <span className="text-2xl text-gray-300">0</span>
          </div>
          <h1 className="text-xl font-bold text-gray-900 mb-1">No Statement Data</h1>
          <p className="text-gray-400 text-sm">Upload your first owner statement to get started.</p>
          <Link href="/upload" className="inline-block mt-6 px-6 py-3 bg-[#1E2E34] text-white rounded-xl font-medium hover:bg-[#2a3f47] transition-colors">
            Upload Statement Data
          </Link>
        </div>
      </div>
    );
  }

  if (error && error.startsWith('load_failed')) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F7F8F9]">
        <div className="text-center max-w-lg mx-auto px-4">
          <h1 className="text-xl font-bold text-gray-900 mb-2">Connection Error</h1>
          <p className="text-gray-400 text-sm">Could not reach the database.</p>
          <p className="text-red-400 text-xs mt-4 break-all font-mono">{error}</p>
          <p className="text-gray-300 text-xs mt-2">URL: {debugInfo.url || 'NOT SET'} | Key: {debugInfo.keyPrefix}</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F7F8F9]">
        <div className="w-6 h-6 border-2 border-[#1E2E34] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!period) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-[#F7F8F9]">
        <div className="text-center">
          <h1 className="text-xl font-bold text-gray-900 mb-1">No Data</h1>
          <p className="text-gray-400 text-sm">No statement periods found.</p>
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
    <div className="min-h-screen bg-[#F7F8F9]">
      {/* Header */}
      <header className="bg-[#1E2E34]">
        <div className="max-w-6xl mx-auto px-6 py-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-[#C9A84C] rounded flex items-center justify-center">
                <span className="text-white font-bold text-sm">RT</span>
              </div>
              <div>
                <h1 className="text-white font-semibold text-lg leading-tight">Owner Statements</h1>
                <div className="flex items-center gap-2 mt-0.5">
                  {periods.length > 1 ? (
                    <select
                      value={selectedMonth}
                      onChange={(e) => loadPeriod(e.target.value)}
                      className="bg-transparent text-gray-400 text-sm border-none outline-none cursor-pointer appearance-none pr-4"
                      style={{ backgroundImage: 'none' }}
                    >
                      {periods.map(p => (
                        <option key={p.month} value={p.month} className="text-gray-900 bg-white">{monthLabel(p.month)}</option>
                      ))}
                    </select>
                  ) : (
                    <span className="text-gray-400 text-sm">{monthLabel(selectedMonth)}</span>
                  )}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <Link href="/upload" className="px-4 py-2 bg-white/10 text-white text-sm rounded-lg hover:bg-white/20 transition-colors">
                Upload Data
              </Link>
            </div>
          </div>
        </div>
      </header>

      {/* Stats bar */}
      <div className="bg-[#1E2E34] border-t border-white/10 pb-6">
        <div className="max-w-6xl mx-auto px-6">
          <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-4">
            <div className="bg-white/5 rounded-xl px-4 py-3">
              <p className="text-gray-500 text-[11px] uppercase tracking-wider">Properties</p>
              <p className="text-white text-xl font-bold mt-0.5">{props.length}</p>
            </div>
            <div className="bg-white/5 rounded-xl px-4 py-3">
              <p className="text-gray-500 text-[11px] uppercase tracking-wider">Stays / Nights</p>
              <p className="text-white text-xl font-bold mt-0.5">{totalStays} / {totalNights}</p>
            </div>
            <div className="bg-white/5 rounded-xl px-4 py-3">
              <p className="text-gray-500 text-[11px] uppercase tracking-wider">Revenue</p>
              <p className="text-white text-xl font-bold mt-0.5">{fmt(totalRevenue)}</p>
            </div>
            <div className="bg-white/5 rounded-xl px-4 py-3">
              <p className="text-gray-500 text-[11px] uppercase tracking-wider">Mgmt Fees</p>
              <p className="text-[#C9A84C] text-xl font-bold mt-0.5">{fmt(totalMgmt)}</p>
            </div>
            <div className="bg-white/5 rounded-xl px-4 py-3">
              <p className="text-gray-500 text-[11px] uppercase tracking-wider">Cleaning</p>
              <p className="text-white text-xl font-bold mt-0.5">{fmt(totalCleaning)}</p>
            </div>
            <div className="bg-white/5 rounded-xl px-4 py-3">
              <p className="text-gray-500 text-[11px] uppercase tracking-wider">Payouts</p>
              <p className="text-emerald-400 text-xl font-bold mt-0.5">{fmt(totalPayout)}</p>
            </div>
          </div>
          {totalGaps > 0 && (
            <div className="mt-3 px-4 py-2 bg-red-500/10 border border-red-500/20 rounded-lg text-red-300 text-xs">
              {totalGaps} data gap{totalGaps > 1 ? 's' : ''} need attention across {props.filter(p => (p.data_gaps?.filter(g => !g.resolved).length || 0) > 0).length} properties
            </div>
          )}
        </div>
      </div>

      {/* Property cards */}
      <main className="max-w-6xl mx-auto px-6 py-6 space-y-3">
        {props.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-gray-400 text-sm">No properties uploaded for this period yet.</p>
            <Link href="/upload" className="inline-block mt-4 text-[#1E2E34] text-sm font-medium underline">
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
      <div className="min-h-screen flex items-center justify-center bg-[#F7F8F9]">
        <div className="w-6 h-6 border-2 border-[#1E2E34] border-t-transparent rounded-full animate-spin" />
      </div>
    }>
      <DashboardContent />
    </Suspense>
  );
}
