import { auth } from '@/auth';
import { NextResponse } from 'next/server';
import { isStayConciergeConfigured, listInboxSearchApprovals } from '@/lib/stay-concierge';
import { INBOX_AUDIENCES, loadInboxSearch } from '@/lib/inbox-search';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';
export const maxDuration = 30;
const headers = { 'Cache-Control': 'private, no-store' };

export async function GET() {
  if (!(await auth())?.user) return NextResponse.json({ error: 'Sign in to search messages.' }, { status: 401, headers });
  if (!isStayConciergeConfigured()) return NextResponse.json({ error: 'Messaging search is unavailable.' }, { status: 503, headers });
  const data = await loadInboxSearch(listInboxSearchApprovals);
  if (data.unavailable.length === INBOX_AUDIENCES.length * 2) return NextResponse.json({ error: 'Messages could not be loaded. Try again.' }, { status: 502, headers });
  return NextResponse.json(data, { headers });
}
