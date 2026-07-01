/**
 * Cost Analysis data layer (Financials > Cost Analysis tab).
 *
 * Per-property operating cost -- the cost to run each property, broken
 * into cleaning (Cape Ann Elite), linens (Nor'East Cleaners), and
 * repairs -- per property per month, normalized per turnover so trends
 * and a before/after read are apples-to-apples.
 *
 * "Operating cost" here is the property-level pass-through service cost
 * (cleaning + linens + repairs). It is NOT Rising Tide's own overhead
 * (insurance, legal, software, marketing) -- that lives in QuickBooks /
 * the corporate accounts and is a separate, later phase. Management fee
 * is excluded too: it's RT revenue, not a cost.
 *
 * Sources, per (property, month):
 *   - property_statements.cleaning_total  -> cleaning + linens (authoritative)
 *   - property_statements.repairs_total   -> repairs
 *   - property_statements.num_stays       -> turnovers (the per-turn denominator)
 *   - cleaning_events                     -> the cleaning-vs-linen split, via
 *                                            the vendor / source columns
 *
 * Resilience: cleaning_events is read with select('*') and the linen
 * subset is detected by vendor === "Nor'East Cleaners" OR
 * source === 'bank-linen'. Works whether or not the cleaning_events.vendor
 * migration has run -- before it does, linens read as 0 and cleaning
 * absorbs the full cleaning_total, which is still correct; the split just
 * populates once the data is tagged.
 */

import { createClient } from '@supabase/supabase-js';
import { LINEN_VENDOR_NAME, LAUNDRY_VENDOR_NAME } from '@/lib/bank-charges';
import { canonicalVendor } from '@/lib/overhead-categories';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

export type CostCell = {
  propertyId: string;
  propertyName: string;
  month: string; // YYYY-MM
  turnovers: number;
  cleaning: number; // Cape Ann Elite
  linens: number; // Nor'East
  laundry: number; // Laundry Plus
  repairs: number; // repairs_total
  operating: number; // cleaning + linens + laundry + repairs
  operatingPerTurn: number | null;
};

export type MonthTotal = {
  cleaning: number;
  linens: number;
  laundry: number;
  repairs: number;
  operating: number;
  turnovers: number;
  operatingPerTurn: number | null;
};

