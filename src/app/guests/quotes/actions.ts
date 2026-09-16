'use server';

import crypto from 'node:crypto';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { greetingMismatch } from '@/lib/quote-message';

/** The property resolved to a Guesty listing staycapeann.com cannot sell (no Stripe key, no page). */
function unsellableListingError(property: { name: string; guesty_listing_id: string }): string {
  return (
    `${property.name}'s Guesty listing ${property.guesty_listing_id} is not one staycapeann.com sells, ` +
    'so the guest would see no pay form. Set the live listing id on the property in the registry first.'
  );
}
import { owedOccupancyTaxRate } from '@/lib/occupancy-tax';
import {
  achievedNightlyLastYear,
  balanceDueDefault,
  defaultExpiresAt,
  fetchScaAvailability,
  fetchScaGuestyQuote,
  getQuoteById,
  listQuotableProperties,
  splitAllowed,
} from '@/lib/sca-quotes';
import {
  sendBalanceReminderEmail,
  sendBalanceReminderSms,
  sendQuoteLinkEmail,
  sendQuoteSms,
} from '@/lib/sca-quote-email';
import {
  SCA_QUOTE_TERMS_VERSION,
  TAX_EXEMPT_OVER_NIGHTS,
  computeQuoteMoney,
  defaultCancellationTerms,
  deriveQuoteStatus,
  isIsoDay,
  nightsBetween,
  todayInEastern,
  type ExtraLine,
  type ReferenceQuote,
  type ScaQuoteRow,
  type ScaQuoteStatus,
} from '@/lib/sca-quotes-types';

/**
 * Server actions for Stay Cape Ann custom quotes (/guests/quotes).
 *
 * Two shapes live here on purpose. The composer is a client component with
 * live totals, so it calls previewQuoteContext and saveQuote as plain async
 * functions and reads a result object back (a thrown error would only
 * reach an error boundary, which is the wrong surface for "check-out must
 * be after check-in"). The detail page's workflow buttons are ordinary
 * <form action> submits with SubmitButton, same as the agreements module,
 * and those throw on failure like sendAgreementToGuest does.
 *
 * Every write goes through the service-role client: sca_quotes is
 * RLS-locked with no anon policies. Money is recomputed server-side from
 * the lines with computeQuoteMoney; the client's tax rate and totals are
 * never trusted, only its inputs.
 */

async function requireStaff(): Promise<string> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) throw new Error('Not signed in');
  return email;
}

async function getRequestOrigin(): Promise<string> {
  const h = await headers();
  const host = h.get('x-forwarded-host') || h.get('host') || '';
  const proto = h.get('x-forwarded-proto') || 'https';
  return host ? `${proto}://${host}` : '';
}

function str(formData: FormData, key: string): string {
  return String(formData.get(key) ?? '').trim();
}

const detailPath = (id: string) => `/guests/quotes/${id}`;

function revalidateQuote(id: string) {
  revalidatePath('/guests/quotes');
  revalidatePath(detailPath(id));
}

async function loadOrThrow(id: string): Promise<ScaQuoteRow> {
  if (!id) throw new Error('Missing quote id');
  const row = await getQuoteById(id);
  if (!row) throw new Error('Quote not found');
  return row;
}

function stamp(): string {
  return new Date().toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/New_York',
  });
}

/** Append a dated line to internal_notes without losing what is there. */
function appendNote(existing: string | null, line: string, by: string): string {
  const entry = `[${stamp()} ${by}] ${line}`;
  return existing && existing.trim() ? `${existing.trimEnd()}\n${entry}` : entry;
}

// ─── Composer input ─────────────────────────────────────────────────────────

