'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import { getStripeKeysMap } from '@/lib/stripe-sync';

/**
 * Fire the off-session balance charge for one balance_charges row.
 *
 * The whole point of the saved-card flow: the operator's single click here
 * replaces minting a second payment link and chasing the guest in January.
 * The charge is exactly balance_cents (the bound IS the recorded balance -
 * no $2,000 link cap), in the PROPERTY'S OWN Stripe account, against the
 * customer + payment method captured at deposit checkout.
 *
 * Concurrency: an atomic scheduled->charging claim means a double click or
 * two operators can never fire two PaymentIntents; the Stripe Idempotency-Key
 * (row id + attempt counter) backstops a network retry of the same attempt
 * while letting an explicit operator retry be a fresh request.
 *
 * Outcomes land on the row (charged / failed with the decline detail) and as
 * an appended note on the concierge's balance work slip, so /work tells the
 * same story. Failure fallback: the operator sends a payment link by hand -
 * the page says so next to every failed row.
 */

const STRIPE = 'https://api.stripe.com/v1';

type ChargeRow = {
  id: string;
  request_key: string;
  property_id: string;
  guest_name: string;
  guest_email: string;
  window_start: string | null;
  window_end: string | null;
  balance_cents: number;
  stripe_customer_id: string;
  stripe_payment_method_id: string;
  charge_after: string;
  slip_request_key: string;
  status: string;
  charge_attempts: number;
};

/** Append an outcome note to the concierge's balance slip (best-effort:
 * a missing slip never blocks or un-charges anything). */
async function noteSlip(slipRequestKey: string, note: string): Promise<void> {
  if (!slipRequestKey) return;
  try {
    const { data: rows } = await supabase
      .from('work_slips')
      .select('id, description')
      .eq('from_guest_request_key', slipRequestKey)
      .limit(1);
    const slip = rows?.[0] as { id: string; description: string | null } | undefined;
    if (!slip) return;
    const merged = [slip.description, note].filter(Boolean).join('\n\n');
    await supabase.from('work_slips').update({ description: merged }).eq('id', slip.id);
    revalidatePath('/work');
  } catch {
    // best-effort only
  }
}

