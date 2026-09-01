/**
 * The accountant's monthly remittance sheet: what has to move out of each
 * property's Chase account at close, and what to file it under.
 *
 *   1. TAX        property account -> *9928, filed on MassTaxConnect under
 *                 the property's certificate.
 *   2. VRBO       property account -> *5130, reimbursing the card that pays
 *                 VRBO its 5% commission as one monthly lump.
 *   3. BOOKING    FYI only. Booking.com auto-debits its own commission from
 *                 the property account the following month.
 *
 * Airbnb is absent by design: Airbnb collects and remits both tax and
 * commission on its side and pays Rising Tide a net amount.
 *
 * WHY THIS MODULE EXISTS (2026-08-27, Dotti's July-close review). The sheet
 * used to be computed in the browser off two scalar columns on
 * guesty_reservations, `total_paid` and `total_taxes`, and both of them lie:
 *
 *   - `total_taxes` is NULL on every listing whose Guesty tax config does
 *     not itemize -- which is all of the newer properties. Their tax fell
 *     to $0, and a $0 row was filtered off the sheet, so 16 Waterman, 19
 *     Rackliffe, 36 Granite and 79 Main silently vanished from the tax
 *     section entirely. July alone hid $3,531.82 of occupancy tax that way.
 *
 *   - `total_paid` has been recording only one of a guest's two 50/50
 *     installment payments since July 2026 (see the gross-mismatch
 *     reconstruction in lib/stripe-sync.ts), and it is 0 on the same
 *     tax-inclusive listings. The VRBO sweep, computed as 5% of
 *     (total_paid - total_taxes), came out roughly half on the properties
 *     it covered and $0 on the four it did not: $1,119.53 swept against
 *     $2,868.10 actually owed.
 *
 * Both are fixed the same way: read `folio_items`, which is the per-line
 * breakdown Guesty itself computed and which the sync already stores.
 * The `TAX`-typed lines are the tax (verified exactly equal to
 * `total_taxes` on every July row that had both, zero drift), and
 * everything else is the guest's pre-tax total, which is what a channel
 * commissions on.
 *
 * The sheet now also lists EVERY property that has a statement this month,
 * including the ones owing nothing, plus any active property in the
 * registry with no statement at all. A newly onboarded property cannot go
 * missing from a tax filing because nobody remembered to add it.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { loadInstallmentsForCodes, type Installment } from '@/lib/installments';
import { occupancyTaxMultiplier } from '@/lib/occupancy-tax';

/** VRBO's commission, always 5% of the guest's pre-tax booking total. The
 *  legacy 4.4% gross-up baked into some historical CHANNEL COMMISSION
 *  values is a Guesty-PDF display artifact and is never what we owe. */
export const VRBO_COMMISSION_RATE = 0.05;
/** Booking.com's standard commission, used only when Guesty gives us none. */
export const BOOKING_COMMISSION_RATE = 0.15;

/** MA exempts a stay of 32 or more consecutive nights from room occupancy
 *  excise, which is why Guesty writes no tax line on the long seasonal
 *  bookings. Surfaced as the reason on a zero-tax stay so the accountant
 *  reads "exempt", not "missing". */
const LONG_STAY_EXEMPT_NIGHTS = 32;

const round2 = (n: number) => Math.round(n * 100) / 100;
const round4 = (n: number) => Math.round(n * 10000) / 10000;

export type TaxGap = {
  confirmationCode: string;
  guestName: string;
  platform: string;
  nights: number | null;
  rent: number;
  /** Why Guesty shows no tax: the 32+ night exemption, or genuinely unknown. */
  reason: 'long_stay_exempt' | 'no_tax_line';
};

export type RemittanceRow = {
  propertyId: string;
  propertyName: string;
  propertyShort: string;
  taxCertId: string | null;
  /**
   * Rent the tax was computed on: the pre-tax guest total of every stay
   * that carried tax, plus the fee behind every taxed add-on. This is what
   * gets typed into MassTaxConnect, which computes the excise from it --
   * so taxableRent * the property's rate reconciles to taxToRemit.
   *
   * Stays that legitimately carried no tax (the 32+ night exemption) are
   * excluded, or the state's computed figure would not tie. They are named
   * in taxGaps instead.
   */
  taxableRent: number;
  /** Occupancy tax on the month's stays. */
  stayTax: number;
  /** Occupancy tax collected inside attributed add-on charges. */
  addOnTax: number;
  /** The add-on leg of taxableRent: fees sold through payment links, which
   *  come from Stripe rather than from a Guesty reservation. */
  addOnRent: number;
  /**
   * The statutory rate this property should be collecting: 0.117 base Cape
   * Ann, 0.147 where the Community Impact Fee applies. taxToRemit divided
   * by taxableRent should equal it. When it does not, a listing's tax
   * config in Guesty is charging the wrong rate and the state's computed
   * excise will not match what we moved -- which is the whole reason the
   * rental-income column earns its place on the sheet.
   */
  expectedTaxRate: number;
  /** stayTax + addOnTax: the wire to *9928. */
  taxToRemit: number;
  vrboCommissionSweep: number;
  bookingAutoDebit: number;
  /** Taxable-channel stays carrying no tax at all. */
  taxGaps: TaxGap[];
  /** True when a VRBO stay had no folio and the 5% base was inferred. */
  sweepEstimated: boolean;
};

