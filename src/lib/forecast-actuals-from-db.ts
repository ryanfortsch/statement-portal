/**
 * Dynamic bank-actuals derived from `overhead_expenses` (the table the
 * /api/ingest-overhead upload on the Cost Analysis tab writes to). The
 * Forecast page uses this so a single upload over there ALSO refreshes
 * the Forecast's "ACT" rows and clears the staleness banner — no
 * offline parser re-run, no hardcoded ACTUALS_2026 edit needed.
 *
 * On any error returns an empty result so the page falls back to the
 * hardcoded ACTUALS_2026 in forecast-actuals.ts — never breaks render.
 *
 * Mapping from cost-analysis categories to the model's expense buckets
 * matches the existing ACTUALS_2026 convention so the per-row totals
 * stay comparable:
 *
 *   card account  → exp_software for rows the categorizer tagged
 *                   'Software' (the subscription stack: Guesty, Anthropic,
 *                   PriceLabs, QuickBooks, Adobe, Quo and the rest), and
 *                   exp_cc_ops for everything else on the card. The card
 *                   used to be one lump, which left the Software row at $0
 *                   in every ACT month and then jumping to the $2,300
 *                   projection in the first forward month, while the six
 *                   Recurring rows quietly absorbed the real spend. The
 *                   projected card model (ccOperatingCost) never included
 *                   software, so this is what makes ACT and projected
 *                   months describe the same shape.
 *   'Pass-through'  → dropped. VRBO and the other channel commissions bill
 *                   the card and are already netted out of rental revenue
 *                   before a statement sees them; counting them here charges
 *                   the same fee twice.
 *   'Card payment' → exp_cc_ops, but ONLY for months whose card export does
 *                   not reach month end. resolveCardSpendSource() keeps one
 *                   source per month, so a month never counts both the
 *                   payoff and the charges, and never reports a few days of
 *                   charges as a whole month.
 *   operating account:
 *     Rent & office     → exp_office
 *     Insurance         → exp_insurance
 *     Bank fees         → exp_bank
 *     Software          → exp_software
 *     Payroll           → exp_contractors (Gusto NET + TAX are wages.
 *                         The old mapping sent these to exp_software,
 *                         which put $29,473 of lifetime wages on the
 *                         Software row. W-2 payroll ran Mar-Oct 2025 and
 *                         stopped; the 1099 bench replaced that rail.)
 *     Contractors       → exp_contractors (the 1099 bench: Delaney's
 *                         field labor, Cooper's creative work, and the
 *                         one-off handymen. Paid direct from ...5130,
 *                         never through Gusto.)
 *     Health benefits   → dropped (out of scope for the mgmt business)
 *     Professional      → exp_debt for MH Partners, exp_accounting for
 *                         MS Consultants, else exp_cc_ops
 *     everything else   → exp_cc_ops (catch-all)
 *
 * Revenue is overlaid from getStatementRevenueByMonth(). For early-year
 * months where Helm hasn't reconciled a statement yet, that lookup
 * returns 0 — which would zero out a row that has real expenses. We
 * fall back to ACTUALS_2026[m-1].revenue (the bank-sweep figure the
 * old offline parser had hardcoded) so the row stays honest until the
 * statement closes and the live number takes over.
 *
 * IMPORTANT: the returned `actuals` array is indexed by month-1 (so
 * calcYear's `actuals[m - 1]` reads the right month). Months with no
 * data are left as sparse holes — calcYear's truthiness check on the
 * lookup naturally falls through to the projection branch for them.
 */

import { createClient } from '@supabase/supabase-js';
import { ACTUALS_2026, type MonthlyActual } from '@/lib/forecast-actuals';
import { CARD_PROXY_CATEGORY, cardCompleteMonths, resolveCardSpendSource } from '@/lib/overhead-categories';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey =
  process.env.SUPABASE_SERVICE_ROLE_KEY ||
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
  '';

type Row = {
  month: string | null;
  category: string | null;
  account: string | null;
  amount: number | null;
  description: string | null;
};

