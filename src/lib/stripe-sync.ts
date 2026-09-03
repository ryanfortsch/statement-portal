/**
 * Per-property Stripe sync logic, shared by:
 *   - /api/sync-stripe -- explicit "Sync Stripe" button on the dashboard;
 *     loops over every property in STRIPE_KEYS_JSON for a given month
 *   - /api/ingest -- runs automatically at the end of a single-property
 *     upload so the formula-estimated stripe fees get replaced with the
 *     real numbers from balance_transaction.fee before the response
 *     comes back to the operator
 *
 * Until 2026-05-03 the sync was only available via the explicit button,
 * which left a small drift on every freshly-ingested statement until
 * someone hit Sync. Auto-running it on ingest closes that gap so the
 * statement the operator clicks on right after upload already has actual
 * Stripe numbers, not estimates.
 *
 * Behavior summary:
 *   1. Pulls the property's successful Stripe charges in an 18-months-back
 *      / 2-months-forward window around the statement month. Charges older
 *      than 6 months back participate ONLY in the decisive matchers
 *      (confirmation-code aggregation, exact date-range) -- see
 *      chargeWindow() for why.
 *   2. Aggregates charges by confirmation code (reservations frequently
 *      have an initial + final-balance charge sharing one descriptor).
 *   3. For each reservation in the statement, replaces stripe_fee with
 *      the real summed fee, recomputes adjusted_revenue, and propagates
 *      the delta into property_statements totals.
 *   4. When Stripe shows MORE collected than Guesty's TOTAL_PAID (Guesty
 *      under-recording one of a two-installment payment plan, seen fleet-
 *      wide starting July 2026), rebuilds adjusted_revenue from Stripe
 *      actuals instead of just flagging it.
 *   5. Emits stripe_* data gaps for refunds, unreconstructed gross
 *      mismatches vs Guesty's TOTAL_PAID, and missing charges. Wipes
 *      prior stripe gaps on every run so re-runs don't accumulate
 *      duplicates.
 *
 * Airbnb + Booking.com reservations are skipped -- those don't flow
 * through Rising Tide's Stripe accounts.
 */

import type { SupabaseClient } from '@supabase/supabase-js';
import { occupancyTaxMultiplier } from '@/lib/occupancy-tax';
import { splitFolio } from '@/lib/remittance';
import { taxPortionOfNet } from '@/lib/addon-tax';
import { chargeWindow } from './stripe-window';
import { FUTURE_STAY_PRINCIPAL_MARK } from './extras-markers';
import { FREEZE_FROM_MONTH, getFreezeStatus } from '@/lib/statement-finality';
import { loadInstallmentsForCodes } from '@/lib/installments';
import { writeStatementTotals } from '@/lib/statement-totals-write';

export type StripeSyncResult = {
  property_id: string;
  charges_found: number;
  matched: number;
  unmatched_charges: string[];
  fee_updates: { code: string; guest: string; prev: number; next: number; delta: number }[];
  refunds_detected: { code: string; guest: string; amount: number }[];
  gross_mismatches: { code: string; guest: string; stripe: number; guesty: number }[];
  gross_reconstructions: { code: string; guest: string; stripe: number; guesty: number; prev_net: number; next_net: number; fee: number }[];
  collected_rebuilds: { code: string; guest: string; collected: number; folio: number; prev_net: number; next_net: number; fee: number }[];
  reservations_missing_charge: { code: string; guest: string; expected: number }[];
  /**
   * Report-only blind spots (2026-09 audit phase 2). None of these move a
   * stored value; they exist so a silent skip stops reading as "verified".
   */
  /** Charge matched, but Stripe returned no balance_transaction fee: the stay is STILL on the 3.9% estimate. */
  fee_unreadable?: { code: string; guest: string; gross: number; charges: number; reason: 'no_balance_transaction' | 'partial' }[];
  /** Collected-net rebuild ran on a gross that Guesty says is short: the visible charges may be truncated. */
  collected_rebuild_truncated?: { code: string; guest: string; collected: number; folio: number; guesty_total_paid: number }[];
  /** This property has RT-Stripe stays but no configured Stripe key, so it was never synced at all. */
  no_stripe_key?: boolean;
  /** True when the statement was already emailed to the owner; the sync wrote nothing. */
  skipped_sent?: boolean;
  error?: string;
};

type StripeCharge = {
  id: string;
  amount: number;              // cents
  amount_refunded: number;     // cents
  currency: string;
  created: number;             // unix seconds
  description: string | null;
  payment_intent: string | null;
  metadata?: Record<string, string> | null;
  application_fee_amount?: number | null;  // set on legacy Guesty Payments charges
  status: string;              // 'succeeded' | 'pending' | 'failed'
  refunded: boolean;
  paid: boolean;
  balance_transaction:
    | string
    | { id: string; fee: number; net: number; amount: number; currency: string }
    | null;
};

/**
 * Payment Link / Checkout charges often carry NO charge.description --
 * the human-readable text ("Kristen Oteri - 19 Rackliffe - July 22")
 * lives on the Checkout Session's line items instead. Recover it so
 * these charges can aggregate, match, and queue like described ones.
 * One extra API call per description-less charge, capped, failures
 * degrade to the old skip-it behavior.
 */
