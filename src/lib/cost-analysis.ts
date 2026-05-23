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

export type OverheadAnalysis = {
  months: string[]; // sorted ascending
  categories: string[]; // categories present, by total desc
  byMonthCategory: Record<string, Record<string, number>>; // month -> category -> amount
  byMonthTotal: Record<string, number>;
  latestTxnDate: string | null; // most recent transaction date, for the "data through X" nudge
  daysSinceLatest: number | null; // computed here (not in render) so the client control stays pure
  hasData: boolean;
};

/**
 * Pull categorized overhead from overhead_expenses (populated by
 * /api/ingest-overhead). Resilient to the table not existing yet
 * (migration unrun) -- returns empty so the UI shows an upload prompt.
 */
export async function getOverhead(): Promise<OverheadAnalysis> {
  const empty: OverheadAnalysis = { months: [], categories: [], byMonthCategory: {}, byMonthTotal: {}, latestTxnDate: null, daysSinceLatest: null, hasData: false };
  if (!supabaseUrl || !supabaseKey) return empty;
  const supabase = createClient(supabaseUrl, supabaseKey);

  const { data, error } = await supabase
    .from('overhead_expenses')
    .select('month, category, amount, txn_date');
  if (error || !data || data.length === 0) return empty;

  const byMonthCategory: Record<string, Record<string, number>> = {};
  const byMonthTotal: Record<string, number> = {};
  const catTotals: Record<string, number> = {};
  let latestTxnDate: string | null = null;

  for (const r of data as { month: string; category: string; amount: number; txn_date: string | null }[]) {
    const m = r.month;
    const cat = r.category;
    const amt = Number(r.amount) || 0;
    if (!m) continue;
    (byMonthCategory[m] ||= {});
    byMonthCategory[m][cat] = round2((byMonthCategory[m][cat] || 0) + amt);
    byMonthTotal[m] = round2((byMonthTotal[m] || 0) + amt);
    catTotals[cat] = round2((catTotals[cat] || 0) + amt);
    if (r.txn_date && (!latestTxnDate || r.txn_date > latestTxnDate)) latestTxnDate = r.txn_date;
  }

  const daysSinceLatest = latestTxnDate
    ? Math.floor((Date.now() - Date.parse(latestTxnDate + 'T00:00:00')) / 86400000)
    : null;

  return {
    months: Object.keys(byMonthTotal).sort(),
    categories: Object.keys(catTotals).sort((a, b) => catTotals[b] - catTotals[a]),
    byMonthCategory,
    byMonthTotal,
    latestTxnDate,
    daysSinceLatest,
    hasData: true,
  };
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
