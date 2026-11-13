/**
 * A partner home's host sees their money on staycapeann.com/host/payouts:
 * where each home's Stripe account stands, every booked stay with what the
 * guest paid, our fee and what reaches them, and the year so far.
 *
 * The money is the host's. Stripe charges the guest on the host's own
 * Standard account and pays their bank on Stripe's own schedule, so the
 * payouts themselves live in the host's Stripe dashboard; this page links
 * there and never claims a payout happened. A stay accepted before card
 * payments opened has no charge here: the office settled it by hand.
 *
 * A host who has not finished with Stripe can start or finish from this
 * page: the bridge mints a fresh setup link for that home (the office's
 * makeSetupLink, recorded as hostActor's host:<email>) and the site sends
 * them to it. The office's earlier link for that home stops working.
 *
 * PURE MODULE: no env, no database, no server-only imports.
 */
import { effectiveStatus, nightsOf, type BookingRequestRow } from './booking-requests.ts';
import type { PartnerPaymentAccount } from './partner-payments.ts';
import { hostGuestName } from './partner-host.ts';
import { easternIsoDay } from './partner-host-calendar.ts';
import { displayTitle } from './sca-quotes-types.ts';

/** Where a Standard account's owner signs in to see their balance and payouts. */
export const STRIPE_DASHBOARD_URL = 'https://dashboard.stripe.com/payouts';

/** How many booked stays the page lists. */
export const HOST_PAYOUT_STAYS = 200;

export type HostStripeState = 'not_set_up' | 'started' | 'reviewing' | 'needs_bank' | 'ready';

export type HostPayoutHome = {
  id: string;
  title: string;
  stripe: HostStripeState;
  /** One line, in the host's words: where their payments stand. */
  stripe_line: string;
  /** The host can start or finish with Stripe from the page. */
  can_set_up: boolean;
  /** They have an account, so their Stripe dashboard is theirs to open. */
  has_dashboard: boolean;
  fee_pct: number | null;
  fee_line: string | null;
};

export type HostPayoutState = 'charging' | 'charged' | 'failed' | 'arranged';

export type HostPayoutStay = {
  id: string;
  property_id: string;
  home_title: string;
  check_in: string;
  check_out: string;
  nights: number;
  guest_name: string;
  /** What the guest paid, or the quoted total when no card was charged here. */
  total_cents: number;
  fee_cents: number | null;
  /** The total less our fee: what reaches the host before Stripe's card fee. */
  payout_cents: number | null;
  currency: string;
  state: HostPayoutState;
  /** "Charged November 14", "Charging now", "The charge failed; we are on it", "Settled with Stay Cape Ann". */
  state_line: string;
  when: 'upcoming' | 'staying' | 'past';
  charged_at: string | null;
};

export type HostPayoutYear = {
  year: number;
  stays: number;
  charged_cents: number;
  fee_cents: number;
  payout_cents: number;
  currency: string;
};

export type HostPayoutsView = {
  homes: HostPayoutHome[];
  stays: HostPayoutStay[];
  /** Money charged on Stripe, by the Eastern year it was charged, newest first. */
  years: HostPayoutYear[];
  dashboard_url: string;
};

export function hostStripeState(a: PartnerPaymentAccount | null | undefined): HostStripeState {
  if (!a || !a.stripe_account_id) return 'not_set_up';
  if (a.charges_enabled && a.payouts_enabled) return 'ready';
  if (a.charges_enabled) return 'needs_bank';
  if (a.details_submitted && a.requirements_due === 0) return 'reviewing';
  return 'started';
}

function pctWords(pct: number): string {
  return `${Number.isInteger(pct) ? pct : pct.toFixed(2).replace(/0$/, '')}%`;
}

export function hostStripeLine(state: HostStripeState, a: PartnerPaymentAccount | null | undefined): string {
  switch (state) {
    case 'not_set_up':
      return 'Not set up yet. Guests can pay by card once it is.';
    case 'started': {
      const due = a?.requirements_due ?? 0;
      return due > 0 ? `Stripe needs ${due} more ${due === 1 ? 'thing' : 'things'} from you before guests can pay.` : 'You started with Stripe. Finish there before guests can pay.';
    }
    case 'reviewing':
      return 'Stripe is reviewing your details. Guests can pay once it is done.';
    case 'needs_bank':
      return 'Guests can pay. Add your bank in Stripe to be paid out.';
    case 'ready':
      return 'Ready to take payments.';
  }
}

