/**
 * Paid payment links in Helm's money estimates (2026-10-22).
 *
 * Dotti asked whether the payment links feed through the money estimates.
 * They did not. A link's money reached the owner statement at month close,
 * through the extras queue, and nowhere before that: the Revenue page and the
 * forecast read Guesty reservations, and link money never touches Guesty.
 * Brian Nugent paid $900 plus tax for two more nights at 17 Beach on 10/22
 * and October's numbers did not move, while the two nights he paid for read
 * as a calendar block rather than as sold.
 *
 * The rules, each the one the statement already uses, so an estimate and the
 * statement that later replaces it agree on what and when:
 *
 *   WHAT COUNTS  every link Helm minted that has been paid, except a
 *                far-future deposit or balance (ffdeposit: / ffbalcharge:),
 *                which is a stay's own principal: the same split stripe-sync
 *                makes before it queues a charge as an add-on.
 *   HOW MUCH     the pre-tax amount the guest paid (base_cents; amount_cents
 *                on links minted before the tax gross-up, which carried no
 *                tax). The occupancy tax is the state's money. The statement
 *                later records it net of the real Stripe fee; close trues the
 *                estimate up.
 *   WHICH MONTH  addonQueueMonth, the statements' own rule: the stay's
 *                checkout month, or the month it was paid when that is later
 *                or there is no stay on file.
 *   NIGHTS       an extension's nights, read from what was charged ("Extended
 *                stay (2 nights)", "Extra night", "Extended night stay"),
 *                starting on the stay's checkout. A label that gives no count
 *                gives no nights, never a guess; its money still counts.
 *
 * A fee with no nights (pet, boat docking, late checkout) is revenue but not
 * room revenue: it stays out of ADR and out of the forecast's pacing
 * scale-up, which would otherwise project a $200 pet fee into a bigger one.
 *
 * Pure apart from the shared month rule, so `npm test` loads it. The reads
 * live in paid-addons.ts.
 */

import { addonQueueMonth } from './addon-queue-month.ts';

export type PaidLinkRow = {
  request_key: string;
  label: string | null;
  property_id: string | null;
  amount_cents: number | null;
  base_cents: number | null;
  tax_cents: number | null;
  paid_at: string | null;
  reservation_id: string | null;
};

/** The stay a link was minted for, from guesty_reservations. */
export type LinkStay = { checkIn: string; checkOut: string; channel: string | null };

export type PaidAddOn = {
  requestKey: string;
  propertyId: string;
  label: string;
  /** Pre-tax dollars. */
  revenue: number;
  /** YYYY-MM the money is recognized in (the statements' rule). */
  month: string;
  /** The day it is recognized on: the stay's checkout, or the paid date. */
  recognizedOn: string;
  /** The stay's booking channel; null when no stay is on file. */
  channel: string | null;
  /** The nights an extension bought, in order. Empty for a fee. */
  extensionDates: string[];
};

const STAY_PRINCIPAL = /^(ffdeposit|ffbalcharge):/;

/** A far-future deposit or balance pays for a stay; it is never an add-on. */
export function isStayPrincipalLink(requestKey: string): boolean {
  return STAY_PRINCIPAL.test(requestKey || '');
}

const KEY_RESERVATION = /^addon:([0-9a-f]{24}):/i;

/**
 * The Guesty reservation a link belongs to. The column when it is filled
 * (links minted on the Charge tab), else the id inside a concierge add-on key
 * (`addon:<reservation>:<label>:<cents>`), which is where every concierge link
 * minted before the column existed keeps it.
 */
export function reservationIdFor(row: Pick<PaidLinkRow, 'reservation_id' | 'request_key'>): string | null {
  const direct = (row.reservation_id || '').trim();
  if (direct) return direct;
  const m = KEY_RESERVATION.exec(row.request_key || '');
  return m ? m[1] : null;
}

/** What the guest paid before occupancy tax, in cents. */
export function preTaxCents(row: Pick<PaidLinkRow, 'base_cents' | 'amount_cents' | 'tax_cents'>): number {
  const base = Number(row.base_cents);
  if (Number.isFinite(base) && base > 0) return base;
  const amount = Number(row.amount_cents) || 0;
  const tax = Number(row.tax_cents) || 0;
  return Math.max(0, amount - tax);
}

const EXTENSION = /extra.?night|extension|extend/i;
const NIGHT_COUNT = /\b(\d{1,2})\s+(?:extra\s+|more\s+|additional\s+)?nights?\b/i;
// "night" on its own, not "nights": "Extra night", "Extended night stay".
const ONE_NIGHT = /\bnight\b(?!s)/i;

