'use server';

/**
 * The one action on /turnovers/cleanings: read the vendor's reminder texts
 * out of quo_events right now, through the same parser the webhook and
 * the afternoon sweep use. Lands back on the page with what it read, or
 * with the error in plain words.
 */

import { redirect } from 'next/navigation';
import { auth } from '@/auth';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import { ingestVendorAppointments } from '@/lib/vendor-schedule';

const PAGE = '/turnovers/cleanings';

export async function pullVendorTextsAction(): Promise<void> {
  const session = await auth();
  if (!session?.user?.email) redirect('/auth/signin');

  const result = await ingestVendorAppointments(supabase, { days: 14 });
  if (result.errors.length > 0) {
    redirect(`${PAGE}?err=${encodeURIComponent(result.errors[0].slice(0, 160))}`);
  }
  redirect(`${PAGE}?pulled=${result.parsed}&scanned=${result.scanned}`);
}
