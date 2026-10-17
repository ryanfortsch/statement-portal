import { auth } from '@/auth';
import { NextResponse } from 'next/server';
import { isStayConciergeConfigured, listInboxSearchApprovals } from '@/lib/stay-concierge';
import { inboxAudiencesFor, loadInboxSearch } from '@/lib/inbox-search';
import { roleForEmail } from '@/lib/helm-access';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;
const headers = { 'Cache-Control': 'private, no-store' };

export async function GET() {
  const session = await auth();
  if (!session?.user) return NextResponse.json({ error: 'Sign in to search messages.' }, { status: 401, headers });
  if (!isStayConciergeConfigured()) return NextResponse.json({ error: 'Messaging search is unavailable.' }, { status: 503, headers });
  // Owner correspondence is behind the owner page gate; the search panel on
  // every inbox page must not hand it to a staff login through the back.
  const audiences = inboxAudiencesFor(roleForEmail(session.user.email));
  const data = await loadInboxSearch(listInboxSearchApprovals, audiences);
  if (data.unavailable.length === audiences.length * 2) return NextResponse.json({ error: 'Messages could not be loaded. Try again.' }, { status: 502, headers });
  return NextResponse.json(data, { headers });
}
