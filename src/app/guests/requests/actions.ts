'use server';

import { revalidatePath } from 'next/cache';
import { requireOwnerEmail } from '@/lib/helm-access-server';
import { acceptBookingRequest, declineBookingRequest, markHostTold, withdrawBookingRequest } from '@/lib/booking-requests-db';
import { makeSetupLink, setFeePct } from '@/lib/partner-payments-db';
import { parseFeePct, setupLinkFor, MAX_FEE_PCT } from '@/lib/partner-payments';
import { SCA_SITE_ORIGIN } from '@/lib/booking-request-email';
import { parseNewPartnerHome } from '@/lib/partner-listing';
import { createPartnerHome } from '@/lib/partner-listing-db';

/**
 * The owner verbs on /guests/requests. Each returns a result the buttons
 * read back, never a throw, so "this request is already closed" lands in a
 * notice rather than an error boundary. Owners only: the path is gated, and
 * a server action posts to whatever page rendered it, so each checks too.
 *
 * Accept books the nights; staycapeann.com then charges the card held on
 * the host's own Stripe account and Helm emails the guest once it has. No
 * verb here calls Stripe: Helm holds no Stripe secret (src/lib/partner-payments.ts).
 */
export type RequestActionResult = { ok: true; note?: string } | { ok: false; error: string };

export async function declineRequestAction(id: string, reason: string): Promise<RequestActionResult> {
  const by = await requireOwnerEmail();
  const r = await declineBookingRequest(id, by, reason);
  revalidatePath('/guests/requests');
  if (!r.ok) return { ok: false, error: r.reason };
  return r.emailed ? { ok: true } : { ok: true, note: 'Declined. The email to the guest did not go; it is retried every hour.' };
}

export async function acceptRequestAction(id: string): Promise<RequestActionResult> {
  const by = await requireOwnerEmail();
  const r = await acceptBookingRequest(id, by);
  revalidatePath('/guests/requests');
  return r.ok ? { ok: true } : { ok: false, error: r.reason };
}

export async function withdrawRequestAction(id: string): Promise<RequestActionResult> {
  const by = await requireOwnerEmail();
  const r = await withdrawBookingRequest(id, by);
  revalidatePath('/guests/requests');
  return r.ok ? { ok: true } : { ok: false, error: r.reason };
}

export async function markHostToldAction(id: string): Promise<RequestActionResult> {
  const by = await requireOwnerEmail();
  const r = await markHostTold(id, by);
  revalidatePath('/guests/requests');
  return r.ok ? { ok: true } : { ok: false, error: r.reason ?? 'Could not mark it.' };
}

// ─── Host payments ──────────────────────────────────────────────────────────

export type SetupLinkResult = { ok: true; link: string; expiresAt: string } | { ok: false; error: string };

/** A fresh setup link for a partner home's host. The old link stops working. */
export async function makeSetupLinkAction(propertyId: string): Promise<SetupLinkResult> {
  const by = await requireOwnerEmail();
  const r = await makeSetupLink(propertyId, by);
  revalidatePath('/guests/requests');
  if (!r.ok) return { ok: false, error: r.reason };
  return { ok: true, link: setupLinkFor(SCA_SITE_ORIGIN, r.token), expiresAt: r.expiresAt };
}

export async function setFeeAction(propertyId: string, raw: string): Promise<RequestActionResult> {
  await requireOwnerEmail();
  const pct = parseFeePct(raw);
  if (pct == null) return { ok: false, error: `The fee is a percent from 0 to ${MAX_FEE_PCT}, like 10.` };
  const r = await setFeePct(propertyId, pct);
  revalidatePath('/guests/requests');
  return r.ok ? { ok: true } : { ok: false, error: r.reason };
}

// ─── A new partner home ─────────────────────────────────────────────────────

export type CreatePartnerResult = { ok: true; id: string } | { ok: false; error: string };

/** Add a partner home. The office finishes it on its property page. */
export async function createPartnerHomeAction(input: Record<string, string>): Promise<CreatePartnerResult> {
  const by = await requireOwnerEmail();
  const parsed = parseNewPartnerHome(input);
  if (!parsed.ok) return parsed;
  const r = await createPartnerHome(parsed.home, by);
  revalidatePath('/guests/requests');
  revalidatePath('/properties');
  return r.ok ? { ok: true, id: r.id } : { ok: false, error: r.reason };
}
