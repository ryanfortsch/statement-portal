/**
 * Partner home payments: the rules.
 *
 * A partner home's host is paid through their own Stripe account, connected
 * to Stay Cape Ann's Stripe Connect platform (held by Rising Tide STR LLC).
 * When a guest sends a booking request on staycapeann.com, the site places a
 * hold for the full stay on the host's account. Accepting the request in
 * Helm books the nights; the site then charges the hold, and our fee comes
 * off at the charge as Stripe's application fee. A decline, an expiry or a
 * withdrawal releases the hold.
 *
 * Helm never holds a Stripe secret and never calls Stripe. The site does
 * every Stripe call and reports back through the bridge:
 *
 *   POST /api/pms/connect          the host's setup link: resolve it, record
 *                                  the account the site created, record what
 *                                  Stripe says about it
 *   POST /api/pms/requests         a request arrives with its hold
 *   GET  /api/pms/requests/settle  what to charge and what to release
 *   POST /api/pms/requests/settle  what happened
 *
 * The money is the host's. None of it reaches a statement, a payout, the
 * books or the forecast; the fee is Rising Tide's revenue, booked from
 * Stripe's platform reports, not from here.
 *
 * PURE MODULE: no env, no database, no server-only imports.
 */
import { createHash, randomBytes } from 'node:crypto';

// ─── The account ────────────────────────────────────────────────────────────

export type PartnerPaymentAccount = {
  property_id: string;
  stripe_account_id: string | null;
  fee_pct: number | null;
  charges_enabled: boolean;
  payouts_enabled: boolean;
  details_submitted: boolean;
  requirements_due: number;
  status_checked_at: string | null;
  setup_token_expires_at: string | null;
  setup_token_created_by: string | null;
  created_at: string;
  updated_at: string;
};

/** Never the token hash: nothing outside the resolver needs it. */
export const PARTNER_PAYMENT_COLS =
  'property_id, stripe_account_id, fee_pct, charges_enabled, payouts_enabled, details_submitted, requirements_due, status_checked_at, setup_token_expires_at, setup_token_created_by, created_at, updated_at';

/** fee_pct arrives from PostgREST as a string (numeric); read it as a number. */
export function shapeAccount(raw: Record<string, unknown>): PartnerPaymentAccount {
  const pct = raw.fee_pct == null || raw.fee_pct === '' ? null : Number(raw.fee_pct);
  return {
    property_id: String(raw.property_id),
    stripe_account_id: (raw.stripe_account_id as string | null) ?? null,
    fee_pct: pct != null && Number.isFinite(pct) ? pct : null,
    charges_enabled: raw.charges_enabled === true,
    payouts_enabled: raw.payouts_enabled === true,
    details_submitted: raw.details_submitted === true,
    requirements_due: Number(raw.requirements_due ?? 0) || 0,
    status_checked_at: (raw.status_checked_at as string | null) ?? null,
    setup_token_expires_at: (raw.setup_token_expires_at as string | null) ?? null,
    setup_token_created_by: (raw.setup_token_created_by as string | null) ?? null,
    created_at: String(raw.created_at ?? ''),
    updated_at: String(raw.updated_at ?? ''),
  };
}

export const ACCOUNT_ID = /^acct_[A-Za-z0-9]{6,64}$/;
export const PAYMENT_INTENT_ID = /^pi_[A-Za-z0-9]{6,64}$/;
export const CHARGE_ID = /^(ch|py)_[A-Za-z0-9]{6,64}$/;

export const MAX_FEE_PCT = 30;

/** A fee the office may set: 0 to 30, at most two decimals. */
export function parseFeePct(raw: unknown): number | null {
  const text = typeof raw === 'number' ? null : String(raw ?? '').replace('%', '').trim();
  if (text === '') return null;
  const n = typeof raw === 'number' ? raw : Number(text);
  if (!Number.isFinite(n) || n < 0 || n > MAX_FEE_PCT) return null;
  return Math.round(n * 100) / 100;
}