export async function chargeBalance(formData: FormData): Promise<void> {
  const session = await auth();
  const operatorEmail = session?.user?.email;
  if (!operatorEmail) redirect('/auth/signin');

  const id = String(formData.get('id') || '').trim();
  if (!id) redirect('/statements/balance-charges');

  const { data } = await supabase.from('balance_charges').select('*').eq('id', id).maybeSingle();
  const row = data as ChargeRow | null;
  if (!row) redirect('/statements/balance-charges');

  // Chargeable states: scheduled (first attempt), failed (operator retry),
  // charging (recovery from a crash mid-attempt - the page warns to check
  // Stripe for a live PaymentIntent first).
  if (!['scheduled', 'failed', 'charging'].includes(row.status)) {
    redirect(`/statements/balance-charges#row-${id}`);
  }
  const todayIso = new Date().toISOString().slice(0, 10);
  if (row.charge_after > todayIso) {
    redirect(`/statements/balance-charges?err=not_due#row-${id}`);
  }

  const stripeKey = getStripeKeysMap()[row.property_id];
  if (!stripeKey) {
    redirect(`/statements/balance-charges?err=no_key#row-${id}`);
  }

  // Atomic claim: only one caller moves this row into 'charging'. The
  // .eq('status', ...) makes a concurrent click read 0 updated rows and
  // bounce back to the page instead of double-charging.
  const attempt = (row.charge_attempts || 0) + 1;
  const { data: claimed } = await supabase
    .from('balance_charges')
    .update({ status: 'charging', charge_attempts: attempt })
    .eq('id', id)
    .eq('status', row.status)
    .select('id');
  if (!claimed || claimed.length === 0) {
    redirect(`/statements/balance-charges#row-${id}`);
  }

  // Guest-facing text on the Stripe receipt: external title, never the
  // street address (policy 2026-08-20). Internal surfaces still show the
  // internal name; this description also feeds the statements extras queue.
  const { data: prop } = await supabase
    .from('properties')
    .select('title')
    .eq('id', row.property_id)
    .maybeSingle();
  const title = String(prop?.title || '').trim();
  const windowDesc =
    row.window_start && row.window_end ? `${row.window_start} to ${row.window_end}` : '';
  const description = ['Booking balance', row.guest_name, title, windowDesc]
    .filter(Boolean)
    .join(' - ')
    .slice(0, 250);

  const params = new URLSearchParams({
    amount: String(row.balance_cents),
    currency: 'usd',
    customer: row.stripe_customer_id,
    payment_method: row.stripe_payment_method_id,
    off_session: 'true',
    confirm: 'true',
    description,
    'metadata[helm_request_key]': row.request_key,
    'metadata[helm_property_id]': row.property_id,
  });
  if (row.guest_email) params.set('receipt_email', row.guest_email);

  let outcome: 'charged' | 'failed' = 'failed';
  let piId = '';
  let failureCode = '';
  let failureMessage = '';
  try {
    const res = await fetch(`${STRIPE}/payment_intents`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${stripeKey}`,
        'Content-Type': 'application/x-www-form-urlencoded',
        'Idempotency-Key': `helm-balance-${id}-${attempt}`,
      },
      body: params.toString(),
    });
    const pi = (await res.json().catch(() => ({}))) as {
      id?: string;
      status?: string;
      error?: {
        code?: string;
        decline_code?: string;
        message?: string;
        payment_intent?: { id?: string };
      };
    };
    if (res.ok && pi.status === 'succeeded') {
      outcome = 'charged';
      piId = pi.id || '';
    } else if (res.ok) {
      // Created but not settled (requires_action without off_session error
      // shape, 'processing'...). Record it as failed-with-detail; the PI id
      // lets the operator finish or cancel it in the Stripe dashboard.
      piId = pi.id || '';
      failureCode = `pi_status_${pi.status || 'unknown'}`;
      failureMessage = `PaymentIntent ${piId} ended ${pi.status || 'unknown'} instead of succeeded`;
    } else {
      piId = pi.error?.payment_intent?.id || '';
      failureCode = pi.error?.decline_code || pi.error?.code || `http_${res.status}`;
      failureMessage = pi.error?.message || `Stripe HTTP ${res.status}`;
    }
  } catch (e) {
    failureCode = 'network_error';
    failureMessage = e instanceof Error ? e.message : 'network error';
  }

  const amountUsd = `$${(row.balance_cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
  if (outcome === 'charged') {
    await supabase
      .from('balance_charges')
      .update({
        status: 'charged',
        stripe_payment_intent_id: piId,
        charged_at: new Date().toISOString(),
        charged_by_email: operatorEmail,
        failure_code: null,
        failure_message: null,
        failed_at: null,
      })
      .eq('id', id);
    // A linkless payment_link_requests row so the statements Stripe sync's
    // metadata-first guest resolution names this charge in the extras queue
    // (the description ends with the external title, whose words must never
    // feed name matching). Ignore a replay conflict.
    await supabase.from('payment_link_requests').insert({
      request_key: row.request_key,
      property_id: row.property_id,
      label: 'Booking balance',
      guest_name: row.guest_name,
      amount_cents: row.balance_cents,
      stripe_link_id: '',
      url: '',
    });
    await noteSlip(
      row.slip_request_key,
      `--- Balance charged ---\n${amountUsd} charged to the card on file on ${todayIso} ` +
        `by ${operatorEmail} (${piId}). Stripe receipt sent` +
        (row.guest_email ? ` to ${row.guest_email}.` : '.') +
        ` The payment will surface in the statements extras queue.`,
    );
  } else {
    await supabase
      .from('balance_charges')
      .update({
        status: 'failed',
        stripe_payment_intent_id: piId || null,
        failure_code: failureCode,
        failure_message: failureMessage.slice(0, 500),
        failed_at: new Date().toISOString(),
      })
      .eq('id', id);
    await noteSlip(
      row.slip_request_key,
      `--- Balance charge FAILED ---\nOff-session charge of ${amountUsd} failed on ${todayIso}: ` +
        `${failureCode} (${failureMessage.slice(0, 200)}). Fallback: mint and send the guest a ` +
        `payment link for the balance instead (the card on file could not be charged).`,
    );
  }

  revalidatePath('/statements/balance-charges');
  redirect(`/statements/balance-charges#row-${id}`);
}
