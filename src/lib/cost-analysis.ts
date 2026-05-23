/**
 * Cost Analysis data layer (Financials > Cost Analysis tab).
 *
 * v1 focus: housekeeping cost -- cleaning (Cape Ann Elite) vs linens
 * (Nor'East Cleaners) -- per property per month, plus per-turnover
 * normalization for an apples-to-apples before/after read on the
 * May 2026 vendor split (when linens unbundled from Cape Ann Elite).
 *
 * Sources, per (property, month):
 *   - property_statements.cleaning_total  -> all-in housekeeping (authoritative)
 *   - property_statements.num_stays       -> turnovers (the per-turn denominator)
 *   - cleaning_events                     -> the cleaning-vs-linen split, via
 *                                            the vendor / source columns
 *
 * Resilience: cleaning_events is read with select('*') and the linen
 * subset is detected by vendor === "Nor'East Cleaners" OR
 * source === 'bank-linen'. So this works whether or not the
 * cleaning_events.vendor migration has run -- before it does (and before
 * May is re-ingested with the split), linens read as 0 and all-in falls
 * back to cleaning_total, which is still correct; the split just
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
  cleaning: number; // Cape Ann Elite (all-in minus linens)
  linens: number; // Nor'East
  allIn: number; // cleaning_total
  allInPerTurn: number | null;
};

export type MonthTotal = {
  cleaning: number;
  linens: number;
  allIn: number;
  turnovers: number;
  allInPerTurn: number | null;
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

  // Statements: the all-in + turnover figures.
  const { data: stmts } = await supabase
    .from('property_statements')
    .select('id, property_id, property_name, num_stays, cleaning_total, period_id');
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
    const allIn = round2(Number(s.cleaning_total) || 0);
    const linens = round2(linenByStmt.get(s.id as string) || 0);
    const cleaning = round2(allIn - linens);
    cells.push({
      propertyId,
      propertyName,
      month,
      turnovers,
      cleaning,
      linens,
      allIn,
      allInPerTurn: turnovers > 0 ? round2(allIn / turnovers) : null,
    });
    propsSeen.set(propertyId, propertyName);
    monthsSeen.add(month);
  }

  const byMonth: Record<string, MonthTotal> = {};
  for (const m of monthsSeen) {
    const mc = cells.filter(c => c.month === m);
    const cleaning = round2(mc.reduce((s, c) => s + c.cleaning, 0));
    const linens = round2(mc.reduce((s, c) => s + c.linens, 0));
    const allIn = round2(mc.reduce((s, c) => s + c.allIn, 0));
    const turnovers = mc.reduce((s, c) => s + c.turnovers, 0);
    byMonth[m] = {
      cleaning,
      linens,
      allIn,
      turnovers,
      allInPerTurn: turnovers > 0 ? round2(allIn / turnovers) : null,
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
 * Same-property apples-to-apples comparison between two months. Only
 * properties with a statement in BOTH months are included (so the
 * averages reflect the same set). Returns per-property rows plus the
 * two headline averages: per property and per turnover.
 */
export type SamePropertyComparison = {
  monthA: string;
  monthB: string;
  rows: {
    propertyId: string;
    propertyName: string;
    aAllIn: number; aTurns: number;
    bAllIn: number; bTurns: number;
  }[];
  avg: {
    aPerProperty: number; bPerProperty: number;
    aPerTurn: number | null; bPerTurn: number | null;
  };
};

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
      aAllIn: a.allIn, aTurns: a.turnovers,
      bAllIn: b.allIn, bTurns: b.turnovers,
    });
  }
  rows.sort((x, y) => x.propertyName.localeCompare(y.propertyName));

  const n = rows.length;
  const aSum = round2(rows.reduce((s, r) => s + r.aAllIn, 0));
  const bSum = round2(rows.reduce((s, r) => s + r.bAllIn, 0));
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
