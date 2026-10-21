import { auth } from '@/auth';
import { canonicalRehearsalEnabled } from '@/lib/channex-staging/canonical-revision-webhook';
import { createCanonicalRevisionStore } from '@/lib/channex-staging/canonical-revision-store';
import { createBookingInventoryConsumerStore } from '@/lib/channex-staging/booking-inventory-consumer-store';
import { CANONICAL_PILOT_PROPERTY } from '@/lib/channex-staging/canonical-revisions';
import { pilotDiagnostics } from '@/lib/channex-staging/pilot-diagnostics';
export const dynamic = 'force-dynamic';
const headers = { 'Cache-Control': 'private, no-store' };
export async function GET() {
  const session = await auth();
  if (!session?.user?.email?.endsWith('@risingtidestr.com') || !canonicalRehearsalEnabled({
    VERCEL_ENV: process.env.VERCEL_ENV, VERCEL_GIT_COMMIT_REF: process.env.VERCEL_GIT_COMMIT_REF,
    CHANNEX_STAGING_ENABLED: process.env.CHANNEX_STAGING_ENABLED,
    CHANNEX_CANONICAL_REHEARSAL_ENABLED: process.env.CHANNEX_CANONICAL_REHEARSAL_ENABLED,
  })) {
    return Response.json({ error: 'Unavailable' }, { status: 403, headers });
  }
  try {
    const url = process.env.CHANNEX_STAGING_DB_URL ?? '', key = process.env.CHANNEX_STAGING_DB_SERVICE_KEY ?? '';
    const signal = AbortSignal.timeout(20000);
    const boundedFetch: typeof fetch = (input, init) => fetch(input, { ...init, signal });
    const [state, conflicts] = await Promise.all([
      createBookingInventoryConsumerStore(url, key, CANONICAL_PILOT_PROPERTY, boundedFetch).read(),
      createCanonicalRevisionStore(url, key, boundedFetch).conflicts(),
    ]);
    // Independent diagnostic snapshots. These cannot authorize a write or replace dispatch CAS.
    const conflictSnapshot = { openCount: conflicts.openCount, resolvedCount: conflicts.resolvedCount, open: conflicts.open };
    return Response.json(pilotDiagnostics(state, conflictSnapshot, Date.now()), { headers });
  } catch {
    return Response.json({ error: 'Staging diagnostics unavailable. No readiness claim can be made.' }, { status: 503, headers });
  }
}
