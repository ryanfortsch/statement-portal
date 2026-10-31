'use server';
import { auth } from '@/auth';
import { sessionView } from '@/lib/helm-access-server';
import { supabaseAdmin as db } from '@/lib/supabase-admin';
import { revalidatePath } from 'next/cache';
import { sourceKeyFromUrl, validateAppointment } from '@/lib/appointment-agenda';

export async function saveAppointment(args: { id: string; expectedVersion: number; details: unknown }): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const [session, view] = await Promise.all([auth(), sessionView()]);
  const email = session?.user?.email?.trim().toLowerCase();
  if (!email?.endsWith('@risingtidestr.com') || view.viewingAsStaff) return { ok: false, error: 'Open your own signed-in agenda to save an appointment.' };
  if (!/^[a-f0-9-]{36}$/i.test(args.id) || !Number.isSafeInteger(args.expectedVersion) || args.expectedVersion < 0) return { ok: false, error: 'Reload this appointment before saving.' };
  const checked = validateAppointment(args.details);
  if (!checked.ok) return checked;
  const details = checked.value;
  const alias = sourceKeyFromUrl(details.sourceUrl, email);
  if (alias) details.sourceKeys = [...new Set([...details.sourceKeys, alias])].sort();
  if (details.sourceKeys.length > 20) return { ok: false, error: 'Too many linked sources.' };
  for (const [key, revision] of Object.entries(details.sourceRevisions || {})) {
    const { data, error } = await db.from('agenda_capture').select('revision').eq('user_email', email).eq('source_key', key).maybeSingle();
    if (error || !data || data.revision !== revision) return { ok: false, error: 'A source changed during your review. Reload and check its latest update before saving.' };
  }
  // A caller cannot suppress a CRM row that their effective role cannot read.
  for (const key of details.sourceKeys.filter(k => k.startsWith('helm:'))) {
    if (!/^helm:meeting:[a-f0-9-]{36}$/i.test(key)) return { ok: false, error: 'Invalid linked contact meeting.' };
    let query = db.from('contact_meetings').select('id').eq('id', key.slice('helm:meeting:'.length));
    if (view.role !== 'owner') query = query.eq('created_by_email', email);
    const { data, error } = await query.maybeSingle();
    if (error || !data) return { ok: false, error: 'The linked contact meeting is unavailable.' };
  }
  const { data, error } = await db.rpc('save_agenda_appointment', {
    p_user_email: email, p_id: args.id, p_expected_version: args.expectedVersion, p_details: details,
  });
  if (error || !data) {
    const known = ['This source already belongs', 'Appointment changed.', 'Appointment unavailable'];
    return { ok: false, error: known.some(s => error?.message.includes(s)) ? error!.message : 'Could not save this appointment. Your entries are still here; retry or check that appointment storage is available.' };
  }
  revalidatePath('/');
  revalidatePath('/appointments');
  revalidatePath(`/appointments/${args.id}`);
  return { ok: true, id: args.id };
}
