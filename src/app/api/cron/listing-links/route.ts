import { NextRequest, NextResponse } from 'next/server';
import { authorizeCron } from '@/lib/cron-auth';
import { runListingLinks } from '@/lib/listing-links';

/**
 * /api/cron/listing-links: keep linked listings apart (one house sold whole
 * and as units, 17 Beach Road first). Every 15 minutes: a whole-house
 * booking closes the units, a unit booking closes the whole house, and a
 * block Helm placed is reopened when its booking goes away. ?dry=1 reports
 * what it would do and writes nothing. Rules: src/lib/listing-links-core.ts.
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 120;

async function handle(request: NextRequest) {
  const denied = await authorizeCron(request);
  if (denied) return denied;
  const dry = request.nextUrl.searchParams.get('dry') === '1';
  try {
    const summary = await runListingLinks({ dry });
    return NextResponse.json({ ok: true, ...summary });
  } catch (err) {
    return NextResponse.json({ ok: false, error: err instanceof Error ? err.message : String(err) }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