export type CostAnalysis = {
  months: string[]; // sorted ascending
  properties: { id: string; name: string }[];
  cells: CostCell[];
  byMonth: Record<string, MonthTotal>;
  /** True once any linen (Nor'East) cost has been tagged in the data --
   *  lets the UI show a "re-ingest to populate the split" hint when false. */
  hasLinenData: boolean;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export async function getCostAnalysis(): Promise<CostAnalysis> {
  const empty: CostAnalysis = { months: [], properties: [], cells: [], byMonth: {}, hasLinenData: false };
  if (!supabaseUrl || !supabaseKey) return empty;
  const supabase = createClient(supabaseUrl, supabaseKey);

  // Periods -> month lookup.
  const { data: periods } = await supabase
    .from('statement_periods')
    .select('id, month')
    .order('month');
  if (!periods || periods.length === 0) return empty;
  const monthById = new Map<string, string>();
  for (const p of periods) monthById.set(p.id as string, p.month as string);

  // Statements: cleaning + repairs + turnover figures.
  const { data: stmts } = await supabase
    .from('property_statements')
    .select('id, property_id, property_name, num_stays, cleaning_total, repairs_total, period_id');
  if (!stmts || stmts.length === 0) return empty;

  // Cleaning events: select('*') so a missing vendor column never errors.
  const stmtIds = stmts.map(s => s.id as string);
  const linenByStmt = new Map<string, number>();
  const laundryByStmt = new Map<string, number>();
  let hasLinenData = false;
  if (stmtIds.length > 0) {
    const { data: events } = await supabase
      .from('cleaning_events')
      .select('*')
      .in('property_statement_id', stmtIds);
    for (const e of (events || []) as Record<string, unknown>[]) {
      const sid = e.property_statement_id as string;
      const amt = Number(e.amount) || 0;
      const isLinen = e.vendor === LINEN_VENDOR_NAME || e.source === 'bank-linen';
      const isLaundry = e.vendor === LAUNDRY_VENDOR_NAME || e.source === 'bank-laundry';
      if (isLinen) {
        linenByStmt.set(sid, (linenByStmt.get(sid) || 0) + amt);
        if (amt > 0) hasLinenData = true;
      } else if (isLaundry) {
        laundryByStmt.set(sid, (laundryByStmt.get(sid) || 0) + amt);
      }
    }
  }

  const cells: CostCell[] = [];
  const propsSeen = new Map<string, string>();
  const monthsSeen = new Set<string>();

  for (const s of stmts) {
    const month = monthById.get(s.period_id as string);
    if (!month) continue;
    const propertyId = s.property_id as string;
    const propertyName = (s.property_name as string) || propertyId;
    const turnovers = Number(s.num_stays) || 0;
    const cleaningTotal = round2(Number(s.cleaning_total) || 0); // cleaning + linens + laundry
    const repairs = round2(Number(s.repairs_total) || 0);
    const linens = round2(linenByStmt.get(s.id as string) || 0);
    const laundry = round2(laundryByStmt.get(s.id as string) || 0);
    const cleaning = round2(cleaningTotal - linens - laundry);
    const operating = round2(cleaningTotal + repairs);
    cells.push({
      propertyId,
      propertyName,
      month,
      turnovers,
      cleaning,
      linens,
      laundry,
      repairs,
      operating,
      operatingPerTurn: turnovers > 0 ? round2(operating / turnovers) : null,
    });
    propsSeen.set(propertyId, propertyName);
    monthsSeen.add(month);
  }

  const byMonth: Record<string, MonthTotal> = {};
  for (const m of monthsSeen) {
    const mc = cells.filter(c => c.month === m);
    const cleaning = round2(mc.reduce((s, c) => s + c.cleaning, 0));
    const linens = round2(mc.reduce((s, c) => s + c.linens, 0));
    const laundry = round2(mc.reduce((s, c) => s + c.laundry, 0));
    const repairs = round2(mc.reduce((s, c) => s + c.repairs, 0));
    const operating = round2(mc.reduce((s, c) => s + c.operating, 0));
    const turnovers = mc.reduce((s, c) => s + c.turnovers, 0);
    byMonth[m] = {
      cleaning,
      linens,
      laundry,
      repairs,
      operating,
      turnovers,
      operatingPerTurn: turnovers > 0 ? round2(operating / turnovers) : null,
    };
  }

  return {
    months: [...monthsSeen].sort(),
    properties: [...propsSeen.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
    cells,
    byMonth,
    hasLinenData,
  };
}

/**
 * Same-property apples-to-apples comparison of operating cost between two
 * months. Only properties with a statement in BOTH months are included
 * (so the averages reflect the same set). Returns per-property rows plus
 * the two headline averages: per property and per turnover.
 */
export type SamePropertyComparison = {
  monthA: string;
  monthB: string;
  rows: {
    propertyId: string;
    propertyName: string;
    aOperating: number; aTurns: number;
    bOperating: number; bTurns: number;
  }[];
  avg: {
    aPerProperty: number; bPerProperty: number;
    aPerTurn: number | null; bPerTurn: number | null;
  };
};

/* --------------------------------------------------------------------- */
/* Rising Tide overhead (corporate card + operating account)             */
/* --------------------------------------------------------------------- */

/** One charge, for the deepest drill-down level. */
export type OverheadTxn = { date: string; description: string; amount: number; account: string };
/** A merchant within a category: its total, count, per-month spend, and the
 *  charges behind it. `total`/`count` are all-time; `byMonth` lets the UI sum
 *  over whatever window it shows. */
export type OverheadVendor = { vendor: string; total: number; count: number; byMonth: Record<string, number>; txns: OverheadTxn[] };
/** A category with its vendor breakdown, for click-to-expand. */
export type OverheadCategoryDetail = { category: string; total: number; count: number; vendors: OverheadVendor[] };
/** A factual readout of a notable / recurring cost -- no advice, no
 *  extrapolation. Just the real amount and what it is. */
export type OverheadInsight = {
  id: string;
  title: string;
  amount: number;     // actual total over the period (not annualized)
  timeframe: string;  // short factual qualifier, e.g. "23 tools", "242 orders"
  detail: string;     // plain factual context
};

export type OverheadAnalysis = {
  months: string[]; // sorted ascending
  currentMonth: string; // YYYY-MM for "now" -- the last data month is partial when it equals this
  categories: string[]; // categories present, by total desc
  byMonthCategory: Record<string, Record<string, number>>; // month -> category -> amount
  byMonthTotal: Record<string, number>;
  categoryTotals: Record<string, number>; // category -> all-time total
  total: number; // all-time grand total
  detail: OverheadCategoryDetail[]; // category -> vendors -> txns, totals desc
  insights: OverheadInsight[]; // factual notable-cost readouts
  latestTxnDate: string | null; // most recent transaction date, for the "data through X" nudge
  daysSinceLatest: number | null; // computed here (not in render) so the client control stays pure
  hasData: boolean;
};

type OverheadRow = { month: string; category: string; amount: number; txn_date: string | null; description: string; account: string };

/**
 * Pull categorized overhead from overhead_expenses (populated by
 * /api/ingest-overhead). Resilient to the table not existing yet
 * (migration unrun) -- returns empty so the UI shows an upload prompt.
 *
 * Returns aggregates for the headline view PLUS a full category -> vendor ->
 * transaction tree for the dashboard drill-down, and a set of proactive
 * insights (overlapping subscriptions, fast-rising categories, etc.).
 */
export async function getOverhead(): Promise<OverheadAnalysis> {
  const empty: OverheadAnalysis = {
    months: [], currentMonth: new Date(Date.now()).toISOString().slice(0, 7),
    categories: [], byMonthCategory: {}, byMonthTotal: {}, categoryTotals: {},
    total: 0, detail: [], insights: [], latestTxnDate: null, daysSinceLatest: null, hasData: false,
  };
  if (!supabaseUrl || !supabaseKey) return empty;
  const supabase = createClient(supabaseUrl, supabaseKey);

  // Page through all rows (Supabase caps a single select at 1000).
  const rows: OverheadRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from('overhead_expenses')
      .select('month, category, amount, txn_date, description, account')
      .order('txn_date', { ascending: false })
      .range(from, from + 999);
    if (error) { if (rows.length === 0) return empty; break; }
    if (!data || data.length === 0) break;
    rows.push(...(data as OverheadRow[]));
    if (data.length < 1000) break;
  }
  if (rows.length === 0) return empty;

  const byMonthCategory: Record<string, Record<string, number>> = {};
  const byMonthTotal: Record<string, number> = {};
  const catTotals: Record<string, number> = {};
  let latestTxnDate: string | null = null;

  // category -> vendor -> accumulator
  const vendorAcc: Record<string, Record<string, OverheadVendor>> = {};

  for (const r of rows) {
    const m = r.month;
    const cat = r.category;
    const amt = Number(r.amount) || 0;
    if (!m) continue;
    (byMonthCategory[m] ||= {});
    byMonthCategory[m][cat] = round2((byMonthCategory[m][cat] || 0) + amt);
    byMonthTotal[m] = round2((byMonthTotal[m] || 0) + amt);
    catTotals[cat] = round2((catTotals[cat] || 0) + amt);
    if (r.txn_date && (!latestTxnDate || r.txn_date > latestTxnDate)) latestTxnDate = r.txn_date;

    const vendor = canonicalVendor(r.description || '');
    (vendorAcc[cat] ||= {});
    const v = (vendorAcc[cat][vendor] ||= { vendor, total: 0, count: 0, byMonth: {}, txns: [] });
    v.total = round2(v.total + amt);
    v.count += 1;
    v.byMonth[m] = round2((v.byMonth[m] || 0) + amt);
    v.txns.push({ date: r.txn_date || '', description: r.description || '', amount: round2(amt), account: r.account });
  }

  // Assemble the sorted detail tree.
  const detail: OverheadCategoryDetail[] = Object.keys(catTotals)
    .map(cat => {
      const vendors = Object.values(vendorAcc[cat] || {})
        .map(v => ({ ...v, txns: v.txns.sort((a, b) => (a.date < b.date ? 1 : -1)) }))
        .sort((a, b) => b.total - a.total);
      return {
        category: cat,
        total: round2(catTotals[cat]),
        count: vendors.reduce((s, v) => s + v.count, 0),
        vendors,
      };
    })
    .sort((a, b) => b.total - a.total);

  const months = Object.keys(byMonthTotal).sort();
  const total = round2(Object.values(catTotals).reduce((s, v) => s + v, 0));
  const insights = computeOverheadInsights(detail);

  const daysSinceLatest = latestTxnDate
    ? Math.floor((Date.now() - Date.parse(latestTxnDate + 'T00:00:00')) / 86400000)
    : null;

  return {
    months,
    currentMonth: new Date(Date.now()).toISOString().slice(0, 7),
    categories: Object.keys(catTotals).sort((a, b) => catTotals[b] - catTotals[a]),
    byMonthCategory,
    byMonthTotal,
    categoryTotals: catTotals,
    total,
    detail,
    insights,
    latestTxnDate,
    daysSinceLatest,
    hasData: true,
  };
}

/**
 * Notable / recurring costs -- a factual readout, not advice. Each entry is
 * the real total over the period with a plain description. No trends are
 * inferred (lumpy annual bills like insurance would create false ones) and
 * nothing is annualized or editorialized. The dashboard shows these so the
 * biggest recurring commitments are visible without hunting through the tree.
 */
function computeOverheadInsights(detail: OverheadCategoryDetail[]): OverheadInsight[] {
  const out: OverheadInsight[] = [];
  const findVendor = (name: string): OverheadVendor | undefined => {
    for (const c of detail) {
      const v = c.vendors.find(v => v.vendor === name);
      if (v) return v;
    }
    return undefined;
  };
  const byCat = (cat: string) => detail.find(c => c.category === cat);

  // Recurring software subscriptions -- the genuinely recurring, reducible set.
  const sw = byCat('Software');
  if (sw && sw.total > 0) {
    out.push({
      id: 'software',
      title: 'Software subscriptions',
      amount: sw.total,
      timeframe: `${sw.vendors.length} tools`,
      detail: sw.vendors.slice(0, 5).map(v => v.vendor).join(', ') + (sw.vendors.length > 5 ? ', …' : ''),
    });
  }

  // AI tools, called out as their own line within software.
  const aiVendors = ['OpenAI', 'Anthropic', 'Cursor', 'Lovable', 'Runway']
    .map(findVendor).filter(Boolean) as OverheadVendor[];
  if (aiVendors.length >= 2) {
    out.push({
      id: 'ai-tools',
      title: 'AI tools',
      amount: aiVendors.reduce((s, v) => s + v.total, 0),
      timeframe: `${aiVendors.length} services`,
      detail: aiVendors.map(v => v.vendor).join(', '),
    });
  }

  // GEICO auto on the corporate card -- stated as a fact (it is vehicle, not
  // property, insurance), no recommendation attached.
  const geico = findVendor('GEICO (auto)');
  if (geico) {
    out.push({
      id: 'geico',
      title: 'Auto insurance (GEICO)',
      amount: geico.total,
      timeframe: 'on the card',
      detail: 'Vehicle insurance running through the corporate card (separate from property coverage).',
    });
  }

  // Amazon -- the second-largest spend area, stated plainly.
  const amzn = findVendor('Amazon');
  if (amzn) {
    out.push({
      id: 'amazon',
      title: 'Amazon',
      amount: amzn.total,
      timeframe: `${amzn.count} orders`,
      detail: 'Guest supplies and small furnishings.',
    });
  }

  return out.sort((a, b) => b.amount - a.amount);
}

export function compareSameProperties(ca: CostAnalysis, monthA: string, monthB: string): SamePropertyComparison {
  const aByProp = new Map(ca.cells.filter(c => c.month === monthA).map(c => [c.propertyId, c]));
  const bByProp = new Map(ca.cells.filter(c => c.month === monthB).map(c => [c.propertyId, c]));
  const rows: SamePropertyComparison['rows'] = [];
  for (const [pid, a] of aByProp) {
    const b = bByProp.get(pid);
    if (!b) continue; // must exist in both months
    rows.push({
      propertyId: pid,
      propertyName: a.propertyName,
      aOperating: a.operating, aTurns: a.turnovers,
      bOperating: b.operating, bTurns: b.turnovers,
    });
  }
  rows.sort((x, y) => x.propertyName.localeCompare(y.propertyName));

  const n = rows.length;
  const aSum = round2(rows.reduce((s, r) => s + r.aOperating, 0));
  const bSum = round2(rows.reduce((s, r) => s + r.bOperating, 0));
  const aTurns = rows.reduce((s, r) => s + r.aTurns, 0);
  const bTurns = rows.reduce((s, r) => s + r.bTurns, 0);

  return {
    monthA, monthB, rows,
    avg: {
      aPerProperty: n > 0 ? round2(aSum / n) : 0,
      bPerProperty: n > 0 ? round2(bSum / n) : 0,
      aPerTurn: aTurns > 0 ? round2(aSum / aTurns) : null,
      bPerTurn: bTurns > 0 ? round2(bSum / bTurns) : null,
    },
  };
}