export type QuoteFormInput = {
  id?: string;
  property_id: string;
  check_in: string;
  check_out: string;
  guests: number;
  guest_first_name: string;
  guest_last_name: string;
  guest_email: string;
  guest_phone: string;
  nightly_cents: number | null;
  accommodation_cents: number;
  cleaning_cents: number;
  extra_lines: ExtraLine[];
  discount_label: string;
  discount_cents: number;
  tax_exempt: boolean;
  payment_plan: 'full' | 'split';
  deposit_cents: number | null;
  balance_due_on: string | null;
  override_calendar: boolean;
  override_terms: boolean;
  message: string;
  cancellation_terms: string;
  internal_notes: string;
  expires_at: string | null;
  reference_quote: ReferenceQuote | null;
  source_kind?: string | null;
  source_ref?: string | null;
};

export type QuotePreview =
  | {
      ok: true;
      guesty_listing_id: string;
      property_title: string;
      tax_rate: number;
      tax_exempt_default: boolean;
      availability: {
        checked: boolean;
        blocked_dates: string[];
        unreleased_dates: string[];
        min_nights: number | null;
        error?: string;
      };
      reference: ReferenceQuote | null;
      /**
       * Last year's achieved nightly on its own, so the composer can still
       * show it when Guesty refused to quote (a min-nights violation is the
       * common case for a custom quote) and `reference` is null.
       */
      achieved: { nightly: number; sample_nights: number } | null;
      terms_violation: string | null;
      /** Guesty's price could not be read (timeout, rate limit, outage). Not a min-nights refusal. */
      reference_error: string | null;
      suggested_nightly_cents: number | null;
      suggested_cleaning_cents: number | null;
    }
  | { ok: false; error: string };

function cents(n: unknown): number {
  const v = Math.round(Number(n));
  return Number.isFinite(v) && v > 0 ? v : 0;
}

function validStay(checkIn: string, checkOut: string): string | null {
  if (!isIsoDay(checkIn) || !isIsoDay(checkOut)) return 'Pick a check-in and a check-out date.';
  if (checkOut <= checkIn) return 'Check-out must be after check-in.';
  const nights = nightsBetween(checkIn, checkOut);
  if (nights < 1 || nights > 365) return 'A quote covers 1 to 365 nights.';
  return null;
}

/**
 * Everything the composer wants to know once property + dates are picked:
 * what the calendar says, what Guesty would charge, what last year
 * achieved, and the tax rate. Read-only; nothing is saved.
 */