/** Nights an extension label says it bought; 0 for a fee or an unstated count. */
export function extensionNightCount(label: string): number {
  const text = label || '';
  if (!EXTENSION.test(text)) return 0;
  const m = NIGHT_COUNT.exec(text);
  if (m) {
    const n = Number(m[1]);
    return n >= 1 && n <= 14 ? n : 0;
  }
  return ONE_NIGHT.test(text) ? 1 : 0;
}

export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** One paid link as an add-on, or null when it is not one. */
export function toPaidAddOn(row: PaidLinkRow, stay: LinkStay | null): PaidAddOn | null {
  if (!row.paid_at || !row.property_id || isStayPrincipalLink(row.request_key)) return null;
  const cents = preTaxCents(row);
  if (cents <= 0) return null;
  // UTC, the way stripe-sync dates the charge it queues.
  const paidOn = row.paid_at.slice(0, 10);
  const checkOut = stay?.checkOut ? stay.checkOut.slice(0, 10) : '';
  const month = addonQueueMonth(paidOn.slice(0, 7), checkOut || null);
  const recognizedOn = checkOut && checkOut.slice(0, 7) === month ? checkOut : paidOn;
  const nights = checkOut ? extensionNightCount(row.label || '') : 0;
  return {
    requestKey: row.request_key,
    propertyId: row.property_id,
    label: row.label || '',
    revenue: cents / 100,
    month,
    recognizedOn,
    channel: stay?.channel ?? null,
    extensionDates: Array.from({ length: nights }, (_, i) => addDays(checkOut, i)),
  };
}

// ── The Revenue page ─────────────────────────────────────────────────────

export type AddOnMonth = {
  revenue: number;
  /** Paid nights, attributed the way the page attributes a stay's nights. */
  nights: number;
  /** Revenue with no nights under it: kept out of ADR. */
  extras: number;
  /** Per channel, for the mix strip. Stays are never counted for an add-on. */
  mix: Array<{ channel: string | null; revenue: number; nights: number }>;
};

export type AddOnFold = {
  revenue: number;
  nights: number;
  extras: number;
  byMonth: Map<string, AddOnMonth>;
  /**
   * Extension nights that count as slept in: on or after the home's first
   * counted day, not already a reservation's night, and held on the calendar
   * wherever the calendar was read. Physical, so it includes nights whose
   * money is recognized outside the range, exactly as a stay's nights do.
   */
  sleptNights: string[];
};

export type AddOnFoldInput = {
  addOns: readonly PaidAddOn[];
  basis: 'checkout' | 'nights';
  rangeStart: string;
  periodEndExclusive: string;
  propStart: string;
  activatedAt: string | null;
  /** Nights a reservation already holds; an extension never double-books them. */
  bookedDates: ReadonlySet<string>;
  /**
   * Calendar-blocked nights, read over [heldFrom, heldTo]. A paid extension's
   * nights are held by the concierge ("Extension hold - <guest>"), and only a
   * held night counts as sold: if the hold was lifted because the stay itself
   * was extended, or never placed, the night is not counted twice or at all.
   * Outside the read window there is nothing to check against, so the link
   * is trusted.
   */
  heldDates: ReadonlySet<string>;
  heldFrom: string;
  heldTo: string;
};

function monthEntry(byMonth: Map<string, AddOnMonth>, month: string): AddOnMonth {
  let e = byMonth.get(month);
  if (!e) {
    e = { revenue: 0, nights: 0, extras: 0, mix: [] };
    byMonth.set(month, e);
  }
  return e;
}