export type DbActuals = {
  /**
   * One entry per month-of-year (index 0 = January). Months with no
   * overhead data are sparse holes (so calcYear's `actuals[m - 1]`
   * truthiness check skips them). Empty when the table is empty.
   */
  actuals: ReadonlyArray<MonthlyActual>;
  /**
   * Highest 1-indexed calendar month within `year` for which the data
   * is complete (the month is strictly in the past). 0 if no eligible
   * month exists. The current in-progress month is NEVER counted as
   * complete, even if it has rows — it stays a projection.
   */
  throughMonth: number;
  /**
   * Most recent transaction date across all overhead rows (any year)
   * — drives the staleness banner. null when the table is empty.
   */
  latestTxnDate: string | null;
};

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function blank(month: string): MonthlyActual {
  return {
    month,
    revenue: 0,
    exp_office: 0,
    exp_software: 0,
    exp_debt: 0,
    exp_insurance: 0,
    exp_accounting: 0,
    exp_bank: 0,
    exp_cc_ops: 0,
    exp_contractors: 0,
    exp_hire: 0,
    exp_onboard_presigned: 0,
    exp_onboard_new: 0,
  };
}

/**
 * Pull dynamic actuals for `year` from `overhead_expenses`. Revenue
 * is overlaid from `revenueByMonth` (typically the output of
 * getStatementRevenueByMonth()).
 *
 * Resilient: any error returns an empty result.
 */