export async function previewQuoteContext(args: {
  property_id: string;
  check_in: string;
  check_out: string;
  guests: number;
}): Promise<QuotePreview> {
  await requireStaff();
  const stayError = validStay(args.check_in, args.check_out);
  if (stayError) return { ok: false, error: stayError };
  const guests = Math.round(Number(args.guests)) || 0;
  if (guests < 1 || guests > 30) return { ok: false, error: 'Guests must be between 1 and 30.' };

  const property = (await listQuotableProperties()).find((p) => p.id === args.property_id);
  if (!property) return { ok: false, error: 'Pick a property.' };
  if (!property.guesty_listing_id) return { ok: false, error: 'This property is not on Stay Cape Ann yet.' };
  if (!property.on_sca) return { ok: false, error: unsellableListingError(property) };

  const nights = nightsBetween(args.check_in, args.check_out);
  const listingId = property.guesty_listing_id;

  const [avail, guestyQuote, achieved] = await Promise.all([
    fetchScaAvailability(listingId, args.check_in, args.check_out),
    fetchScaGuestyQuote(listingId, args.check_in, args.check_out, guests),
    achievedNightlyLastYear(property.id, args.check_in, args.check_out),
  ]);

  // Nights are [check_in, check_out); the checkout day is the next guest's
  // arrival day and never counts against this quote.
  const blocked: string[] = [];
  const unreleased: string[] = [];
  let minNights: number | null = null;
  const nightPrices: number[] = [];
  if (avail.ok) {
    for (const d of avail.days) {
      if (d.date < args.check_in || d.date >= args.check_out) continue;
      if (d.prerelease) unreleased.push(d.date);
      else if (!d.available) blocked.push(d.date);
      if (typeof d.minNights === 'number' && d.minNights > 0) minNights = Math.max(minNights ?? 0, d.minNights);
      if (typeof d.price === 'number' && d.price > 0) nightPrices.push(d.price);
    }
  }

  let reference: ReferenceQuote | null = null;
  let termsViolation: string | null = null;
  let referenceError: string | null = null;
  if (guestyQuote.ok) {
    reference = {
      fetched_at: new Date().toISOString(),
      estimated: !!guestyQuote.quote.estimated,
      nights: guestyQuote.quote.nights || nights,
      subtotal: guestyQuote.quote.subtotal,
      cleaning_fee: guestyQuote.quote.cleaningFee,
      extra_guest_fee: guestyQuote.quote.extraGuestFee,
      taxes: guestyQuote.quote.taxes,
      total: guestyQuote.quote.total,
      currency: guestyQuote.quote.currency,
      achieved_nightly: achieved?.nightly ?? null,
      achieved_sample_nights: achieved?.sample_nights ?? null,
    };
  } else if (guestyQuote.termsViolation) {
    termsViolation = guestyQuote.error;
  } else {
    referenceError = guestyQuote.error;
  }

  // Suggested nightly, best source first: Guesty's real quote, then what
  // the window actually achieved a year ago, then the calendar's list
  // prices (PriceLabs leftovers, the weakest signal).
  let suggestedNightly: number | null = null;
  if (guestyQuote.ok && !guestyQuote.quote.estimated && guestyQuote.quote.subtotal > 0 && nights > 0) {
    suggestedNightly = Math.round((guestyQuote.quote.subtotal / nights) * 100);
  } else if (achieved) {
    suggestedNightly = Math.round(achieved.nightly * 100);
  } else if (nightPrices.length > 0) {
    suggestedNightly = Math.round((nightPrices.reduce((s, p) => s + p, 0) / nightPrices.length) * 100);
  }
  const suggestedCleaning =
    guestyQuote.ok && guestyQuote.quote.cleaningFee > 0 ? Math.round(guestyQuote.quote.cleaningFee * 100) : null;

  return {
    ok: true,
    guesty_listing_id: listingId,
    property_title: property.title || property.name,
    tax_rate: owedOccupancyTaxRate(property.id),
    tax_exempt_default: nights > TAX_EXEMPT_OVER_NIGHTS,
    availability: {
      checked: avail.ok,
      blocked_dates: blocked,
      unreleased_dates: unreleased,
      min_nights: minNights,
      error: avail.ok ? undefined : avail.error,
    },
    reference,
    achieved,
    terms_violation: termsViolation,
    reference_error: referenceError,
    suggested_nightly_cents: suggestedNightly,
    suggested_cleaning_cents: suggestedCleaning,
  };
}

/** Light shape check on the reference the composer hands back from preview. */
function sanitizeReference(r: ReferenceQuote | null | undefined): ReferenceQuote | null {
  if (!r || typeof r !== 'object') return null;
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);
  if (!(n(r.total) > 0 || n(r.subtotal) > 0)) return null;
  return {
    fetched_at: typeof r.fetched_at === 'string' ? r.fetched_at : new Date().toISOString(),
    estimated: !!r.estimated,
    nights: n(r.nights),
    subtotal: n(r.subtotal),
    cleaning_fee: n(r.cleaning_fee),
    extra_guest_fee: n(r.extra_guest_fee),
    taxes: n(r.taxes),
    total: n(r.total),
    currency: typeof r.currency === 'string' && r.currency ? r.currency : 'USD',
    achieved_nightly: typeof r.achieved_nightly === 'number' ? r.achieved_nightly : null,
    achieved_sample_nights: typeof r.achieved_sample_nights === 'number' ? r.achieved_sample_nights : null,
  };
}

/**
 * Create or update a quote from the composer. Returns the id on success and
 * a human-readable error otherwise. Money is recomputed here from the lines;
 * the client's preview is only ever a preview.
 */
