/**
 * Nights-in-month recognition basis for /revenue.
 *
 * The default basis on /revenue is CHECKOUT: a stay's whole value lands in
 * the month it checks out, which is how owner statements recognize money
 * (see CLAUDE.md, "Recognition"). That basis is canonical and is not
 * touched by anything in this file.
 *
 * This module supplies the second, display-only basis: a stay's value
 * spread across the calendar months its nights actually fall in. An August
 * booking with most of its nights in August stops landing entirely on
 * September just because it checked out there.
 *
 * The governing rule is REDISTRIBUTE, NEVER RECOMPUTE. Whatever dollar
 * amount the checkout basis assigned a stay, this basis takes that same
 * amount and moves it. It never re-derives a payout, and nothing here
 * writes to the database.
 *
 * Flat per-night is not an approximation chosen for convenience: it is the
 * same split the operator already approves by hand. Both cross-month
 * bookings that carry `reservation_installments` slices today reproduce
 * exactly under flat proration, to the dollar:
 *
 *   GY-fCdhbUYC  3 South    Jun 22 to Aug 6, 45 nights, $30,271
 *                slices 9 / 31 / 5 nights -> 6,054 / 20,854 / 3,363
 *                flat @ $672.69/night     -> 6,054 / 20,853 / 3,363
 *   GY-qqVPackv  17 Beach   Jun 27 to Aug 1, 35 nights, $62,465
 *                slices 4 / 31 nights     -> 7,139 / 55,326
 *                flat @ $1,784.71/night   -> 7,139 / 55,326
 */

/** Which month a dollar is recognized in. */
export type RevenueBasis = 'checkout' | 'nights';

/** One month's slice of a stay, already clipped to the requested range. */
export type NightBucket = {
  /** YYYY-MM. */
  month: string;
  revenue: number;
  nights: number;
};

function nightsBetween(startStr: string, endStr: string): number {
  const ms = Date.parse(endStr) - Date.parse(startStr);
  if (!Number.isFinite(ms)) return 0;
  return Math.max(0, Math.round(ms / 86_400_000));
}

/** First day of the month after the one containing `ymd`, as YYYY-MM-DD. */
function nextMonthStart(ymd: string): string {
  const y = parseInt(ymd.slice(0, 4), 10);
  const m = parseInt(ymd.slice(5, 7), 10); // 1-based
  const d = new Date(Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 1));
  return d.toISOString().slice(0, 10);
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Spread one stay's recognized value across the months its nights fall in.
 *
 * The DENOMINATOR is the stay's allocatable nights, meaning every night on
 * or after `propStart` (a property earns nothing before it was activated),
 * NOT the nights inside the requested range. That distinction is what makes
 * the basis conserve: over a window containing the whole stay the buckets
 * sum to `value` exactly, while a range that clips the stay gets only the
 * share of nights it actually contains.
 *
 * Rounding residue goes to the last in-range bucket, so a full-window
 * allocation is penny-exact rather than off by a cent or two.
 *
 * Returns an empty array for a stay with no allocatable nights, a
 * non-positive value, or no overlap with the range at all.
 */
export function allocateStayByNights(args: {
  checkIn: string;
  checkOut: string;
  value: number;
  /** Property activation floor, already max'd against the range start upstream. */
  propStart: string;
  rangeStart: string;
  /** Exclusive: the day after the range's last day. */
  periodEndExclusive: string;
}): NightBucket[] {
  const { checkIn, checkOut, value, propStart, rangeStart, periodEndExclusive } = args;
  if (!(value > 0)) return [];

  // Denominator: post-activation nights of the stay, unclipped by range.
  const allocStart = checkIn > propStart ? checkIn : propStart;
  const allocNights = nightsBetween(allocStart, checkOut);
  if (allocNights <= 0) return [];

  // Numerator window: the part of that also inside the requested range.
  const windowStart = allocStart > rangeStart ? allocStart : rangeStart;
  const windowEnd = checkOut < periodEndExclusive ? checkOut : periodEndExclusive;
  if (windowStart >= windowEnd) return [];

  const perNight = value / allocNights;

  const buckets: NightBucket[] = [];
  let cursor = windowStart;
  while (cursor < windowEnd) {
    const monthEndExclusive = nextMonthStart(cursor);
    const segEnd = monthEndExclusive < windowEnd ? monthEndExclusive : windowEnd;
    const segNights = nightsBetween(cursor, segEnd);
    if (segNights > 0) {
      buckets.push({
        month: cursor.slice(0, 7),
        revenue: round2(perNight * segNights),
        nights: segNights,
      });
    }
    cursor = monthEndExclusive;
  }

  // Put the rounding residue in the last in-range bucket, but only when the
  // range contained the whole allocatable stay. A clipped stay must keep its
  // per-night share rather than absorbing the missing months' pennies.
  if (buckets.length > 0) {
    const coveredNights = buckets.reduce((a, b) => a + b.nights, 0);
    if (coveredNights === allocNights) {
      const summed = buckets.reduce((a, b) => a + b.revenue, 0);
      const residue = round2(value - summed);
      if (residue !== 0) {
        const last = buckets[buckets.length - 1];
        last.revenue = round2(last.revenue + residue);
      }
    }
  }

  return buckets;
}

/* --------------------------------------------------------------------- */
/* Reconciled per-stay values                                             */
/* --------------------------------------------------------------------- */

