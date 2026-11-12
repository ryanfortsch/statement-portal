/**
 * Booking requests for partner homes: the reads and writes.
 *
 * The rules are src/lib/booking-requests.ts. This file:
 *
 *   createBookingRequest   the bridge (POST /api/pms/requests). Idempotent on
 *                          request_key; a partner home only; re-priced here
 *                          from the home's Helm rate plan (quoteForBridge),
 *                          so the stored total is Helm's, never the browser's.
 *   listBookingRequests    the review screen: every open request, and what
 *                          closed in the last 30 days, with the home and its
 *                          host's contact.
 *   declineBookingRequest  / withdrawBookingRequest / markHostTold
 *                          owner verbs; each update claims the row with
 *                          status = 'pending' and a live clock in its where
 *                          clause, so two clicks, or a click racing the cron,
 *                          decide it once.
 *   acceptBookingRequest   the host said yes: the nights are booked (an
 *                          accepted request holds its nights on the home's
 *                          Helm calendar, pms-bridge holdsInWindow), and the
 *                          site charges the card on its next settle pass
 *                          (src/lib/partner-payments-db.ts). Only a request
 *                          carrying a card hold can be accepted.
 *   sweepBookingRequests   the hourly cron: closes requests whose clock ran
 *                          out and retries any guest email that failed.
 *
 * Money: a home whose host's Stripe can take charges must send a hold with
 * every request, and the hold must be the stay's total and our fee to the
 * cent, on that home's account. Helm never calls Stripe (partner-payments.ts).
 */
import { supabaseAdmin, isServiceConfigured } from '@/lib/supabase-admin';
import { bridgeStatus, getBridgeProperty, quoteForBridge, rangeCheckForBridge, type BridgeFailure } from '@/lib/pms-bridge';
import { isPartnerHome } from '@/lib/property-scope';
import { getHousePolicy } from '@/lib/property-rates';
import { isListedPartner } from '@/lib/partner-listed';
import { listPartnerFeeds, syncPartnerFeeds } from '@/lib/partner-calendar-db';
import { staleFeedsBlockAccept } from '@/lib/partner-calendar';
import { sendRequestOutcome, sendRequestReceipt } from '@/lib/booking-request-email';
import { getPaymentAccount, retryConfirmations } from '@/lib/partner-payments-db';
import { holdMismatch, holdsAccepted, partnerFeeCents, paymentsReady } from '@/lib/partner-payments';
import {
  BOOKING_REQUEST_COLS,
  OUTCOME_RETRY_DAYS,
  isOpen,
  requestTerms,
  respondByFor,
  validateRequestInput,
  type BookingRequestRow,
} from '@/lib/booking-requests';

const TABLE = 'booking_requests';

export type CreateRequestFailure =
  | BridgeFailure
  | { ok: false; error: 'books_instantly'; property_id: string }
  | { ok: false; error: 'hold_required'; property_id: string }
  | { ok: false; error: 'hold_mismatch'; detail: string };

export type CreateRequestResult = { ok: true; created: boolean; request: BookingRequestRow } | CreateRequestFailure;

/** The HTTP status the bridge route answers for a refusal. */
export function requestFailureStatus(f: CreateRequestFailure): number {
  return f.error === 'books_instantly' || f.error === 'hold_required' || f.error === 'hold_mismatch' ? 409 : bridgeStatus(f.error);
}

/** A missing table reads as not configured (the migration is applied by hand). */
function isMissingTable(err: { code?: string; message?: string } | null | undefined): boolean {
  if (!err) return false;
  return err.code === '42P01' || err.code === 'PGRST205' || /could not find the table|does not exist/i.test(err.message ?? '');
}

async function findByKey(key: string): Promise<BookingRequestRow | null> {
  const { data, error } = await supabaseAdmin.from(TABLE).select(BOOKING_REQUEST_COLS).eq('request_key', key).maybeSingle();
  if (error) throw new Error(`booking_requests read failed: ${error.message}`);
  return (data as BookingRequestRow | null) ?? null;
}

