import { NextRequest, NextResponse } from 'next/server';
import { authorizeCron } from '@/lib/cron-auth';
import { runLeaseLeads } from '@/lib/lease-leads';

/**
 * /api/cron/lease-leads: winter lease leads from Zillow. Every 30 minutes:
 * read Zillow's renter mail, file it by renter and listing, and vet each lead
 * with new mail. Only a serious lead reaches the owners' home feed. Reads
 * Gmail and never sends. Rules: src/lib/lease-leads-core.ts.
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 300;

async function handle(request: NextRequest) {
  const denied = await authorizeCron(request);
  if (denied) return denied;
  try {
    const summary = await runLeaseLeads();
    return NextResponse.json({ ok: true, ...summary });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