export async function saveQuote(input: QuoteFormInput): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  let staff: string;
  try {
    staff = await requireStaff();
  } catch {
    return { ok: false, error: 'Not signed in.' };
  }

  const stayError = validStay(input.check_in, input.check_out);
  if (stayError) return { ok: false, error: stayError };
  const nights = nightsBetween(input.check_in, input.check_out);
  const guests = Math.round(Number(input.guests)) || 0;
  if (guests < 1 || guests > 30) return { ok: false, error: 'Guests must be between 1 and 30.' };

  const property = (await listQuotableProperties()).find((p) => p.id === input.property_id);
  if (!property) return { ok: false, error: 'Pick a property.' };
  if (!property.guesty_listing_id) return { ok: false, error: 'This property is not on Stay Cape Ann yet.' };
  if (!property.on_sca) return { ok: false, error: unsellableListingError(property) };

  // The email and text open with the guest's own first name; a note that
  // greets someone else goes straight to the guest. 2026-09-16.
  const greetingError = greetingMismatch(String(input.message ?? ''), String(input.guest_first_name ?? ''));
  if (greetingError) return { ok: false, error: greetingError };

  const accommodation = cents(input.accommodation_cents);
  if (!(Number(input.accommodation_cents) >= 0)) return { ok: false, error: 'Accommodation cannot be negative.' };
  const cleaning = cents(input.cleaning_cents);
  const extraLines: ExtraLine[] = [];
  for (const line of input.extra_lines ?? []) {
    const label = String(line?.label ?? '').trim();
    const amount = cents(line?.cents);
    if (!label) return { ok: false, error: 'Every extra line needs a label.' };
    if (amount <= 0) return { ok: false, error: `"${label}" needs an amount above zero.` };
    // Every extra line is taxable. Guesty folds the extras into the
    // accommodation fare and taxes the whole fare from the listing's config,
    // and the statements inversion divides the collected gross by the same
    // multiplier, so an "untaxed" line here would only make Helm's total
    // disagree with both. tax_exempt (32+ nights) still zeroes everything.
    void line.taxable;
    extraLines.push({ label: label.slice(0, 80), cents: amount, taxable: true });
  }
  const discount = cents(input.discount_cents);
  if (discount > accommodation) return { ok: false, error: 'The discount cannot exceed the accommodation.' };
  const discountLabel = String(input.discount_label ?? '').trim().slice(0, 80);

  const taxRate = owedOccupancyTaxRate(property.id);
  const taxExempt = !!input.tax_exempt;
  const plan: 'full' | 'split' = input.payment_plan === 'split' ? 'split' : 'full';

  let balanceDueOn: string | null = null;
  if (plan === 'split') {
    if (!splitAllowed(input.check_in)) {
      return { ok: false, error: 'A deposit plan needs a check-in more than 60 days out. Use pay in full.' };
    }
    balanceDueOn = isIsoDay(input.balance_due_on) ? input.balance_due_on : balanceDueDefault(input.check_in);
    const today = todayInEastern();
    if (balanceDueOn <= today || balanceDueOn >= input.check_in) {
      return { ok: false, error: 'The balance due date must fall between today and check-in.' };
    }
  }

  const money = computeQuoteMoney({
    accommodation_cents: accommodation,
    cleaning_cents: cleaning,
    extra_lines: extraLines,
    discount_cents: discount,
    tax_rate: taxRate,
    tax_exempt: taxExempt,
    payment_plan: plan,
    deposit_cents: plan === 'split' ? input.deposit_cents : null,
  });
  if (money.total_cents < 100) return { ok: false, error: 'The total must be at least $1.' };
  // Each leg is its own card charge, and staycapeann.com refuses a charge
  // under a dollar. A 50-cent deposit or a one-cent balance would save fine
  // and then strand the guest at the payment step.
  if (plan === 'split' && (money.deposit_cents == null || money.balance_cents == null || money.deposit_cents < 100 || money.balance_cents < 100)) {
    return { ok: false, error: 'The deposit and the balance must each be at least $1.' };
  }

  const nightly = input.nightly_cents != null && cents(input.nightly_cents) > 0 ? cents(input.nightly_cents) : null;

  let expiresAt = defaultExpiresAt();
  if (input.expires_at) {
    const t = Date.parse(input.expires_at);
    if (!Number.isFinite(t)) return { ok: false, error: 'The expiry date is not valid.' };
    expiresAt = new Date(t).toISOString();
  }

  const cancellationTerms =
    String(input.cancellation_terms ?? '').trim() ||
    defaultCancellationTerms({ payment_plan: plan, check_in: input.check_in, balance_due_on: balanceDueOn });

  const payload: Record<string, unknown> = {
    property_id: property.id,
    guesty_listing_id: property.guesty_listing_id,
    property_title: property.title || property.name,
    property_internal_name: property.name,
    check_in: input.check_in,
    check_out: input.check_out,
    nights,
    guests,
    guest_first_name: String(input.guest_first_name ?? '').trim().slice(0, 80),
    guest_last_name: String(input.guest_last_name ?? '').trim().slice(0, 80),
    guest_email: String(input.guest_email ?? '').trim().toLowerCase() || null,
    guest_phone: String(input.guest_phone ?? '').trim() || null,
    currency: 'USD',
    nightly_cents: nightly,
    accommodation_cents: accommodation,
    cleaning_cents: cleaning,
    extra_lines: extraLines,
    discount_label: discount > 0 ? discountLabel || 'Discount' : discountLabel || null,
    discount_cents: discount,
    tax_exempt: taxExempt,
    tax_rate: taxExempt ? 0 : taxRate,
    tax_cents: money.tax_cents,
    total_cents: money.total_cents,
    payment_plan: plan,
    deposit_cents: plan === 'split' ? money.deposit_cents : null,
    balance_cents: plan === 'split' ? money.balance_cents : null,
    balance_due_on: balanceDueOn,
    override_calendar: !!input.override_calendar,
    override_terms: !!input.override_terms,
    message: String(input.message ?? '').trim() || null,
    cancellation_terms: cancellationTerms,
    terms_version: SCA_QUOTE_TERMS_VERSION,
    internal_notes: String(input.internal_notes ?? '').trim() || null,
    reference_quote: sanitizeReference(input.reference_quote),
    expires_at: expiresAt,
    // The composition changed; bridge events never touch this stamp.
    edited_at: new Date().toISOString(),
  };

  if (input.id) {
    const existing = await getQuoteById(input.id);
    if (!existing) return { ok: false, error: 'Quote not found.' };
    const status = deriveQuoteStatus(existing);
    if (status === 'accepted') return { ok: false, error: 'This quote was accepted and paid. Duplicate it to offer new terms.' };
    if (status === 'voided') return { ok: false, error: 'This quote is voided. Restore it first, or duplicate it.' };
    // The column holds 'expired' once the cron or the bridge stamped it, and
    // deriveQuoteStatus trusts the column before the date. Saving a new
    // expiry from the composer is the operator reviving the quote, the same
    // thing the Extend button does, so revive it the same way.
    if (existing.status === 'expired' && Date.parse(expiresAt) > Date.now()) {
      payload.status = existing.sent_at ? 'sent' : 'draft';
    }
    const { error } = await supabaseAdmin.from('sca_quotes').update(payload).eq('id', input.id);
    if (error) return { ok: false, error: error.message };
    revalidateQuote(input.id);
    return { ok: true, id: input.id };
  }

  payload.token = crypto.randomBytes(16).toString('hex');
  payload.status = 'draft';
  payload.created_by = staff;
  payload.source_kind = String(input.source_kind ?? '').trim().slice(0, 40) || null;
  payload.source_ref = String(input.source_ref ?? '').trim().slice(0, 200) || null;

  const { data, error } = await supabaseAdmin.from('sca_quotes').insert(payload).select('id').single();
  if (error || !data) return { ok: false, error: error?.message || 'Insert failed.' };
  revalidateQuote(data.id as string);
  return { ok: true, id: data.id as string };
}

