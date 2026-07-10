'use server';

import crypto from 'node:crypto';
import { redirect } from 'next/navigation';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { archiveToDrive, isDriveArchiveConfigured } from '@/lib/drive-archive';
import {
  fetchAgreementPdf,
  sendAgreementExecutedEmail,
  sendAgreementLinkEmail,
  sendAgreementSignedCopyEmail,
  sendAgreementStaffAlert,
} from '@/lib/agreement-email';
import { agreementPdfFilename } from '@/lib/agreement-pdf';
import type { AgreementCustomClause, GuestAgreementRow } from '@/lib/agreement-types';

/**
 * Server actions for guest rental agreements (Stay Cape Ann).
 *
 * Staff actions authenticate via the Helm session. The one public action
 * — submitAgreementSignature — is gated by knowledge of the 32-hex
 * signing token, mirroring submitContractSignature on the owner side.
 * All DB access goes through the service-role client because
 * guest_agreements is RLS-locked with no anon policies.
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

function numOrNull(formData: FormData, key: string): number | null {
  const raw = str(formData, key);
  if (!raw) return null;
  const n = Number(raw.replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

/**
 * Parse the shared create/edit form into a guest_agreements row payload.
 * Property comes either from the registry picker (property_id set →
 * address/city prefilled server-side unless overridden) or as free-text
 * for one-off units ("3 South Street, Unit B").
 */
async function parseAgreementForm(formData: FormData): Promise<Record<string, unknown>> {
  const propertyId = str(formData, 'property_id') || null;
  let address = str(formData, 'property_address');
  let city = str(formData, 'property_city');

  if (propertyId && (!address || !city)) {
    const { data: prop } = await supabaseAdmin
      .from('properties')
      .select('address, city')
      .eq('id', propertyId)
      .maybeSingle();
    if (prop) {
      address = address || (prop.address as string);
      city = city || (prop.city as string);
    }
  }
  if (!address || !city) throw new Error('Property address and city are required');

  const guestName = str(formData, 'guest_name');
  if (!guestName) throw new Error('Guest name is required');

  const stayStart = str(formData, 'stay_start');
  const stayEnd = str(formData, 'stay_end');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(stayStart) || !/^\d{4}-\d{2}-\d{2}$/.test(stayEnd)) {
    throw new Error('Stay dates are required');
  }
  if (stayEnd <= stayStart) throw new Error('Check-out must be after check-in');

  const rentalFee = numOrNull(formData, 'rental_fee');
  if (rentalFee == null || rentalFee < 0) throw new Error('Rental fee is required');

  const kind = str(formData, 'kind') === 'mid_term' ? 'mid_term' : 'short_term';

  const depositKindRaw = str(formData, 'deposit_kind');
  const depositKind = ['none', 'security', 'damage', 'hold'].includes(depositKindRaw)
    ? depositKindRaw
    : 'none';
  const depositAmount = depositKind === 'none' ? null : numOrNull(formData, 'deposit_amount');
  if (depositKind !== 'none' && (depositAmount == null || depositAmount <= 0)) {
    throw new Error('Deposit amount is required when a deposit is selected');
  }

  // Cancellation: the select carries the standard windows; "strict"
  // renders the no-refund clause (cutoff null).
  const cancelChoice = str(formData, 'cancel_policy'); // '60' | '30' | 'strict' | 'custom'
  let cancelCutoff: number | null = null;
  let cancelPct: number | null = null;
  if (cancelChoice === 'custom') {
    cancelCutoff = numOrNull(formData, 'cancel_cutoff_days');
    cancelPct = numOrNull(formData, 'cancel_refund_pct') ?? 50;
    if (cancelCutoff == null) throw new Error('Custom cancellation needs a cutoff (days before check-in)');
  } else if (cancelChoice !== 'strict') {
    cancelCutoff = Number(cancelChoice) || 60;
    cancelPct = 50;
  }

  // Custom clauses: clause_title_N / clause_body_N pairs.
  const clauses: AgreementCustomClause[] = [];
  for (let i = 0; i < 8; i++) {
    const title = str(formData, `clause_title_${i}`);
    const body = str(formData, `clause_body_${i}`);
    if (body) clauses.push({ title, body });
  }

  return {
    property_id: propertyId,
    property_address: address,
    property_city: city,
    kind,
    guest_name: guestName,
    guest_email: str(formData, 'guest_email') || null,
    guest_phone: str(formData, 'guest_phone') || null,
    additional_occupants: str(formData, 'additional_occupants') || null,
    stay_start: stayStart,
    stay_end: stayEnd,
    rental_fee: rentalFee,
    deposit_kind: depositKind,
    deposit_amount: depositAmount,
    max_occupancy: numOrNull(formData, 'max_occupancy'),
    check_in_time: str(formData, 'check_in_time') || '4:00 PM',
    check_out_time: str(formData, 'check_out_time') || '11:00 AM',
    cancel_cutoff_days: cancelCutoff,
    cancel_refund_pct: cancelPct,
    quiet_hours: str(formData, 'quiet_hours') || '11:00 PM to 7:00 AM',
    utilities_included: formData.getAll('utilities').map((u) => String(u)).filter(Boolean),
    snow_removal_by_guest: formData.get('snow_removal_by_guest') === 'on',
    cleaning_fee_separate: formData.get('cleaning_fee_separate') === 'on',
    midstay_cleaning: formData.get('midstay_cleaning') === 'on',
    no_early_termination: formData.get('no_early_termination') === 'on',
    custom_clauses: clauses.length > 0 ? clauses : null,
    internal_notes: str(formData, 'internal_notes') || null,
  };
}

