import { auth } from '@/auth';
import { calderwoodReadAllowed } from '@/lib/calderwood-readonly/access';
import { ingestCanonicalRevisions } from '@/lib/channex-staging/canonical-revisions';
import { createCanonicalRevisionClient } from '@/lib/channex-staging/canonical-revision-client';
import { createCanonicalRevisionStore } from '@/lib/channex-staging/canonical-revision-store';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;
const headers = { 'Cache-Control': 'private, no-store' };
export async function POST(request: Request) {
  const session = await auth();
  if (!calderwoodReadAllowed(session?.user?.email, { VERCEL_ENV: process.env.VERCEL_ENV,
      VERCEL_GIT_COMMIT_REF: process.env.VERCEL_GIT_COMMIT_REF, CHANNEX_STAGING_ENABLED: process.env.CHANNEX_STAGING_ENABLED }) ||
      process.env.CHANNEX_CANONICAL_REHEARSAL_ENABLED !== 'true') {
    return Response.json({ error: 'Canonical staging rehearsal is not enabled.' }, { status: 403, headers });
  }
  if (!process.env.AUTH_URL || request.headers.get('origin') !== new URL(process.env.AUTH_URL).origin) {
    return Response.json({ error: 'Invalid origin.' }, { status: 403, headers });
  }
  try {
    // No caller-selected database, property, provider, calendar values or send option.
    const raw = await request.text();
    if (raw.length > 200) throw Error('Body');
    const body = JSON.parse(raw);
    if (!body || typeof body !== 'object' || Array.isArray(body) ||
        Object.keys(body).some(k => k !== 'revisionId') ||
        (body.revisionId !== undefined && typeof body.revisionId !== 'string')) throw Error('Body');
    const result = await ingestCanonicalRevisions(
      createCanonicalRevisionClient(process.env.CHANNEX_STAGING_API_KEY ?? ''),
      createCanonicalRevisionStore(process.env.CHANNEX_STAGING_DB_URL ?? '', process.env.CHANNEX_STAGING_DB_SERVICE_KEY ?? ''),
      body.revisionId);
    return Response.json({ ...result, checkedAt: new Date().toISOString() }, { headers });
  } catch {
    return Response.json({ error: 'Import incomplete. Saved revisions are retained; acknowledgements may be partial. Retry uses the same canonical booking. Check staging installation, isolation and mapping. No messages were sent.' },
      { status: 503, headers });
  }
}