/**
 * Our fee on a stay, in cents: fee_pct of everything the guest pays except
 * occupancy tax (the nights, cleaning and extra-guest fees after any
 * discount). The tax is the host's to remit, so we take no cut of it.
 */
export function partnerFeeCents(totalCents: number, taxCents: number, feePct: number): number {
  const base = Math.max(0, Math.round(totalCents) - Math.max(0, Math.round(taxCents)));
  return Math.round((base * feePct) / 100);
}

/** True once the host's account can be charged and our fee is set. */
export function paymentsReady(a: PartnerPaymentAccount | null | undefined): boolean {
  return !!a && !!a.stripe_account_id && a.charges_enabled && a.fee_pct != null;
}

/** True when a card hold on this account can be accepted with a request. */
export function holdsAccepted(a: PartnerPaymentAccount | null | undefined): boolean {
  return !!a && !!a.stripe_account_id && a.fee_pct != null;
}

/** One line for the office: where the host's payments stand. */
export function accountStatusLabel(a: PartnerPaymentAccount | null | undefined, now: Date): string {
  if (!a || (!a.stripe_account_id && !a.setup_token_expires_at)) return 'Not set up';
  if (!a.stripe_account_id) {
    return a.setup_token_expires_at && Date.parse(a.setup_token_expires_at) > now.getTime()
      ? 'Setup link sent, the host has not opened it'
      : 'Setup link expired';
  }
  if (a.charges_enabled && a.payouts_enabled) return a.fee_pct == null ? 'Stripe is ready; set the fee' : 'Taking payments';
  if (a.charges_enabled) return 'Taking payments; Stripe needs bank details for payouts';
  if (a.details_submitted) return 'Stripe is reviewing the host';
  return a.requirements_due > 0 ? `Stripe needs ${a.requirements_due} more ${a.requirements_due === 1 ? 'thing' : 'things'} from the host` : 'The host started with Stripe';
}

// ─── The setup link ─────────────────────────────────────────────────────────

/** How long a setup link works. A host who needs longer gets a new one. */
export const SETUP_TOKEN_DAYS = 14;

const TOKEN = /^[A-Za-z0-9_-]{40,64}$/;

/** 256 random bits, URL-safe. Shown to the office once; only its hash is kept. */
export function newSetupToken(): string {
  return randomBytes(32).toString('base64url');
}

export function isSetupToken(s: unknown): s is string {
  return typeof s === 'string' && TOKEN.test(s);
}

export function hashSetupToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function setupTokenExpiry(now: Date): string {
  return new Date(now.getTime() + SETUP_TOKEN_DAYS * 86_400_000).toISOString();
}

/** The link the office sends the host. */
export function setupLinkFor(siteOrigin: string, token: string): string {
  return `${siteOrigin.replace(/\/+$/, '')}/host/payments/${token}`;
}

// ─── The hold on a request ──────────────────────────────────────────────────

export type HoldStatus = 'none' | 'held' | 'captured' | 'released' | 'failed';

export type RequestHold = {
  stripe_account_id: string;
  payment_intent_id: string;
  amount_cents: number;
  fee_cents: number;
};

export type HoldValidation = { ok: true; hold: RequestHold | null } | { ok: false; detail: string };

/** The `hold` on a bridge request body: absent, or exactly this shape. */
export function validateHold(raw: unknown): HoldValidation {
  if (raw == null) return { ok: true, hold: null };
  if (typeof raw !== 'object') return { ok: false, detail: 'hold must be an object' };
  const h = raw as Record<string, unknown>;
  if (typeof h.stripe_account_id !== 'string' || !ACCOUNT_ID.test(h.stripe_account_id)) return { ok: false, detail: 'hold.stripe_account_id is not a Stripe account id' };
  if (typeof h.payment_intent_id !== 'string' || !PAYMENT_INTENT_ID.test(h.payment_intent_id)) return { ok: false, detail: 'hold.payment_intent_id is not a payment intent id' };
  const amount = Number(h.amount_cents);
  const fee = Number(h.fee_cents);
  if (!Number.isInteger(amount) || amount <= 0) return { ok: false, detail: 'hold.amount_cents must be whole cents' };
  if (!Number.isInteger(fee) || fee < 0 || fee > amount) return { ok: false, detail: 'hold.fee_cents must be whole cents, at most the amount' };
  return { ok: true, hold: { stripe_account_id: h.stripe_account_id, payment_intent_id: h.payment_intent_id, amount_cents: amount, fee_cents: fee } };
}

