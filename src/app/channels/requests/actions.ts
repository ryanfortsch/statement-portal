'use server';
import { auth } from '@/auth';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { supabaseAdmin as db } from '@/lib/supabase-admin';
import { validateReview } from '@/lib/airbnb-request-notifications';
import { notifyReviewedRequest } from '@/lib/airbnb-request-alerts.server';
import { findRequest } from '@/lib/airbnb-request-queue.server';

export async function saveRequestReview(form: FormData) {
  const session = await auth();
  const email = session?.user?.email;
  if (!email?.endsWith('@risingtidestr.com')) throw new Error('Unauthorized');
  if (process.env.AIRBNB_REQUEST_QUEUE_ENABLED !== 'true') throw new Error('Request queue is not enabled.');
  const get = (key: string) => String(form.get(key) ?? '').trim();
  let errorMessage = '';
  let alertResult = '';
  try {
    const input = Object.fromEntries(['property', 'start', 'end', 'evidence', 'verified'].map(k => [k, get(k)]));
    const { property, evidence } = validateReview(input);
    const messageId = get('messageId');
    if (!messageId || messageId.length > 200) throw new Error('Invalid source message.');
    const source = await findRequest(messageId);
    // First review wins. Replayed forms cannot overwrite another operator's verification.
    const review = {
      message_id: source.messageId, property_id: property, check_in: input.start,
      check_out: input.end, evidence_url: evidence, reviewed_by: email, reviewed_at: new Date().toISOString(),
    };
    const { error } = await db.from('airbnb_request_reviews').insert(review);
    if (error) errorMessage = error.code === '23505' ? 'This request has already been reviewed. Refresh to see its assignment.' : 'Could not save the review. No booking or calendar was changed.';
    if (!error) {
      try { alertResult = await notifyReviewedRequest(source, review); }
      catch { alertResult = 'unknown'; }
    }
  } catch (error) { errorMessage = error instanceof Error ? error.message : 'Review failed.'; }
  revalidatePath('/channels/requests');
  redirect(`/channels/requests${errorMessage ? `?error=${encodeURIComponent(errorMessage)}` : `?saved=1&alert=${encodeURIComponent(alertResult)}`}`);
}
