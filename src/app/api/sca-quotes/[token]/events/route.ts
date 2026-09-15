import { NextResponse } from 'next/server';
import { revalidatePath } from 'next/cache';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { authorizeStayConcierge } from '@/lib/stay-concierge-auth';
import { getQuoteById, getQuoteByToken, isQuoteToken } from '@/lib/sca-quotes';
import { sendQuoteAcceptFailedStaffAlert, sendQuoteAcceptedStaffAlert } from '@/lib/sca-quote-email';
import { deriveQuoteStatus, fmtCents, type QuoteEvent, type ScaQuoteRow } from '@/lib/sca-quotes-types';

/**
 * POST /api/sca-quotes/<token>/events
 *
 * staycapeann.com reports what the guest did with a custom quote:
 *
 *   viewed         the page rendered (first stamp kept, count bumped)
 *   declined       the guest pressed "not the right fit"
 *   accept_failed  a stage of the accept flow broke; the card was not kept
 *   accepted       the card was captured and the Guesty reservation exists
 *   balance_paid   the second leg of a split plan was captured
 *
 * Helm is the record; staycapeann.com is the actor. Nothing here charges a
 * card or touches Guesty. The accepted and balance_paid events are
 * idempotent on the payment intent id so a retried report never double
 * stamps, and both raise a staff alert best-effort (an email outage must
 * not make the guest's request fail after their card was captured).
 *
 * Auth: STAY_CONCIERGE_KEY header. Allowlisted in src/proxy.ts.
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

const EVENTS = new Set(['viewed', 'declined', 'accept_failed', 'accepted', 'balance_paid']);
const LEGS = new Set(['full', 'deposit', 'balance']);
const STAGES = new Set(['stripe', 'guesty', 'capture', 'other']);

function requestOrigin(req: Request): string {
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host') || '';
  const proto = req.headers.get('x-forwarded-proto') || 'https';
  return host ? `${proto}://${host}` : '';
}

const s = (v: unknown, max = 200): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');

const cents = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? Math.round(v) : null;

/** Dated lines appended to internal_notes; the history survives, the live fields move on. */
function appendNotes(existing: string | null, lines: string[]): string | null {
  if (lines.length === 0) return existing;
  const when = new Date().toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/New_York',
  });
  const block = lines.map((l) => `[${when} staycapeann.com] ${l}`).join('\n');
  return existing && existing.trim() ? `${existing.trimEnd()}\n${block}` : block;
}

