'use server';

import { redirect } from 'next/navigation';
import { supabaseAdmin, isServiceConfigured } from '@/lib/supabase-admin';
import { sendTransactionalViaResend } from '@/lib/resend';
import { ALWAYS_CC } from '@/lib/properties';
import { getFleetProperty } from '@/lib/fleet';
import { createBooking, conflictToSearchParams, type BookingConflict } from '@/lib/bookings-write';
import { isYmd, nightsBetween } from '@/lib/bookings-write-core';

/**
 * The public direct-inquiry form. The property comes from the registry
 * (getFleetProperty, active homes only) so a DB-only home has a /book page.
 * The inquiry is created through the locked writer with status 'inquiry':
 * an inquiry never holds dates and never enters the iCal export, so it can
 * no longer block OTA nights. We still refuse to take one over a window a
 * canonical hold already owns, and send the guest back to the form with
 * the booked dates shown (the page reads conflictFromSearchParams).
 */

const HOLD_STATUSES = ['confirmed', 'completed', 'block'] as const;

export async function submitBookingInquiry(formData: FormData) {
  const propertyId = String(formData.get('property_id') || '').trim();
  const checkIn = String(formData.get('check_in') || '').trim();
  const checkOut = String(formData.get('check_out') || '').trim();
  const guestName = String(formData.get('guest_name') || '').trim();
  const guestEmail = String(formData.get('guest_email') || '').trim().toLowerCase();
  const guestPhone = String(formData.get('guest_phone') || '').trim() || null;
  const numGuests = Number(formData.get('num_guests') || 0) || null;
  const message = String(formData.get('message') || '').trim() || null;
  const honeypot = String(formData.get('hp_extra') || '').trim();

  // Basic spam trap: bots fill every field; humans skip the hidden one.
  if (honeypot) {
    redirect(`/book/${propertyId}/thanks`);
  }

  const property = await getFleetProperty(propertyId);
  if (!property || !property.is_active) throw new Error('Property not found.');
  if (!checkIn || !checkOut) throw new Error('Pick both arrival and departure dates.');
  if (!isYmd(checkIn) || !isYmd(checkOut)) throw new Error('Dates must be valid.');
  if (checkOut <= checkIn) throw new Error('Departure must be after arrival.');
  if (!guestName) throw new Error('We need your name.');
  if (!guestEmail || !guestEmail.includes('@')) throw new Error('A valid email please.');

  const conflict = await findHoldOverlap(propertyId, checkIn, checkOut);
  if (conflict) {
    redirect(
      `/book/${propertyId}?${conflictToSearchParams(conflict, {
        check_in: checkIn,
        check_out: checkOut,
        guests: numGuests ? String(numGuests) : null,
      })}`,
    );
  }

  const row = await createBooking({
    propertyId,
    channel: 'direct',
    source: 'direct_booking',
    status: 'inquiry',
    checkIn,
    checkOut,
    guestName,
    guestEmail,
    guestPhone,
    numGuests,
    notes: message,
    actor: 'book-page',
  });
  const nights = nightsBetween(checkIn, checkOut);

  // Notify Allie + Ryan
  const subject = `[Helm Direct] ${property.name}: ${guestName} ${checkIn} to ${checkOut}`;
  const html = `
    <h2 style="font-family: Georgia, serif; color: #1e2e34;">New booking inquiry: ${escapeHtml(property.name)}</h2>
    <table style="font-family: -apple-system, sans-serif; font-size: 14px; border-collapse: collapse;">
      <tr><td style="padding:4px 12px 4px 0; color:#666;">Property</td><td>${escapeHtml(property.name)}, ${escapeHtml(property.address)}</td></tr>
      <tr><td style="padding:4px 12px 4px 0; color:#666;">Dates</td><td>${checkIn} to ${checkOut} (${nights} ${nights === 1 ? 'night' : 'nights'})</td></tr>
      <tr><td style="padding:4px 12px 4px 0; color:#666;">Guests</td><td>${numGuests ?? '-'}</td></tr>
      <tr><td style="padding:4px 12px 4px 0; color:#666;">Name</td><td>${escapeHtml(guestName)}</td></tr>
      <tr><td style="padding:4px 12px 4px 0; color:#666;">Email</td><td><a href="mailto:${escapeHtml(guestEmail)}">${escapeHtml(guestEmail)}</a></td></tr>
      ${guestPhone ? `<tr><td style="padding:4px 12px 4px 0; color:#666;">Phone</td><td>${escapeHtml(guestPhone)}</td></tr>` : ''}
      ${message ? `<tr><td style="padding:4px 12px 4px 0; color:#666; vertical-align:top;">Message</td><td style="white-space:pre-wrap;">${escapeHtml(message)}</td></tr>` : ''}
      ${row.external_confirmation_code ? `<tr><td style="padding:4px 12px 4px 0; color:#666;">Code</td><td style="font-family: ui-monospace, monospace;">${escapeHtml(row.external_confirmation_code)}</td></tr>` : ''}
    </table>
    <p style="font-family: -apple-system, sans-serif; font-size: 13px; margin-top: 18px;">
      Open the inquiry in Helm:
      <a href="https://helm.risingtidestr.com/channels/bookings/${row.id}">/channels/bookings/${row.id}</a>
    </p>
  `;

  // Resend's /emails endpoint accepts an array, but our wrapper takes one
  // recipient at a time. Fan out so Allie + Ryan both get the alert.
  for (const to of ALWAYS_CC) {
    await sendTransactionalViaResend({
      to,
      subject,
      html,
      fromEmail: process.env.RESEND_FROM_EMAIL ?? 'inquiries@risingtidestr.com',
      fromName: 'Rising Tide Helm',
    }).catch((err) => console.warn('[book] resend failed', err));
  }

  redirect(`/book/${propertyId}/thanks?ref=${row.id}`);
}

/**
 * The first canonical hold (confirmed / completed / block, duplicate_of
 * null) sharing a night with the requested window. Inquiries and pending
 * rows never count: nobody holds those dates yet.
 */
async function findHoldOverlap(propertyId: string, checkIn: string, checkOut: string): Promise<BookingConflict | null> {
  if (!isServiceConfigured) return null;
  const { data, error } = await supabaseAdmin
    .from('bookings')
    .select('id, status, check_in, check_out')
    .eq('property_id', propertyId)
    .is('duplicate_of', null)
    .in('status', [...HOLD_STATUSES])
    .lt('check_in', checkOut)
    .gt('check_out', checkIn)
    .order('check_in', { ascending: true })
    .limit(1);
  if (error || !data || data.length === 0) return null;
  const r = data[0] as { id: string; status: string; check_in: string; check_out: string };
  return { booking_id: r.id, status: r.status, check_in: r.check_in.slice(0, 10), check_out: r.check_out.slice(0, 10) };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
