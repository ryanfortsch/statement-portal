'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import { explainError, releaseHeldEmail } from '@/lib/stay-concierge';

/**
 * "Not a pitch": the concierge forgets the hold and drafts the email on its
 * next check (about 90 seconds), as it would any guest email. The screen
 * holds only what it is confident is selling, so this should be rare; it is
 * the one way a misjudged guest gets back into the queue.
 */
export async function releaseHeldPitch(formData: FormData): Promise<void> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return;
  const id = String(formData.get('source_id') || '').trim();
  if (!/^[0-9a-f]{10,24}$/.test(id)) return;
  const res = await releaseHeldEmail(id, email);
  if (!res.ok && !(res.error.kind === 'http' && res.error.status === 404)) {
    console.error('releaseHeldPitch failed', explainError(res.error));
  }
  revalidatePath('/messaging/status');
  revalidatePath('/messaging');
}