/**
 * File a guest's request. The order matters:
 *   1. validate the body;
 *   2. the same request_key returns the request it made before;
 *   3. the home must be a partner home (a home we run books instantly
 *      through POST /api/pms/reservations);
 *   4. price it here; terms and taken nights refuse it exactly as a quote
 *      would, and a total that moved since the guest saw it is quote_drift;
 *   5. the card: a home taking charges needs a hold (hold_required), and a
 *      hold must be on the home's account for the stay's total and our fee
 *      (hold_mismatch); the site releases a refused hold;
 *   6. insert, then email the guest a receipt (best-effort, retried by the
 *      cron while the request is open).
 */
export async function createBookingRequest(raw: unknown, opts: { now?: Date } = {}): Promise<CreateRequestResult> {
  if (!isServiceConfigured) return { ok: false, error: 'not_configured' };
  const v = validateRequestInput(raw);
  if (!v.ok) return { ok: false, error: 'invalid', detail: v.detail };
  const input = v.input;
  const now = opts.now ?? new Date();

  let existing: BookingRequestRow | null;
  try {
    existing = await findByKey(input.request_key);
  } catch (err) {
    if (isMissingTable(err as { message?: string })) return { ok: false, error: 'not_configured' };
    throw err;
  }
  if (existing) return { ok: true, created: false, request: existing };

  const property = await getBridgeProperty(input.property_id);
  if (!property) return { ok: false, error: 'not_found' };
  if (!isPartnerHome(property)) return { ok: false, error: 'books_instantly', property_id: property.id };
  // Only a home an owner listed takes requests (lib/partner-listing); one
  // taken off the site is not there for the guest.
  if (!(await isListedPartner(property.id))) return { ok: false, error: 'not_found' };

  // The policy the guest is agreeing to, kept on the request. No policy, or
  // one that cannot be read, takes no request (the site shows none either).
  const terms = requestTerms(await getHousePolicy(property.id));
  if (!terms) return { ok: false, error: 'invalid', detail: 'this home has no cancellation policy' };

  const priced = await quoteForBridge(property.id, input.check_in, input.check_out, input.guests, 'sca', { now });
  if (!priced.ok) return priced;
  const q = priced.quote;
  const totalCents = q.breakdown.total_cents;
  if (input.quoted_total_cents != null && input.quoted_total_cents !== totalCents) {
    return { ok: false, error: 'quote_drift', quoted_total_cents: input.quoted_total_cents, current_total_cents: totalCents };
  }

  const account = await getPaymentAccount(property.id);
  const hold = input.hold;
  if (hold) {
    if (!holdsAccepted(account)) return { ok: false, error: 'hold_mismatch', detail: 'this home takes no card yet' };
    const why = holdMismatch(hold, {
      stripe_account_id: account!.stripe_account_id as string,
      amount_cents: totalCents,
      fee_cents: partnerFeeCents(totalCents, q.breakdown.tax_cents, account!.fee_pct as number),
    });
    if (why) return { ok: false, error: 'hold_mismatch', detail: why };
  } else if (paymentsReady(account)) {
    return { ok: false, error: 'hold_required', property_id: property.id };
  }

  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .insert({
      request_key: input.request_key,
      source: input.source,
      property_id: property.id,
      check_in: input.check_in,
      check_out: input.check_out,
      guests: input.guests,
      guest_first_name: input.guest.first_name,
      guest_last_name: input.guest.last_name,
      guest_email: input.guest.email,
      guest_phone: input.guest.phone,
      message: input.message,
      quoted_total_cents: totalCents,
      currency: q.currency,
      quote: q,
      status: 'pending',
      respond_by: respondByFor(now),
      cancellation_terms: terms.cancellation_terms,
      house_rules: terms.house_rules,
      terms_version: input.terms_version,
      ...(hold
        ? {
            stripe_account_id: hold.stripe_account_id,
            payment_intent_id: hold.payment_intent_id,
            hold_cents: hold.amount_cents,
            fee_cents: hold.fee_cents,
            hold_status: 'held',
            hold_placed_at: now.toISOString(),
          }
        : {}),
    })
    .select(BOOKING_REQUEST_COLS)
    .single();
  if (error) {
    // Two posts with one key racing: the loser returns the winner's row.
    if (error.code === '23505') {
      const twin = await findByKey(input.request_key);
      if (twin) return { ok: true, created: false, request: twin };
    }
    if (isMissingTable(error)) return { ok: false, error: 'not_configured' };
    throw new Error(`booking_requests insert failed: ${error.message}`);
  }
  const row = data as BookingRequestRow;

  try {
    if (await sendRequestReceipt(row, property.title)) {
      const stamped = new Date().toISOString();
      await supabaseAdmin.from(TABLE).update({ receipt_emailed_at: stamped }).eq('id', row.id).is('receipt_emailed_at', null);
      row.receipt_emailed_at = stamped;
    }
  } catch (err) {
    console.warn('[booking-requests] receipt email failed:', err instanceof Error ? err.message : String(err));
  }

  return { ok: true, created: true, request: row };
}