async function synthesizeLinkDescriptions(key: string, charges: StripeCharge[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const targets = charges.filter(c => !((c.description || '').trim()) && c.payment_intent).slice(0, 40);
  for (const c of targets) {
    try {
      const sessions = await stripeGet<{ data: { line_items?: { data?: { description?: string | null }[] } }[] }>(
        key,
        'checkout/sessions',
        { payment_intent: c.payment_intent as string, limit: '1', 'expand[]': ['data.line_items'] },
      );
      const names = (sessions.data?.[0]?.line_items?.data || [])
        .map(li => (li.description || '').trim())
        .filter(Boolean);
      if (names.length > 0) out.set(c.id, names.join(', '));
    } catch {
      // Leave it description-less; the aggregation loop reports it in
      // unmatched_charges the same way it always has.
    }
  }
  return out;
}

type ReservationRow = {
  id: string;
  confirmation_code: string;
  platform: string | null;
  guest_name: string | null;
  property_statement_id: string;
  guesty_rental_income: number;
  stripe_fee: number | null;
  adjusted_revenue: number | null;
  bank_match_status: string | null;
  check_in: string | null;
  check_out: string | null;
};

/**
 * Suggest which reservation a one-off Stripe charge (early check-in,
 * extra night, pet fee sold via a custom Payment Link) belongs to.
 *
 * Signal order:
 *   1. Guest-name token in the charge description (she usually types the
 *      guest's name into the link description) -- wins when exactly one
 *      reservation's guest matches.
 *   2. Charge date against the stay window. In-stay charges score 0
 *      (extensions are charged mid-stay); otherwise distance in days to
 *      the nearest stay edge (early check-in links are charged a few
 *      days before arrival). Nearest stay within 7 days wins.
 *
 * Purely a suggestion -- the operator confirms or overrides in the
 * review queue, so a wrong guess costs one dropdown change.
 */
function suggestReservationForCharge(
  reservations: ReservationRow[],
  chargeIso: string,
  description: string,
): string | null {
  const descLower = description.toLowerCase();
  const nameHits = reservations.filter(r => {
    const tokens = (r.guest_name || '').toLowerCase().split(/\s+/).filter(t => t.length >= 3);
    return tokens.some(t => descLower.includes(t));
  });
  if (nameHits.length === 1 && nameHits[0].confirmation_code) return nameHits[0].confirmation_code;

  const chargeMs = new Date(chargeIso + 'T00:00:00Z').getTime();
  const DAY = 86400000;
  let best: string | null = null;
  let bestDist = Infinity;
  const pool = nameHits.length > 1 ? nameHits : reservations;
  for (const r of pool) {
    if (!r.confirmation_code || !r.check_in || !r.check_out) continue;
    const ci = new Date(r.check_in + 'T00:00:00Z').getTime();
    const co = new Date(r.check_out + 'T00:00:00Z').getTime();
    if (!Number.isFinite(ci) || !Number.isFinite(co)) continue;
    const dist = chargeMs >= ci && chargeMs <= co
      ? 0
      : Math.min(Math.abs(chargeMs - ci), Math.abs(chargeMs - co));
    if (dist < bestDist) { bestDist = dist; best = r.confirmation_code; }
  }
  return bestDist <= 7 * DAY ? best : null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * The statement period (YYYY-MM) a far-future deposit/balance charge really
 * belongs to, parsed from its bridge request_key. The revenue is recognized
 * at CHECKOUT, so we take the last ISO date in the key:
 *   ffdeposit:<slug>:<check_in>:<check_out>:<cents>  -> check_out month
 *   ffbalcharge:<slug>:<check_in>                    -> check_in month
 * Returns '' when no date is present (unparseable / future-proofing).
 */
function futureStayPeriodFromKey(requestKey: string): string {
  const dates = requestKey.match(/\d{4}-\d{2}-\d{2}/g);
  const last = dates && dates.length ? dates[dates.length - 1] : '';
  return last ? last.slice(0, 7) : '';
}

/**
 * Report (as a data gap) a property that has RT-Stripe-channel stays this
 * month but NO configured Stripe key.
 *
 * syncPropertyStripe only ever runs for properties that HAVE a key, so a
 * keyless property is not "synced clean" -- it is never looked at. Its
 * VRBO/Manual/Direct fees keep the 3.9% + $0.40 estimate indefinitely and
 * nothing anywhere says so. Airbnb/Booking-only properties legitimately
 * need no key, so the gap is raised only when RT-Stripe stays exist.
 *
 * Report-only: writes one data_gaps row, never a money column. Fails
 * closed on a read error (throws) rather than reporting a false all-clear.
 */
export async function reportMissingStripeKey(
  supabase: SupabaseClient,
  opts: { propertyId: string; statementId: string; month: string },
): Promise<{ raised: boolean; rtStays: number }> {
  // A frozen statement is skipped by syncPropertyStripe, and that function's
  // gap wipe is the only thing besides this helper that clears the row. So a
  // gap written here after the statement is sent or the month is finalized
  // could never be cleared again -- it would sit on the owner's closed month
  // forever. The condition is a standing config fact; it will be reported on
  // the next open month instead.
  const freeze = await getFreezeStatus(supabase, { statementId: opts.statementId });
  if (freeze.frozen) return { raised: false, rtStays: 0 };

  const { data: rows, error } = await supabase
    .from('reservations')
    .select('platform, adjusted_revenue')
    .eq('property_statement_id', opts.statementId);
  if (error) throw new Error(`stripe key check: reservation read failed: ${error.message}`);
  // Revenue-bearing RT-Stripe stays only. A Manual row with no revenue is
  // a homeowner blocking their own house -- it has no Stripe charge to
  // verify, so counting it would raise this gap on properties that need no
  // key at all.
  const rtStays = (rows || []).filter(r => {
    const p = String(r.platform || '').toUpperCase();
    const isRT = p.includes('HOMEAWAY') || p === 'VRBO' || p === 'MANUAL' || p === 'DIRECT';
    return isRT && (Number(r.adjusted_revenue) || 0) > 0;
  }).length;

  // Idempotent: clear any prior row so repeated syncs never stack. Ordered
  // so a failure can never leave the statement with NO gap where it had one:
  // when there is nothing to re-raise we only delete (correct -- the
  // condition is resolved); when there is, the insert follows immediately
  // and its failure is reported to the caller.
  const { error: delErr } = await supabase
    .from('data_gaps')
    .delete()
    .eq('property_statement_id', opts.statementId)
    .eq('gap_type', 'stripe_key_missing');
  if (delErr) throw new Error(`stripe key check: gap cleanup failed: ${delErr.message}`);
  if (rtStays === 0) return { raised: false, rtStays: 0 };

  const { error: insErr } = await supabase.from('data_gaps').insert({
    property_statement_id: opts.statementId,
    gap_type: 'stripe_key_missing',
    severity: 'warning',
    description: `${rtStays} VRBO/Direct stay${rtStays === 1 ? '' : 's'} on this statement are paid through Rising Tide's own Stripe, but this property has no Stripe key configured in Helm, so its fees were never verified and are still the 3.9% + $0.40 estimate.`,
    expected_data: `Add STRIPE_KEY_${opts.propertyId.toUpperCase()} in Vercel with the property's restricted key, then run Sync Stripe.`,
    resolved: false,
  });
  if (insErr) throw new Error(`stripe key check: gap insert failed: ${insErr.message}`);
  return { raised: true, rtStays };
}

export function getStripeKeysMap(): Record<string, string> {
  // Three sources, most specific wins:
  //   1. STRIPE_KEYS_JSON        - the original Sensitive blob (9 legacy props)
  //   2. STRIPE_KEYS_JSON_EXTRA  - additive JSON overlay (84_thatcher era)
  //   3. STRIPE_KEY_<PROPERTY_ID> - ONE VAR PER PROPERTY, the standard going
  //      forward (Dotti 2026-07-21): value is the bare rk_live_ key, no JSON.
  //      Adding a property never opens an existing var, so a Sensitive flag
  //      or a paste slip can never take out the rest of the fleet.
  // Every reader (statements sync, installments verify-source, the
  // payment-links bridge) merges all three here.
  return {
    ...parseKeysVar('STRIPE_KEYS_JSON'),
    ...parseKeysVar('STRIPE_KEYS_JSON_EXTRA'),
    ...perPropertyKeyVars(),
  };
}

/** Scan env for STRIPE_KEY_<PROPERTY_ID> vars: STRIPE_KEY_3_LOCUST ->
 * {"3_locust": <value>}. Values are trimmed of stray quotes/whitespace.
 * Full-access secrets are REFUSED by policy - Helm only ever holds
 * restricted keys, so an sk_live_ paste is ignored rather than becoming a
 * live credential (visible in the payment-links GET diagnostic). */
export function perPropertyKeyVars(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, raw] of Object.entries(process.env)) {
    const m = /^STRIPE_KEY_([A-Z0-9_]+)$/.exec(name);
    if (!m || !raw) continue;
    const value = raw.trim().replace(/^["']|["']$/g, '').trim();
    if (!value || value.startsWith('sk_')) continue;
    out[m[1].toLowerCase()] = value;
  }
  return out;
}

/** Property ids whose per-property var holds a refused full-access secret
 * (sk_). Surfaced by the diagnostic so a wrong-key paste is visible instead
 * of silently ignored. */
export function refusedSecretKeyVars(): string[] {
  const out: string[] = [];
  for (const [name, raw] of Object.entries(process.env)) {
    const m = /^STRIPE_KEY_([A-Z0-9_]+)$/.exec(name);
    if (m && raw && raw.trim().replace(/^["']|["']$/g, '').startsWith('sk_')) {
      out.push(m[1].toLowerCase());
    }
  }
  return out;
}

function parseKeysVar(name: string): Record<string, string> {
  const raw = process.env[name] || '';
  if (!raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    return parsed as Record<string, string>;
  } catch {
    return {};
  }
}

async function stripeGet<T>(key: string, path: string, params: Record<string, string | string[]>): Promise<T> {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (Array.isArray(v)) v.forEach(item => q.append(k, item));
    else q.append(k, v);
  }
  const res = await fetch(`https://api.stripe.com/v1/${path}?${q.toString()}`, {
    headers: { Authorization: `Bearer ${key}` },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(`Stripe ${path} failed (${res.status}): ${body?.error?.message || JSON.stringify(body)}`);
  }
  return body as T;
}

async function listChargesAroundMonth(key: string, month: string): Promise<StripeCharge[]> {
  const { startUnix: start, endUnix: end } = chargeWindow(month);
  const charges: StripeCharge[] = [];
  let startingAfter: string | undefined;
  // Safety cap at 50 pages (5000 charges).
  for (let i = 0; i < 50; i++) {
    const params: Record<string, string | string[]> = {
      'created[gte]': String(start),
      'created[lt]': String(end),
      limit: '100',
      'expand[]': ['data.balance_transaction'],
    };
    if (startingAfter) params.starting_after = startingAfter;
    const page = await stripeGet<{ data: StripeCharge[]; has_more: boolean }>(key, 'charges', params);
    charges.push(...page.data);
    if (!page.has_more || page.data.length === 0) break;
    startingAfter = page.data[page.data.length - 1].id;
  }
  return charges;
}

/**
 * Sync one property's Stripe charges against its reservations for a
 * single statement month. Mutates the DB (reservations.stripe_fee,
 * property_statements totals, data_gaps) in place. Returns a per-property
 * result object the caller can show the operator.
 *
 * Caller responsibilities:
 *   - Pass in the already-fetched property_statements row (only the
 *     fields listed below are needed). We don't refetch because both
 *     callers already have it in hand.
 *   - Don't pre-filter for "should we run this" -- the function returns
 *     a result with charges_found=0 if nothing matches, which is a
 *     legitimate state on quiet months.
 */
export async function syncPropertyStripe(opts: {
  supabase: SupabaseClient;
  propertyId: string;
  restrictedKey: string;
  month: string;
  stmt: {
    id: string;
    management_fee_pct: number;
    cleaning_total: number;
    repairs_total: number;
    reserve_holdback?: number;
  };
}): Promise<StripeSyncResult> {
  const { supabase, propertyId, restrictedKey, month, stmt } = opts;

  const result: StripeSyncResult = {
    property_id: propertyId,
    charges_found: 0,
    matched: 0,
    unmatched_charges: [],
    fee_updates: [],
    refunds_detected: [],
    gross_mismatches: [],
    gross_reconstructions: [],
    collected_rebuilds: [],
    reservations_missing_charge: [],
  };

  try {
    // HARD GATE (2026-08-02): a statement that has been EMAILED to the
    // owner never shifts again. 36 Granite's July email went out at
    // 14:31 UTC and a sync moved its payout $21.60 ten minutes later --
    // the owner's PDF and Helm silently diverged. Post-send corrections
    // are an operator decision on the NEXT month's statement, never an
    // automatic rewrite of a sent one. Sent-ness = close_tasks
    // email_sent_at for this period + property (stamped by /api/draft-
    // email's send flow).
    //
    // 2026-09 (finality phase 1): the gate also honors the period-level
    // freeze (statement_periods.status = 'final', the Finalize Month
    // button) so the nightly cron cannot keep moving payouts in a month
    // the operator closed as a whole. And the gate now fails CLOSED for
    // months >= FREEZE_FROM_MONTH: if the freeze state cannot be read,
    // the sync skips this property rather than assuming it is writable.
    const { data: periodRow, error: periodErr } = await supabase
      .from('statement_periods')
      .select('id, status')
      .eq('month', month)
      .maybeSingle();
    if (periodErr && month >= FREEZE_FROM_MONTH) {
      result.error = `finality check failed (period read): ${periodErr.message}; skipping to avoid writing a possibly-frozen statement`;
      return result;
    }
    if (periodRow?.status === 'final' && month >= FREEZE_FROM_MONTH) {
      result.skipped_sent = true;
      return result;
    }
    if (periodRow?.id) {
      const { data: closeTask, error: taskErr } = await supabase
        .from('close_tasks')
        .select('email_sent_at')
        .eq('period_id', periodRow.id)
        .eq('property_id', propertyId)
        .maybeSingle();
      if (taskErr && month >= FREEZE_FROM_MONTH) {
        result.error = `finality check failed (close_tasks read): ${taskErr.message}; skipping to avoid writing a possibly-sent statement`;
        return result;
      }
      if (closeTask?.email_sent_at) {
        result.skipped_sent = true;
        return result;
      }
    }

    const charges = await listChargesAroundMonth(restrictedKey, month);
    const succeeded = charges.filter(c => c.status === 'succeeded' || c.paid);
    result.charges_found = succeeded.length;

    // This statement-month's reservations -- the rows we may update fees
    // on and emit gaps for.
    const { data: rRes } = await supabase
      .from('reservations')
      .select('id, confirmation_code, platform, guest_name, property_statement_id, guesty_rental_income, stripe_fee, adjusted_revenue, bank_match_status, check_in, check_out')
      .eq('property_statement_id', stmt.id);
    const reservations: ReservationRow[] = (rRes || []) as ReservationRow[];
    const byCode = new Map<string, ReservationRow>();
    for (const r of reservations) if (r.confirmation_code) byCode.set(r.confirmation_code, r);

    // Installment-aware guard. Cross-month installment bookings (a long
    // stay split across months via reservation_installments) already have
    // their per-month adjusted_revenue set to the NET installment amount
    // and a PRORATED stripe_fee written by ingest's installment fork.
    // Stripe-sync must NOT overwrite those: the full-stay Stripe charge
    // (e.g. one $65k Payment Link) would otherwise get matched to a single
    // month's row and dump the entire fee on that one month, corrupting
    // adjusted_revenue and the statement total. For any code with
    // installment rows we still match/report the charge, but leave the
    // fee + adjusted_revenue exactly as ingest wrote them.
    // Read through the shared loader, which FAILS CLOSED (2026-09 audit
    // phase 2). This query used to discard its error: an unreadable split
    // table produced an EMPTY code set, which reads as "nothing here is
    // split" -- and the guard below then does the exact thing it exists to
    // prevent, dumping a full-stay Payment Link fee onto one month's row.
    // A throw here is caught by this function's outer catch and reported
    // as this property's sync error, leaving every stored value untouched.
    const installmentCodes = new Set<string>(
      (await loadInstallmentsForCodes(
        supabase,
        reservations.map(r => r.confirmation_code).filter(Boolean) as string[],
      )).keys(),
    );

    // Cross-month known codes for this property -- used to distinguish
    // "real orphan charge" (no reservation anywhere) from "charge for a
    // stay in a different statement month" (normal: guests pay months
    // before check-in).
    const { data: allStmtsThisProp } = await supabase
      .from('property_statements')
      .select('id')
      .eq('property_id', propertyId);
    const thisPropStmtIds = new Set((allStmtsThisProp || []).map(s => s.id));

    const { data: crossMonthRes } = await supabase
      .from('reservations')
      .select('confirmation_code, property_statement_id')
      .not('confirmation_code', 'is', null);
    const knownCodesThisProp = new Set(
      (crossMonthRes || [])
        .filter(r => r.property_statement_id && thisPropStmtIds.has(r.property_statement_id))
        .map(r => r.confirmation_code as string),
    );
    const { data: guestyAllForProp } = await supabase
      .from('guesty_reservations')
      .select('confirmation_code')
      .eq('property_id', propertyId);
    for (const g of guestyAllForProp || []) {
      if (g.confirmation_code) knownCodesThisProp.add(g.confirmation_code);
    }

    // TOTAL_PAID + TOTAL_TAXES on this month's reservations. TOTAL_PAID is
    // used for the gross-mismatch check; taxes feed the amount-based
    // fallback matcher below (Stripe charges the guest's full gross, taxes
    // included, while guesty_rental_income is the pre-tax channel-net).
    //
    // `folio_items` is read because `total_taxes` is a CACHE of the folio's
    // tax lines that Guesty leaves NULL on any listing whose tax config does
    // not itemize, and on reservations created by hand. lib/remittance.ts
    // learned this in August (its docblock: the scalar "is the fallback,
    // never the source") after four properties silently fell off the tax
    // sheet; this matcher was still trusting the scalar.
    //
    // The cost of the miss is a fee that never gets corrected. With taxes
    // NULL the expected gross collapses to the pre-tax rent, so the search
    // is for a charge that does not exist -- Stripe billed the guest the
    // tax-inclusive total -- no candidate matches, and the row keeps the
    // 3.9% + $0.40 placeholder forever while raising a stripe_missing_charge
    // gap that reads as "no charge found" rather than "looked for the wrong
    // number". Found on 17 Beach's Brian Guest Spillover GY-EcKUjyqJ: hunted
    // $1,050.00, the charge was $1,172.85, real fee $34.31 against a $41.35
    // estimate.
    const codesForThisProp = reservations.map(r => r.confirmation_code).filter(Boolean);
    const { data: gRes } = codesForThisProp.length
      ? await supabase.from('guesty_reservations').select('confirmation_code, total_paid, total_taxes, folio_items').in('confirmation_code', codesForThisProp)
      : { data: [] as { confirmation_code: string; total_paid: number | null; total_taxes: number | null; folio_items: unknown }[] };
    const grossByCode = new Map<string, number>();
    const taxesByCode = new Map<string, number>();
    (gRes || []).forEach(g => {
      if (!g.confirmation_code) return;
      if (g.total_paid != null) grossByCode.set(g.confirmation_code, g.total_paid);
      if (g.total_taxes != null) {
        taxesByCode.set(g.confirmation_code, g.total_taxes);
        return;
      }
      // Scalar absent: derive from the folio Guesty itself computed. Only a
      // positive tax is worth recording -- a folio with no tax line at all
      // (Airbnb, or the 32+ night exemption) is genuinely zero-tax and the
      // pre-tax rent already IS the expected gross.
      const folioTax = splitFolio(g.folio_items).tax;
      if (folioTax > 0) taxesByCode.set(g.confirmation_code, folioTax);
    });

    // The same folios kept whole, for applyCollectedNet's inversion. Unlike
    // taxesByCode this is populated even when the scalar was present, because
    // the inversion wants THIS stay's own rate rather than a cache of it.
    const folioByCode = new Map<string, { tax: number; preTax: number }>();
    (gRes || []).forEach(g => {
      if (!g.confirmation_code) return;
      const f = splitFolio(g.folio_items);
      if (f.hasFolio) folioByCode.set(g.confirmation_code, { tax: f.tax, preTax: f.preTax });
    });

    // Aggregate Stripe charges. For Guesty-routed bookings the description
    // starts with the confirmation code (HM..., HA-, GY-, BC-) and multiple
    // captures of the same reservation aggregate cleanly under that code.
    // SCA / staycapeann.com Payment Link descriptions all start with the
    // same word ("Stay at <name> - YYYY-MM-DD...") -- aggregating those by
    // first-token would collapse every SCA charge in the month into one big
    // "Stay" pile and defeat the amount-based fallback below. Keep those
    // atomic by using the charge id as the grouping key.
    const GUESTY_CODE = /^(HM|HA-|GY-|BC-)[A-Za-z0-9-]+/;
    // helmRequestKey: stamped on the charge (payment_intent_data metadata) by
    // /api/payment-links. Its presence means "bridge-minted add-on link":
    // that money belongs to the extras review queue by construction, so the
    // stay-payment fallbacks below must never consume it, and the queue's
    // reservation preselect can resolve the guest from payment_link_requests
    // instead of parsing the description. Pre-metadata links (minted before
    // 2026-08-20) have null here and keep the description-parsing paths.
    // fuzzyEligible: charge is Guesty-coded or created inside the legacy
    // 6-month window (chargeWindow().fuzzyCutoffUnix). Pre-cutoff
    // non-coded charges exist only for the date-range matcher.
    type Agg = { grossCents: number; refundedCents: number; feeCents: number; feeKnown: boolean; feeChargeCount: number; chargeCount: number; displayLabel: string; fullDesc: string; createdUnix: number; isGuestyCoded: boolean; hasAppFee: boolean; helmRequestKey: string | null; fuzzyEligible: boolean };
    const { fuzzyCutoffUnix } = chargeWindow(month);
    const byCodeAgg = new Map<string, Agg>();
    const orphanCodes: { code: string; amount: number; displayLabel: string }[] = [];

    // Recover line-item text for description-less Payment Link charges
    // before aggregating, so they can match and queue like the rest.
    const synthDesc = await synthesizeLinkDescriptions(restrictedKey, succeeded);

    for (const charge of succeeded) {
      const desc = ((charge.description || synthDesc.get(charge.id) || '')).trim();
      const firstToken = desc.split(/\s+/)[0];
      // Guesty-coded charges aggregate by code; custom Payment Link charges
      // stay atomic so the orphan list shows one entry per real charge.
      // A charge with no description AND no recoverable line-item text stays
      // in play as an atomic orphan too: the amount-based fallback matches on
      // gross alone, and the extras queue wants the money either way.
      // Dropping these left flat-priced Payment Link stays permanently stuck
      // on the 3.9% fee estimate.
      const looksLikeCode = !!firstToken && GUESTY_CODE.test(firstToken);
      const code = looksLikeCode ? firstToken : charge.id;
      const label = desc || `(no description) …${charge.id.slice(-8)}`;
      const displayLabel = looksLikeCode ? firstToken : (label.length > 48 ? label.slice(0, 45) + '…' : label);

      const agg = byCodeAgg.get(code) || { grossCents: 0, refundedCents: 0, feeCents: 0, feeKnown: false, feeChargeCount: 0, chargeCount: 0, displayLabel, fullDesc: label, createdUnix: charge.created, isGuestyCoded: looksLikeCode, hasAppFee: false, helmRequestKey: (charge.metadata?.helm_request_key || '').trim() || null, fuzzyEligible: false };
      agg.fuzzyEligible = agg.fuzzyEligible || looksLikeCode || charge.created >= fuzzyCutoffUnix;
      agg.grossCents += charge.amount;
      agg.refundedCents += charge.amount_refunded;
      const fee = (charge.balance_transaction && typeof charge.balance_transaction !== 'string')
        ? charge.balance_transaction.fee
        : null;
      if (fee != null) { agg.feeCents += fee; agg.feeKnown = true; agg.feeChargeCount += 1; }
      // Legacy Guesty Payments charges carry an application fee on top of
      // Stripe's; the collected-net rebuild below skips those (its simple
      // gross/1.117 inversion would miss the ~1% Guesty cut).
      if ((charge.application_fee_amount || 0) > 0) agg.hasAppFee = true;
      agg.chargeCount += 1;
      byCodeAgg.set(code, agg);
    }

    const matchedCodes = new Set<string>();

    // Collected-net rebuild (Dotti 2026-08-01/02: "we don't wear the promo
    // spend - revenue is what's coming in; we change prices all the
    // time"). A Direct/SCA stay's Guesty folio routinely disagrees with
    // the money that actually landed - opening discounts, price edits
    // between quote and reservation, drift inside the booking flow's 2%
    // tolerance. Whatever the cause, the owner's recognized revenue
    // follows the charge:
    //   net = (collected_gross / tax_multiplier) - actual_fee
    // (the multiplier inverts the occupancy rate the guest was actually
    // charged -- 1.117 base, 1.147 for CIF properties like 79 Main, per
    // lib/occupancy-tax keyed on the CHARGE's creation date so pre-CIF
    // charges keep inverting at 11.7%. The charge total is tax-inclusive,
    // and only the pre-tax share is rent revenue.)
    // Manual/Direct only: VRBO grosses carry channel-commission
    // semantics, and legacy Guesty Payments charges (application fee)
    // plus 29+ night stays (MA occupancy tax does not apply to 31+ day
    // rentals, so the inversion would misprice them) bail to the plain
    // fee path and the operator flags. Derives from stored columns,
    // never the current adjusted value, so re-syncs are idempotent.
    // Returns true when the row was handled here (written or already
    // agreeing within $1); the caller then skips the plain fee write.
    // Report-only: a matched stay whose real fee Stripe would not hand over
    // (restricted key without balance_transaction read, most often) keeps the
    // 3.9% estimate. Silence there is indistinguishable from "already
    // correct", which is how an estimate survives forever. Frozen classes
    // (paid_off_stripe, installment slices) are excluded deliberately -- their
    // fees are meant to stand, so flagging them would be pure noise.
    const noteFeeUnreadable = (
      row: { confirmation_code: string; guest_name: string | null; stripe_fee: number | null; bank_match_status: string | null },
      gross: number,
      charges: number,
      reason: 'no_balance_transaction' | 'partial',
    ) => {
      if (row.stripe_fee == null) return;
      if (row.bank_match_status === 'paid_off_stripe') return;
      if (installmentCodes.has(row.confirmation_code)) return;
      (result.fee_unreadable ||= []).push({
        code: row.confirmation_code, guest: row.guest_name || 'Guest', gross, charges, reason,
      });
    };

    const applyCollectedNet = async (
      res: ReservationRow,
      agg: { grossCents: number; refundedCents: number; feeCents: number; feeKnown: boolean; hasAppFee: boolean; createdUnix: number },
    ): Promise<boolean> => {
      if ((res.platform || '').toUpperCase() !== 'MANUAL') return false;
      if (!agg.feeKnown || agg.refundedCents > 0 || agg.hasAppFee) return false;
      if (res.stripe_fee == null || res.bank_match_status === 'paid_off_stripe' || installmentCodes.has(res.confirmation_code)) return false;
      const base = res.guesty_rental_income || 0;
      if (base <= 0 || !res.check_in || !res.check_out) return false;
      const nights = Math.round((new Date(res.check_out + 'T00:00:00Z').getTime() - new Date(res.check_in + 'T00:00:00Z').getTime()) / 86400000);
      if (!Number.isFinite(nights) || nights <= 0 || nights > 28) return false;
      const collectedGross = round2(agg.grossCents / 100);
      // Every Direct charge reads tax-inclusive, INCLUDING flat-rent links
      // where the operator charged the pre-tax folio amount with no tax
      // added (Dahlia's $275 extension night on 36 Granite). Dotti's
      // ruling 2026-08-02: occupancy tax comes out of whatever the guest
      // paid, so the owner's rent share on a $275 flat link is $275/1.117.
      // The tax still gets remitted either way; this decides who bears it.
      const chargeIso = new Date(agg.createdUnix * 1000).toISOString().slice(0, 10);
      // Invert at THIS STAY'S rate, taken from its own folio, and fall back to
      // the property-level map only when the booking has no folio to speak
      // for itself.
      //
      // A property-level rate cannot express a per-stay exception, and 17
      // Beach had one: every Direct/VRBO folio there billed the 3% Community
      // Impact Fee, except Brian Guest Spillover GY-EcKUjyqJ, whose CIF line
      // was hand-zeroed (metadata.override) so the guest genuinely paid 11.7%.
      // Inverting his $1,172.85 at the property's 1.147 recognized $1,022.54
      // of rent against a folio that plainly says $1,050.00, and took $15.93
      // off the owner. The folio is the per-booking truth; the map is a
      // fleet-level approximation of it.
      //
      // This also survives a rate CHANGE cleanly. When a listing's tax config
      // is corrected, bookings confirmed beforehand keep their locked folio
      // lines at the old rate, and each one now inverts at the rate written on
      // it rather than at whatever the property is charging today.
      const stayFolio = folioByCode.get(res.confirmation_code);
      const stayMultiplier = stayFolio && stayFolio.preTax > 0 && stayFolio.tax > 0
        ? (stayFolio.preTax + stayFolio.tax) / stayFolio.preTax
        : occupancyTaxMultiplier(propertyId, chargeIso);
      const collectedPreTax = round2(collectedGross / stayMultiplier);
      const actualFee = round2(agg.feeCents / 100);
      if (Math.abs(collectedPreTax - base) <= 1) {
        // Folio and charge agree at the property's true tax rate. Still
        // snap the row to the absolute base - fee: a PRIOR sync that ran
        // with the wrong rate can have left an inflated net behind (79
        // Main July: 1.117 inversion counted the guest's 3% CIF as rent,
        // over-crediting the owner $132.74 across two stays; Dotti
        // 2026-08-02: tax comes out of revenue). The plain fee path only
        // writes deltas when the FEE changes, so it can never heal a
        // wrong net that carries the right fee -- this absolute write
        // can, and is a no-op when the row is already correct.
        const agreeNet = round2(base - actualFee);
        const prevAgreeNet = round2(res.adjusted_revenue || 0);
        if (agreeNet > 0 && (prevAgreeNet !== agreeNet || round2(res.stripe_fee) !== actualFee)) {
          await supabase
            .from('reservations')
            .update({ stripe_fee: actualFee, adjusted_revenue: agreeNet })
            .eq('id', res.id);
          result.collected_rebuilds.push({
            code: res.confirmation_code, guest: res.guest_name || 'Guest',
            collected: collectedGross, folio: base,
            prev_net: prevAgreeNet, next_net: agreeNet, fee: actualFee,
          });
        }
        return true;
      }
      if (collectedPreTax < base * 0.5 || collectedPreTax > base * 1.5) return false; // implausible: likely wrong charge
      // Evidence that what we can SEE is not all the money: Guesty recorded a
      // larger TOTAL_PAID than the charges matched here. The rebuild below is
      // deliberately left exactly as it was (changing it moves an owner
      // payout and needs its own approval + parity harness); this only tells
      // the operator the input may be truncated.
      {
        const guestyPaid = grossByCode.get(res.confirmation_code) ?? null;
        if (collectedPreTax < base && guestyPaid != null && guestyPaid > collectedGross + 1) {
          (result.collected_rebuild_truncated ||= []).push({
            code: res.confirmation_code, guest: res.guest_name || 'Guest',
            collected: collectedGross, folio: base, guesty_total_paid: guestyPaid,
          });
        }
      }
      const nextNet = round2(collectedPreTax - actualFee);
      if (nextNet <= 0) return false;
      const prevNet = round2(res.adjusted_revenue || 0);
      if (prevNet !== nextNet || round2(res.stripe_fee) !== actualFee) {
        await supabase
          .from('reservations')
          .update({ stripe_fee: actualFee, adjusted_revenue: nextNet })
          .eq('id', res.id);
        result.collected_rebuilds.push({
          code: res.confirmation_code, guest: res.guest_name || 'Guest',
          collected: round2(agg.grossCents / 100), folio: base,
          prev_net: prevNet, next_net: nextNet, fee: actualFee,
        });
      }
      return true;
    };

    for (const [code, agg] of byCodeAgg.entries()) {
      const res = byCode.get(code);
      if (!res) {
        if (!knownCodesThisProp.has(code)) {
          orphanCodes.push({ code, amount: round2(agg.grossCents / 100), displayLabel: agg.displayLabel });
        }
        continue;
      }
      matchedCodes.add(code);
      result.matched++;

      const p = (res.platform || '').toUpperCase();
      const isRTStripeChannel = p.includes('HOMEAWAY') || p === 'VRBO' || p === 'MANUAL';
      if (!isRTStripeChannel) continue;

      const stripeGross = round2(agg.grossCents / 100);
      const refunded = round2(agg.refundedCents / 100);
      const actualFee = agg.feeKnown ? round2(agg.feeCents / 100) : null;
      if (actualFee == null) noteFeeUnreadable(res, stripeGross, agg.chargeCount, 'no_balance_transaction');
      else if (agg.feeChargeCount < agg.chargeCount) noteFeeUnreadable(res, stripeGross, agg.chargeCount, 'partial');

      const guestyGross = grossByCode.get(code);
      const mismatched = guestyGross != null && Math.abs(guestyGross - stripeGross) > 1;
      const rowWritable = actualFee != null && res.stripe_fee != null
        && res.bank_match_status !== 'paid_off_stripe' && !installmentCodes.has(code);

      if (refunded > 0) {
        result.refunds_detected.push({ code, guest: res.guest_name || 'Guest', amount: refunded });
      }

      // Stripe-actuals reconstruction (Dotti 2026-08-01). Starting July
      // 2026 Guesty's TOTAL_PAID began under-reporting two-installment
      // stays: exactly one of the guest's 50/50 payments, while both
      // charges sit succeeded in Stripe. Ingest builds adjusted_revenue
      // from TOTAL_PAID for VRBO/Manual stays, so those statements
      // under-recognize revenue by roughly half the stay. When Stripe --
      // the account the money actually landed in -- shows MORE collected
      // than Guesty recorded, rebuild the net from Stripe actuals using
      // the same formula ingest uses, with the real summed fee:
      //   net = stripe_gross - taxes - commission - actual_fee
      // Commission mirrors ingest's post-kludge semantics: 5% of pre-tax
      // for VRBO, 0 for Manual/Direct (total_taxes is booking-level, so
      // it is correct against the full gross). Guarded to only ever
      // revise upward, never on refunded or installment-split rows;
      // anything that fails a guard falls through to the old flag-only
      // gross_mismatch behavior.
      let reconstructedRow = false;
      if (mismatched && rowWritable && refunded === 0 && stripeGross > (guestyGross as number) + 1) {
        const taxes = taxesByCode.get(code) ?? 0;
        const preTax = Math.max(stripeGross - taxes, 0);
        const isVrbo = p.includes('HOMEAWAY') || p === 'VRBO';
        const commission = isVrbo ? round2(preTax * 0.05) : 0;
        const nextNet = round2(stripeGross - taxes - commission - (actualFee as number));
        const prevNet = round2(res.adjusted_revenue || 0);
        if (nextNet > prevNet && nextNet > 0) {
          await supabase
            .from('reservations')
            .update({ stripe_fee: actualFee, adjusted_revenue: nextNet })
            .eq('id', res.id);
          result.gross_reconstructions.push({
            code, guest: res.guest_name || 'Guest',
            stripe: stripeGross, guesty: guestyGross as number,
            prev_net: prevNet, next_net: nextNet, fee: actualFee as number,
          });
          reconstructedRow = true;
        }
      }

      // A row frozen paid_off_stripe is an operator statement that the
      // money is settled by hand (Barry Allen 2026-08-31: net corrected
      // from verified Stripe actuals after Guesty logged half). Flagging
      // its Stripe-vs-Guesty spread every sync would nag about the very
      // discrepancy the operator already resolved.
      if (mismatched && !reconstructedRow && res.bank_match_status !== 'paid_off_stripe') {
        result.gross_mismatches.push({ code, guest: res.guest_name || 'Guest', stripe: stripeGross, guesty: guestyGross as number });
      }

      // Replace estimate with actual whenever Stripe returned the fee --
      // every penny matters because deltas snowball across N reservations.
      // Skip rows marked paid_off_stripe (paid by check/wire; their
      // stripe_fee is intentionally fixed). A reconstructed row already
      // carries the actual fee inside its rebuilt net. A Direct stay
      // whose charge disagrees with the folio rebuilds absolutely from
      // the collected amount instead.
      if (!reconstructedRow && rowWritable) {
        const rebuilt = await applyCollectedNet(res, agg);
        if (!rebuilt) {
          const prev = round2(res.stripe_fee as number);
          if (prev !== actualFee) {
            const deltaFee = round2((actualFee as number) - prev);
            const newAdjusted = round2((res.adjusted_revenue || 0) - deltaFee);
            await supabase
              .from('reservations')
              .update({ stripe_fee: actualFee, adjusted_revenue: newAdjusted })
              .eq('id', res.id);
            result.fee_updates.push({ code, guest: res.guest_name || 'Guest', prev, next: actualFee as number, delta: deltaFee });
          }
        }
      }
    }

    // Amount-based fallback. Stripe descriptions on custom Payment Links
    // (Direct/Manual stays paid through RT's own checkout, not Guesty's)
    // don't lead with a Guesty confirmation code, so the description-token
    // matcher above misses them. For each still-unmatched RT-Stripe
    // reservation, compute the expected Stripe gross and look for an
    // orphan charge that matches within $1. Only links if exactly one
    // orphan matches -- ambiguity falls through to the missing-charge gap.
    //
    // Charge-id-keyed orphans linked here get their dedupe keys recorded
    // so any pending review-queue row from a PRIOR sync (when the charge
    // was still orphan) is cleaned up below.
    const linkedOrphanKeys: string[] = [];
    for (const r of reservations) {
      if (matchedCodes.has(r.confirmation_code)) continue;
      const p = (r.platform || '').toUpperCase();
      const isRTStripeChannel = p.includes('HOMEAWAY') || p === 'VRBO' || p === 'MANUAL';
      if (!isRTStripeChannel) continue;
      const isHomeownerStay = p === 'MANUAL' && (!r.guesty_rental_income || r.guesty_rental_income === 0);
      if (isHomeownerStay) continue;

      // Stripe charges the guest the full gross: rental + taxes. If
      // guesty_reservations has TOTAL_PAID populated use that; else
      // reconstruct from guesty_rental_income + total_taxes.
      const knownGross = grossByCode.get(r.confirmation_code) || 0;
      const reconstructed = round2((r.guesty_rental_income || 0) + (taxesByCode.get(r.confirmation_code) || 0));
      const expectedGross = knownGross > 0 ? knownGross : reconstructed;
      if (expectedGross <= 0) continue;

      // Fully-refunded charges can never be the stay's payment, so they
      // don't get to create ambiguity either. Kristen Oteri's $600
      // one-nighter on 19 Rackliffe: the guest double-paid a Payment
      // Link and one charge was refunded -- two identical $600 orphans
      // made candidates.length 2 and the stay sat on the fee estimate,
      // flagged missing, while the real money was right there.
      const isFullyRefunded = (code: string) => {
        const a = byCodeAgg.get(code);
        return !!a && a.grossCents > 0 && a.refundedCents >= a.grossCents;
      };
      // Bridge-minted add-on links (helm_request_key metadata) are excluded:
      // an early check-in fee that happens to equal a stay's expected gross
      // must queue as an add-on, not get consumed as the stay's payment.
      const isHelmAddOn = (code: string) => !!byCodeAgg.get(code)?.helmRequestKey;
      // Pre-cutoff non-coded charges (see chargeWindow) never enter the
      // amount pool: they can neither match nor create ambiguity, keeping
      // this fallback identical to the 6-month-window behavior.
      const isFuzzyEligible = (code: string) => !!byCodeAgg.get(code)?.fuzzyEligible;
      const candidates = orphanCodes.filter(o => Math.abs(o.amount - expectedGross) <= 1 && isFuzzyEligible(o.code) && !isFullyRefunded(o.code) && !isHelmAddOn(o.code));
      if (candidates.length !== 1) continue;
      const orphan = candidates[0];
      const agg = byCodeAgg.get(orphan.code);
      if (!agg) continue;

      // Treat as matched. Remove from orphan list / aggregates so the
      // existing reporting blocks see it as paired.
      matchedCodes.add(r.confirmation_code);
      result.matched += 1;
      orphanCodes.splice(orphanCodes.indexOf(orphan), 1);
      byCodeAgg.delete(orphan.code);
      if (!agg.isGuestyCoded) linkedOrphanKeys.push(`stripe:${orphan.code}`);

      // Replace the approximated fee with Stripe's actual whenever the
      // balance_transaction was returned -- same write the description-
      // match path does. Skip rows marked paid_off_stripe. A Direct stay
      // whose charge disagrees with the folio rebuilds from collected.
      const actualFee = agg.feeKnown ? round2(agg.feeCents / 100) : null;
      if (actualFee == null) noteFeeUnreadable(r, orphan.amount, agg.chargeCount, 'no_balance_transaction');
      else if (agg.feeChargeCount < agg.chargeCount) noteFeeUnreadable(r, orphan.amount, agg.chargeCount, 'partial');
      const rebuilt = await applyCollectedNet(r, agg);
      if (!rebuilt && actualFee != null && r.stripe_fee != null && r.bank_match_status !== 'paid_off_stripe' && !installmentCodes.has(r.confirmation_code)) {
        const prev = round2(r.stripe_fee);
        if (prev !== actualFee) {
          const deltaFee = round2(actualFee - prev);
          const newAdjusted = round2((r.adjusted_revenue || 0) - deltaFee);
          await supabase
            .from('reservations')
            .update({ stripe_fee: actualFee, adjusted_revenue: newAdjusted })
            .eq('id', r.id);
          result.fee_updates.push({ code: r.confirmation_code, guest: r.guest_name || 'Guest', prev, next: actualFee, delta: deltaFee });
        }
      }

      const refunded = round2(agg.refundedCents / 100);
      if (refunded > 0) {
        result.refunds_detected.push({ code: r.confirmation_code, guest: r.guest_name || 'Guest', amount: refunded });
      }
    }

    // Date-range fallback (Dotti 2026-08-01: "use the actuals from
    // Stripe"). SCA Payment Link descriptions carry the stay window
    // ("Stay at Gloucester Harbor - 2026-07-27 to 2026-07-31"). On a
    // property where Guesty has neither TOTAL_PAID nor total_taxes (the
    // 19 Rackliffe pattern), the amount fallback expects the pre-tax
    // figure and can never see the tax-inclusive charge ($4,643.44
    // expected vs $5,128.71 charged), so the 3.9% fee estimate survived
    // every sync. The Stripe account is per-property and the description
    // names the exact stay dates, so check-in/check-out equality is
    // decisive. Sum every orphan charge carrying the range (split
    // payments share one description) and write the summed actual fee.
    // The range must belong to exactly one still-unmatched reservation:
    // cancel-and-rebook can leave two rows around one window, and a
    // wrong link writes money onto the wrong guest.
    const DATE_RANGE_RE = /(\d{4}-\d{2}-\d{2})\s+to\s+(\d{4}-\d{2}-\d{2})/;
    for (const r of reservations) {
      if (matchedCodes.has(r.confirmation_code)) continue;
      const p = (r.platform || '').toUpperCase();
      const isRTStripeChannel = p.includes('HOMEAWAY') || p === 'VRBO' || p === 'MANUAL';
      if (!isRTStripeChannel) continue;
      const isHomeownerStay = p === 'MANUAL' && (!r.guesty_rental_income || r.guesty_rental_income === 0);
      if (isHomeownerStay) continue;
      if (!r.check_in || !r.check_out) continue;

      const hits = orphanCodes.filter(o => {
        const agg = byCodeAgg.get(o.code);
        if (!agg || agg.isGuestyCoded) return false;
        if (agg.helmRequestKey) return false; // bridge-minted add-on: extras-queue money, never a stay payment
        if (agg.grossCents > 0 && agg.refundedCents >= agg.grossCents) return false; // fully refunded: not the payment
        const m = DATE_RANGE_RE.exec(agg.fullDesc);
        return !!m && m[1] === r.check_in && m[2] === r.check_out;
      });
      if (hits.length === 0) continue;

      const claimants = reservations.filter(x => {
        const xp = (x.platform || '').toUpperCase();
        const rt = xp.includes('HOMEAWAY') || xp === 'VRBO' || xp === 'MANUAL';
        return rt && !matchedCodes.has(x.confirmation_code) && x.check_in === r.check_in && x.check_out === r.check_out;
      });
      if (claimants.length !== 1) continue;

      let grossCents = 0, refundedCents = 0, feeCents = 0;
      let feeKnown = true, hasAppFee = false;
      let createdUnix = Number.MAX_SAFE_INTEGER;
      for (const o of hits) {
        const agg = byCodeAgg.get(o.code);
        if (!agg) { feeKnown = false; continue; }
        grossCents += agg.grossCents;
        refundedCents += agg.refundedCents;
        feeCents += agg.feeCents;
        if (agg.hasAppFee) hasAppFee = true;
        if (!agg.feeKnown) feeKnown = false;
        // Earliest charge dates the payment for the tax-rate lookup:
        // split payments of one booking were all quoted at the same rate.
        if (agg.createdUnix < createdUnix) createdUnix = agg.createdUnix;
      }
      if (createdUnix === Number.MAX_SAFE_INTEGER) createdUnix = 0;

      matchedCodes.add(r.confirmation_code);
      result.matched += 1;
      for (const o of hits) {
        orphanCodes.splice(orphanCodes.indexOf(o), 1);
        byCodeAgg.delete(o.code);
        linkedOrphanKeys.push(`stripe:${o.code}`);
      }

      const actualFee = feeKnown ? round2(feeCents / 100) : null;
      if (actualFee == null) noteFeeUnreadable(r, round2(grossCents / 100), hits.length, 'no_balance_transaction');
      const rebuilt = await applyCollectedNet(r, { grossCents, refundedCents, feeCents, feeKnown, hasAppFee, createdUnix });
      if (!rebuilt && actualFee != null && r.stripe_fee != null && r.bank_match_status !== 'paid_off_stripe' && !installmentCodes.has(r.confirmation_code)) {
        const prev = round2(r.stripe_fee);
        if (prev !== actualFee) {
          const deltaFee = round2(actualFee - prev);
          const newAdjusted = round2((r.adjusted_revenue || 0) - deltaFee);
          await supabase
            .from('reservations')
            .update({ stripe_fee: actualFee, adjusted_revenue: newAdjusted })
            .eq('id', r.id);
          result.fee_updates.push({ code: r.confirmation_code, guest: r.guest_name || 'Guest', prev, next: actualFee, delta: deltaFee });
        }
      }

      const refunded = round2(refundedCents / 100);
      if (refunded > 0) {
        result.refunds_detected.push({ code: r.confirmation_code, guest: r.guest_name || 'Guest', amount: refunded });
      }
    }

    // Multi-stay guest-name fallback. A guest who extends by phone often
    // pays ONE human-written Payment Link covering several reservations
    // ("Niari Keverian, July 2 + July 6 extension" -- one $972 charge for
    // two Manual stays on 79 Main). No single stay's expected gross equals
    // the charge and the description carries neither a confirmation code
    // nor a YYYY-MM-DD range, so every pass above misses it and both stays
    // keep their 3.9% estimates. Anchor on the guest's full name in the
    // charge description -- these links are written by the operator, who
    // types the guest's name -- then sanity-check the amount against the
    // group's combined gross: exact (within $1) when taxes are known for
    // every stay, else a tax-inclusive band (combined rental up to +25%,
    // MA STR tax is ~14.7%) since Guesty leaves total_taxes null on these
    // direct bookings. Requires exactly one name-carrying orphan and every
    // row writable, so ambiguity or a protected row falls through to the
    // missing-charge gap unchanged. The actual fee apportions pro-rata by
    // rental income; the last row absorbs the rounding remainder so the
    // per-stay fees sum to Stripe's fee to the penny.
    {
      const nameGroups = new Map<string, ReservationRow[]>();
      for (const r of reservations) {
        if (matchedCodes.has(r.confirmation_code)) continue;
        const p = (r.platform || '').toUpperCase();
        const isRTStripeChannel = p.includes('HOMEAWAY') || p === 'VRBO' || p === 'MANUAL';
        if (!isRTStripeChannel) continue;
        const isHomeownerStay = p === 'MANUAL' && (!r.guesty_rental_income || r.guesty_rental_income === 0);
        if (isHomeownerStay) continue;
        const nameKey = (r.guest_name || '').trim().toLowerCase().replace(/\s+/g, ' ');
        if (nameKey.length < 5) continue;
        const group = nameGroups.get(nameKey) || [];
        group.push(r);
        nameGroups.set(nameKey, group);
      }

      for (const [nameKey, rows] of nameGroups.entries()) {
        if (rows.length < 2) continue;

        const hits = orphanCodes.filter(o => {
          const agg = byCodeAgg.get(o.code);
          if (!agg || agg.isGuestyCoded) return false;
          if (!agg.fuzzyEligible) return false; // pre-cutoff: decisive matchers only (see chargeWindow)
          if (agg.grossCents > 0 && agg.refundedCents >= agg.grossCents) return false; // fully refunded: not the payment
          return agg.fullDesc.toLowerCase().includes(nameKey);
        });
        if (hits.length !== 1) continue;
        const orphan = hits[0];
        const agg = byCodeAgg.get(orphan.code);
        if (!agg) continue;
        // Legacy Guesty Payments charges carry an application fee the
        // summed balance_transaction.fee doesn't include -- same bail as
        // the collected-net rebuild, so the operator handles those.
        if (agg.hasAppFee) continue;

        const combinedRental = round2(rows.reduce((s, r) => s + (r.guesty_rental_income || 0), 0));
        if (combinedRental <= 0) continue;
        const taxesKnown = rows.every(r => grossByCode.has(r.confirmation_code) || taxesByCode.has(r.confirmation_code));
        const expectedCombined = round2(rows.reduce((s, r) => {
          const known = grossByCode.get(r.confirmation_code) || 0;
          return s + (known > 0 ? known : round2((r.guesty_rental_income || 0) + (taxesByCode.get(r.confirmation_code) || 0)));
        }, 0));
        const amountOk = taxesKnown
          ? Math.abs(orphan.amount - expectedCombined) <= 1
          : orphan.amount >= combinedRental - 1 && orphan.amount <= round2(combinedRental * 1.25) + 1;
        if (!amountOk) continue;

        const allWritable = agg.feeKnown && rows.every(r =>
          r.stripe_fee != null && r.bank_match_status !== 'paid_off_stripe' && !installmentCodes.has(r.confirmation_code));
        if (!allWritable) continue;

        // Claim the charge for the whole group.
        orphanCodes.splice(orphanCodes.indexOf(orphan), 1);
        byCodeAgg.delete(orphan.code);
        linkedOrphanKeys.push(`stripe:${orphan.code}`);
        for (const r of rows) { matchedCodes.add(r.confirmation_code); result.matched += 1; }

        const actualFee = round2(agg.feeCents / 100);
        let assigned = 0;
        for (let i = 0; i < rows.length; i++) {
          const r = rows[i];
          const share = i === rows.length - 1
            ? round2(actualFee - assigned)
            : round2(actualFee * ((r.guesty_rental_income || 0) / combinedRental));
          assigned = round2(assigned + share);
          const prev = round2(r.stripe_fee as number);
          if (prev === share) continue;
          const deltaFee = round2(share - prev);
          const newAdjusted = round2((r.adjusted_revenue || 0) - deltaFee);
          await supabase
            .from('reservations')
            .update({ stripe_fee: share, adjusted_revenue: newAdjusted })
            .eq('id', r.id);
          result.fee_updates.push({ code: r.confirmation_code, guest: r.guest_name || 'Guest', prev, next: share, delta: deltaFee });
        }

        const refunded = round2(agg.refundedCents / 100);
        if (refunded > 0) {
          result.refunds_detected.push({
            code: rows.map(r => r.confirmation_code).join(' + '),
            guest: rows[0].guest_name || 'Guest',
            amount: refunded,
          });
        }
      }
    }

    // Pre-cutoff leftovers stay silent: they were invisible under the
    // 6-month window, and an unmatched 14-month-old charge is history,
    // not an operator action item.
    result.unmatched_charges = orphanCodes
      .filter(o => byCodeAgg.get(o.code)?.fuzzyEligible)
      .map(o => `${o.displayLabel} ($${o.amount.toFixed(2)})`);

    // One-off Payment Link charges (early check-in, extra night, pet fee
    // charged outside Guesty) used to evaporate here: listed once in
    // unmatched_charges, then gone. Persist them into the same operator
    // review queue the bank-side leftovers use, so they can be attributed
    // to a reservation as add-on revenue or dismissed. Scope:
    //   - charge-id-keyed orphans only (custom descriptions). Guesty-coded
    //     orphans stay transient -- they're usually a sync-timing race on
    //     a future stay, not real off-statement money.
    //   - created inside the statement month, so a 6-months-back charge
    //     doesn't spam every later month's queue.
    //   - amount is the NET the account keeps (gross - refunds - actual
    //     Stripe fee), matching how Manual/VRBO stay revenue is recognized.
    // dedupe_key `stripe:<charge_id>` + ignoreDuplicates keeps re-syncs
    // idempotent and preserves operator decisions. Tolerates the table
    // not existing (pre-migration env) without failing the sync.
    try {
      const queueRows: Record<string, unknown>[] = [];
      const staleRefundedDepositKeys: string[] = [];
      // Metadata-first guest resolution for the reservation preselect: a
      // bridge-minted charge names its payment_link_requests row via
      // helm_request_key, and that row's guest_name is authoritative --
      // the description now ends with the property's external title
      // ("Stay at ..."), whose words must never feed name matching.
      // Old links without metadata keep the description-parsing fallback.
      const helmKeys = [...new Set(
        orphanCodes.map(o => byCodeAgg.get(o.code)?.helmRequestKey).filter((k): k is string => !!k),
      )];
      const guestByRequestKey = new Map<string, string>();
      // Occupancy tax minted onto the link (2026-08-27). An add-on fee is
      // rent, so the guest is charged fee + tax; the tax is money held for
      // the state and must never land in the owner's add-on revenue or in
      // the management-fee base. It rides on its own `tax_amount` column so
      // the remittance sheet can pick it up at month-close. Links minted
      // before the gross-up have tax_cents 0, which is what keeps every
      // historical statement's numbers identical.
      const taxByRequestKey = new Map<string, number>();
      // The rent that tax was computed on, carried through so the
      // remittance sheet can print a rental-income column beside the tax.
      // MassTaxConnect is filed by entering rent and letting the state
      // compute the excise, so the base has to be a real recorded number,
      // not the tax divided back out by a rate.
      const baseByRequestKey = new Map<string, number>();
      if (helmKeys.length > 0) {
        const { data: linkRows } = await supabase
          .from('payment_link_requests')
          .select('request_key, guest_name, tax_cents, base_cents')
          .in('request_key', helmKeys);
        for (const lr of linkRows || []) {
          if ((lr.guest_name || '').trim()) guestByRequestKey.set(lr.request_key, String(lr.guest_name).trim());
          const tc = Number(lr.tax_cents) || 0;
          if (tc > 0) {
            taxByRequestKey.set(lr.request_key, tc);
            baseByRequestKey.set(lr.request_key, Number(lr.base_cents) || 0);
          }
        }
      }
      const preselectText = (agg: Agg): string => {
        const metaGuest = agg.helmRequestKey ? guestByRequestKey.get(agg.helmRequestKey) : undefined;
        return metaGuest || agg.fullDesc;
      };
      for (const o of orphanCodes) {
        const agg = byCodeAgg.get(o.code);
        if (!agg || agg.isGuestyCoded) continue;
        // SCA principal-payment links are auto-generated as "Stay at
        // <name> - <dates>". When one misses its amount match (fee/tax
        // drift, split charges) it's still a STAY payment, never an
        // add-on -- queueing it would invite double-counting revenue the
        // Guesty PDF already carries. The missing-charge gap on the
        // reservation flags it instead. A helm_request_key overrides the
        // text test: bridge-minted charges are add-ons by construction,
        // whatever their description says.
        if (!agg.helmRequestKey && /^stay at\b/i.test(agg.fullDesc)) continue;
        const createdIso = new Date(agg.createdUnix * 1000).toISOString().slice(0, 10);
        if (createdIso.slice(0, 7) !== month) continue;
        if (agg.refundedCents >= agg.grossCents) {
          // Fully refunded, usually a double-paid link we refunded. Stripe
          // keeps its processing fee on refunds. Policy (Dotti 2026-08-02,
          // Kristen Oteri's double-paid $600 on 19 Rackliffe): card fees
          // back out of REVENUE, never land as a repairs-style debit. When
          // the refunded charge unambiguously pairs with one matched stay
          // (refunded gross equals the stay's folio pre-tax or its
          // tax-inclusive total: the double-pay signature), fold the kept
          // fee into that stay's stripe_fee, so the owner shares it through
          // the management-fee base like every other card fee. Re-reads the
          // row the matchers just wrote, so re-syncs stay deterministic.
          // No unambiguous pair -> the old debit-queue fallback so the
          // loss is never silent.
          if (agg.feeKnown && agg.feeCents > 0) {
            const refundedGross = round2(agg.grossCents / 100);
            const keptFee = round2(agg.feeCents / 100);
            // Per-property tax rate at this refunded charge's creation date
            // (79 Main charges include the 3% CIF in the tax-inclusive total).
            const refundMultiplier = occupancyTaxMultiplier(
              propertyId,
              new Date(agg.createdUnix * 1000).toISOString().slice(0, 10),
            );
            const pairs = reservations.filter(x => {
              const xp = (x.platform || '').toUpperCase();
              const rt = xp.includes('HOMEAWAY') || xp === 'VRBO' || xp === 'MANUAL';
              if (!rt || !matchedCodes.has(x.confirmation_code)) return false;
              if (x.stripe_fee == null || x.bank_match_status === 'paid_off_stripe' || installmentCodes.has(x.confirmation_code)) return false;
              const folio = x.guesty_rental_income || 0;
              if (folio <= 0) return false;
              return Math.abs(refundedGross - folio) <= 1 || Math.abs(refundedGross - round2(folio * refundMultiplier)) <= 1;
            });
            let folded = false;
            if (pairs.length === 1) {
              const { data: freshRow } = await supabase
                .from('reservations')
                .select('stripe_fee, adjusted_revenue')
                .eq('id', pairs[0].id)
                .maybeSingle();
              if (freshRow && freshRow.stripe_fee != null) {
                const newFee = round2(Number(freshRow.stripe_fee) + keptFee);
                const newAdjusted = round2(Number(freshRow.adjusted_revenue || 0) - keptFee);
                if (newAdjusted > 0) {
                  await supabase
                    .from('reservations')
                    .update({ stripe_fee: newFee, adjusted_revenue: newAdjusted })
                    .eq('id', pairs[0].id);
                  result.fee_updates.push({
                    code: pairs[0].confirmation_code, guest: pairs[0].guest_name || 'Guest',
                    prev: round2(Number(freshRow.stripe_fee)), next: newFee, delta: keptFee,
                  });
                  // Any pending rows from prior syncs (deposit or debit) are stale now.
                  staleRefundedDepositKeys.push(`stripe:${o.code}`, `stripe:${o.code}:refundfee`);
                  folded = true;
                }
              }
            }
            if (!folded) {
              staleRefundedDepositKeys.push(`stripe:${o.code}`);
              queueRows.push({
                property_id: propertyId,
                month,
                direction: 'debit',
                deposit_date: createdIso,
                amount: keptFee,
                description: `Stripe fee kept on refunded charge: ${agg.fullDesc} ($${refundedGross.toFixed(2)} refunded)`.slice(0, 300),
                source: 'stripe_charge',
                suggested_reservation_code: suggestReservationForCharge(reservations, createdIso, preselectText(agg)),
                dedupe_key: `stripe:${o.code}:refundfee`,
              });
            }
          }
          continue;
        }
        const netCents = agg.grossCents - agg.refundedCents - (agg.feeKnown ? agg.feeCents : 0);
        if (netCents <= 0) continue;
        const gross = round2(agg.grossCents / 100);
        const feeNote = agg.feeKnown ? `$${round2(agg.feeCents / 100).toFixed(2)} Stripe fee` : 'fee pending';
        const refundNote = agg.refundedCents > 0 ? `, $${round2(agg.refundedCents / 100).toFixed(2)} refunded` : '';
        // Far-future booking deposit / balance (bridge-minted, ffdeposit: or
        // ffbalcharge: request_key): this is stay PRINCIPAL for the stay's own
        // future statement period, NOT an add-on for a stay in THIS month.
        // Mark it so the extras-queue decision surface warns "do not apply
        // here", and drop the same-month reservation preselect that would
        // otherwise invite a wrong attribution. The stay's revenue is
        // recognized on its own statement via the reservation; this charge is
        // how the guest paid, not additive add-on revenue.
        const futurePrincipal = /^(ffdeposit|ffbalcharge):/.test(agg.helmRequestKey || '');
        const targetPeriod = futurePrincipal ? futureStayPeriodFromKey(agg.helmRequestKey || '') : '';
        const taxCents = agg.helmRequestKey
          ? taxPortionOfNet({ netCents, taxCents: taxByRequestKey.get(agg.helmRequestKey) || 0 })
          : 0;
        const taxNote = taxCents > 0 ? `, $${round2(taxCents / 100).toFixed(2)} occupancy tax held for remittance` : '';
        const baseDesc = `${agg.fullDesc} ($${gross.toFixed(2)} gross, ${feeNote}${refundNote}${taxNote})`;
        const description = futurePrincipal
          ? `${FUTURE_STAY_PRINCIPAL_MARK} - do not apply to this statement${targetPeriod ? `; belongs to ${targetPeriod}` : ''}. ${baseDesc}`
          : baseDesc;
        queueRows.push({
          property_id: propertyId,
          month,
          deposit_date: createdIso,
          // `amount` stays what it has always been: the owner-facing add-on
          // revenue. The tax is carved out of it, not added on top, so the
          // canonical formula in lib/statement-addons.ts is untouched.
          amount: round2((netCents - taxCents) / 100),
          tax_amount: round2(taxCents / 100),
          tax_base: taxCents > 0
            ? round2((baseByRequestKey.get(agg.helmRequestKey || '') || 0) / 100)
            : 0,
          description: description.slice(0, 300),
          source: 'stripe_charge',
          suggested_reservation_code: futurePrincipal
            ? null
            : suggestReservationForCharge(reservations, createdIso, preselectText(agg)),
          dedupe_key: `stripe:${o.code}`,
        });
      }
      if (queueRows.length > 0) {
        const { error: qErr } = await supabase
          .from('bank_deposit_attributions')
          .upsert(queueRows, { onConflict: 'dedupe_key', ignoreDuplicates: true });
        if (qErr && qErr.code !== 'PGRST205' && !/does not exist|relation|Could not find the table/i.test(qErr.message || '')) {
          console.warn('stripe orphan review-queue insert failed:', qErr.message);
        }
      }
      // A charge queued while orphan can later match a reservation (the
      // amount fallback links it once the reservation data is fixed), or
      // get fully refunded after its deposit row was queued. Drop the
      // still-pending queue rows in both cases so the same money can't be
      // attributed twice / after it's gone. Rows the operator already
      // attributed or dismissed are left alone.
      const pendingDeleteKeys = [...linkedOrphanKeys, ...staleRefundedDepositKeys];
      if (pendingDeleteKeys.length > 0) {
        const { error: delErr } = await supabase
          .from('bank_deposit_attributions')
          .delete()
          .in('dedupe_key', pendingDeleteKeys)
          .eq('status', 'pending')
          .eq('source', 'stripe_charge');
        if (delErr && delErr.code !== 'PGRST205' && !/does not exist|relation|Could not find the table/i.test(delErr.message || '')) {
          console.warn('stripe orphan review-queue cleanup failed:', delErr.message);
        }
      }
    } catch (queueErr) {
      // Queue persistence must never fail the sync -- fee corrections and
      // gap reporting matter more than the review queue.
      console.warn('stripe orphan review-queue error:', queueErr instanceof Error ? queueErr.message : queueErr);
    }

    // Reservations we expected a Stripe charge for but didn't find --
    // VRBO / Manual non-homeowner stays only.
    for (const r of reservations) {
      if (matchedCodes.has(r.confirmation_code)) continue;
      const p = (r.platform || '').toUpperCase();
      const isRTStripeChannel = p.includes('HOMEAWAY') || p === 'VRBO' || p === 'MANUAL';
      if (!isRTStripeChannel) continue;
      const isHomeownerStay = p === 'MANUAL' && (!r.guesty_rental_income || r.guesty_rental_income === 0);
      if (isHomeownerStay) continue;
      result.reservations_missing_charge.push({
        code: r.confirmation_code,
        guest: r.guest_name || 'Guest',
        expected: round2(r.guesty_rental_income || 0),
      });
    }

    // Recompute statement totals if any fees changed -- through the single
    // write path, which reads every input itself. This closes two hazards
    // the inline version carried: cleaning_total / repairs_total came from
    // the CALLER's memory (a stale snapshot could recompute the payout
    // against numbers that were no longer the stored ones), and the
    // reservations read discarded its error (a failed read zeroed the
    // month). A throw here lands in this function's outer catch as the
    // property's sync error, with every stored value untouched.
    if (result.fee_updates.length > 0 || result.gross_reconstructions.length > 0 || result.collected_rebuilds.length > 0) {
      await writeStatementTotals(supabase, stmt.id, { action: 'Stripe sync' });
    }

    // Persist discrepancy gaps. Wipe any prior stripe_* gaps so re-runs
    // don't pile up duplicates.
    await supabase
      .from('data_gaps')
      .delete()
      .eq('property_statement_id', stmt.id)
      .in('gap_type', ['stripe_refund_detected', 'stripe_gross_mismatch', 'stripe_gross_reconstructed', 'stripe_opening_discount', 'stripe_collected_rebuild', 'stripe_missing_charge', 'stripe_orphan_charge', 'stripe_fee_unreadable', 'stripe_collected_truncated', 'stripe_key_missing']);

    // Pull any reservation_notes for the codes we're about to flag, so
    // gap descriptions inherit the durable context that arrived
    // out-of-band (e.g., "Allie refunded half because Guesty
    // auto-charged"). Notes are keyed on confirmation_code so they
    // survive ingest re-runs even though reservation UUIDs don't.
    // Tolerates the table not existing yet (PGRST205) -- gaps just
    // ship without notes when the migration hasn't run.
    const flaggedCodes = new Set<string>([
      ...result.refunds_detected.map(r => r.code),
      ...result.gross_mismatches.map(m => m.code),
      ...result.gross_reconstructions.map(g => g.code),
      ...result.collected_rebuilds.map(c => c.code),
      ...result.reservations_missing_charge.map(mc => mc.code),
      ...(result.fee_unreadable || []).map(f => f.code),
      ...(result.collected_rebuild_truncated || []).map(c => c.code),
    ]);
    const notesByCode = new Map<string, { body: string; created_at: string }>();
    if (flaggedCodes.size > 0) {
      const { data: notes, error: notesErr } = await supabase
        .from('reservation_notes')
        .select('confirmation_code, body, created_at')
        .in('confirmation_code', Array.from(flaggedCodes))
        .order('created_at', { ascending: false });
      if (notesErr && notesErr.code !== 'PGRST205' && !/does not exist|relation|Could not find the table/i.test(notesErr.message || '')) {
        console.warn('reservation_notes lookup failed:', notesErr.message);
      } else if (notes) {
        // Latest note per code wins (we ordered desc, so first occurrence is newest).
        for (const n of notes as { confirmation_code: string; body: string; created_at: string }[]) {
          if (!notesByCode.has(n.confirmation_code)) {
            notesByCode.set(n.confirmation_code, { body: n.body, created_at: n.created_at });
          }
        }
      }
    }
    const noteSuffix = (code: string): string => {
      const note = notesByCode.get(code);
      return note ? ` Note: ${note.body}` : '';
    };

    const newGaps: { gap_type: string; description: string; severity: string; expected_data: string; resolved?: boolean }[] = [];
    for (const r of result.refunds_detected) {
      newGaps.push({
        gap_type: 'stripe_refund_detected',
        description: `Stripe shows $${r.amount.toFixed(2)} refunded on ${r.guest} (${r.code}). Owner payout may need adjustment.${noteSuffix(r.code)}`,
        severity: 'warning',
        expected_data: `Confirm whether the refund is in-period and update the statement manually`,
      });
    }
    for (const m of result.gross_mismatches) {
      newGaps.push({
        gap_type: 'stripe_gross_mismatch',
        description: `Stripe gross $${m.stripe.toFixed(2)} disagrees with Guesty TOTAL_PAID $${m.guesty.toFixed(2)} for ${m.guest} (${m.code}).${noteSuffix(m.code)}`,
        severity: 'info',
        expected_data: `Re-check the Guesty reservation amount for this stay`,
      });
    }
    // Audit trail for auto-corrections: recorded pre-resolved so the gap
    // counter stays quiet, but the row documents exactly what moved and
    // why if an owner ever asks about the month's numbers.
    for (const g of result.gross_reconstructions) {
      newGaps.push({
        gap_type: 'stripe_gross_reconstructed',
        description: `Guesty TOTAL_PAID $${g.guesty.toFixed(2)} under-reported ${g.guest} (${g.code}); Stripe collected $${g.stripe.toFixed(2)}. Net rebuilt from Stripe actuals: $${g.prev_net.toFixed(2)} -> $${g.next_net.toFixed(2)} (real fee $${g.fee.toFixed(2)}).${noteSuffix(g.code)}`,
        severity: 'info',
        expected_data: `None -- auto-corrected. Fix TOTAL_PAID in Guesty to stop this recurring`,
        resolved: true,
      });
    }
    // Audit trail for collected-net pass-through: pre-resolved so the
    // gap counter stays quiet, but the row documents why this stay's
    // revenue differs from the Guesty folio if an owner ever asks.
    for (const c of result.collected_rebuilds) {
      newGaps.push({
        gap_type: 'stripe_collected_rebuild',
        description: `Guest paid $${c.collected.toFixed(2)} vs Guesty folio for ${c.guest} (${c.code}); Direct-stay revenue recognized from the money collected (folio pre-tax $${c.folio.toFixed(2)}). Net $${c.prev_net.toFixed(2)} -> $${c.next_net.toFixed(2)} (real fee $${c.fee.toFixed(2)}).${noteSuffix(c.code)}`,
        severity: 'info',
        expected_data: `None -- revenue follows the collected amount (policy 2026-08-01)`,
        resolved: true,
      });
    }
    for (const mc of result.reservations_missing_charge) {
      newGaps.push({
        gap_type: 'stripe_missing_charge',
        description: `No Stripe charge found for ${mc.guest} (${mc.code}) expected $${mc.expected.toFixed(2)}.${noteSuffix(mc.code)}`,
        severity: 'info',
        expected_data: `Check Stripe dashboard for this confirmation code`,
      });
    }
    // A matched charge whose real fee Stripe would not return. The stay is
    // still priced on the 3.9% + $0.40 estimate, against the standing
    // "actuals are the rule" directive -- so it gets said out loud.
    for (const f of result.fee_unreadable || []) {
      newGaps.push({
        gap_type: 'stripe_fee_unreadable',
        description: f.reason === 'partial'
          ? `${f.guest}'s stay was paid across ${f.charges} Stripe charges but only some returned a fee, so the fee recorded here is UNDERSTATED and the payout correspondingly overstated.${noteSuffix(f.code)}`
          : `Matched ${f.guest}'s Stripe charge ($${f.gross.toFixed(2)}, ${f.charges} charge${f.charges === 1 ? '' : 's'}) but Stripe returned no fee at all, so this stay is still on the 3.9% + $0.40 estimate.${noteSuffix(f.code)}`,
        severity: 'warning',
        expected_data: `Give this property's restricted Stripe key read access to Balance transactions, then run Sync Stripe again.`,
      });
    }
    // The collected-net rebuild ran on a gross Guesty says is short. The
    // rebuild itself is unchanged (that would move a payout); this only
    // reports that its input may have been truncated.
    for (const c of result.collected_rebuild_truncated || []) {
      newGaps.push({
        gap_type: 'stripe_collected_truncated',
        description: `${c.guest} (${c.code}): revenue was rebuilt from $${c.collected.toFixed(2)} of visible Stripe charges, but Guesty recorded $${c.guesty_total_paid.toFixed(2)} collected. If a payment is outside the charge window, this stay's revenue is understated.${noteSuffix(c.code)}`,
        severity: 'warning',
        expected_data: `Check Stripe for earlier charges on this booking (deposit at booking time), then re-run Sync Stripe.`,
      });
    }
    if (newGaps.length > 0) {
      await supabase
        .from('data_gaps')
        .insert(newGaps.map(g => ({ property_statement_id: stmt.id, ...g })));
    }

    // Auto-resolve missing_guest_gross gaps once the sync proves we have
    // real Stripe data for every Manual/VRBO stay on the statement. The
    // gap was raised at ingest when a reservation lacked TOTAL_PAID, so
    // stripe_fee fell back to a 3.9%-on-net approximation. Once
    // sync-stripe matches every Manual/VRBO reservation to its real Stripe
    // charge (i.e. reservations_missing_charge is empty), the
    // approximation has been replaced with balance_transaction.fee and
    // the warning is stale -- exactly the phantom flag pattern we hit on
    // 21 Horton's Karen Bandy (GY-VfmMf3z4): Guesty never populated
    // total_paid for that direct booking, so the suggested CSV re-upload
    // can't help, but the real Stripe fee is already on the reservation.
    if (result.reservations_missing_charge.length === 0) {
      await supabase
        .from('data_gaps')
        .update({ resolved: true })
        .eq('property_statement_id', stmt.id)
        .eq('gap_type', 'missing_guest_gross')
        .eq('resolved', false);
    }
  } catch (err) {
    result.error = err instanceof Error ? err.message : String(err);
  }

  return result;
}
