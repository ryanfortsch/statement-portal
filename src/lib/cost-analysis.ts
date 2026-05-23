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
import { LINEN_VENDOR_NAME } from '@/lib/bank-charges';
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
  repairs: number; // repairs_total
  operating: number; // cleaning + linens + repairs
  operatingPerTurn: number | null;
};

export type MonthTotal = {
  cleaning: number;
  linens: number;
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
  let hasLinenData = false;
  if (stmtIds.length > 0) {
    const { data: events } = await supabase
      .from('cleaning_events')
      .select('*')
      .in('property_statement_id', stmtIds);
    for (const e of (events || []) as Record<string, unknown>[]) {
      const isLinen = e.vendor === LINEN_VENDOR_NAME || e.source === 'bank-linen';
      if (!isLinen) continue;
      const sid = e.property_statement_id as string;
      const amt = Number(e.amount) || 0;
      linenByStmt.set(sid, (linenByStmt.get(sid) || 0) + amt);
      if (amt > 0) hasLinenData = true;
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
    const cleaningTotal = round2(Number(s.cleaning_total) || 0); // cleaning + linens
    const repairs = round2(Number(s.repairs_total) || 0);
    const linens = round2(linenByStmt.get(s.id as string) || 0);
    const cleaning = round2(cleaningTotal - linens);
    const operating = round2(cleaningTotal + repairs);
    cells.push({
      propertyId,
      propertyName,
      month,
      turnovers,
      cleaning,
      linens,
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
    const repairs = round2(mc.reduce((s, c) => s + c.repairs, 0));
    const operating = round2(mc.reduce((s, c) => s + c.operating, 0));
    const turnovers = mc.reduce((s, c) => s + c.turnovers, 0);
    byMonth[m] = {
      cleaning,
      linens,
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
/** A merchant within a category: its total, count, and the charges behind it. */
export type OverheadVendor = { vendor: string; total: number; count: number; txns: OverheadTxn[] };
/** A category with its vendor breakdown, for click-to-expand. */
export type OverheadCategoryDetail = { category: string; total: number; count: number; vendors: OverheadVendor[] };
/** A proactive, plain-English flag about a cost worth reducing or checking. */
export type OverheadInsight = {
  id: string;
  severity: 'high' | 'medium' | 'low';
  title: string;
  detail: string;
  annual: number | null; // estimated yearly $ at stake, when meaningful
};

export type OverheadAnalysis = {
  months: string[]; // sorted ascending
  categories: string[]; // categories present, by total desc
  byMonthCategory: Record<string, Record<string, number>>; // month -> category -> amount
  byMonthTotal: Record<string, number>;
  categoryTotals: Record<string, number>; // category -> all-time total
  total: number; // all-time grand total
  detail: OverheadCategoryDetail[]; // category -> vendors -> txns, totals desc
  insights: OverheadInsight[]; // proactive savings/trend flags
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
    months: [], categories: [], byMonthCategory: {}, byMonthTotal: {}, categoryTotals: {},
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
    const v = (vendorAcc[cat][vendor] ||= { vendor, total: 0, count: 0, txns: [] });
    v.total = round2(v.total + amt);
    v.count += 1;
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
  const insights = computeOverheadInsights(detail, byMonthCategory, months);

  const daysSinceLatest = latestTxnDate
    ? Math.floor((Date.now() - Date.parse(latestTxnDate + 'T00:00:00')) / 86400000)
    : null;

  return {
    months,
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
 * Proactive overhead insights -- the "things you could trim" panel. All
 * heuristic and directional; each is phrased as a prompt to check, not a
 * command. Annual estimates extrapolate the observed run-rate over the
 * months of data we have.
 */
function computeOverheadInsights(
  detail: OverheadCategoryDetail[],
  byMonthCategory: Record<string, Record<string, number>>,
  months: string[],
): OverheadInsight[] {
  const out: OverheadInsight[] = [];
  const nMonths = Math.max(months.length, 1);
  const annualize = (total: number) => Math.round((total / nMonths) * 12);

  const findVendor = (name: string): OverheadVendor | undefined => {
    for (const c of detail) {
      const v = c.vendors.find(v => v.vendor === name);
      if (v) return v;
    }
    return undefined;
  };
  const byCat = (cat: string) => detail.find(c => c.category === cat);

  // 1. Overlapping AI tools -- the easiest subscription overlap to consolidate.
  const aiNames = ['OpenAI', 'Anthropic', 'Cursor', 'Lovable', 'Runway'];
  const aiVendors = aiNames.map(findVendor).filter(Boolean) as OverheadVendor[];
  if (aiVendors.length >= 2) {
    const aiTotal = aiVendors.reduce((s, v) => s + v.total, 0);
    out.push({
      id: 'ai-overlap',
      severity: 'medium',
      title: `${aiVendors.length} overlapping AI subscriptions`,
      detail: `You're paying ${aiVendors.map(v => v.vendor).join(', ')}. Consolidating to one or two could trim the rest.`,
      annual: annualize(aiTotal),
    });
  }

  // 2. Auto insurance sitting in business overhead -- reclassify or confirm.
  const geico = findVendor('GEICO (auto)');
  if (geico) {
    out.push({
      id: 'auto-insurance',
      severity: 'high',
      title: 'Auto insurance is in business overhead',
      detail: `GEICO auto runs ~${fmtUSD(annualize(geico.total))}/yr on the card. Confirm it belongs in the business, otherwise reclassify it as personal.`,
      annual: annualize(geico.total),
    });
  }

  // 3. Software subscription stack -- the single most reducible bucket.
  const sw = byCat('Software');
  if (sw && sw.total > 0) {
    const top = sw.vendors.slice(0, 4).map(v => v.vendor).join(', ');
    out.push({
      id: 'software-stack',
      severity: 'medium',
      title: `Software is a ~${fmtUSD(annualize(sw.total))}/yr stack`,
      detail: `${sw.vendors.length} tools, led by ${top}. Worth an annual subscription audit for ones you've outgrown.`,
      annual: annualize(sw.total),
    });
  }

  // 4. Amazon concentration -- many small orders add up; a spend policy helps.
  const amzn = findVendor('Amazon');
  if (amzn && amzn.count >= 20) {
    out.push({
      id: 'amazon-concentration',
      severity: 'low',
      title: `Amazon is ~${fmtUSD(annualize(amzn.total))}/yr across ${amzn.count} orders`,
      detail: 'A business account with a simple approval step (or a per-property budget) usually trims impulse buys here.',
      annual: annualize(amzn.total),
    });
  }

  // 5. Fastest-rising category: last 3 months vs the 3 before.
  if (months.length >= 6) {
    const recent = months.slice(-3);
    const prior = months.slice(-6, -3);
    const sumCat = (ms: string[], cat: string) => ms.reduce((s, m) => s + (byMonthCategory[m]?.[cat] || 0), 0);
    let best: { cat: string; deltaPerMo: number; pct: number } | null = null;
    for (const c of detail) {
      const r = sumCat(recent, c.category) / 3;
      const p = sumCat(prior, c.category) / 3;
      if (p < 50) continue; // ignore tiny/noisy bases
      const deltaPerMo = r - p;
      const pct = (deltaPerMo / p) * 100;
      if (deltaPerMo >= 150 && pct >= 20 && (!best || deltaPerMo > best.deltaPerMo)) {
        best = { cat: c.category, deltaPerMo, pct };
      }
    }
    if (best) {
      out.push({
        id: 'rising-category',
        severity: 'medium',
        title: `${best.cat} is trending up`,
        detail: `Up ~${fmtUSD(Math.round(best.deltaPerMo))}/mo (+${best.pct.toFixed(0)}%) over the last quarter vs the prior one. Worth a look before it sets a new baseline.`,
        annual: Math.round(best.deltaPerMo * 12),
      });
    }
  }

  return out.sort((a, b) => (b.annual || 0) - (a.annual || 0));
}

function fmtUSD(n: number): string {
  return '$' + Math.round(n).toLocaleString('en-US');
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