/**
 * A stay's reconciled dollars, and the statement stays Guesty never had.
 *
 * The checkout basis gets reconciliation for free: `applyStatementsAndPacing`
 * swaps a closed month's computed revenue for the statement's
 * `rental_revenue` scalar. The nights basis cannot use a monthly scalar,
 * because it has to know which nights those dollars belong to. So it moves
 * reconciliation one level down, to the stay.
 *
 * `rental_revenue` equals `SUM(reservations.adjusted_revenue)` on every one
 * of the 41 statements on file, to the cent, so working per stay loses
 * nothing and gains the Stripe fee actuals, operator corrections, refunds
 * and the legacy commission strip that Guesty's payout fields do not carry.
 */
export type ReconciledStays = {
  /** confirmation_code -> summed adjusted_revenue. Installment codes excluded. */
  byCode: Map<string, number>;
  /**
   * Statement stays with no accepted guesty_reservations twin, keyed by
   * property_id. Today's checkout basis picks these up inside the
   * `rental_revenue` swap; the nights basis has to place them itself.
   */
  orphansByProperty: Map<string, Array<{
    checkIn: string;
    checkOut: string;
    revenue: number;
    platform: string | null;
  }>>;
  /**
   * True when the read failed. Callers must then fall back to Guesty gross
   * for EVERY stay rather than mixing reconciled and unreconciled ones
   * inside a month, which is the same degrade-everything posture the
   * existing statement channel-mix read takes.
   */
  degraded: boolean;
};

type MinimalClient = {
  from: (table: string) => {
    select: (cols: string) => any;
  };
};

/**
 * Load reconciled per-stay dollars for every statement reservation whose
 * stay overlaps the range.
 *
 * A date-overlap query is exactly right here and needs no lookahead: the
 * longest stay in the table is 45 nights and overlap already requires
 * `check_out > rangeStart`.
 *
 * This is a SECOND, additional read. It deliberately does not disturb the
 * existing `.in('property_statement_id', ...)` channel-mix query, which is
 * scoped that way precisely so a statement's mix sums to its own
 * `rental_revenue`; putting a date filter on that one would drop in-statement
 * rows and move CHECKOUT-basis channel mix.
 */
export async function loadReconciledStayValues(
  client: MinimalClient,
  rangeStart: string,
  periodEndExclusive: string,
  acceptedCodes: Set<string>,
  installmentCodes: Set<string>,
  selectAllPaged: <T>(
    page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
    opts?: { label?: string },
  ) => Promise<T[]>,
): Promise<ReconciledStays> {
  const empty: ReconciledStays = {
    byCode: new Map(),
    orphansByProperty: new Map(),
    degraded: false,
  };

  type Row = {
    property_statement_id: string | null;
    confirmation_code: string | null;
    platform: string | null;
    adjusted_revenue: number | null;
    nights: number | null;
    check_in: string | null;
    check_out: string | null;
  };

  let rows: Row[];
  try {
    rows = await selectAllPaged<Row>(
      (from, to) =>
        client
          .from('reservations')
          .select('property_statement_id, confirmation_code, platform, adjusted_revenue, nights, check_in, check_out')
          .lt('check_in', periodEndExclusive)
          .gt('check_out', rangeStart)
          .order('id', { ascending: true })
          .range(from, to),
      { label: 'reconciled stay values' },
    );
  } catch {
    return { ...empty, degraded: true };
  }

  const byCode = new Map<string, number>();
  const orphanRows: Array<{ row: Row; stmtId: string }> = [];

  for (const r of rows) {
    const code = r.confirmation_code;
    const rev = Number(r.adjusted_revenue ?? 0);
    if (!code || !r.check_in || !r.check_out || rev === 0) continue;

    // Synthetic cross-month installment rows carry the whole stay span with
    // only their slice's nights, and the operator's slices already ARE a
    // nights allocation. Two independent tells, both agreeing on the same
    // four rows today; keep both.
    const span = nightsBetween(r.check_in, r.check_out);
    if (installmentCodes.has(code) || (r.nights != null && Number(r.nights) !== span)) continue;

    byCode.set(code, (byCode.get(code) ?? 0) + rev);

    if (!acceptedCodes.has(code) && r.property_statement_id) {
      orphanRows.push({ row: r, stmtId: r.property_statement_id });
    }
  }

  // Orphans need a property, and `reservations.property_id` is null on
  // almost every row, so resolve through the statement.
  const orphansByProperty = new Map<string, Array<{
    checkIn: string; checkOut: string; revenue: number; platform: string | null;
  }>>();

  if (orphanRows.length > 0) {
    const stmtIds = Array.from(new Set(orphanRows.map((o) => o.stmtId)));
    try {
      const stmts = await selectAllPaged<{ id: string; property_id: string | null }>(
        (from, to) =>
          client
            .from('property_statements')
            .select('id, property_id')
            .in('id', stmtIds)
            .order('id', { ascending: true })
            .range(from, to),
        { label: 'orphan statement properties' },
      );
      const propByStmt = new Map(stmts.map((s) => [s.id, s.property_id]));
      for (const { row, stmtId } of orphanRows) {
        const pid = propByStmt.get(stmtId);
        if (!pid) continue;
        const list = orphansByProperty.get(pid) ?? [];
        list.push({
          checkIn: row.check_in!,
          checkOut: row.check_out!,
          revenue: Number(row.adjusted_revenue ?? 0),
          platform: row.platform,
        });
        orphansByProperty.set(pid, list);
      }
    } catch {
      // Orphans are the small tail. Losing them is better than degrading the
      // whole range, and they only exist in closed months.
    }
  }

  return { byCode, orphansByProperty, degraded: false };
}
