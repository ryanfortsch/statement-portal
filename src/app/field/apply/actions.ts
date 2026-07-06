'use server';

import { redirect } from 'next/navigation';
import { fieldDb } from '@/lib/field-db';
import { sendNewApplicantEmail } from '@/lib/field-notify';
import { screenApplication } from '@/lib/ai/screen-applicant';

export type ApplyState = { error: string };

/** Public application submit (no auth — this is the top of the recruiting
 *  funnel). Writes via the service-role client; the table has no anon policy,
 *  so applicants never touch it directly.
 *
 *  useActionState-shaped, same pattern as onboarding's completeOnboarding: a
 *  validation failure RETURNS a specific inline error so the form stays
 *  mounted with everything the applicant typed (and their uploaded intro
 *  video) intact — the old redirect('?error=1') wiped a fully-filled form
 *  over one bad field. Success still redirects to the thanks screen. */
export async function submitApplication(_prev: ApplyState, formData: FormData): Promise<ApplyState> {
  const full_name = String(formData.get('full_name') || '').trim().slice(0, 120);
  const email = String(formData.get('email') || '').trim().toLowerCase().slice(0, 200);
  const phone = String(formData.get('phone') || '').trim().slice(0, 40);
  const area = String(formData.get('area') || '').trim().slice(0, 120);
  if (full_name.length < 2) return { error: 'Please add your full name.' };
  if (!email.includes('@')) return { error: 'That email doesn’t look right. Please double-check it.' };
  if (phone.length < 7) return { error: 'Please add a phone number we can reach you at.' };
  if (area.length < 2) return { error: 'Please tell us where you’re based.' };

  const trd = String(formData.get('trade') || 'inspection');
  const trade = trd === 'maintenance' || trd === 'cleaning' ? trd : 'inspection';

  // Vehicle is now a deliberate Yes/No radio (was a pre-checked box). 'yes' →
  // true, 'no' → false, anything else → null (unanswered).
  const vehicle = String(formData.get('has_transport') || '');
  const has_transport = vehicle === 'yes' ? true : vehicle === 'no' ? false : null;

  // Optional intro video: only keep an http(s) link, so junk/script text never
  // lands in a field the office renders as a clickable link.
  const rawVideo = String(formData.get('video_url') || '').trim().slice(0, 500);
  const video_url = /^https?:\/\//i.test(rawVideo) ? rawVideo : null;

  const source = String(formData.get('source') || '').trim().slice(0, 40) || null;
  const about = String(formData.get('about') || '').trim().slice(0, 2000) || null;
  const availability = String(formData.get('availability') || '').trim().slice(0, 300) || null;
  const heard_about = String(formData.get('heard_about') || '').trim().slice(0, 200) || null;

  // AI first-pass: score this applicant against the role before the office ever
  // looks, so the verdict is on the row from birth. Awaited (one fast Haiku
  // call) but never fatal -- if it throws, the row inserts unscreened and the
  // Applicants "Screen" button can backfill it.
  const verdict = await screenApplication({
    id: 'new', full_name, area, has_transport, availability, about, heard_about, video_url, trade,
  }).catch(() => null);

  await fieldDb().from('contractor_applications').insert({
    full_name,
    email,
    phone: phone || null,
    area,
    about,
    availability,
    heard_about,
    video_url,
    has_transport,
    trade,
    source,
    status: 'new',
    ai_recommendation: verdict?.recommendation ?? null,
    ai_score: verdict?.score ?? null,
    ai_reason: verdict?.reason ?? null,
    ai_assessed_at: verdict ? new Date().toISOString() : null,
  });

  sendNewApplicantEmail({ full_name, email, phone, area, has_transport, source }).catch(() => {});

  redirect('/field/apply?submitted=1');
}
