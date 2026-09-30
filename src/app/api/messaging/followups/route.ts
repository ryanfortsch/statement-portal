import { NextResponse, type NextRequest } from 'next/server';
import { listRecentApprovals, listRecentOwnerApprovals, listRecentCleanerApprovals, listRecentContractorApprovals } from '@/lib/stay-concierge';
import { recentFollowups } from '@/lib/recent-followups';
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
// Protected by the same staff session proxy as the messaging queue feed.
export async function GET(req: NextRequest) {
  const audience = req.nextUrl.searchParams.get('audience');
  const loaders = {guests:listRecentApprovals, owners:listRecentOwnerApprovals, cleaners:listRecentCleanerApprovals, contractors:listRecentContractorApprovals};
  const load = audience && Object.hasOwn(loaders,audience) ? loaders[audience as keyof typeof loaders] : null;
  if (!load) return NextResponse.json({error:'Invalid audience'}, {status:400});
  const result = await load(168);
  if (!result.ok) return NextResponse.json({error:'Follow-up status could not be refreshed.'}, {status:502});
  return NextResponse.json({items:recentFollowups(result.data.approvals)}, {headers:{'Cache-Control':'private, no-store'}});
}