export async function createGuestAgreement(formData: FormData): Promise<void> {
  await requireStaff();
  const payload = await parseAgreementForm(formData);
  payload.signing_token = crypto.randomBytes(16).toString('hex');

  const { data, error } = await supabaseAdmin
    .from('guest_agreements')
    .insert(payload)
    .select('id')
    .single();
  if (error) throw new Error(error.message);

  revalidatePath('/guests');
  redirect(`/guests/agreements/${data.id}`);
}

export async function updateGuestAgreement(formData: FormData): Promise<void> {
  await requireStaff();
  const id = str(formData, 'id');
  if (!id) throw new Error('Missing agreement id');

  const { data: existing } = await supabaseAdmin
    .from('guest_agreements')
    .select('id, guest_signed_at')
    .eq('id', id)
    .maybeSingle();
  if (!existing) throw new Error('Agreement not found');
  // A signed agreement is a legal record — void it and issue a fresh one
  // instead of editing what the guest already signed.
  if (existing.guest_signed_at) throw new Error('Agreement is already signed; void it and create a new one');

  const payload = await parseAgreementForm(formData);
  const { error } = await supabaseAdmin.from('guest_agreements').update(payload).eq('id', id);
  if (error) throw new Error(error.message);

  revalidatePath('/guests');
  revalidatePath(`/guests/agreements/${id}`);
  redirect(`/guests/agreements/${id}`);
}

/** Email the signing link to the guest and stamp sent_at. */
export async function sendAgreementToGuest(formData: FormData): Promise<void> {
  await requireStaff();
  const id = str(formData, 'id');
  if (!id) throw new Error('Missing agreement id');

  const { data } = await supabaseAdmin.from('guest_agreements').select('*').eq('id', id).maybeSingle();
  if (!data) throw new Error('Agreement not found');
  const agreement = data as GuestAgreementRow;
  if (agreement.voided_at) throw new Error('Agreement is voided');
  if (!agreement.guest_email) throw new Error('Add a guest email first');

  const origin = await getRequestOrigin();
  const result = await sendAgreementLinkEmail({ agreement, origin });
  if (!result.ok) throw new Error(`Email failed: ${result.reason}`);

  await supabaseAdmin
    .from('guest_agreements')
    .update({ sent_at: agreement.sent_at ?? new Date().toISOString() })
    .eq('id', id);

  revalidatePath(`/guests/agreements/${id}`);
  revalidatePath('/guests');
}