// ─── The review screen ──────────────────────────────────────────────────────

export type RequestHome = {
  id: string;
  name: string;
  title: string | null;
  host_name: string | null;
  host_emails: string[];
  host_phone: string | null;
};

/** What the calendar says now about an open request's nights. */
export type RequestCalendar =
  | { state: 'open' }
  | { state: 'booked'; nights: string[] }
  | { state: 'closed'; nights: string[] }
  | { state: 'unknown' };

export type ReviewRequest = BookingRequestRow & { home: RequestHome | null; calendar: RequestCalendar | null };

const CLOSED_WINDOW_DAYS = 30;

export async function listBookingRequests(opts: { now?: Date } = {}): Promise<{ ok: true; rows: ReviewRequest[] } | { ok: false; reason: 'not_configured' }> {
  if (!isServiceConfigured) return { ok: false, reason: 'not_configured' };
  const now = opts.now ?? new Date();
  const since = new Date(now.getTime() - CLOSED_WINDOW_DAYS * 86_400_000).toISOString();
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .select(BOOKING_REQUEST_COLS)
    .or(`status.eq.pending,decided_at.gte.${since}`)
    .order('created_at', { ascending: false })
    .limit(300);
  if (error) {
    if (isMissingTable(error)) return { ok: false, reason: 'not_configured' };
    throw new Error(`booking_requests read failed: ${error.message}`);
  }
  const rows = (data ?? []) as BookingRequestRow[];

  const ids = [...new Set(rows.map((r) => r.property_id))];
  const homes = new Map<string, RequestHome>();
  if (ids.length > 0) {
    const { data: props } = await supabaseAdmin
      .from('properties')
      .select('id, name, title, owner_full, owner_emails, owner_phone')
      .in('id', ids);
    for (const p of (props ?? []) as Array<Record<string, unknown>>) {
      homes.set(String(p.id), {
        id: String(p.id),
        name: String(p.name ?? p.id),
        title: (p.title as string | null) ?? null,
        host_name: (p.owner_full as string | null) ?? null,
        host_emails: Array.isArray(p.owner_emails) ? (p.owner_emails as string[]).filter(Boolean) : [],
        host_phone: (p.owner_phone as string | null) ?? null,
      });
    }
  }

  // The calendar, read live for each open request: a night booked since the
  // request landed means the host cannot say yes to it.
  const calendars = new Map<string, RequestCalendar>();
  await Promise.all(
    rows
      .filter((r) => isOpen(r, now))
      .map(async (r) => {
        try {
          const c = await rangeCheckForBridge(r.property_id, r.check_in, r.check_out, { now });
          if (!c.ok) calendars.set(r.id, { state: 'unknown' });
          else if (c.reservedDates.length > 0) calendars.set(r.id, { state: 'booked', nights: c.reservedDates });
          else if (c.unavailableDates.length > 0) calendars.set(r.id, { state: 'closed', nights: c.unavailableDates });
          else calendars.set(r.id, { state: 'open' });
        } catch {
          calendars.set(r.id, { state: 'unknown' });
        }
      }),
  );

  return {
    ok: true,
    rows: rows.map((r) => ({ ...r, home: homes.get(r.property_id) ?? null, calendar: calendars.get(r.id) ?? null })),
  };
}

/** The open requests' clocks, for the owners' home feed line. Never throws. */
export async function openRequestClocks(now: Date = new Date()): Promise<string[]> {
  if (!isServiceConfigured) return [];
  try {
    const { data, error } = await supabaseAdmin
      .from(TABLE)
      .select('respond_by')
      .eq('status', 'pending')
      .gt('respond_by', now.toISOString())
      .order('respond_by', { ascending: true })
      .limit(50);
    if (error) return [];
    return ((data ?? []) as Array<{ respond_by: string }>).map((r) => r.respond_by);
  } catch {
    return [];
  }
}

// ─── Owner verbs ────────────────────────────────────────────────────────────

