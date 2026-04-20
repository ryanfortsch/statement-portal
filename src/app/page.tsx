'use client';

import { useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { supabase, debugInfo } from '@/lib/supabase';
import { Suspense } from 'react';

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

function ConfidenceBadge({ level }: { level: string }) {
  const colors: Record<string, string> = {
    green: 'bg-emerald-100 text-emerald-800 border-emerald-200',
    yellow: 'bg-amber-100 text-amber-800 border-amber-200',
    red: 'bg-red-100 text-red-800 border-red-200',
  };
  const labels: Record<string, string> = {
    green: 'Complete',
    yellow: 'Review Needed',
    red: 'Missing Data',
  };
  return (
    <span className={`text-xs font-medium px-2.5 py-0.5 rounded-full border ${colors[level] || colors.red}`}>
      {labels[level] || 'Unknown'}
    </span>
  );
}

function DataSourceCheck({ label, present }: { label: string; present: boolean }) {
  return (
    <span className={`text-xs px-2 py-0.5 rounded ${present ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-600'}`}>
      {present ? '\u2713' : '\u2717'} {label}
    </span>
  );
}

function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
}

function formatDate(dateStr: string): string {
  if (!dateStr) return '-';
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function PlatformBadge({ platform }: { platform: string }) {
  const colors: Record<string, string> = {
    Airbnb: 'bg-rose-50 text-rose-700',
    HomeAway: 'bg-blue-50 text-blue-700',
    Manual: 'bg-purple-50 text-purple-700',
    'Booking.com': 'bg-indigo-50 text-indigo-700',
  };
  return (
    <span className={`text-xs px-2 py-0.5 rounded ${colors[platform] || 'bg-gray-50 text-gray-700'}`}>
      {platform === 'HomeAway' ? 'VRBO' : platform}
    </span>
  );
}

function PropertyCard({ prop }: { prop: PropertyStatement }) {
  const [expanded, setExpanded] = useState(false);
  const gaps = prop.data_gaps?.filter(g => !g.resolved) || [];

  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-sm overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-6 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors"
      >
        <div className="flex items-center gap-4">
          <div className="text-left">
            <h3 className="text-lg font-semibold text-gray-900">{prop.property_name}</h3>
            <p className="text-sm text-gray-500">{prop.owner_name}</p>
          </div>
          <ConfidenceBadge level={prop.confidence} />
          {gaps.length > 0 && (
            <span className="bg-red-500 text-white text-xs font-bold px-2 py-0.5 rounded-full">
              {gaps.length} gap{gaps.length > 1 ? 's' : ''}
            </span>
          )}
        </div>
        <div className="flex items-center gap-6">
          <div className="text-right">
            <p className="text-sm text-gray-500">Owner Payout</p>
            <p className="text-xl font-bold text-gray-900">{formatCurrency(prop.owner_payout)}</p>
          </div>
          <svg className={`w-5 h-5 text-gray-400 transition-transform ${expanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {expanded && (
        <div className="px-6 pb-6 border-t border-gray-100">
          {/* Data Sources */}
          <div className="flex gap-2 mt-4 mb-4">
            <DataSourceCheck label="Guesty Statement" present={prop.has_guesty_statement} />
            <DataSourceCheck label="Platform CSV" present={prop.has_platform_csv} />
            <DataSourceCheck label="Bank CSV" present={prop.has_bank_csv} />
          </div>

          {/* P&L Summary */}
          <div className="bg-gray-50 rounded-lg p-4 mb-4">
            <h4 className="text-sm font-semibold text-gray-700 mb-2">Statement Summary</h4>
            <div className="space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-gray-600">Rental Revenue ({prop.num_stays} stays, {prop.nights_booked} nights)</span>
                <span className="font-medium">{formatCurrency(prop.rental_revenue)}</span>
              </div>
              <div className="flex justify-between text-red-600">
                <span>Management Fee ({(prop.management_fee_pct * 100).toFixed(0)}%)</span>
                <span>-{formatCurrency(prop.management_fee)}</span>
              </div>
              <div className="flex justify-between text-red-600">
                <span>Cleaning</span>
                <span>-{formatCurrency(prop.cleaning_total)}</span>
              </div>
              {prop.repairs_total > 0 && (
                <div className="flex justify-between text-red-600">
                  <span>Repairs & Maintenance</span>
                  <span>-{formatCurrency(prop.repairs_total)}</span>
                </div>
              )}
              {prop.tax_remittance > 0 && (
                <div className="flex justify-between text-red-600">
                  <span>Tax Remittance</span>
                  <span>-{formatCurrency(prop.tax_remittance)}</span>
                </div>
              )}
              <div className="border-t border-gray-300 pt-1 mt-1 flex justify-between font-bold">
                <span>Owner Payout</span>
                <span>{formatCurrency(prop.owner_payout)}</span>
              </div>
            </div>
          </div>

          {/* Reservations */}
          {prop.reservations && prop.reservations.length > 0 && (
            <div className="mb-4">
              <h4 className="text-sm font-semibold text-gray-700 mb-2">Reservations</h4>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-gray-500 border-b">
                      <th className="pb-2 pr-4">Guest</th>
                      <th className="pb-2 pr-4">Dates</th>
                      <th className="pb-2 pr-4">Nights</th>
                      <th className="pb-2 pr-4">Platform</th>
                      <th className="pb-2 pr-4 text-right">Guesty Income</th>
                      <th className="pb-2 pr-4 text-right">Stripe Fee</th>
                      <th className="pb-2 text-right">Adj. Revenue</th>
                      <th className="pb-2 text-right">Bank</th>
                    </tr>
                  </thead>
                  <tbody>
                    {prop.reservations.map((r) => (
                      <tr key={r.id} className="border-b border-gray-50">
                        <td className="py-2 pr-4 font-medium">{r.guest_name}</td>
                        <td className="py-2 pr-4 text-gray-600">{formatDate(r.check_in)} - {formatDate(r.check_out)}</td>
                        <td className="py-2 pr-4">{r.nights}</td>
                        <td className="py-2 pr-4"><PlatformBadge platform={r.platform} /></td>
                        <td className="py-2 pr-4 text-right">{formatCurrency(r.guesty_rental_income)}</td>
                        <td className="py-2 pr-4 text-right text-red-600">
                          {r.stripe_fee > 0 ? `-${formatCurrency(r.stripe_fee)}` : '-'}
                        </td>
                        <td className="py-2 text-right font-medium">{formatCurrency(r.adjusted_revenue)}</td>
                        <td className="py-2 text-right">
                          {r.bank_match_status === 'matched' ? (
                            <span className="text-emerald-600">{'\u2713'} {formatCurrency(r.bank_deposit_amount || 0)}</span>
                          ) : (
                            <span className="text-amber-500">pending</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="font-bold border-t border-gray-200">
                      <td className="pt-2" colSpan={4}>Total</td>
                      <td className="pt-2 text-right">
                        {formatCurrency(prop.reservations.reduce((s, r) => s + r.guesty_rental_income, 0))}
                      </td>
                      <td className="pt-2 text-right text-red-600">
                        {formatCurrency(prop.reservations.reduce((s, r) => s + r.stripe_fee, 0))}
                      </td>
                      <td className="pt-2 text-right">{formatCurrency(prop.rental_revenue)}</td>
                      <td></td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}

          {/* Cleaning */}
          {prop.cleaning_events && prop.cleaning_events.length > 0 && (
            <div className="mb-4">
              <h4 className="text-sm font-semibold text-gray-700 mb-2">Cleaning (Bank Total: {formatCurrency(prop.cleaning_total)})</h4>
              <div className="space-y-2">
                {prop.cleaning_events.map((ce) => (
                  <div key={ce.id} className="flex items-center justify-between bg-gray-50 rounded px-3 py-2 text-sm">
                    <div>
                      <span className="font-medium">{ce.guest_name || 'Unmatched'}</span>
                      {ce.checkout_date && <span className="text-gray-500 ml-2">checkout {formatDate(ce.checkout_date)}</span>}
                    </div>
                    <div className="flex items-center gap-3">
                      {ce.invoice_no && (
                        <span className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded">
                          Inv #{ce.invoice_no} {ce.invoice_amount ? formatCurrency(ce.invoice_amount) : ''}
                        </span>
                      )}
                      {ce.bank_charge_amount && (
                        <span className="text-xs bg-gray-200 text-gray-700 px-2 py-0.5 rounded">
                          Bank {formatCurrency(ce.bank_charge_amount)}
                        </span>
                      )}
                      <span className={`text-xs px-2 py-0.5 rounded ${
                        ce.source === 'invoice+bank' ? 'bg-emerald-50 text-emerald-700' :
                        ce.source === 'invoice' ? 'bg-blue-50 text-blue-700' :
                        ce.source === 'bank' ? 'bg-gray-100 text-gray-600' :
                        ce.source === 'uploaded' ? 'bg-purple-50 text-purple-700' :
                        'bg-red-50 text-red-600'
                      }`}>
                        {ce.source}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Data Gaps */}
          {gaps.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-red-700 mb-2">Missing Data</h4>
              <div className="space-y-2">
                {gaps.map((gap) => (
                  <div key={gap.id} className={`flex items-center justify-between rounded px-3 py-2 text-sm border ${
                    gap.severity === 'critical' ? 'bg-red-50 border-red-200' : 'bg-amber-50 border-amber-200'
                  }`}>
                    <div>
                      <p className="font-medium">{gap.description}</p>
                      {gap.expected_data && <p className="text-xs text-gray-500 mt-0.5">Needed: {gap.expected_data}</p>}
                    </div>
                    <UploadButton gapId={gap.id} propertyStatementId={prop.id} />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function UploadButton({ gapId, propertyStatementId }: { gapId: string; propertyStatementId: string }) {
  const [uploading, setUploading] = useState(false);
  const [uploaded, setUploaded] = useState(false);

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    try {
      // Upload file to Supabase Storage
      const filePath = `${propertyStatementId}/${Date.now()}_${file.name}`;
      const { error: uploadError } = await supabase.storage
        .from('statement-uploads')
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      // Create upload record
      const { data: uploadData, error: insertError } = await supabase
        .from('statement_uploads')
        .insert({
          property_statement_id: propertyStatementId,
          file_name: file.name,
          file_type: 'invoice',
          file_path: filePath,
          file_size: file.size,
        })
        .select()
        .single();

      if (insertError) throw insertError;

      // Link upload to gap and mark resolved
      await supabase
        .from('data_gaps')
        .update({
          resolved: true,
          resolved_at: new Date().toISOString(),
          upload_id: uploadData.id,
          resolution_note: `Uploaded: ${file.name}`,
        })
        .eq('id', gapId);

      setUploaded(true);
    } catch (err) {
      console.error('Upload failed:', err);
      alert('Upload failed. Please try again.');
    } finally {
      setUploading(false);
    }
  }

  if (uploaded) {
    return <span className="text-xs text-emerald-600 font-medium">{'\u2713'} Uploaded</span>;
  }

  return (
    <label className="cursor-pointer bg-white border border-gray-300 text-gray-700 text-xs font-medium px-3 py-1.5 rounded hover:bg-gray-50 transition-colors">
      {uploading ? 'Uploading...' : 'Upload'}
      <input type="file" className="hidden" onChange={handleUpload} accept=".pdf,.png,.jpg,.jpeg,.csv" disabled={uploading} />
    </label>
  );
}

function DashboardContent() {
  const searchParams = useSearchParams();
  const [period, setPeriod] = useState<StatementPeriod | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedMonth, setSelectedMonth] = useState('');
  const [authenticated, setAuthenticated] = useState(false);
  const [inputCode, setInputCode] = useState('');
  const [authError, setAuthError] = useState(false);

  const expectedToken = process.env.NEXT_PUBLIC_PORTAL_TOKEN;
  const urlToken = searchParams.get('key');

  useEffect(() => {
    // Check URL param first
    if (urlToken && urlToken === expectedToken) {
      setAuthenticated(true);
    }
    // Check if no token is configured (dev mode)
    if (!expectedToken) {
      setAuthenticated(true);
    }
  }, [urlToken, expectedToken]);

  useEffect(() => {
    if (authenticated) {
      loadLatestPeriod();
    } else {
      setLoading(false);
    }
  }, [authenticated]);

  async function loadLatestPeriod() {
    setLoading(true);
    try {
      // Get available periods
      const { data: periods, error: periodsError } = await supabase
        .from('statement_periods')
        .select('*')
        .order('month', { ascending: false })
        .limit(12);

      if (periodsError) throw periodsError;
      if (!periods || periods.length === 0) {
        setError('no_data');
        setLoading(false);
        return;
      }

      const targetMonth = selectedMonth || periods[0].month;
      await loadPeriod(targetMonth);
    } catch (err) {
      console.error(err);
      setError('load_failed: ' + (err instanceof Error ? err.message : JSON.stringify(err)));
    } finally {
      setLoading(false);
    }
  }

  async function loadPeriod(month: string) {
    setLoading(true);
    try {
      // Get the period
      const { data: periodData, error: periodError } = await supabase
        .from('statement_periods')
        .select('*')
        .eq('month', month)
        .single();

      if (periodError) throw periodError;

      // Get property statements
      const { data: props, error: propsError } = await supabase
        .from('property_statements')
        .select('*')
        .eq('period_id', periodData.id)
        .order('property_name');

      if (propsError) throw propsError;

      // Get reservations, cleaning, and gaps for each property
      const enrichedProps = await Promise.all(
        (props || []).map(async (prop: PropertyStatement) => {
          const [resResult, cleanResult, gapResult] = await Promise.all([
            supabase.from('reservations').select('*').eq('property_statement_id', prop.id).order('check_out'),
            supabase.from('cleaning_events').select('*').eq('property_statement_id', prop.id).order('checkout_date'),
            supabase.from('data_gaps').select('*').eq('property_statement_id', prop.id).order('severity'),
          ]);
          return {
            ...prop,
            reservations: resResult.data || [],
            cleaning_events: cleanResult.data || [],
            data_gaps: gapResult.data || [],
          };
        })
      );

      setPeriod({
        ...periodData,
        property_statements: enrichedProps,
      });
      setSelectedMonth(month);
    } catch (err) {
      console.error(err);
      setError('load_failed: ' + (err instanceof Error ? err.message : JSON.stringify(err)));
    } finally {
      setLoading(false);
    }
  }

  if (!authenticated) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="w-full max-w-sm mx-auto px-6">
          <div className="text-center mb-8">
            <h1 className="text-2xl font-bold text-[#1E2E34] mb-1">Rising Tide</h1>
            <p className="text-gray-500 text-sm">Owner Statement Portal</p>
          </div>
          <form onSubmit={(e) => {
            e.preventDefault();
            if (inputCode === expectedToken) {
              setAuthenticated(true);
              setAuthError(false);
            } else {
              setAuthError(true);
            }
          }}>
            <input
              type="password"
              placeholder="Enter access code"
              value={inputCode}
              onChange={(e) => { setInputCode(e.target.value); setAuthError(false); }}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg text-center text-lg tracking-widest focus:outline-none focus:ring-2 focus:ring-[#1E2E34] focus:border-transparent"
              autoFocus
            />
            {authError && (
              <p className="text-red-500 text-sm text-center mt-2">Invalid access code</p>
            )}
            <button
              type="submit"
              className="w-full mt-4 bg-[#1E2E34] text-white py-3 rounded-lg font-medium hover:bg-[#2a3f47] transition-colors"
            >
              Access Portal
            </button>
          </form>
        </div>
      </div>
    );
  }

  if (error === 'no_data') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">No Statement Data</h1>
          <p className="text-gray-500">No statement periods have been created yet.</p>
          <p className="text-gray-400 text-sm mt-4">Portal is connected and ready.</p>
        </div>
      </div>
    );
  }

  if (error && error.startsWith('load_failed')) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center max-w-lg mx-auto px-4">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Connection Error</h1>
          <p className="text-gray-500">Could not connect to the database.</p>
          <p className="text-red-400 text-xs mt-4 break-all">{error}</p>
          <p className="text-gray-300 text-xs mt-2">URL: {debugInfo.url || 'NOT SET'}</p>
          <p className="text-gray-300 text-xs">Key: {debugInfo.keyPrefix}</p>
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#1E2E34] mx-auto mb-4"></div>
          <p className="text-gray-500">Loading statements...</p>
        </div>
      </div>
    );
  }

  if (!period) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">No Statement Data</h1>
          <p className="text-gray-500">No statement periods have been created yet.</p>
          <p className="text-gray-400 text-sm mt-4">Portal is connected and ready.</p>
        </div>
      </div>
    );
  }

  const props = period.property_statements || [];
  const totalPayout = props.reduce((s, p) => s + p.owner_payout, 0);
  const totalRevenue = props.reduce((s, p) => s + p.rental_revenue, 0);
  const totalGaps = props.reduce((s, p) => s + (p.data_gaps?.filter(g => !g.resolved).length || 0), 0);
  const statusLabel: Record<string, string> = { draft: 'Mid-Month Draft', review: 'Under Review', final: 'Final' };

  const monthLabel = new Date(period.month + '-01T00:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' });

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-[#1E2E34] text-white">
        <div className="max-w-6xl mx-auto px-6 py-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold tracking-tight">Rising Tide Statements</h1>
              <p className="text-gray-300 text-sm mt-1">{monthLabel}</p>
            </div>
            <div className="flex items-center gap-4">
              <span className={`text-xs font-medium px-3 py-1 rounded-full ${
                period.status === 'final' ? 'bg-emerald-500' :
                period.status === 'review' ? 'bg-amber-500' :
                'bg-gray-500'
              }`}>
                {statusLabel[period.status] || period.status}
              </span>
            </div>
          </div>

          {/* Summary bar */}
          <div className="grid grid-cols-4 gap-6 mt-6">
            <div>
              <p className="text-gray-400 text-xs uppercase tracking-wide">Properties</p>
              <p className="text-2xl font-bold">{props.length}</p>
            </div>
            <div>
              <p className="text-gray-400 text-xs uppercase tracking-wide">Total Revenue</p>
              <p className="text-2xl font-bold">{formatCurrency(totalRevenue)}</p>
            </div>
            <div>
              <p className="text-gray-400 text-xs uppercase tracking-wide">Total Payouts</p>
              <p className="text-2xl font-bold">{formatCurrency(totalPayout)}</p>
            </div>
            <div>
              <p className="text-gray-400 text-xs uppercase tracking-wide">Data Gaps</p>
              <p className={`text-2xl font-bold ${totalGaps > 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                {totalGaps}
              </p>
            </div>
          </div>
        </div>
      </header>

      {/* Property cards */}
      <main className="max-w-6xl mx-auto px-6 py-6 space-y-4">
        {props.map((prop) => (
          <PropertyCard key={prop.id} prop={prop} />
        ))}
      </main>
    </div>
  );
}

export default function Home() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[#1E2E34]"></div>
      </div>
    }>
      <DashboardContent />
    </Suspense>
  );
}
