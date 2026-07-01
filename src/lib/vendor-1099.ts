/**
 * 1099 candidate report.
 *
 * Computes YTD payments per vendor across every source of vendor spend
 * Helm tracks today:
 *   - cleaning_events  (Cape Ann Elite, Nor'East Cleaners)
 *   - repair_events    (Ian Drometer, Morris Heating & Air, etc.)
 *   - overhead_expenses (corporate-card + operating-account charges,
 *                        canonicalized by canonicalVendor())
 *
 * Flags anyone over $600 YTD as a 1099 candidate (the IRS 1099-NEC
 * threshold). The W9 itself stays in QuickBooks (system of record);
 * Helm just tracks whether one has been collected so year-end doesn't
 * surprise anyone -- especially relevant now that we're letting the
 * bookkeeper go and the "quietly tracked in someone else's head" path
 * is closing.
 *
 * Vendor matching across sources is by a normalized key (lowercased,
 * trimmed, whitespace collapsed) so spelling variants merge to one row.
 *
 * Resilience: the optional `vendor_w9` table (W9-on-file flag) is read
 * defensively -- if it doesn't exist yet, every row reports
 * w9OnFile=false. The cost data is unaffected.
 */

import { createClient } from '@supabase/supabase-js';
import { canonicalVendor } from '@/lib/overhead-categories';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

export const IRS_1099_THRESHOLD = 600;

export type Vendor1099Row = {
  vendorKey: string;       // normalized key (used for w9 lookup + actions)
  displayName: string;     // best-cased label for the UI
  ytdTotal: number;        // total payments this calendar year
  txnCount: number;
  sources: Array<'cleaning' | 'repairs' | 'overhead'>;
  eligible1099: boolean;   // ytdTotal >= $600
  w9OnFile: boolean;
};

export type Vendor1099Report = {
  year: number;
  rows: Vendor1099Row[];                 // sorted by ytdTotal desc
  totals: {
    vendors: number;
    over600: number;
    over600WithoutW9: number;
    spendOver600: number;
  };
};

function normalize(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}
function round2(n: number): number { return Math.round(n * 100) / 100; }

function inYear(iso: string | null | undefined, y: number): boolean {
  if (!iso) return false;
  return iso.startsWith(String(y) + '-');
}