export type RemittanceSheet = {
  month: string;
  rows: RemittanceRow[];
  /** Active registry properties with no statement in this month at all. */
  missingProperties: Array<{ id: string; name: string }>;
  /**
   * Set when the cross-month split table could not be read (2026-09 audit
   * phase 2). The sheet still prints -- an accountant mid-filing needs
   * SOMETHING -- but every long-stay figure on it may be attributed to the
   * wrong month, so the printed sheet says so instead of looking clean.
   */
  installmentsDegraded?: boolean;
};

type FolioItem = { type?: string | null; amount?: number | string | null };

/** Split a booking's folio into tax and pre-tax guest total.
 *
 *  Tax lines carry `type: 'TAX'` (normalType ST / LT / CT / TAX for the
 *  state, local, city and Community Impact Fee legs). Everything else is
 *  what the guest paid before tax: accommodation fare, cleaning fee, extra
 *  person fee, the channel markup, and negative discount lines. Note the
 *  markup and extra-person lines carry NO `type` at all, so this must key
 *  on "is it tax", never on an allowlist of revenue types. */
export function splitFolio(folio: unknown): { tax: number; preTax: number; hasFolio: boolean } {
  if (!Array.isArray(folio) || folio.length === 0) return { tax: 0, preTax: 0, hasFolio: false };
  let tax = 0;
  let preTax = 0;
  for (const raw of folio as FolioItem[]) {
    const amt = Number(raw?.amount);
    if (!Number.isFinite(amt)) continue;
    if ((raw?.type || '') === 'TAX') tax += amt;
    else preTax += amt;
  }
  return { tax: round2(tax), preTax: round2(preTax), hasFolio: true };
}

/** A cross-month booking's share of its own booking-level folio for one
 *  month, by revenue ratio -- the same proration lib/installments.ts uses
 *  for the Stripe fee. Unsplit bookings get 1. Without this a 3-month
 *  installment stay would put its FULL booking tax on all three sheets. */
export function monthShare(installments: Installment[] | undefined, month: string): number {
  if (!installments || installments.length === 0) return 1;
  const total = installments.reduce((s, i) => s + Number(i.installment_revenue || 0), 0);
  if (total <= 0) return 1;
  const mine = installments
    .filter(i => i.month === month)
    .reduce((s, i) => s + Number(i.installment_revenue || 0), 0);
  if (mine <= 0) return 1;
  return mine / total;
}

const isVrbo = (platform: string) => platform.includes('HOMEAWAY') || platform === 'VRBO';
const isBooking = (platform: string) => platform.includes('BOOKING');
const isManual = (platform: string) => platform === 'MANUAL' || platform === 'DIRECT';
/** Channels whose occupancy tax Rising Tide collects and remits itself.
 *  Airbnb's is handled by Airbnb. */
const isTaxableChannel = (platform: string) => isVrbo(platform) || isBooking(platform) || isManual(platform);

type ReservationRow = {
  property_statement_id: string;
  confirmation_code: string;
  guest_name: string | null;
  platform: string | null;
  nights: number | null;
  guesty_rental_income: number | string | null;
};

type GuestyRow = {
  confirmation_code: string;
  nights: number | null;
  total_taxes: number | string | null;
  channel_commission: number | string | null;
  folio_items: unknown;
};

/**
 * Build the whole sheet for one month. Server-only: reads folio_items,
 * which is a large JSON blob per reservation and has no business crossing
 * to the browser.
 *
 * `opts.propertyId` narrows the sheet to a single property. Every heavy
 * read downstream keys off the statement rows, so scoping them scopes the
 * whole build -- which is what lets /api/ingest ask "what did this one
 * property owe last month" without paying for the other fourteen. A scoped
 * sheet carries no `missingProperties`, since the coverage guarantee is a
 * property of the FULL sheet and an empty list on a scoped one would read
 * as "nothing missing".
 */