// ─── Detail page workflow (FormData actions) ────────────────────────────────

function refuseIf(status: ScaQuoteStatus, ...blocked: ScaQuoteStatus[]) {
  if (blocked.includes(status)) {
    const why: Record<ScaQuoteStatus, string> = {
      draft: 'This quote is a draft.',
      sent: 'This quote is out with the guest.',
      accepted: 'This quote was accepted and paid.',
      declined: 'The guest declined this quote.',
      expired: 'This quote has expired. Extend it first.',
      voided: 'This quote is voided. Restore it first.',
    };
    throw new Error(why[status]);
  }
}

/**
 * Sending a quote the guest had declined is a re-offer: the decline has to
 * clear or deriveQuoteStatus keeps reading it as declined. The reason is
 * kept in the notes so the history survives.
 */
function reofferFields(quote: ScaQuoteRow, by: string): Record<string, unknown> {
  if (!quote.declined_at) return {};
  return {
    declined_at: null,
    decline_reason: null,
    internal_notes: appendNote(
      quote.internal_notes,
      `Re-sent after the guest declined on ${stampOf(quote.declined_at)}${quote.decline_reason ? ` (${quote.decline_reason})` : ''}`,
      by,
    ),
  };
}

function stampOf(iso: string): string {
  return new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', timeZone: 'America/New_York' });
}

