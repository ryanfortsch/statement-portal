/**
 * The guest app's one write a guest can make: an email for the Stay Cape Ann
 * list, from the stay link of a direct booking (/h/s/<token>/join). The rules
 * (who may be asked, the cap, the email check) are pure in guest-app-stays.ts;
 * the write is the shared subscribe writer, so a guest who joins here is on
 * the list exactly as a staycapeann.com signup is: welcome email, Resend,
 * an unsubscribe link on every campaign.
 *
 * Re-read at the POST, like the code reveal: the link, the stay and its
 * channels. A link that is revoked, cancelled or at an OTA booking writes
 * nothing, whatever the form says.
 */
import 'server-only';
import { supabaseAdmin, isServiceConfigured } from '@/lib/supabase-admin';
import { subscribeAudienceContact } from '@/lib/audience-subscribe';
import { resolveStayForJoin } from '@/lib/guest-app-stays-db';
import { parseJoinEmail, STAY_JOIN_MAX, type StayJoinResult } from '@/lib/guest-app-stays';

/** source_detail on the contact; source reads 'Stay Cape Ann signup'. */
export const GUEST_APP_JOIN_SOURCE = 'staycapeann_guest_app';

export async function joinStayList(token: string, rawEmail: unknown): Promise<StayJoinResult> {
  if (!isServiceConfigured) return 'closed';
  const stay = await resolveStayForJoin(token);
  if (!stay || !stay.mayAskEmail) return 'closed';
  const email = parseJoinEmail(rawEmail);
  if (!email) return 'invalid';

  // Signups are counted per stay link from their own events; a read that
  // fails writes nothing rather than lifting the cap.
  const { count, error } = await supabaseAdmin
    .from('audience_events')
    .select('id', { count: 'exact', head: true })
    .eq('metadata->>guest_app_stay', stay.stayId);
  if (error || count === null) return 'failed';
  if (count >= STAY_JOIN_MAX) return 'full';

  const result = await subscribeAudienceContact({
    email,
    sourceLabel: GUEST_APP_JOIN_SOURCE,
    tags: ['insider', 'guest_app', ...(stay.homeName ? [stay.homeName] : [])],
    marketingConsent: true,
    eventMetadata: { guest_app_stay: stay.stayId, property_id: stay.propertyId },
  });
  return result.ok ? 'joined' : 'failed';
}
