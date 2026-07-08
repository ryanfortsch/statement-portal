import { NextResponse } from 'next/server';
import { listApprovals, listOwnerApprovals, listCleanerApprovals, listContractorApprovals, isStayConciergeConfigured } from '@/lib/stay-concierge';

/**
 * Lightweight count endpoint for the Messaging nav badge.
 *
 * The badge polls this every ~30s so Dotti sees from any module when a new
 * draft is waiting. We proxy through Helm rather than letting the client
 * hit stay-concierge directly because the dashboard key is a server-only
 * secret.
 *
 * Returns the COMBINED guest + owner pending count: Messaging is one section
 * with two tabs (see MessagingTabs), so the masthead badge should signal
 * either queue. The individual breakdown is returned alongside for any
 * future caller that wants per-tab counts.
 *
 * Returns 0 when the service is unconfigured. A failure on either sub-call
 * falls back to 0 for that side rather than zeroing out the whole badge.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  if (!isStayConciergeConfigured()) {
    return NextResponse.json({ count: 0, guests: 0, owners: 0, cleaners: 0, contractors: 0 });
  }
  const [guestRes, ownerRes, cleanerRes, contractorRes] = await Promise.all([
    listApprovals(),
    listOwnerApprovals(),
    listCleanerApprovals(),
    listContractorApprovals(),
  ]);
  // Mirror the messaging PAGES' own filters exactly. Each prior tweak
  // (data.count, then approvals.length, then resolved_at filter) failed to
  // match because stay-concierge's array contents drift from what either
  // page considers "pending." The only definition that stays in sync is:
  // what the page itself shows.
  //
  // Guests (MessagingQueue): everything in approvals minus scheduled rows.
  //   pending = approvals.filter(a => a.status !== 'scheduled')
  //
  // Owners (OwnerMessagingQueue): everything in approvals (no filter).
  //   pending = approvals
  //
  // Proactive cleaner/owner messages (ProactiveRemindersPanel) need no
  // handling here: when one fires in approve mode it arrives as a normal
  // pending approval in its queue's list, and neither page filters, so the
  // counts below already include them.
  //
  // If the badge says N, open the corresponding tab and you will see N
  // cards. If those numbers ever diverge again, the fix is to mirror
  // whatever filter the page added -- not to invent a new definition here.
  const guests = guestRes.ok
    ? guestRes.data.approvals.filter((a) => a.status !== 'scheduled').length
    : 0;
  const owners = ownerRes.ok ? ownerRes.data.approvals.length : 0;
  const cleaners = cleanerRes.ok ? cleanerRes.data.approvals.length : 0;
  const contractors = contractorRes.ok ? contractorRes.data.approvals.length : 0;
  return NextResponse.json({
    count: guests + owners + cleaners + contractors,
    guests,
    owners,
    cleaners,
    contractors,
  });
}