/**
 * Email and/or text the guest their quote link. Stamps sent_at the first
 * time, last_sent_at every time, and records which rails carried it. When
 * one rail of "both" fails the other's success is still recorded, and the
 * failure is thrown so the operator sees it.
 */
export async function sendQuote(formData: FormData): Promise<void> {
  const staff = await requireStaff();
  const id = str(formData, 'id');
  const via = str(formData, 'via');
  if (!['email', 'sms', 'both'].includes(via)) throw new Error('Pick email, text, or both');
  const quote = await loadOrThrow(id);
  refuseIf(deriveQuoteStatus(quote), 'voided', 'accepted', 'expired');

  const wantEmail = via === 'email' || via === 'both';
  const wantSms = via === 'sms' || via === 'both';
  if (wantEmail && !quote.guest_email) throw new Error('Add a guest email first (Edit)');
  if (wantSms && !quote.guest_phone) throw new Error('Add a guest phone first (Edit)');

  const delivered: string[] = [];
  const failures: string[] = [];
  if (wantEmail) {
    const r = await sendQuoteLinkEmail({ quote });
    if (r.ok) delivered.push('email');
    else failures.push(`email: ${r.reason}`);
  }
  if (wantSms) {
    const r = await sendQuoteSms({ quote });
    if (r.ok) delivered.push('sms');
    else failures.push(`text: ${r.reason}`);
  }

  if (delivered.length > 0) {
    const now = new Date().toISOString();
    const sentVia = [...quote.sent_via];
    for (const d of delivered) if (!sentVia.includes(d)) sentVia.push(d);
    await supabaseAdmin
      .from('sca_quotes')
      .update({ ...reofferFields(quote, staff), sent_at: quote.sent_at ?? now, last_sent_at: now, sent_via: sentVia, status: 'sent' })
      .eq('id', id);
    revalidateQuote(id);
  }
  if (failures.length > 0) throw new Error(`Send failed (${failures.join('; ')})`);
}

/** The operator shared the link by hand (WhatsApp, an OTA thread). */
export async function markQuoteSent(formData: FormData): Promise<void> {
  const staff = await requireStaff();
  const id = str(formData, 'id');
  const quote = await loadOrThrow(id);
  refuseIf(deriveQuoteStatus(quote), 'voided', 'accepted');
  const now = new Date().toISOString();
  const sentVia = quote.sent_via.includes('link') ? quote.sent_via : [...quote.sent_via, 'link'];
  await supabaseAdmin
    .from('sca_quotes')
    .update({ ...reofferFields(quote, staff), sent_at: quote.sent_at ?? now, last_sent_at: now, sent_via: sentVia, status: 'sent' })
    .eq('id', id);
  revalidateQuote(id);
}