/** Stamp sent_at without emailing — for links shared by text/WhatsApp. */
export async function markAgreementSent(formData: FormData): Promise<void> {
  await requireStaff();
  const id = str(formData, 'id');
  if (!id) throw new Error('Missing agreement id');
  await supabaseAdmin
    .from('guest_agreements')
    .update({ sent_at: new Date().toISOString() })
    .eq('id', id)
    .is('sent_at', null);
  revalidatePath(`/guests/agreements/${id}`);
  revalidatePath('/guests');
}

/**
 * Public-facing: the guest signs at /agreement/<token>. No auth — gated
 * by knowledge of the token. Captures typed name + timestamp + IP +
 * user-agent (ESIGN / MA UETA audit trail). Idempotent: an already-signed
 * agreement redirects to the confirmation page without overwriting.
 */
export async function submitAgreementSignature(formData: FormData): Promise<void> {
  const token = str(formData, 'token');
  if (!token || !/^[a-f0-9]{32}$/.test(token)) throw new Error('Invalid agreement link');

  const agreed = formData.get('agree') === 'on';
  const name = str(formData, 'signed_name');
  if (!agreed) throw new Error('You must check "I agree" to sign.');
  if (name.length < 3) throw new Error('Type your full legal name to sign.');

  const db = supabaseAdmin;
  const { data: existing, error: lookupErr } = await db
    .from('guest_agreements')
    .select('id, guest_signed_at, voided_at')
    .eq('signing_token', token)
    .maybeSingle();
  if (lookupErr || !existing) throw new Error(lookupErr?.message || 'Agreement not found');
  if (existing.voided_at) throw new Error('This agreement is no longer active. Contact us for a new link.');
  if (existing.guest_signed_at) redirect(`/agreement/${token}/signed`);

  const h = await headers();
  const xff = h.get('x-forwarded-for') || '';
  const ip = xff.split(',')[0].trim() || h.get('x-real-ip') || '';
  const ua = h.get('user-agent') || '';

  const { error } = await db
    .from('guest_agreements')
    .update({
      guest_signed_at: new Date().toISOString(),
      guest_signed_name: name,
      guest_signed_ip: ip || null,
      guest_signed_user_agent: ua || null,
      // Signing implies delivery even if staff never hit "send".
      sent_at: new Date().toISOString(),
    })
    .eq('signing_token', token)
    .is('guest_signed_at', null);
  if (error) throw new Error(error.message);

  // Best-effort emails: guest gets the signed copy, staff get the
  // countersign nudge. The signature is already persisted — a Resend or
  // Puppeteer hiccup must not lose it or block the confirmation page.
  const { data: full } = await db.from('guest_agreements').select('*').eq('signing_token', token).maybeSingle();
  if (full) {
    const agreement = full as GuestAgreementRow;
    const origin = await getRequestOrigin();
    if (origin) {
      const [guestResult, staffResult] = await Promise.all([
        sendAgreementSignedCopyEmail({ agreement, origin }),
        sendAgreementStaffAlert({ agreement, origin }),
      ]);
      if (guestResult.ok) {
        await db
          .from('guest_agreements')
          .update({ guest_email_sent_at: new Date().toISOString() })
          .eq('signing_token', token);
      } else {
        console.warn('[submitAgreementSignature] guest signed-copy email skipped:', guestResult.reason);
      }
      if (!staffResult.ok) {
        console.warn('[submitAgreementSignature] staff alert skipped:', staffResult.reason);
      }
    }
  }

  revalidatePath(`/agreement/${token}`);
  revalidatePath(`/guests/agreements/${existing.id}`);
  redirect(`/agreement/${token}/signed`);
}