export function hostPayoutHome(home: { id: string; title: string | null }, account: PartnerPaymentAccount | null | undefined): HostPayoutHome {
  const stripe = hostStripeState(account);
  const fee = account?.fee_pct ?? null;
  return {
    id: home.id,
    title: displayTitle(home.title) || 'Your home',
    stripe,
    stripe_line: hostStripeLine(stripe, account),
    can_set_up: stripe === 'not_set_up' || stripe === 'started' || (stripe === 'reviewing' && (account?.requirements_due ?? 0) > 0),
    has_dashboard: stripe !== 'not_set_up',
    fee_pct: fee,
    fee_line: fee == null ? null : `Our fee is ${pctWords(fee)} of each stay, not counting occupancy tax.`,
  };
}

const DAY = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', month: 'long', day: 'numeric' });
const YEAR = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric' });

export function easternYear(iso: string): number {
  return Number(YEAR.format(new Date(iso)));
}

/** A booked stay, or null when the request never became one. */
export function hostPayoutStay(row: BookingRequestRow, title: string | null, now: Date): HostPayoutStay | null {
  if (effectiveStatus(row, now) !== 'accepted') return null;
  const today = easternIsoDay(now);
  const when: HostPayoutStay['when'] = row.check_out <= today ? 'past' : row.check_in <= today ? 'staying' : 'upcoming';
  const charged = row.hold_status === 'captured';
  const held = row.hold_cents != null && row.hold_status !== 'none' && row.hold_status !== 'released';
  let state: HostPayoutState;
  let line: string;
  if (charged) {
    state = 'charged';
    line = row.captured_at ? `Charged ${DAY.format(new Date(row.captured_at))}` : 'Charged';
  } else if (row.hold_status === 'held') {
    state = 'charging';
    line = 'Charging the card now';
  } else if (row.hold_status === 'failed') {
    state = 'failed';
    line = 'The charge did not go through. We are on it.';
  } else {
    state = 'arranged';
    line = 'Settled with Stay Cape Ann';
  }
  const total = held ? (row.hold_cents as number) : row.quoted_total_cents;
  const fee = held && row.fee_cents != null ? row.fee_cents : null;
  return {
    id: row.id,
    property_id: row.property_id,
    home_title: displayTitle(title) || 'Your home',
    check_in: row.check_in,
    check_out: row.check_out,
    nights: nightsOf(row.check_in, row.check_out),
    guest_name: hostGuestName(row, true),
    total_cents: total,
    fee_cents: fee,
    payout_cents: fee != null ? total - fee : null,
    currency: row.currency,
    state,
    state_line: line,
    when,
    charged_at: charged ? row.captured_at : null,
  };
}

/** Upcoming and current stays first, soonest first; then past ones, latest first. */
export function sortPayoutStays(list: HostPayoutStay[]): HostPayoutStay[] {
  const ahead = list.filter((s) => s.when !== 'past').sort((a, b) => a.check_in.localeCompare(b.check_in) || a.id.localeCompare(b.id));
  const past = list.filter((s) => s.when === 'past').sort((a, b) => b.check_out.localeCompare(a.check_out) || a.id.localeCompare(b.id));
  return [...ahead, ...past];
}

/** What Stripe charged for the host, by the Eastern year of the charge. One currency per year row. */
export function payoutYears(stays: HostPayoutStay[]): HostPayoutYear[] {
  const byKey = new Map<string, HostPayoutYear>();
  for (const s of stays) {
    if (s.state !== 'charged' || !s.charged_at || s.fee_cents == null || s.payout_cents == null) continue;
    const year = easternYear(s.charged_at);
    const key = `${year}:${s.currency}`;
    const row = byKey.get(key) ?? { year, stays: 0, charged_cents: 0, fee_cents: 0, payout_cents: 0, currency: s.currency };
    row.stays += 1;
    row.charged_cents += s.total_cents;
    row.fee_cents += s.fee_cents;
    row.payout_cents += s.payout_cents;
    byKey.set(key, row);
  }
  return [...byKey.values()].sort((a, b) => b.year - a.year || a.currency.localeCompare(b.currency));
}

export function hostPayoutsView(
  homes: Array<{ id: string; title: string | null }>,
  accounts: Map<string, PartnerPaymentAccount>,
  rows: BookingRequestRow[],
  now: Date,
): HostPayoutsView {
  const titles = new Map(homes.map((h) => [h.id, h.title]));
  const stays = sortPayoutStays(
    rows
      .filter((r) => titles.has(r.property_id))
      .map((r) => hostPayoutStay(r, titles.get(r.property_id) ?? null, now))
      .filter((s): s is HostPayoutStay => !!s),
  );
  return {
    homes: homes.map((h) => hostPayoutHome(h, accounts.get(h.id))),
    stays,
    years: payoutYears(stays),
    dashboard_url: STRIPE_DASHBOARD_URL,
  };
}