/** Kill the guest link. The bridge 404s a voided quote. */
export async function voidQuote(formData: FormData): Promise<void> {
  await requireStaff();
  const id = str(formData, 'id');
  const quote = await loadOrThrow(id);
  // An accepted quote is a paid reservation's record; voiding it would
  // only hide the balance page from the guest. Cancel in Guesty instead.
  refuseIf(deriveQuoteStatus(quote), 'accepted');
  await supabaseAdmin
    .from('sca_quotes')
    .update({ voided_at: new Date().toISOString(), status: 'voided' })
    .eq('id', id);
  revalidateQuote(id);
}

export async function unvoidQuote(formData: FormData): Promise<void> {
  await requireStaff();
  const id = str(formData, 'id');
  const quote = await loadOrThrow(id);
  if (quote.accepted_at) throw new Error('This quote was accepted and paid.');
  // Restore to whatever the lifecycle says it was; expiry re-derives at read.
  const status: ScaQuoteStatus = quote.declined_at ? 'declined' : quote.sent_at ? 'sent' : 'draft';
  await supabaseAdmin.from('sca_quotes').update({ voided_at: null, status }).eq('id', id);
  revalidateQuote(id);
}

/** Push expires_at out by N days from whichever is later, now or the current expiry. */
export async function extendQuoteExpiry(formData: FormData): Promise<void> {
  await requireStaff();
  const id = str(formData, 'id');
  const days = Math.min(90, Math.max(1, Math.round(Number(str(formData, 'days')) || 7)));
  const quote = await loadOrThrow(id);
  refuseIf(deriveQuoteStatus(quote), 'voided', 'accepted');
  const now = Date.now();
  const current = quote.expires_at ? Date.parse(quote.expires_at) : now;
  const base = Math.max(now, Number.isFinite(current) ? current : now);
  const update: Record<string, unknown> = { expires_at: new Date(base + days * 86_400_000).toISOString() };
  if (quote.status === 'expired') update.status = quote.sent_at ? 'sent' : 'draft';
  await supabaseAdmin.from('sca_quotes').update(update).eq('id', id);
  revalidateQuote(id);
}

/**
 * The guest paid but the bridge never heard about it (or the operator
 * finished the reservation by hand after an accept_failed). Records the
 * Guesty ids so the balance leg and the staff view line up.
 */
export async function markQuoteAcceptedManually(formData: FormData): Promise<void> {
  const staff = await requireStaff();
  const id = str(formData, 'id');
  const code = str(formData, 'confirmation_code');
  const reservationId = str(formData, 'reservation_id');
  const note = str(formData, 'note');
  if (!code) throw new Error('Enter the Guesty confirmation code');
  const quote = await loadOrThrow(id);
  refuseIf(deriveQuoteStatus(quote), 'voided', 'accepted');
  // The balance leg charges against the reservation; without its id the
  // guest page would authorize and release the card on every attempt.
  if (quote.payment_plan === 'split' && !(reservationId || quote.guesty_reservation_id)) {
    throw new Error('Enter the Guesty reservation id so the balance can be collected on the guest page');
  }
  const now = new Date().toISOString();
  await supabaseAdmin
    .from('sca_quotes')
    .update({
      accepted_at: now,
      status: 'accepted',
      guesty_confirmation_code: code,
      guesty_reservation_id: reservationId || quote.guesty_reservation_id,
      // A manual acceptance means the first leg was collected outside the
      // bridge; the balance leg still derives from balance_paid_at.
      deposit_paid_at: quote.payment_plan === 'split' ? now : quote.deposit_paid_at,
      accept_error: null,
      internal_notes: appendNote(
        quote.internal_notes,
        `Marked accepted manually, confirmation ${code}${reservationId ? `, reservation ${reservationId}` : ''}${note ? `. ${note}` : ''}`,
        staff,
      ),
    })
    .eq('id', id);
  revalidateQuote(id);
}