/**
 * Does a hold match what Helm priced? The account must be the home's, the
 * amount the stay's total and the fee ours, to the cent. Null when it does;
 * otherwise what differs, for the log.
 */
export function holdMismatch(
  hold: RequestHold,
  expected: { stripe_account_id: string; amount_cents: number; fee_cents: number },
): string | null {
  if (hold.stripe_account_id !== expected.stripe_account_id) return 'the hold is on another Stripe account';
  if (hold.amount_cents !== expected.amount_cents) return `the hold is ${hold.amount_cents} cents, the stay is ${expected.amount_cents}`;
  if (hold.fee_cents !== expected.fee_cents) return `the fee is ${hold.fee_cents} cents, ours is ${expected.fee_cents}`;
  return null;
}

// ─── Settling a hold ────────────────────────────────────────────────────────

export type SettleAction = 'capture' | 'release';

export type SettleRow = {
  request_key: string;
  status: string;
  respond_by: string;
  hold_status: string;
  stripe_account_id: string | null;
  payment_intent_id: string | null;
  hold_cents: number | null;
};

export type SettleItem = {
  request_key: string;
  action: SettleAction;
  stripe_account_id: string;
  payment_intent_id: string;
  amount_cents: number;
};

/**
 * What the site should do with each live hold. An accepted request is
 * charged. A declined, withdrawn or closed one is released, and so is a
 * pending one whose clock ran out (it can no longer be accepted, and the
 * hourly cron has not stamped it yet). Anything else waits.
 */
export function settleActionFor(row: SettleRow, now: Date): SettleAction | null {
  if (row.hold_status !== 'held' || !row.stripe_account_id || !row.payment_intent_id || row.hold_cents == null) return null;
  if (row.status === 'accepted') return 'capture';
  if (row.status === 'declined' || row.status === 'withdrawn' || row.status === 'expired') return 'release';
  if (row.status === 'pending' && Date.parse(row.respond_by) <= now.getTime()) return 'release';
  return null;
}

export function settleQueue(rows: SettleRow[], now: Date): SettleItem[] {
  const out: SettleItem[] = [];
  for (const r of rows) {
    const action = settleActionFor(r, now);
    if (!action) continue;
    out.push({
      request_key: r.request_key,
      action,
      stripe_account_id: r.stripe_account_id as string,
      payment_intent_id: r.payment_intent_id as string,
      amount_cents: r.hold_cents as number,
    });
  }
  // Charges first: a guest waiting on a confirmation matters more.
  return out.sort((a, b) => (a.action === b.action ? 0 : a.action === 'capture' ? -1 : 1));
}

export type SettleOutcome = 'captured' | 'released' | 'capture_failed';

export type SettleReport = {
  request_key: string;
  payment_intent_id: string;
  outcome: SettleOutcome;
  charge_id: string | null;
  amount_cents: number | null;
  detail: string | null;
};

export type SettleReportValidation = { ok: true; report: SettleReport } | { ok: false; detail: string };