/**
 * Staff countersigns a guest-signed agreement, fully executing it. Sends
 * the executed PDF to the guest and archives it to Helm Records / Guest
 * Agreements / <year>. Idempotent; requires the guest signature first.
 */
export async function countersignAgreement(formData: FormData): Promise<void> {
  await requireStaff();
  const id = str(formData, 'id');
  if (!id) throw new Error('Missing agreement id');

  const db = supabaseAdmin;
  const { data: existing, error: lookupErr } = await db
    .from('guest_agreements')
    .select('id, guest_signed_at, countersigned_at, signing_token')
    .eq('id', id)
    .maybeSingle();
  if (lookupErr || !existing) throw new Error(lookupErr?.message || 'Agreement not found');
  if (!existing.guest_signed_at) throw new Error('Guest has not signed yet');
  if (existing.countersigned_at) {
    revalidatePath(`/guests/agreements/${id}`);
    return;
  }

  const { error: updateErr } = await db
    .from('guest_agreements')
    .update({ countersigned_at: new Date().toISOString() })
    .eq('id', id);
  if (updateErr) throw new Error(updateErr.message);

  // Post-countersign side effects, all best-effort: render the executed
  // PDF once, reuse the buffer for the guest email + the Drive archive.
  const { data: full } = await db.from('guest_agreements').select('*').eq('id', id).maybeSingle();
  if (full) {
    const agreement = full as GuestAgreementRow;
    const origin = await getRequestOrigin();
    if (origin) {
      let pdf: Buffer | null = null;
      try {
        pdf = await fetchAgreementPdf({ agreementId: id, token: agreement.signing_token, origin });
      } catch (err) {
        console.error(
          '[countersignAgreement] executed PDF render failed:',
          err instanceof Error ? err.message : String(err),
        );
      }

      const emailResult = await sendAgreementExecutedEmail({ agreement, origin, pdf: pdf ?? undefined });
      if (emailResult.ok) {
        await db
          .from('guest_agreements')
          .update({ executed_email_sent_at: new Date().toISOString() })
          .eq('id', id);
      } else {
        console.warn('[countersignAgreement] executed email skipped:', emailResult.reason);
      }

      if (pdf && isDriveArchiveConfigured()) {
        const dateStr = new Date().toISOString().slice(0, 10);
        const archive = await archiveToDrive({
          pdf,
          filename: agreementPdfFilename(agreement.property_address, agreement.guest_name).replace(
            /\.pdf$/,
            ` - Executed ${dateStr}.pdf`,
          ),
          folderPath: ['Guest Agreements', dateStr.slice(0, 4)],
        });
        if (archive.ok && archive.url) {
          await db.from('guest_agreements').update({ drive_url: archive.url }).eq('id', id);
        } else {
          console.warn('[countersignAgreement] Drive archive skipped:', archive.reason);
        }
      }
    }
  }

  revalidatePath(`/guests/agreements/${id}`);
  revalidatePath('/guests');
}

/** Void an agreement (superseded / cancelled). The signing link stops working. */
export async function voidAgreement(formData: FormData): Promise<void> {
  await requireStaff();
  const id = str(formData, 'id');
  if (!id) throw new Error('Missing agreement id');
  await supabaseAdmin
    .from('guest_agreements')
    .update({ voided_at: new Date().toISOString() })
    .eq('id', id);
  revalidatePath(`/guests/agreements/${id}`);
  revalidatePath('/guests');
}

export async function unvoidAgreement(formData: FormData): Promise<void> {
  await requireStaff();
  const id = str(formData, 'id');
  if (!id) throw new Error('Missing agreement id');
  await supabaseAdmin.from('guest_agreements').update({ voided_at: null }).eq('id', id);
  revalidatePath(`/guests/agreements/${id}`);
  revalidatePath('/guests');
}