export async function markBalancePaidManually(formData: FormData): Promise<void> {
  const staff = await requireStaff();
  const id = str(formData, 'id');
  const note = str(formData, 'note');
  const quote = await loadOrThrow(id);
  if (deriveQuoteStatus(quote) !== 'accepted') throw new Error('Only an accepted quote has a balance');
  if (quote.payment_plan !== 'split') throw new Error('This quote was paid in full');
  if (quote.balance_paid_at) return;
  await supabaseAdmin
    .from('sca_quotes')
    .update({
      balance_paid_at: new Date().toISOString(),
      internal_notes: appendNote(quote.internal_notes, `Balance marked paid manually${note ? `. ${note}` : ''}`, staff),
    })
    .eq('id', id);
  revalidateQuote(id);
}

/** Nudge the guest about the balance: email, plus a text when we have a phone. */
export async function sendBalanceReminder(formData: FormData): Promise<void> {
  await requireStaff();
  const id = str(formData, 'id');
  const quote = await loadOrThrow(id);
  if (deriveQuoteStatus(quote) !== 'accepted') throw new Error('Only an accepted quote has a balance');
  if (quote.payment_plan !== 'split' || quote.balance_paid_at) throw new Error('No balance is outstanding');
  if (!quote.guest_email && !quote.guest_phone) throw new Error('No guest email or phone on this quote');

  const results: { ok: boolean; reason?: string }[] = [];
  if (quote.guest_email) results.push(await sendBalanceReminderEmail({ quote }));
  if (quote.guest_phone) results.push(await sendBalanceReminderSms({ quote }));
  if (results.some((r) => r.ok)) {
    await supabaseAdmin.from('sca_quotes').update({ balance_reminder_sent_at: new Date().toISOString() }).eq('id', id);
    revalidateQuote(id);
  }
  const failed = results.filter((r) => !r.ok).map((r) => r.reason).filter(Boolean);
  if (failed.length === results.length) throw new Error(`Reminder failed (${failed.join('; ')})`);
}

/**
 * Fresh draft with the same composition and a new token; lifecycle stamps
 * do not carry over. The way to re-offer after an acceptance or a void.
 */
export async function duplicateQuote(formData: FormData): Promise<void> {
  const staff = await requireStaff();
  const id = str(formData, 'id');
  const q = await loadOrThrow(id);

  const { data, error } = await supabaseAdmin
    .from('sca_quotes')
    .insert({
      token: crypto.randomBytes(16).toString('hex'),
      status: 'draft',
      property_id: q.property_id,
      guesty_listing_id: q.guesty_listing_id,
      property_title: q.property_title,
      property_internal_name: q.property_internal_name,
      check_in: q.check_in,
      check_out: q.check_out,
      nights: q.nights,
      guests: q.guests,
      guest_first_name: q.guest_first_name,
      guest_last_name: q.guest_last_name,
      guest_email: q.guest_email,
      guest_phone: q.guest_phone,
      currency: q.currency,
      nightly_cents: q.nightly_cents,
      accommodation_cents: q.accommodation_cents,
      cleaning_cents: q.cleaning_cents,
      extra_lines: q.extra_lines,
      discount_label: q.discount_label,
      discount_cents: q.discount_cents,
      tax_exempt: q.tax_exempt,
      tax_rate: q.tax_rate,
      tax_cents: q.tax_cents,
      total_cents: q.total_cents,
      payment_plan: q.payment_plan,
      deposit_cents: q.deposit_cents,
      balance_cents: q.balance_cents,
      balance_due_on: q.balance_due_on,
      override_calendar: q.override_calendar,
      override_terms: q.override_terms,
      message: q.message,
      cancellation_terms: q.cancellation_terms,
      terms_version: SCA_QUOTE_TERMS_VERSION,
      internal_notes: appendNote(null, `Duplicated from quote ${q.id}`, staff),
      reference_quote: q.reference_quote,
      expires_at: defaultExpiresAt(),
      source_kind: q.source_kind,
      source_ref: q.source_ref,
      created_by: staff,
    })
    .select('id')
    .single();
  if (error || !data) throw new Error(error?.message || 'Duplicate failed');

  revalidatePath('/guests/quotes');
  redirect(detailPath(data.id as string));
}
