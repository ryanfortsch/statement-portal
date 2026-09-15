'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import { owedOccupancyTaxRate } from '@/lib/occupancy-tax';
import {
  checkPaymentLinkPaid,
  deactivatePaymentLink,
  fetchGuestyGuestPhone,
  loadLinkProperties,
  loadPaymentLink,
  mintPaymentLink,
  nudgePaymentLink,
  pickHelmRequestKey,
  recordLinkDelivery,
  sendGuestSms,
} from '@/lib/payment-links';
import {
  buildPaymentLinkSms,
  fillLinkPlaceholder,
  firstName,
  resolvePropertyIdFromName,
  resolvePropertyIdFromSlug,
  toE164,
} from '@/lib/payment-links-text';

/**
 * Server actions behind the Send lens's payment-link panel, the ledger under
 * it, and the Payments cards on the home feed.
 *
 * Proactive links (Dotti, 2026-09-14): the reactive rail only mints when the
 * AI reads a fee commitment in a reply. Charging a guest for a late checkout
 * she decided on herself needed a hand-built Stripe link and a hand-typed
 * text. Now: pick the stay, type what for and how much, and the link mints in
 * the property's own Stripe account and texts to the guest's real phone on
 * the GUESTS line. The ledger and the home feed then say whether it was paid.
 */

const REVALIDATE = ['/messaging/send', '/'];

async function requireEmail(): Promise<string | null> {
  const session = await auth();
  return session?.user?.email ?? null;
}

function revalidateAll() {
  REVALIDATE.forEach((p) => revalidatePath(p));
}

export type LinkPropertyPick = { id: string; name: string; title: string; hasKey: boolean; taxRate: number };

export type PreparedLink = {
  ok: true;
  /** Helm property id the stay resolved to, or null when the concierge slug
   *  matched nothing (or two things) and the operator has to pick. */
  propertyId: string | null;
  propertyName: string;
  propertyTitle: string;
  hasKey: boolean;
  taxRate: number;
  /** E.164 from the Guesty reservation, '' when none on file. */
  guestPhone: string;
  guestFullName: string;
  properties: LinkPropertyPick[];
};

/** Everything the panel needs before the operator types: which property
 *  this stay is, whether Helm can mint there, the tax rate, the phone. */
export async function preparePaymentLinkAction(input: {
  listingSlug: string;
  reservationId: string;
  /** The stay's display name from the picker ("3 South"), tried when the
   *  slug matches nothing. */
  propertyName?: string;
}): Promise<PreparedLink | { ok: false; error: string }> {
  if (!(await requireEmail())) return { ok: false, error: 'Not signed in' };
  const today = new Date().toISOString().slice(0, 10);
  const [all, guest] = await Promise.all([
    loadLinkProperties(),
    fetchGuestyGuestPhone(input.reservationId),
  ]);
  const properties: LinkPropertyPick[] = all.map((p) => ({
    id: p.id,
    name: p.name,
    title: p.title,
    hasKey: p.hasKey,
    taxRate: owedOccupancyTaxRate(p.id, today),
  }));
  const propertyId =
    resolvePropertyIdFromSlug(input.listingSlug, all.map((p) => p.id)) ??
    resolvePropertyIdFromName(input.propertyName || '', all);
  const match = propertyId ? all.find((p) => p.id === propertyId) : undefined;
  return {
    ok: true,
    propertyId,
    propertyName: match?.name ?? '',
    propertyTitle: match?.title ?? '',
    hasKey: !!match?.hasKey,
    taxRate: propertyId ? owedOccupancyTaxRate(propertyId, today) : 0,
    guestPhone: guest.phone,
    guestFullName: guest.fullName,
    properties,
  };
}

export type CreateLinkInput = {
  propertyId: string;
  label: string;
  /** Pre-tax, as quoted to the guest. */
  amountUsd: number;
  taxable: boolean;
  guestName: string;
  guestPhone: string;
  /** The text as previewed (may carry the [link] placeholder). Empty means
   *  build the standard one. */
  smsBody: string;
  /** Text it now (true) or just mint and hand back the URL (false). */
  send: boolean;
  reservationId: string;
  conversationId: string;
};

export type CreateLinkResult =
  | {
      ok: true;
      url: string;
      requestKey: string;
      baseCents: number;
      taxCents: number;
      totalCents: number;
      /** An open link for the same charge already existed; this is it. */
      deduped: boolean;
      sent: boolean;
      sentTo: string;
      /** Set when the link minted but the text did not go out. */
      smsError: string;
      /** Set on a deduped link that was already texted earlier. */
      note: string;
    }
  | { ok: false; error: string };