export type DecideResult = { ok: true; row: BookingRequestRow; emailed: boolean } | { ok: false; reason: string };

async function titleFor(propertyId: string): Promise<string | null> {
  const p = await getBridgeProperty(propertyId);
  return p?.title ?? null;
}

/** The claim: the row moves only while it is pending and its clock is live. */
async function decide(
  id: string,
  patch: Record<string, unknown>,
  now: Date,
): Promise<{ ok: true; row: BookingRequestRow } | { ok: false; reason: string }> {
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .update(patch)
    .eq('id', id)
    .eq('status', 'pending')
    .gt('respond_by', now.toISOString())
    .select(BOOKING_REQUEST_COLS)
    .maybeSingle();
  if (error) return { ok: false, reason: error.message };
  if (!data) return { ok: false, reason: 'This request is already closed.' };
  return { ok: true, row: data as BookingRequestRow };
}

async function emailOutcome(row: BookingRequestRow): Promise<boolean> {
  try {
    if (!(await sendRequestOutcome(row, await titleFor(row.property_id)))) return false;
    await supabaseAdmin.from(TABLE).update({ outcome_emailed_at: new Date().toISOString() }).eq('id', row.id).is('outcome_emailed_at', null);
    return true;
  } catch (err) {
    console.warn('[booking-requests] outcome email failed:', err instanceof Error ? err.message : String(err));
    return false;
  }
}

/** The host said no. The reason stays in Helm; the guest gets the plain decline. */
export async function declineBookingRequest(id: string, by: string, reason: string, now: Date = new Date()): Promise<DecideResult> {
  const r = await decide(id, { status: 'declined', decided_at: now.toISOString(), decided_by: by, decline_reason: reason.trim().slice(0, 500) || null }, now);
  if (!r.ok) return r;
  return { ok: true, row: r.row, emailed: await emailOutcome(r.row) };
}

/** The guest told us they no longer want it. Nothing is emailed. */
export async function withdrawBookingRequest(id: string, by: string, now: Date = new Date()): Promise<DecideResult> {
  const r = await decide(id, { status: 'withdrawn', decided_at: now.toISOString(), decided_by: by }, now);
  if (!r.ok) return r;
  return { ok: true, row: r.row, emailed: false };
}

/**
 * The host said yes. In order:
 *   1. the request is open and carries a card hold (a request without one
 *      cannot be paid for, so it cannot be accepted);
 *   2. the calendar, read live after the host's own calendars are read
 *      again, has no other stay on its nights, and each of those calendars
 *      has a good read from the last six hours;
 *   3. the claim: pending, a live clock and a live hold, in the where
 *      clause. Two accepted requests can never share a night (the table's
 *      exclusion constraint), so a race between two yeses books one.
 * The guest is not emailed here: the site charges the hold on its next
 * settle pass and the confirmation goes out when it reports the charge.
 */
export async function acceptBookingRequest(id: string, by: string, now: Date = new Date()): Promise<{ ok: true; row: BookingRequestRow } | { ok: false; reason: string }> {
  if (!isServiceConfigured) return { ok: false, reason: 'Helm is not connected to its database.' };
  const { data: current, error } = await supabaseAdmin.from(TABLE).select(BOOKING_REQUEST_COLS).eq('id', id).maybeSingle();
  if (error) return { ok: false, reason: error.message };
  if (!current) return { ok: false, reason: 'No such request.' };
  const row = current as BookingRequestRow;
  if (!isOpen(row, now)) return { ok: false, reason: 'This request is already closed.' };
  if (row.hold_status !== 'held') return { ok: false, reason: 'There is no card on hold for this request, so it cannot be accepted. Decline it and ask the guest to send it again.' };

  // The host's own calendars, read again now: a night they sold on Airbnb a
  // minute ago must stop the yes. A feed that cannot be read keeps its last
  // good read, which counts below only while it is recent.
  await syncPartnerFeeds({ propertyId: row.property_id, now });
  const stale = staleFeedsBlockAccept(await listPartnerFeeds(row.property_id), now);
  if (stale) return { ok: false, reason: stale };
  const cal = await rangeCheckForBridge(row.property_id, row.check_in, row.check_out, { now });
  if (!cal.ok) return { ok: false, reason: 'The calendar could not be read just now. Try again in a minute.' };
  if (cal.reservedDates.length > 0) return { ok: false, reason: 'Another stay holds some of these nights now. Decline this request.' };

  const { data, error: upErr } = await supabaseAdmin
    .from(TABLE)
    .update({ status: 'accepted', decided_at: now.toISOString(), decided_by: by })
    .eq('id', id)
    .eq('status', 'pending')
    .eq('hold_status', 'held')
    .gt('respond_by', now.toISOString())
    .select(BOOKING_REQUEST_COLS)
    .maybeSingle();
  if (upErr) {
    if (upErr.code === '23P01') return { ok: false, reason: 'Another accepted request already holds these nights.' };
    return { ok: false, reason: upErr.message };
  }
  if (!data) return { ok: false, reason: 'This request is already closed.' };
  return { ok: true, row: data as BookingRequestRow };
}

