import { CAPE_ANN_REGION } from '@/lib/property-scope';
import { NextResponse } from 'next/server';
import { listApprovals, listOwnerApprovals, listCleanerApprovals, listContractorApprovals, isStayConciergeConfigured } from '@/lib/stay-concierge';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import { todayET } from '@/lib/checkout-schedule';

/**
 * Lightweight count endpoint for the Messaging nav badge.
 *
 * The badge polls this every ~30s so Dotti sees from any module when a new
 * draft is waiting. We proxy through Helm rather than letting the client
 * hit stay-concierge directly because the dashboard key is a server-only
 * secret.
 *
 * The masthead intentionally shows guests only; audience tabs show their own
 * totals. Failed sources return null so a temporary outage cannot clear a badge.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// The cleaner tab also carries the Helm-native schedule-digest card:
// one pending digest for today-or-later counts as one pending card,
// exactly matching what /cleaner-messaging renders (a sent/skipped
// digest renders as history, not an ask). Independent of the concierge.
async function pendingDigestCount(): Promise<number | null> {
  try {
    const { data, error } = await supabase
      .from('cleaner_schedule_digests')
      .select('id')
      .eq('region', CAPE_ANN_REGION)
      .eq('status', 'pending')
      .gte('service_date', todayET())
      .order('service_date', { ascending: true }).limit(1);
    return error ? null : (data ?? []).length;
  } catch {
    return null;
  }
}

export async function GET() {
  if (!isStayConciergeConfigured()) {
    const digests = await pendingDigestCount();
    return NextResponse.json({ count: digests, guests: 0, owners: 0, cleaners: digests, contractors: 0 });
  }
  const [guestRes, ownerRes, cleanerRes, contractorRes, digests] = await Promise.all([
    listApprovals(),
    listOwnerApprovals(),
    listCleanerApprovals(),
    listContractorApprovals(),
    pendingDigestCount(),
  ]);
  // Mirror the messaging PAGES' own filters exactly. Each prior tweak
  // (data.count, then approvals.length, then resolved_at filter) failed to
  // match because stay-concierge's array contents drift from what either
  // page considers "pending." The only definition that stays in sync is:
  // what the page itself shows.
  //
  // Every queue now shows pending + scheduled (queued) cards, and every
  // page's badge-worthy count is the PENDING slice only — a queued card is
  // handled work waiting on a timer, not an ask on the operator.
  //   pending = approvals.filter(a => a.status !== 'scheduled')
  //
  // Proactive cleaner/owner messages (ProactiveRemindersPanel) need no
  // handling here: when one fires in approve mode it arrives as a normal
  // pending approval in its queue's list, so the counts below already
  // include them.
  //
  // If the badge says N, open the corresponding tab and you will see N
  // pending cards. If those numbers ever diverge again, the fix is to mirror
  // whatever filter the page added -- not to invent a new definition here.
  const notScheduled = (a: { status: string }) => a.status !== 'scheduled';
  const guests = guestRes.ok ? guestRes.data.approvals.filter(notScheduled).length : null;
  const owners = ownerRes.ok ? ownerRes.data.approvals.filter(notScheduled).length : null;
  const cleaners = cleanerRes.ok && digests !== null ? cleanerRes.data.approvals.filter(notScheduled).length + digests : null;
  const contractors = contractorRes.ok ? contractorRes.data.approvals.filter(notScheduled).length : null;
  return NextResponse.json({
    count: guests !== null && owners !== null && cleaners !== null && contractors !== null ? guests + owners + cleaners + contractors : null,
    guests,
    owners,
    cleaners,
    contractors,
  });
}
