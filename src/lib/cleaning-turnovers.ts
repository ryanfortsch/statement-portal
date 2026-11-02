/**
 * The itemized cleaning block on an owner statement: one row per turnover.
 *
 * The statement prints one Cleaning line. A home that opted in
 * (`properties.statement_cleaning_detail`) also prints what that line was
 * made of, and this module decides the rows. It is pure so the render page
 * and the test see the same arithmetic.
 *
 * Bundling rule. A turnover is a checkout. Ingest already attributes a
 * laundry or linen delivery to the nearest Cape Ann Elite cleaning within
 * seven days by stamping the same `checkout_date` and `guest_name` on the
 * delivery row, so every money row sharing a checkout date is one turnover:
 * housekeeping plus whatever laundry rode with it. A delivery ingest could
 * not place (no checkout date) stands on its own, dated by the bank charge.
 *
 * Only money rows count (CLEANING_MONEY_SOURCES): an invoice-only row is
 * attribution and never bills, so it never itemizes either. A vendor credit
 * nets against its charge exactly as `deriveCleaningTotal` nets it, which is
 * what lets the block's total tie to the Cleaning line to the cent.
 */
import { CLEANING_MONEY_SOURCES, round2 } from './statement-totals.ts';

export type CleaningTurnoverInput = {
  checkout_date: string | null;
  bank_charge_date: string | null;
  guest_name: string | null;
  source: string | null;
  amount: number | string | null;
  credit_amount: number | string | null;
};

export type CleaningTurnover = {
  /** The checkout, or the bank date for a row ingest could not place. */
  date: string;
  /** The guest who checked out; null when no stay could be named. */
  guest: string | null;
  /**
   * False when ingest found no checkout on this statement for the charge
   * (the stay closed last month, so it sits on last month's statement) and
   * the row is dated by the bank charge instead. nameUnplacedTurnovers can
   * still put a guest on it from the home's own checkouts.
   */
  placed: boolean;
  /** Cape Ann Elite's housekeeping, net of any credit. */
  housekeeping: number;
  /** Laundry and linen deliveries, net of any credit. */
  laundry: number;
  /** housekeeping + laundry. */
  total: number;
};

export type CleaningItemization = {
  rows: CleaningTurnover[];
  /** Sum of every row, rounded to the cent. */
  total: number;
};

const n = (v: number | string | null | undefined): number => Number(v) || 0;

function isDelivery(source: string | null): boolean {
  return source === 'bank-laundry' || source === 'bank-linen';
}

/** Group a statement's cleaning rows into turnovers, oldest first. */
export function bundleCleaningTurnovers(events: CleaningTurnoverInput[]): CleaningItemization {
  const byKey = new Map<string, CleaningTurnover>();
  for (const e of events) {
    if (!CLEANING_MONEY_SOURCES.has(String(e.source || ''))) continue;
    const net = n(e.amount) - n(e.credit_amount);
    const date = e.checkout_date || e.bank_charge_date;
    if (!date) continue;
    // A placed row shares its checkout's key. Unplaced rows charged on one
    // bank date read as one unnamed turnover (a cleaning and its delivery
    // for a stay that closed last month land together on the day the bank
    // took them), never as a guess at a guest.
    const key = e.checkout_date ? `turnover:${e.checkout_date}` : `bank:${e.bank_charge_date}`;
    const row = byKey.get(key) || { date, guest: null, placed: !!e.checkout_date, housekeeping: 0, laundry: 0, total: 0 };
    if (e.guest_name && !row.guest) row.guest = e.guest_name;
    if (isDelivery(e.source)) row.laundry = round2(row.laundry + net);
    else row.housekeeping = round2(row.housekeeping + net);
    row.total = round2(row.housekeeping + row.laundry);
    byKey.set(key, row);
  }
  const rows = [...byKey.values()].sort((a, b) => a.date.localeCompare(b.date));
  const total = round2(rows.reduce((sum, r) => sum + r.total, 0));
  return { rows, total };
}

/**
 * The block prints only when its rows add up to the Cleaning line the owner
 * is reading two inches above. A statement whose rows drift from the stored
 * total (a row edited after the recompute, a source this module does not
 * know) keeps the single line rather than printing two figures that disagree.
 */
export function itemizationTiesToTotal(itemization: CleaningItemization, cleaningTotal: number | string | null): boolean {
  if (itemization.rows.length === 0) return false;
  return Math.abs(itemization.total - n(cleaningTotal)) < 0.005;
}

export type CheckoutInput = { check_out: string | null; guest_name: string | null };

/** Seven days, the same window ingest allows a delivery to trail its cleaning. */
const NAMING_WINDOW_DAYS = 7;

function daysBetween(earlier: string, later: string): number {
  return (Date.parse(later + 'T00:00:00Z') - Date.parse(earlier + 'T00:00:00Z')) / 86_400_000;
}

/**
 * Put a guest on a turnover ingest could not place.
 *
 * Ingest pairs a cleaning charge with a checkout on the SAME statement, so a
 * stay that closed on the last day of September and was cleaned (and charged)
 * on October 2 has nothing in October to attach to and prints as a bare
 * "Turnover". The home's own checkouts settle it: the last checkout at the
 * house within the seven days before the bank charge is the stay that
 * turnover closed. The row takes that checkout's date and guest and reads
 * like every other row. A charge with no checkout in the window stays
 * unnamed; the block never guesses past the window.
 *
 * Money is untouched: rows keep their amounts and the total is the same.
 */
export function nameUnplacedTurnovers(itemization: CleaningItemization, checkouts: CheckoutInput[]): CleaningItemization {
  const named = checkouts
    .filter((c): c is { check_out: string; guest_name: string } => !!c.check_out && !!c.guest_name)
    .sort((a, b) => a.check_out.localeCompare(b.check_out));
  const rows = itemization.rows.map((row) => {
    if (row.placed || row.guest) return row;
    let match: { check_out: string; guest_name: string } | null = null;
    for (const c of named) {
      const gap = daysBetween(c.check_out, row.date);
      if (gap < 0 || gap > NAMING_WINDOW_DAYS) continue;
      if (!match || c.check_out > match.check_out) match = c;
    }
    return match ? { ...row, date: match.check_out, guest: match.guest_name } : row;
  });
  rows.sort((a, b) => a.date.localeCompare(b.date));
  return { rows, total: itemization.total };
}