export function validateSettleReport(raw: unknown): SettleReportValidation {
  if (!raw || typeof raw !== 'object') return { ok: false, detail: 'body must be an object' };
  const b = raw as Record<string, unknown>;
  const key = typeof b.request_key === 'string' ? b.request_key.trim() : '';
  if (!key || key.length > 200) return { ok: false, detail: 'request_key is required' };
  if (typeof b.payment_intent_id !== 'string' || !PAYMENT_INTENT_ID.test(b.payment_intent_id)) return { ok: false, detail: 'payment_intent_id is not a payment intent id' };
  const outcome = b.outcome;
  if (outcome !== 'captured' && outcome !== 'released' && outcome !== 'capture_failed') return { ok: false, detail: "outcome must be 'captured', 'released' or 'capture_failed'" };
  const charge = b.charge_id == null ? null : String(b.charge_id);
  if (charge != null && !CHARGE_ID.test(charge)) return { ok: false, detail: 'charge_id is not a Stripe charge id' };
  const amount = b.amount_cents == null ? null : Number(b.amount_cents);
  if (amount != null && (!Number.isInteger(amount) || amount < 0)) return { ok: false, detail: 'amount_cents must be whole cents' };
  if (outcome === 'captured' && (charge == null || amount == null)) return { ok: false, detail: 'a capture reports its charge_id and amount_cents' };
  const detail = typeof b.detail === 'string' ? b.detail.replace(/\s+/g, ' ').trim().slice(0, 300) || null : null;
  return { ok: true, report: { request_key: key, payment_intent_id: b.payment_intent_id, outcome, charge_id: charge, amount_cents: amount, detail } };
}

/** The status a settle report moves a held request to. */
export function holdStatusAfter(outcome: SettleOutcome): HoldStatus {
  return outcome === 'captured' ? 'captured' : outcome === 'released' ? 'released' : 'failed';
}

// ─── What Stripe reports about an account ───────────────────────────────────

export type AccountStatusReport = {
  property_id: string;
  stripe_account_id: string;
  charges_enabled: boolean;
  payouts_enabled: boolean;
  details_submitted: boolean;
  requirements_due: number;
};

export function validateAccountStatus(raw: unknown): { ok: true; report: AccountStatusReport } | { ok: false; detail: string } {
  if (!raw || typeof raw !== 'object') return { ok: false, detail: 'body must be an object' };
  const b = raw as Record<string, unknown>;
  const pid = typeof b.property_id === 'string' ? b.property_id.trim() : '';
  if (!pid) return { ok: false, detail: 'property_id is required' };
  if (typeof b.stripe_account_id !== 'string' || !ACCOUNT_ID.test(b.stripe_account_id)) return { ok: false, detail: 'stripe_account_id is not a Stripe account id' };
  const due = Number(b.requirements_due ?? 0);
  if (!Number.isInteger(due) || due < 0 || due > 500) return { ok: false, detail: 'requirements_due must be a whole number' };
  return {
    ok: true,
    report: {
      property_id: pid,
      stripe_account_id: b.stripe_account_id,
      charges_enabled: b.charges_enabled === true,
      payouts_enabled: b.payouts_enabled === true,
      details_submitted: b.details_submitted === true,
      requirements_due: due,
    },
  };
}

// ─── Words on the review screen ─────────────────────────────────────────────

const usd = (cents: number) => `$${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: cents % 100 === 0 ? 0 : 2, maximumFractionDigits: 2 })}`;

/** One line about the card on a request. */
export function holdLine(r: { hold_status: string; hold_cents: number | null; fee_cents: number | null; hold_error: string | null; status: string }): string {
  const amount = r.hold_cents == null ? '' : ` ${usd(r.hold_cents)}`;
  const fee = r.fee_cents == null ? '' : ` · our fee ${usd(r.fee_cents)}`;
  switch (r.hold_status) {
    case 'held':
      return r.status === 'accepted' ? `Charging the card${amount}${fee}` : `Card held${amount}${fee}`;
    case 'captured':
      return `Charged${amount}${fee}`;
    case 'released':
      return `Hold released${amount}`;
    case 'failed':
      return `The card could not be charged${r.hold_error ? `: ${r.hold_error}` : ''}`;
    default:
      return 'No card on file';
  }
}