export async function createPaymentLinkAction(input: CreateLinkInput): Promise<CreateLinkResult> {
  const email = await requireEmail();
  if (!email) return { ok: false, error: 'Not signed in' };

  const propertyId = (input.propertyId || '').trim();
  const label = (input.label || '').trim();
  const amountCents = Math.round(Number(input.amountUsd) * 100);
  const guestName = (input.guestName || '').trim();
  const phone = toE164(input.guestPhone);
  if (!propertyId) return { ok: false, error: 'Pick the property this stay is at.' };
  if (!label) return { ok: false, error: 'Say what the charge is for (late checkout, pet fee, extra night).' };
  if (!Number.isFinite(amountCents) || amountCents < 100 || amountCents > 200_000) {
    return { ok: false, error: 'Amount must be between $1 and $2,000, before tax.' };
  }
  if (input.send && !phone) {
    return { ok: false, error: 'Enter a mobile number to text, or create the link without texting.' };
  }

  const { requestKey, existing } = await pickHelmRequestKey({
    reservationId: input.reservationId || '',
    conversationId: input.conversationId || '',
    propertyId,
    label,
    amountCents,
  });

  const minted = await mintPaymentLink({
    propertyId,
    label,
    amountCents,
    guestName,
    requestKey,
    taxable: input.taxable,
    extras: {
      source: 'helm',
      reservationId: input.reservationId || '',
      conversationId: input.conversationId || '',
      guestPhone: phone,
      createdBy: email,
    },
  });
  if (!minted.ok) return { ok: false, error: explainMintError(minted.error, minted.detail) };

  const result: Extract<CreateLinkResult, { ok: true }> = {
    ok: true,
    url: minted.url,
    requestKey,
    baseCents: minted.base_cents,
    taxCents: minted.tax_cents,
    totalCents: minted.total_cents,
    deduped: minted.deduped,
    sent: false,
    sentTo: '',
    smsError: '',
    note: '',
  };

  // A replayed link that already reached the guest must not text twice; the
  // ledger's Nudge is the deliberate way to remind them.
  if (existing?.sent_via === 'sms') {
    result.note = `You already made this link on ${new Date(existing.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} and texted it. Use Nudge below to remind them.`;
    revalidateAll();
    return result;
  }

  if (input.send && phone) {
    const standard = buildPaymentLinkSms({
      guestFirst: firstName(guestName),
      label,
      baseCents: minted.base_cents,
      taxCents: minted.tax_cents,
      totalCents: minted.total_cents,
      propertyTitle: await propertyTitleFor(propertyId),
      url: minted.url,
    });
    const body = input.smsBody.trim() ? fillLinkPlaceholder(input.smsBody, minted.url) : standard;
    try {
      await sendGuestSms(phone, body);
      await recordLinkDelivery(requestKey, { via: 'sms', phone, body });
      result.sent = true;
      result.sentTo = phone;
    } catch (e) {
      result.smsError = e instanceof Error ? e.message : String(e);
    }
  }
  revalidateAll();
  return result;
}

async function propertyTitleFor(propertyId: string): Promise<string> {
  const all = await loadLinkProperties();
  return all.find((p) => p.id === propertyId)?.title ?? '';
}

function explainMintError(error: string, detail?: string): string {
  switch (error) {
    case 'no_key':
      return 'This property has no Stripe key in Helm, so no link can be minted here. Add its STRIPE_KEY_<PROPERTY_ID> in Vercel.';
    case 'stripe_permission':
      return "The property's Stripe key is read-only. Add write access for Payment Links, Products, and Prices to the restricted key in that property's Stripe dashboard.";
    case 'amount_out_of_range':
      return 'Amount must be between $1 and $2,000, before tax.';
    case 'not_configured':
      return 'Supabase service key is not set, so nothing can be recorded.';
    default:
      return `Stripe refused: ${detail || error}`;
  }
}

/** The operator copied a link she chose not to text: it is now delivered
 *  by hand, and the ledger stops calling it unsent. */
export async function markLinkCopiedAction(requestKey: string): Promise<void> {
  if (!(await requireEmail())) return;
  const row = await loadPaymentLink(requestKey);
  if (!row || row.sent_via) return;
  await recordLinkDelivery(requestKey, { via: 'copied' });
  revalidateAll();
}

export async function nudgePaymentLinkAction(
  requestKey: string,
): Promise<{ ok: true; to: string } | { ok: false; error: string }> {
  if (!(await requireEmail())) return { ok: false, error: 'Not signed in' };
  const r = await nudgePaymentLink(requestKey);
  revalidateAll();
  if (r.ok) return r;
  const msg =
    r.error === 'no_phone'
      ? 'No mobile number on file for this guest, so there is nothing to text. Copy the link and send it by hand.'
      : r.error === 'closed'
        ? 'This link is already paid or cancelled.'
        : r.error === 'send_failed'
          ? `The text did not go out: ${r.detail || 'Quo error'}`
          : 'Unknown link.';
  return { ok: false, error: msg };
}

export async function cancelPaymentLinkAction(
  requestKey: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!(await requireEmail())) return { ok: false, error: 'Not signed in' };
  const r = await deactivatePaymentLink(requestKey);
  revalidateAll();
  if (r.ok) return { ok: true };
  return { ok: false, error: r.error === 'stripe_error' ? `Stripe refused: ${r.detail}` : r.error };
}

export async function checkPaymentLinkAction(
  requestKey: string,
): Promise<{ ok: true; paid: boolean } | { ok: false; error: string }> {
  if (!(await requireEmail())) return { ok: false, error: 'Not signed in' };
  const row = await loadPaymentLink(requestKey);
  if (!row) return { ok: false, error: 'Unknown link.' };
  const r = await checkPaymentLinkPaid(row);
  revalidateAll();
  if (!r.ok) return { ok: false, error: r.detail || r.error };
  return { ok: true, paid: r.paid };
}

// Form-shaped twins for server components (<form action={fn.bind(null, key)}>):
// the ledger rows and the home-feed Payments cards. Outcomes land on the
// re-rendered row, so these return nothing.

export async function nudgePaymentLinkForm(requestKey: string): Promise<void> {
  await nudgePaymentLinkAction(requestKey);
}

export async function cancelPaymentLinkForm(requestKey: string): Promise<void> {
  await cancelPaymentLinkAction(requestKey);
}

export async function checkPaymentLinkForm(requestKey: string): Promise<void> {
  await checkPaymentLinkAction(requestKey);
}
