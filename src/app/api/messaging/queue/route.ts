import { NextResponse, type NextRequest } from 'next/server';
import {
  listApprovals,
  listOwnerApprovals,
  listCleanerApprovals,
  listContractorApprovals,
  isStayConciergeConfigured,
  explainError,
  type StayConciergeError,
} from '@/lib/stay-concierge';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import { loadContractorApprovalContext } from '@/lib/contractor-approval-context';
import { loadGuestQuoteContext } from '@/lib/guest-quote-context';

/**
 * A messaging queue's cards as plain JSON, for the card list to poll on its own.
 *
 * Each queue page renders several sections, and the cards used to ride the same
 * router.refresh as the rest of them. That coupled a 15s card refresh to the
 * slowest thing on the page: on /messaging the conversations list rebuilds off
 * a 16-page Guesty burst and takes ~35s cold, well past the poll interval, so
 * each tick superseded the one still in flight and the queue could sit minutes
 * behind while the header chip still read "just now". The tell was a coached
 * card stuck on "Regenerating" long after the rewrite had landed upstream.
 *
 * This endpoint is the queue's own feed: one upstream call, ~60ms, no
 * aggregations. Same proxy session gate as every other /api route, and the
 * dashboard key stays server-side (see /api/messaging/pending-count, which
 * proxies for the nav badge the same way).
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const AUDIENCES = ['guests', 'owners', 'cleaners', 'contractors'] as const;
type Audience = (typeof AUDIENCES)[number];

function isAudience(v: string): v is Audience {
  return (AUDIENCES as readonly string[]).includes(v);
}

function failed(error: StayConciergeError) {
  // The client keeps showing its last good queue on a failure, so the body is
  // for diagnosis only.
  return NextResponse.json({ error: explainError(error) }, { status: 502 });
}

/** Helm's own property list, for naming the homes on a contractor's run. */
async function propertyNames(): Promise<Map<string, string>> {
  try {
    const { data } = await supabase.from('properties').select('id, name').order('name');
    return new Map(((data ?? []) as { id: string; name: string }[]).map((p) => [p.id, p.name]));
  } catch {
    return new Map();
  }
}

export async function GET(req: NextRequest) {
  const param = req.nextUrl.searchParams.get('audience') || 'guests';
  const audience: Audience = isAudience(param) ? param : 'guests';

  if (!isStayConciergeConfigured()) {
    return NextResponse.json({ approvals: [] });
  }

  if (audience === 'owners') {
    const res = await listOwnerApprovals();
    return res.ok ? NextResponse.json({ approvals: res.data.approvals }) : failed(res.error);
  }

  if (audience === 'cleaners') {
    const res = await listCleanerApprovals();
    return res.ok ? NextResponse.json({ approvals: res.data.approvals }) : failed(res.error);
  }

  if (audience === 'contractors') {
    const res = await listContractorApprovals();
    if (!res.ok) return failed(res.error);
    const approvals = res.data.approvals;
    // The Field context is keyed by approval id, and a coached rewrite lands
    // under a NEW id: without it here, the replacement card would come back
    // with a blank property dropdown until the next full page render. Same
    // call the page makes. Only cards proposing a work slip have a dropdown
    // to narrow, and most polls carry none, so check before paying for it.
    const wantsContext = approvals.some((a) => a.proposed_slip && a.contractor_contact);
    if (!wantsContext) return NextResponse.json({ approvals, context: {} });
    const context = await loadContractorApprovalContext(
      approvals,
      await propertyNames(),
    ).catch(() => ({}));
    return NextResponse.json({ approvals, context });
  }

  const res = await listApprovals();
  if (!res.ok) return failed(res.error);
  const approvals = res.data.approvals;
  // A guest's open quotes, keyed by approval id. Same reason the contractor
  // context rides this feed: a coached rewrite lands under a NEW id, so a
  // context left to the next full page render would blank on the replacement
  // card. Only a card carrying an email or a message id can join to anything,
  // and an all-OTA queue carries neither, so check before paying for it.
  const wantsQuotes = approvals.some((a) => (a.guest_email || '').trim() || (a.guesty_message_id || '').trim());
  if (!wantsQuotes) return NextResponse.json({ approvals, context: {} });
  const context = await loadGuestQuoteContext(approvals).catch(() => ({}));
  return NextResponse.json({ approvals, context });
}
