'use server';

import { redirect } from 'next/navigation';
import { createClient } from '@supabase/supabase-js';
import { sendTransactionalViaResend } from '@/lib/resend';
import { ALWAYS_CC, getProperty } from '@/lib/properties';

function getSb() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
  if (!url || !key) throw new Error('Supabase env vars not configured');
  return createClient(url, key, { auth: { persistSession: false } });
}

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

  // Basic spam trap — bots fill every field; humans skip the hidden one.
  if (honeypot) {
    redirect(`/book/${propertyId}/thanks`);
  }

  const property = getProperty(propertyId);
  if (!property) throw new Error('Property not found.');
  if (!checkIn || !checkOut) throw new Error('Pick both arrival and departure dates.');
  if (!isYmd(checkIn) || !isYmd(checkOut)) throw new Error('Dates must be valid.');
  if (checkOut <= checkIn) throw new Error('Departure must be after arrival.');
  if (!guestName) throw new Error('We need your name.');
  if (!guestEmail || !guestEmail.includes('@')) throw new Error('A valid email please.');

  const sb = getSb();

  // Conflict check — refuse if dates overlap an existing non-cancelled booking
  const { data: conflicts } = await sb
    .from('bookings')
    .select('id, check_in, check_out, status')
    .eq('property_id', propertyId)
    .neq('status', 'cancelled')
    .lt('check_in', checkOut)
    .gt('check_out', checkIn);

  const hardConflicts = (conflicts ?? []).filter((c) => c.status !== 'inquiry' && c.status !== 'pending');
  if (hardConflicts.length > 0) {
    throw new Error('Those dates are already booked. Try a different window.');
  }

  const nights = Math.round(
    (Date.parse(`${checkOut}T00:00:00Z`) - Date.parse(`${checkIn}T00:00:00Z`)) / 86400_000,
  );

  const { data: row, error } = await sb
    .from('bookings')
    .insert({
      property_id: propertyId,
      channel: 'direct',
      source: 'direct_booking',
      status: 'inquiry',
      check_in: checkIn,
      check_out: checkOut,
      nights,
      guest_name: guestName,
      guest_email: guestEmail,
      guest_phone: guestPhone,
      num_guests: numGuests,
      notes: message,
    })
    .select('id')
    .maybeSingle();

  if (error) throw new Error(error.message);
  const bookingId = row?.id ?? '';

  // Notify Allie + Ryan
  const subject = `[Helm Direct] ${property.name}: ${guestName} ${checkIn} → ${checkOut}`;
  const html = `
    <h2 style="font-family: Georgia, serif; color: #1e2e34;">New booking inquiry · ${property.name}</h2>
    <table style="font-family: -apple-system, sans-serif; font-size: 14px; border-collapse: collapse;">
      <tr><td style="padding:4px 12px 4px 0; color:#666;">Property</td><td>${property.name} · ${property.address}</td></tr>
      <tr><td style="padding:4px 12px 4px 0; color:#666;">Dates</td><td>${checkIn} → ${checkOut} (${nights} ${nights === 1 ? 'night' : 'nights'})</td></tr>
      <tr><td style="padding:4px 12px 4px 0; color:#666;">Guests</td><td>${numGuests ?? '—'}</td></tr>
      <tr><td style="padding:4px 12px 4px 0; color:#666;">Name</td><td>${escapeHtml(guestName)}</td></tr>
      <tr><td style="padding:4px 12px 4px 0; color:#666;">Email</td><td><a href="mailto:${guestEmail}">${guestEmail}</a></td></tr>
      ${guestPhone ? `<tr><td style="padding:4px 12px 4px 0; color:#666;">Phone</td><td>${escapeHtml(guestPhone)}</td></tr>` : ''}
      ${message ? `<tr><td style="padding:4px 12px 4px 0; color:#666; vertical-align:top;">Message</td><td style="white-space:pre-wrap;">${escapeHtml(message)}</td></tr>` : ''}
    </table>
    <p style="font-family: -apple-system, sans-serif; font-size: 13px; margin-top: 18px;">
      Open the inquiry in Helm:
      <a href="https://helm.risingtidestr.com/channels/${propertyId}">/channels/${propertyId}</a>
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
      fromName: 'Rising Tide · Helm',
    }).catch((err) => console.warn('[book] resend failed', err));
  }

  redirect(`/book/${propertyId}/thanks?ref=${bookingId}`);
}

function isYmd(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