/** Phase 1: the office passed the request to the host by hand. Stamped once. */
export async function markHostTold(id: string, by: string, now: Date = new Date()): Promise<{ ok: boolean; reason?: string }> {
  const { data, error } = await supabaseAdmin
    .from(TABLE)
    .update({ host_told_at: now.toISOString(), host_told_by: by })
    .eq('id', id)
    .eq('status', 'pending')
    .is('host_told_at', null)
    .select('id')
    .maybeSingle();
  if (error) return { ok: false, reason: error.message };
  return data ? { ok: true } : { ok: false, reason: 'Already marked, or the request is closed.' };
}

// ─── The cron ───────────────────────────────────────────────────────────────

export type SweepResult = { ok: true; expired: number; outcomeEmails: number; receipts: number; confirmations: number } | { ok: false; reason: string };

/**
 * Close every request whose clock ran out, email those guests, and retry the
 * emails that failed: an outcome for OUTCOME_RETRY_DAYS, a receipt while the
 * request is open. Each row is claimed with status = 'pending' in the where
 * clause, so an owner's decline racing the sweep decides it once.
 */
export async function sweepBookingRequests(now: Date = new Date()): Promise<SweepResult> {
  if (!isServiceConfigured) return { ok: false, reason: 'not_configured' };
  const nowIso = now.toISOString();

  const { data: due, error } = await supabaseAdmin
    .from(TABLE)
    .select('id')
    .eq('status', 'pending')
    .lte('respond_by', nowIso)
    .order('respond_by', { ascending: true })
    .limit(100);
  if (error) return { ok: false, reason: isMissingTable(error) ? 'not_configured' : error.message };

  let expired = 0;
  for (const { id } of (due ?? []) as Array<{ id: string }>) {
    const { data } = await supabaseAdmin
      .from(TABLE)
      .update({ status: 'expired', decided_at: nowIso, decided_by: 'cron' })
      .eq('id', id)
      .eq('status', 'pending')
      .lte('respond_by', nowIso)
      .select('id')
      .maybeSingle();
    if (data) expired++;
  }

  // Every closed request owes the guest one email; send what has not gone.
  const retrySince = new Date(now.getTime() - OUTCOME_RETRY_DAYS * 86_400_000).toISOString();
  const { data: owed } = await supabaseAdmin
    .from(TABLE)
    .select(BOOKING_REQUEST_COLS)
    .in('status', ['declined', 'expired'])
    .is('outcome_emailed_at', null)
    .gte('decided_at', retrySince)
    .limit(100);
  let outcomeEmails = 0;
  for (const row of (owed ?? []) as BookingRequestRow[]) {
    if (await emailOutcome(row)) outcomeEmails++;
  }

  const { data: unreceipted } = await supabaseAdmin
    .from(TABLE)
    .select(BOOKING_REQUEST_COLS)
    .eq('status', 'pending')
    .is('receipt_emailed_at', null)
    .gt('respond_by', nowIso)
    .limit(100);
  let receipts = 0;
  for (const row of (unreceipted ?? []) as BookingRequestRow[]) {
    try {
      if (await sendRequestReceipt(row, await titleFor(row.property_id))) {
        await supabaseAdmin.from(TABLE).update({ receipt_emailed_at: new Date().toISOString() }).eq('id', row.id).is('receipt_emailed_at', null);
        receipts++;
      }
    } catch {
      // the next sweep tries again
    }
  }

  const confirmations = await retryConfirmations(now);

  return { ok: true, expired, outcomeEmails, receipts, confirmations };
}