export async function buildRemittanceSheet(
  supabase: SupabaseClient,
  month: string,
  opts?: { propertyId?: string },
): Promise<RemittanceSheet> {
  const scopedTo = opts?.propertyId;
  const { data: period } = await supabase
    .from('statement_periods').select('id').eq('month', month).maybeSingle();
  if (!period?.id) return { month, rows: [], missingProperties: [] };

  let stmtQuery = supabase
    .from('property_statements')
    .select('id, property_id, property_name')
    .eq('period_id', period.id);
  if (scopedTo) stmtQuery = stmtQuery.eq('property_id', scopedTo);
  const { data: statements } = await stmtQuery.order('property_name');
  const stmts = (statements || []) as Array<{ id: string; property_id: string; property_name: string }>;
  if (stmts.length === 0) return { month, rows: [], missingProperties: [], installmentsDegraded: false };

  const { data: reservationRows } = await supabase
    .from('reservations')
    .select('property_statement_id, confirmation_code, guest_name, platform, nights, guesty_rental_income')
    .in('property_statement_id', stmts.map(s => s.id));
  const reservations = (reservationRows || []) as ReservationRow[];

  const codes = [...new Set(reservations.map(r => r.confirmation_code).filter(Boolean))];

  // guesty_reservations in chunks: folio_items is heavy and a single .in()
  // over a long month's codes is a big row set.
  const guestyByCode = new Map<string, GuestyRow>();
  for (let i = 0; i < codes.length; i += 100) {
    const { data } = await supabase
      .from('guesty_reservations')
      .select('confirmation_code, nights, total_taxes, channel_commission, folio_items')
      .in('confirmation_code', codes.slice(i, i + 100));
    for (const g of (data || []) as GuestyRow[]) {
      if (g.confirmation_code) guestyByCode.set(g.confirmation_code, g);
    }
  }

  // Fail-visible, not fail-closed: this sheet is a tax document the
  // accountant may be part-way through filing, so a split-table read
  // failure degrades it with a printed warning rather than denying it.
  let installmentsDegraded = false;
  let installmentsByCode: Map<string, Installment[]>;
  try {
    installmentsByCode = await loadInstallmentsForCodes(supabase, codes);
  } catch (err) {
    console.error('remittance: installment read failed, sheet degraded', err);
    installmentsDegraded = true;
    installmentsByCode = new Map<string, Installment[]>();
  }

  // Occupancy tax sitting inside attributed add-on charges (a late checkout
  // or extra night sold through a payment link). Zero for every row minted
  // before the gross-up shipped, which is why July stays exactly as sent.
  const addOnTaxByProperty = new Map<string, number>();
  const addOnRentByProperty = new Map<string, number>();
  const { data: attributions } = await supabase
    .from('bank_deposit_attributions')
    .select('property_id, tax_amount, tax_base, direction')
    .eq('month', month)
    .eq('status', 'attributed');
  for (const a of (attributions || []) as Array<{ property_id: string; tax_amount: number | string | null; tax_base: number | string | null; direction: string | null }>) {
    if ((a.direction || 'deposit') === 'debit') continue;
    const t = Number(a.tax_amount) || 0;
    if (t === 0) continue;
    addOnTaxByProperty.set(a.property_id, (addOnTaxByProperty.get(a.property_id) || 0) + t);
    addOnRentByProperty.set(a.property_id, (addOnRentByProperty.get(a.property_id) || 0) + (Number(a.tax_base) || 0));
  }

  const { data: propRows } = await supabase
    .from('properties')
    .select('id, name, tax_cert_id, is_active');
  const registry = (propRows || []) as Array<{ id: string; name: string | null; tax_cert_id: string | null; is_active: boolean | null }>;
  const registryById = new Map(registry.map(p => [p.id, p]));

  const byStatement = new Map<string, ReservationRow[]>();
  for (const r of reservations) {
    const list = byStatement.get(r.property_statement_id);
    if (list) list.push(r);
    else byStatement.set(r.property_statement_id, [r]);
  }

  const rows: RemittanceRow[] = stmts.map(stmt => {
    let stayTax = 0;
    let stayRent = 0;
    let vrboCommissionSweep = 0;
    let bookingAutoDebit = 0;
    let sweepEstimated = false;
    const taxGaps: TaxGap[] = [];

    for (const r of byStatement.get(stmt.id) || []) {
      const platform = (r.platform || '').toUpperCase();
      if (!isTaxableChannel(platform)) continue;

      const g = guestyByCode.get(r.confirmation_code);
      const folio = splitFolio(g?.folio_items);
      const share = monthShare(installmentsByCode.get(r.confirmation_code), month);
      const rent = Number(r.guesty_rental_income) || 0;

      // Tax: the folio's TAX lines are authoritative. `total_taxes` is a
      // cache of the same number that Guesty leaves NULL on listings whose
      // tax config does not itemize, so it is the fallback, never the source.
      // `share` applies to BOOKING-level figures only. folio_items and
      // guesty_reservations describe the whole booking, so a cross-month
      // stay's month gets its slice of them. The reservations row is
      // already the slice -- /api/ingest writes the installment's own
      // revenue and nights onto it -- so anything read from there is used
      // verbatim. Multiplying it by share again prorates twice, which is
      // how Kate Bacon's $55,325.59 July rent first printed as $49,002.65.
      const bookingTax = folio.hasFolio && folio.tax !== 0 ? folio.tax * share : (Number(g?.total_taxes) || 0) * share;
      stayTax += bookingTax;

      // Rent behind that tax. The folio's pre-tax total is the guest's whole
      // taxable rent -- accommodation, cleaning, extra-person and channel
      // markup, net of discounts -- which is exactly the figure
      // MassTaxConnect wants. Without a folio, back into it: Guesty's rental
      // income is already net of the channel's commission on VRBO.
      if (bookingTax !== 0) {
        stayRent += folio.hasFolio && folio.preTax > 0
          ? folio.preTax * share
          : (isVrbo(platform) && rent > 0 ? rent / (1 - VRBO_COMMISSION_RATE) : rent);
      }

      if (bookingTax === 0 && rent > 0) {
        // The exemption is a property of the BOOKING, not of the month's
        // slice of it. An installment-split stay carries only its
        // nights-in-month on the reservation row (31 of Kate Bacon's 35),
        // which would read as "no tax line" on a stay that is in fact
        // exempt. Guesty's booking-level nights is the right test.
        const bookingNights = g?.nights ?? r.nights ?? 0;
        taxGaps.push({
          confirmationCode: r.confirmation_code,
          guestName: r.guest_name || 'Guest',
          platform: r.platform || '',
          nights: bookingNights,
          rent: round2(rent),
          reason: bookingNights >= LONG_STAY_EXEMPT_NIGHTS ? 'long_stay_exempt' : 'no_tax_line',
        });
      }

      if (isVrbo(platform)) {
        // 5% of the guest's PRE-TAX booking total. Without a folio, back
        // into that total from the rental income Guesty already netted the
        // commission out of.
        if (folio.hasFolio && folio.preTax > 0) {
          vrboCommissionSweep += folio.preTax * VRBO_COMMISSION_RATE * share;
        } else if (rent > 0) {
          // Month-sliced already; no second proration.
          vrboCommissionSweep += (rent / (1 - VRBO_COMMISSION_RATE)) * VRBO_COMMISSION_RATE;
          sweepEstimated = true;
        }
      }

      if (isBooking(platform)) {
        // Booking.com's own number when we have it; contracted rates vary,
        // so the standard 15% is only a fallback for a missing column.
        const stored = Number(g?.channel_commission) || 0;
        const commission = stored > 0
          ? stored
          : (folio.hasFolio && folio.preTax > 0 ? folio.preTax * BOOKING_COMMISSION_RATE : 0);
        bookingAutoDebit += commission * share;
      }
    }

    const addOnTax = round2(addOnTaxByProperty.get(stmt.property_id) || 0);
    const addOnRent = round2(addOnRentByProperty.get(stmt.property_id) || 0);
    const reg = registryById.get(stmt.property_id);
    return {
      propertyId: stmt.property_id,
      propertyName: stmt.property_name,
      propertyShort: reg?.name || stmt.property_name,
      taxCertId: reg?.tax_cert_id ?? null,
      taxableRent: round2(stayRent + addOnRent),
      addOnRent,
      // Mid-month is the right probe date for the CIF gate: a rate that
      // starts mid-history applies to the month it starts in.
      expectedTaxRate: round4(occupancyTaxMultiplier(stmt.property_id, `${month}-15`) - 1),
      stayTax: round2(stayTax),
      addOnTax,
      taxToRemit: round2(stayTax + addOnTax),
      vrboCommissionSweep: round2(vrboCommissionSweep),
      bookingAutoDebit: round2(bookingAutoDebit),
      taxGaps,
      sweepEstimated,
    };
  });

  // Coverage guarantee: an active property with no statement this month is
  // named on the sheet rather than being silently absent from it. Skipped
  // on a scoped sheet, which is answering a question about one property
  // and has no view of the fleet.
  const covered = new Set(stmts.map(s => s.property_id));
  const missingProperties = scopedTo ? [] : registry
    .filter(p => p.is_active !== false && !covered.has(p.id) && p.id !== 'hq')
    .map(p => ({ id: p.id, name: p.name || p.id }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return { month, rows, missingProperties, installmentsDegraded };
}