export async function getActualsFromDb(
  year: number,
  revenueByMonth: Record<string, number>,
): Promise<DbActuals> {
  const empty: DbActuals = { actuals: [], throughMonth: 0, latestTxnDate: null };
  if (!supabaseUrl || !supabaseKey) return empty;
  const supabase = createClient(supabaseUrl, supabaseKey);

  try {
    // Paginate through every row for the year (Supabase caps at 1000).
    const rows: Row[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase
        .from('overhead_expenses')
        .select('month, category, account, amount, description')
        .like('month', `${year}-%`)
        .range(from, from + 999);
      if (error) {
        console.error('[forecast-actuals-from-db] query failed:', error.message);
        return empty;
      }
      if (!data || data.length === 0) break;
      rows.push(...(data as Row[]));
      if (data.length < 1000) break;
    }

    // Most recent txn_date across the WHOLE table (any year) so the
    // staleness banner reflects most-recent-upload, honestly.
    let latestTxnDate: string | null = null;
    try {
      const { data: latestRow } = await supabase
        .from('overhead_expenses')
        .select('txn_date')
        .not('txn_date', 'is', null)
        .order('txn_date', { ascending: false })
        .limit(1);
      latestTxnDate = (latestRow?.[0]?.txn_date as string | undefined) ?? null;
    } catch {
      /* leave null — non-fatal */
    }

    // How far the CARD export runs, which is a different date from the one
    // above: the operating upload usually runs later. A month only counts as
    // card-covered when the card data reaches its last calendar day.
    let cardMaxTxnDate: string | null = null;
    try {
      const { data: latestCard } = await supabase
        .from('overhead_expenses')
        .select('txn_date')
        .eq('account', 'card')
        .not('txn_date', 'is', null)
        .order('txn_date', { ascending: false })
        .limit(1);
      cardMaxTxnDate = (latestCard?.[0]?.txn_date as string | undefined) ?? null;
    } catch {
      /* leave null — every month then falls back to the payoff proxy */
    }

    if (rows.length === 0) return { ...empty, latestTxnDate };

    // Exactly one source of card spend per month: complete card detail where
    // it exists, the operating account's card payoff everywhere else. Never
    // both, and never a partial month of charges passed off as a whole one.
    const complete = cardCompleteMonths(rows, cardMaxTxnDate);
    const usableRows = resolveCardSpendSource(rows, complete);

    // Aggregate per month into MonthlyActual.
    const byMonth = new Map<string, MonthlyActual>();
    for (const r of usableRows) {
      if (!r.month) continue;
      const amt = Math.abs(Number(r.amount) || 0); // source is signed; expenses are positive
      if (!amt) continue;
      const cat = r.category || '';
      const acct = r.account || '';
      const desc = (r.description || '').toUpperCase();

      const ma = byMonth.get(r.month) ?? blank(r.month);

      // A channel commission already netted out of rental revenue is not
      // overhead. VRBO and its peers bill the card and the same fee is
      // deducted before a statement ever sees the revenue, so counting it
      // here charges Rising Tide twice. It stays visible in Cost Analysis,
      // where watching the cash move in and back out is the point.
      if (cat === 'Pass-through') {
        // deliberately counted nowhere
      } else if (acct === 'card') {
        // The subscription stack gets its own row. The projection carries
        // software on exp_software and never inside ccOperatingCost, so the
        // ACT months have to split it out the same way or the Software row
        // reads $0 through August and $2,300 from September.
        if (cat === 'Software') ma.exp_software += amt;
        else ma.exp_cc_ops += amt;
      } else {
        switch (cat) {
          case 'Rent & office':   ma.exp_office += amt; break;
          case 'Insurance':       ma.exp_insurance += amt; break;
          case 'Bank fees':       ma.exp_bank += amt; break;
          case 'Software':        ma.exp_software += amt; break;
          // Gusto NET + TAX are wages and belong on the people line. The old
          // convention sent the whole Payroll category to exp_software on the
          // theory that Gusto is a SaaS fee; that was true of the ~$68/mo
          // platform fee and false of the $29,473 of wages it also carried.
          case 'Payroll':         ma.exp_contractors += amt; break;
          case 'Contractors':     ma.exp_contractors += amt; break;
          // Card payoff standing in for card spend. Only survives to here in
          // months whose card export does not reach month end; the rest were
          // removed by resolveCardSpendSource.
          case CARD_PROXY_CATEGORY: ma.exp_cc_ops += amt; break;
          case 'Health benefits': /* out of scope for the mgmt-business forecast */ break;
          case 'Professional':
            if (desc.includes('MH PARTNERS') || desc.includes('MHPARTNERS')) {
              ma.exp_debt += amt;
            } else if (desc.includes('MS CONSULTANTS') || desc.includes('MSCONSULTANTS')) {
              ma.exp_accounting += amt;
            } else {
              ma.exp_cc_ops += amt;
            }
            break;
          default:
            // Marketing, Listing platforms, Guest supplies, Repairs & upkeep,
            // Travel, Other — operating-account ops fall into the catch-all.
            ma.exp_cc_ops += amt;
        }
      }
      byMonth.set(r.month, ma);
    }

    // Build a sparse dense-indexed array: actuals[m - 1] = month m's
    // MonthlyActual, with holes for months that have no rows. Highest
    // index is the last month with data so `throughMonth` reads cleanly.
    let maxMonth = 0;
    for (const m of byMonth.keys()) {
      const [y, mm] = m.split('-').map((s) => parseInt(s, 10));
      if (y === year && mm > maxMonth) maxMonth = mm;
    }

    // Sparse: holes are runtime-undefined. We assert as MonthlyActual[]
    // at the boundary because calcYear's lookup is truthiness-checked
    // (`if (actuals && actuals[m - 1])`) so holes naturally fall through
    // to the projection branch. Tightening the array type all the way
    // through calcYear would force a model signature change.
    const dense: (MonthlyActual | undefined)[] = [];
    dense.length = maxMonth;
    for (let m = 1; m <= maxMonth; m++) {
      const ym = `${year}-${String(m).padStart(2, '0')}`;
      const ma = byMonth.get(ym);
      if (!ma) continue;
      // Revenue: prefer the reconciled statement number; when Helm hasn't
      // closed the month yet, fall back to the bank-sweep figure that
      // the old offline parser had hardcoded so the row doesn't read as
      // $0 against real expenses (Jan-Mar 2026 today).
      const liveRev = revenueByMonth[ym] ?? 0;
      const fallbackRev = ACTUALS_2026[m - 1]?.revenue ?? 0;
      const revenue = liveRev > 0 ? liveRev : fallbackRev;
      dense[m - 1] = {
        ...ma,
        revenue: round2(revenue),
        exp_office: round2(ma.exp_office),
        exp_software: round2(ma.exp_software),
        exp_debt: round2(ma.exp_debt),
        exp_insurance: round2(ma.exp_insurance),
        exp_accounting: round2(ma.exp_accounting),
        exp_bank: round2(ma.exp_bank),
        exp_cc_ops: round2(ma.exp_cc_ops),
        exp_contractors: round2(ma.exp_contractors),
        exp_hire: round2(ma.exp_hire),
      };
    }
    const actuals = dense as MonthlyActual[];

    // throughMonth = highest month that has data AND is strictly past.
    // The current in-progress month is excluded even if rows exist for
    // it (mirrors the statement-actuals guard in forecast-statement-actuals).
    const now = new Date();
    const cy = now.getFullYear();
    const cm = now.getMonth() + 1;
    let throughMonth = 0;
    for (let m = 1; m <= maxMonth; m++) {
      if (!dense[m - 1]) continue;
      const isComplete = year < cy || (year === cy && m < cm);
      if (isComplete) throughMonth = m;
    }

    return { actuals, throughMonth, latestTxnDate };
  } catch (err) {
    console.error('[forecast-actuals-from-db] threw:', err);
    return empty;
  }
}