/** Everything one home's paid add-ons add to a Revenue page range. */
export function foldPaidAddOns(input: AddOnFoldInput): AddOnFold {
  const {
    addOns, basis, rangeStart, periodEndExclusive, propStart, activatedAt,
    bookedDates, heldDates, heldFrom, heldTo,
  } = input;
  const activation = activatedAt ? activatedAt.slice(0, 10) : null;
  const counts = (d: string): boolean =>
    d >= propStart &&
    !bookedDates.has(d) &&
    (d < heldFrom || d > heldTo || heldDates.has(d));

  const out: AddOnFold = { revenue: 0, nights: 0, extras: 0, byMonth: new Map(), sleptNights: [] };
  const slept = new Set<string>();

  for (const a of addOns) {
    if (activation && activation > a.recognizedOn) continue;
    const counted = a.extensionDates.filter(counts);
    for (const d of counted) slept.add(d);

    if (basis === 'nights' && a.extensionDates.length > 0) {
      // Money follows the nights it bought, each night an equal share.
      const share = a.revenue / a.extensionDates.length;
      for (const d of a.extensionDates) {
        if (d < rangeStart || d >= periodEndExclusive || d < propStart) continue;
        const month = d.slice(0, 7);
        const night = counted.includes(d) ? 1 : 0;
        const e = monthEntry(out.byMonth, month);
        e.revenue += share;
        e.nights += night;
        if (!night) e.extras += share;
        e.mix.push({ channel: a.channel, revenue: share, nights: night });
        out.revenue += share;
        out.nights += night;
        if (!night) out.extras += share;
      }
      continue;
    }

    // Checkout attribution, the same window a stay's checkout must fall in.
    if (a.recognizedOn <= rangeStart || a.recognizedOn > periodEndExclusive) continue;
    const nights = counted.length;
    const e = monthEntry(out.byMonth, a.month);
    e.revenue += a.revenue;
    e.nights += nights;
    if (nights === 0) e.extras += a.revenue;
    e.mix.push({ channel: a.channel, revenue: a.revenue, nights });
    out.revenue += a.revenue;
    out.nights += nights;
    if (nights === 0) out.extras += a.revenue;
  }
  out.sleptNights = [...slept].sort();
  return out;
}

/**
 * A closed month swapped for its statement. The statement's add-ons are the
 * ones the operator attributed (net of the real Stripe fee), so they replace
 * the links' estimate. Its fee already includes the add-ons' share, so the
 * revenue it is reconciled against must include them too, or the fee
 * resolver charges the management fee on them a second time.
 */
export function statementMonthWithAddOns(input: {
  rentalRevenue: number;
  nightsBooked: number;
  addOnsRevenue: number;
  linkRevenue: number;
  linkNights: number;
  linkExtras: number;
}): { revenue: number; nights: number; extras: number; feeRevenue: number; addOnScale: number; countNights: boolean } {
  const rental = Number(input.rentalRevenue) || 0;
  const addOns = Math.max(0, Number(input.addOnsRevenue) || 0);
  const linkRevenue = Math.max(0, Number(input.linkRevenue) || 0);
  // Nights only when the statement actually carries add-on money: a link that
  // was refunded and dismissed bought nobody a night.
  const countNights = addOns > 0 && input.linkNights > 0;
  return {
    revenue: rental + addOns,
    nights: (Number(input.nightsBooked) || 0) + (countNights ? input.linkNights : 0),
    // The statement does not say which add-on was a fee; the links do.
    extras: linkRevenue > 0 ? addOns * (Math.max(0, input.linkExtras) / linkRevenue) : addOns,
    feeRevenue: rental + addOns,
    addOnScale: linkRevenue > 0 ? addOns / linkRevenue : 0,
    countNights,
  };
}

// ── The forecast ─────────────────────────────────────────────────────────

export type ForecastCell = { nights: number; revenue: number; extras?: number };

/**
 * Add paid links to the forecast's booked map. Extension nights are booked
 * nights, so they join the cell and scale like any stay. A fee goes in
 * `extras`, which the forecast adds after its projection, so it is never
 * scaled up.
 */
export function foldAddOnsIntoForecast(
  booked: Map<string, Map<string, ForecastCell>>,
  addOns: readonly PaidAddOn[],
  keepMonths: ReadonlySet<string>,
  inScope: (propertyId: string) => boolean,
): void {
  const cell = (pid: string, ym: string): ForecastCell => {
    let prop = booked.get(pid);
    if (!prop) {
      prop = new Map();
      booked.set(pid, prop);
    }
    let c = prop.get(ym);
    if (!c) {
      c = { nights: 0, revenue: 0 };
      prop.set(ym, c);
    }
    return c;
  };
  for (const a of addOns) {
    if (!inScope(a.propertyId)) continue;
    if (a.extensionDates.length > 0) {
      const share = a.revenue / a.extensionDates.length;
      for (const d of a.extensionDates) {
        const ym = d.slice(0, 7);
        if (!keepMonths.has(ym)) continue;
        const c = cell(a.propertyId, ym);
        c.nights += 1;
        c.revenue += share;
      }
    } else if (keepMonths.has(a.month)) {
      const c = cell(a.propertyId, a.month);
      c.extras = (c.extras ?? 0) + a.revenue;
    }
  }
}