export async function getVendor1099Report(year?: number): Promise<Vendor1099Report> {
  const y = year || new Date().getUTCFullYear();
  const empty: Vendor1099Report = { year: y, rows: [], totals: { vendors: 0, over600: 0, over600WithoutW9: 0, spendOver600: 0 } };
  if (!supabaseUrl || !supabaseKey) return empty;
  const supabase = createClient(supabaseUrl, supabaseKey);

  type Accum = { displayName: string; total: number; count: number; sources: Set<'cleaning' | 'repairs' | 'overhead'> };
  const by = new Map<string, Accum>();
  const add = (raw: string, amount: number, source: 'cleaning' | 'repairs' | 'overhead') => {
    const name = (raw || '').trim();
    if (!name) return;
    const key = normalize(name);
    if (!key) return;
    const a = by.get(key) || { displayName: name, total: 0, count: 0, sources: new Set() };
    a.total += amount;
    a.count += 1;
    a.sources.add(source);
    // Prefer a more "natural cased" display: pick the longest variant seen,
    // which tends to be the most-complete form (e.g. "Morris Heating & Air"
    // beats "Morris Heating").
    if (name.length > a.displayName.length) a.displayName = name;
    by.set(key, a);
  };

  // 1) cleaning_events (year-filtered by bank_charge_date)
  const { data: cleanRows } = await supabase
    .from('cleaning_events')
    .select('vendor, amount, bank_charge_date, source')
    .gte('bank_charge_date', `${y}-01-01`)
    .lt('bank_charge_date', `${y + 1}-01-01`);
  for (const r of (cleanRows || []) as { vendor: string | null; amount: number | string | null; bank_charge_date: string | null; source: string | null }[]) {
    if (!inYear(r.bank_charge_date, y)) continue;
    // vendor column fallback by source discriminator, for rows written
    // before the vendor migration ran. Order matters: laundry + linen
    // sources must precede the Cape Ann Elite default.
    const vendor = r.vendor
      || (r.source === 'bank-laundry' ? 'Laundry Plus' : null)
      || (r.source === 'bank-linen' ? "Nor'East Cleaners" : null)
      || 'Cape Ann Elite';
    const amt = Math.abs(Number(r.amount) || 0);
    if (amt > 0) add(vendor, amt, 'cleaning');
  }

  // 2) repair_events (vendor_name, year-filtered by bank_charge_date)
  // Tolerates table not existing if the repairs migration hasn't run.
  try {
    const { data: repairRows, error: repairErr } = await supabase
      .from('repair_events')
      .select('vendor_name, bank_charge_amount, bank_charge_date')
      .gte('bank_charge_date', `${y}-01-01`)
      .lt('bank_charge_date', `${y + 1}-01-01`);
    if (!repairErr) {
      for (const r of (repairRows || []) as { vendor_name: string | null; bank_charge_amount: number | string | null; bank_charge_date: string | null }[]) {
        if (!inYear(r.bank_charge_date, y)) continue;
        const amt = Math.abs(Number(r.bank_charge_amount) || 0);
        if (amt > 0 && r.vendor_name) add(r.vendor_name, amt, 'repairs');
      }
    }
  } catch { /* tolerate missing table */ }

  // 3) overhead_expenses -- the corporate-card + operating-account ledger.
  //    canonicalVendor() collapses transaction descriptions to a stable
  //    merchant name (so "AMZN Mktp US*X1Y2Z3..." rolls up to "Amazon").
  //    Page through 1000 at a time -- same cap getOverhead() handles.
  try {
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase
        .from('overhead_expenses')
        .select('description, amount, txn_date')
        .gte('txn_date', `${y}-01-01`)
        .lt('txn_date', `${y + 1}-01-01`)
        .range(from, from + 999);
      if (error) { if (from === 0) break; break; }
      if (!data || data.length === 0) break;
      for (const r of data as { description: string | null; amount: number | string | null; txn_date: string | null }[]) {
        const amt = Math.abs(Number(r.amount) || 0);
        if (amt > 0) {
          const name = canonicalVendor(r.description || '');
          if (name) add(name, amt, 'overhead');
        }
      }
      if (data.length < 1000) break;
    }
  } catch { /* tolerate missing table */ }

  // 4) Overlay w9_on_file -- tolerant of vendor_w9 not existing.
  const w9: Record<string, boolean> = {};
  try {
    const { data: w9Rows, error: w9Err } = await supabase
      .from('vendor_w9')
      .select('vendor_key, on_file');
    if (!w9Err) {
      for (const r of (w9Rows || []) as { vendor_key: string; on_file: boolean }[]) {
        w9[r.vendor_key] = !!r.on_file;
      }
    }
  } catch { /* tolerate missing table */ }

  const rows: Vendor1099Row[] = [];
  for (const [key, a] of by.entries()) {
    rows.push({
      vendorKey: key,
      displayName: a.displayName,
      ytdTotal: round2(a.total),
      txnCount: a.count,
      sources: [...a.sources].sort(),
      eligible1099: a.total >= IRS_1099_THRESHOLD,
      w9OnFile: !!w9[key],
    });
  }
  rows.sort((x, y2) => y2.ytdTotal - x.ytdTotal);

  const over600 = rows.filter(r => r.eligible1099);
  return {
    year: y,
    rows,
    totals: {
      vendors: rows.length,
      over600: over600.length,
      over600WithoutW9: over600.filter(r => !r.w9OnFile).length,
      spendOver600: round2(over600.reduce((s, r) => s + r.ytdTotal, 0)),
    },
  };
}