export async function POST(req: Request, ctx: { params: Promise<{ token: string }> }) {
  const denied = authorizeStayConcierge(req);
  if (denied) return denied;

  const { token } = await ctx.params;
  if (!isQuoteToken(token)) return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON body' }, { status: 400 });
  }
  const eventName = s(body?.event, 40);
  if (!EVENTS.has(eventName)) return NextResponse.json({ ok: false, error: 'unknown event' }, { status: 400 });
  const event = body as unknown as QuoteEvent;

  let row: ScaQuoteRow | null;
  try {
    row = await getQuoteByToken(token);
  } catch (err) {
    console.error('[sca-quotes/events] read failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ ok: false, error: 'unavailable' }, { status: 503 });
  }
  if (!row || row.voided_at || row.status === 'voided') {
    return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
  }

  const now = new Date().toISOString();
  const status = deriveQuoteStatus(row);
  const origin = requestOrigin(req);
  let update: Record<string, unknown> | null = null;
  let alert: 'accepted' | 'balance' | 'failed' | null = null;

  switch (event.event) {
    case 'viewed': {
      update = { viewed_at: row.viewed_at ?? now, view_count: (row.view_count ?? 0) + 1 };
      break;
    }
    case 'declined': {
      // Only a live quote can be declined; an accepted or expired one keeps
      // its state (the guest's "no" after paying is a cancellation, handled
      // in Guesty, not here).
      if (status !== 'sent') return NextResponse.json({ ok: true, status, ignored: true });
      update = { declined_at: now, decline_reason: s(event.reason, 500) || null, status: 'declined' };
      break;
    }
    case 'accept_failed': {
      const leg = LEGS.has(s(event.leg, 20)) ? s(event.leg, 20) : 'unknown';
      const stage = STAGES.has(s(event.stage, 20)) ? s(event.stage, 20) : 'other';
      const error = s(event.error, 900) || 'unknown error';
      update = { accept_error: `[${leg}/${stage}] ${error}`.slice(0, 1000), accept_error_at: now };
      alert = 'failed';
      break;
    }
    case 'accepted': {
      const pi = s(event.stripe_payment_intent_id);
      if (!pi) return NextResponse.json({ ok: false, error: 'stripe_payment_intent_id required' }, { status: 400 });
      if (row.accepted_at && row.stripe_payment_intent_id === pi) {
        return NextResponse.json({ ok: true, status: 'accepted', deduped: true });
      }
      const leg = s(event.leg, 20);
      const guest = (event.guest ?? {}) as Partial<Record<'first_name' | 'last_name' | 'email' | 'phone', unknown>>;
      // Email and phone are the guest's verified contact channels: they are
      // what the Stripe receipt, the Guesty reservation and the filed
      // agreement carry, so a correction the guest typed at checkout wins
      // over the operator's spelling (the balance reminders read these).
      // Names stay fill-only; the operator's spelling of a name is not a
      // delivery address. Every change lands in the notes.
      const email = s(guest.email, 200).toLowerCase() || null;
      const phone = s(guest.phone, 40) || null;
      const amountPaid = cents(event.amount_cents);
      const expected = leg === 'deposit' ? row.deposit_cents : row.total_cents;
      const notes: string[] = [];
      if (email && row.guest_email && email !== row.guest_email) {
        notes.push(`Guest corrected their email at checkout: ${row.guest_email} became ${email}`);
      }
      if (phone && row.guest_phone && phone !== row.guest_phone) {
        notes.push(`Guest corrected their phone at checkout: ${row.guest_phone} became ${phone}`);
      }
      if (amountPaid != null && expected != null && amountPaid !== expected) {
        notes.push(
          `Card charged ${fmtCents(amountPaid, row.currency)} on the ${leg || 'first'} leg; the quote on file expected ${fmtCents(expected, row.currency)}. Check the edit history.`,
        );
      }
      update = {
        accepted_at: now,
        status: 'accepted',
        stripe_account_key: s(event.stripe_account_key) || null,
        stripe_payment_intent_id: pi,
        amount_paid_cents: amountPaid,
        guesty_reservation_id: s(event.guesty_reservation_id) || null,
        guesty_confirmation_code: s(event.guesty_confirmation_code, 40) || null,
        guesty_total_cents: cents(event.guesty_total_cents),
        guest_first_name: row.guest_first_name || s(guest.first_name, 80),
        guest_last_name: row.guest_last_name || s(guest.last_name, 80),
        guest_email: email ?? row.guest_email,
        guest_phone: phone ?? row.guest_phone,
        internal_notes: appendNotes(row.internal_notes, notes),
        agreement_version: s(event.agreement_version, 40) || null,
        agreement_accepted_at: s(event.agreement_accepted_at, 40) || null,
        accept_ip: s(event.accept_ip, 64) || null,
        deposit_paid_at: leg === 'deposit' ? now : row.deposit_paid_at,
        accept_error: null,
      };
      alert = 'accepted';
      break;
    }
    case 'balance_paid': {
      if (row.balance_paid_at) return NextResponse.json({ ok: true, status, deduped: true });
      const pi = s(event.stripe_payment_intent_id);
      if (!pi) return NextResponse.json({ ok: false, error: 'stripe_payment_intent_id required' }, { status: 400 });
      const balancePaid = cents(event.amount_cents);
      const balanceNotes: string[] = [];
      if (balancePaid != null && row.balance_cents != null && balancePaid !== row.balance_cents) {
        balanceNotes.push(
          `Card charged ${fmtCents(balancePaid, row.currency)} on the balance leg; the quote on file expected ${fmtCents(row.balance_cents, row.currency)}.`,
        );
      }
      update = {
        balance_paid_at: now,
        balance_payment_intent_id: pi,
        balance_paid_cents: balancePaid,
        internal_notes: appendNotes(row.internal_notes, balanceNotes),
      };
      alert = 'balance';
      break;
    }
  }

  if (update) {
    const { error } = await supabaseAdmin.from('sca_quotes').update(update).eq('id', row.id);
    if (error) {
      console.error('[sca-quotes/events] write failed:', error.message);
      return NextResponse.json({ ok: false, error: 'write failed' }, { status: 500 });
    }
    revalidatePath('/guests/quotes');
    revalidatePath(`/guests/quotes/${row.id}`);
  }

  const updated = (await getQuoteById(row.id).catch(() => null)) ?? { ...row, ...(update ?? {}) } as ScaQuoteRow;

  if (alert && origin) {
    // Best-effort. The stamp is already in; a mail failure is a log line.
    try {
      const r =
        alert === 'failed'
          ? await sendQuoteAcceptFailedStaffAlert({ quote: updated, origin })
          : await sendQuoteAcceptedStaffAlert({ quote: updated, origin, leg: alert });
      if (!r.ok) console.warn('[sca-quotes/events] staff alert skipped:', r.reason);
    } catch (err) {
      console.warn('[sca-quotes/events] staff alert threw:', err instanceof Error ? err.message : String(err));
    }
  }

  return NextResponse.json({ ok: true, status: deriveQuoteStatus(updated) });
}
