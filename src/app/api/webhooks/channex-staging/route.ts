import { canonicalRehearsalEnabled, handleCanonicalRevisionWebhook } from '@/lib/channex-staging/canonical-revision-webhook';
import { runMappedCanonicalRevisions } from '@/lib/channex-staging/canonical-revision-mapped';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;
export async function POST(request: Request) {
  return handleCanonicalRevisionWebhook(request, {
    enabled: canonicalRehearsalEnabled({
      VERCEL_ENV: process.env.VERCEL_ENV, VERCEL_GIT_COMMIT_REF: process.env.VERCEL_GIT_COMMIT_REF,
      CHANNEX_STAGING_ENABLED: process.env.CHANNEX_STAGING_ENABLED,
      CHANNEX_CANONICAL_REHEARSAL_ENABLED: process.env.CHANNEX_CANONICAL_REHEARSAL_ENABLED,
    }),
    secret: process.env.CHANNEX_CANONICAL_SIGNING_SECRET ?? '', now: Date.now,
    run: (revisionId, bookingId) => runMappedCanonicalRevisions({
      url: process.env.CHANNEX_STAGING_DB_URL ?? '', storageKey: process.env.CHANNEX_STAGING_DB_SERVICE_KEY ?? '',
      providerKey: process.env.CHANNEX_STAGING_API_KEY ?? '', revisionId, bookingId,
    }),
  });
}
