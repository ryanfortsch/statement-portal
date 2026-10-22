'use server';

import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import { recordCleanerText } from '@/lib/quo-ingest';

type Result = { ok: boolean; message?: string };

/**
 * Place a cleaner's text on a house (the home feed's "Cleanings to check").
 *
 * Writes exactly what the Quo ingest writes for a text that names its house,
 * through the same function (recordCleanerText): the completion on that
 * house's last checkout as of the text, the cleaning_sessions finish, and a
 * work slip when the text reports a problem. The finish time is the text's,
 * not the tap's, and the source stays 'quo', so an operator's own "Mark
 * cleaned" still wins over it.
 *
 * The text is claimed first (open to attached, on the update's where
 * clause), so two people attaching at once cannot log one clean on two
 * houses. A failed write puts it back to open; every write is idempotent on
 * the Quo message id, so trying again is safe.
 */
export async function attachUnplacedCleanerTextAction(id: string, propertyId: string): Promise<Result> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return { ok: false, message: 'Not signed in' };
  if (!id || !propertyId) return { ok: false, message: 'Pick the house first.' };

  const { data: home } = await supabase.from('properties').select('id').eq('id', propertyId).maybeSingle();
  if (!home) return { ok: false, message: 'That house is not in the registry. Refresh and pick again.' };

  const { data: claimed, error } = await supabase
    .from('cleaner_unplaced_texts')
    .update({ status: 'attached', property_id: propertyId, resolved_by: email, resolved_at: new Date().toISOString() })
    .eq('id', id)
    .eq('status', 'open')
    .select('quo_message_id, cleaner_phone, message_body, message_at')
    .maybeSingle();
  if (error) return { ok: false, message: 'Could not save. Try again.' };
  if (!claimed) {
    revalidatePath('/');
    return { ok: false, message: 'Someone already placed or set aside this text.' };
  }

  const text = claimed as { quo_message_id: string; cleaner_phone: string; message_body: string; message_at: string };
  try {
    await recordCleanerText({
      propertyId,
      messageId: text.quo_message_id,
      at: text.message_at,
      phone: text.cleaner_phone,
      body: text.message_body,
    });
  } catch {
    await supabase
      .from('cleaner_unplaced_texts')
      .update({ status: 'open', property_id: null, resolved_by: null, resolved_at: null })
      .eq('id', id)
      .eq('status', 'attached');
    return { ok: false, message: 'Could not log the clean. Try again.' };
  }

  revalidatePath('/');
  revalidatePath('/turnovers');
  return { ok: true };
}

/** Close a text that is not a turnover (a wrong number, a duplicate, a clean
 *  already marked by hand). Nothing else is written. */
export async function setAsideUnplacedCleanerTextAction(id: string): Promise<Result> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return { ok: false, message: 'Not signed in' };
  if (!id) return { ok: false, message: 'Nothing to set aside.' };

  const { error } = await supabase
    .from('cleaner_unplaced_texts')
    .update({ status: 'set_aside', resolved_by: email, resolved_at: new Date().toISOString() })
    .eq('id', id)
    .eq('status', 'open');
  if (error) return { ok: false, message: 'Could not save. Try again.' };

  revalidatePath('/');
  return { ok: true };
}
