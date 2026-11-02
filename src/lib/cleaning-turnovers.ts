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
  /** The checkout, or the bank date for a delivery with no checkout. */
  date: string;
  /** The guest who checked out; null for a standalone delivery. */
  guest: string | null;
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
    const row = byKey.get(key) || { date, guest: null, housekeeping: 0, laundry: 0, total: 0 };
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
