'use server';

import { redirect } from 'next/navigation';
import { fieldDb } from '@/lib/field-db';

/** Public application submit (no auth — this is the top of the recruiting
 *  funnel). Writes via the service-role client; the table has no anon policy,
 *  so applicants never touch it directly. */
export async function submitApplication(formData: FormData): Promise<void> {
  const full_name = String(formData.get('full_name') || '').trim().slice(0, 120);
  const email = String(formData.get('email') || '').trim().toLowerCase().slice(0, 200);
  const phone = String(formData.get('phone') || '').trim().slice(0, 40);
  // Name, email, and a phone are the floor — we coordinate jobs over SMS.
  if (full_name.length < 2 || !email.includes('@') || phone.length < 7) redirect('/field/apply?error=1');

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

  await fieldDb().from('contractor_applications').insert({
    full_name,
    email,
    phone: phone || null,
    area: String(formData.get('area') || '').trim().slice(0, 120) || null,
    about: String(formData.get('about') || '').trim().slice(0, 2000) || null,
    availability: String(formData.get('availability') || '').trim().slice(0, 300) || null,
    heard_about: String(formData.get('heard_about') || '').trim().slice(0, 200) || null,
    video_url,
    has_transport,
    trade,
    source: String(formData.get('source') || '').trim().slice(0, 40) || null,
    status: 'new',
  });

  redirect('/field/apply?submitted=1');
}
