import { NextRequest, NextResponse } from 'next/server';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { auth } from '@/auth';
import {
  renderProjectionPdf,
  projectionPdfFilename,
  type DeliverableType,
} from '@/lib/projection-pdf';

/**
 * GET /api/projection-pdf?id=<projection_uuid>&type=projection|guide|contract|readiness
 *
 * Renders the requested deliverable to a PDF and streams it back as
 * application/pdf with a friendly filename. Used by the "Download PDF"
 * buttons on /projections/<id>.
 *
 * Access control:
 *   - Authenticated Helm staff (NextAuth session) can download any
 *     deliverable for any projection. This covers the internal
 *     DownloadPdfButton flows.
 *   - Unauthenticated requests must include `&token=<onboarding_token>`
 *     matching the projection's row. Only the contract type allows
 *     this fallback — the public signing flow at /contract/<token>/
 *     signed needs to let the owner download a copy of what they
 *     just signed without prompting them to log in. Projection
 *     deck / guide / readiness PDFs aren't surfaced to owners, so
 *     they stay auth-only.
 *
 * Without the token check, anyone with a projection UUID could
 * silently pull down the signed contract — which would include the
 * full fee structure, custom redlines, and the owner's electronic
 * signature.
 */

export const runtime = 'nodejs';
export const maxDuration = 60;

const VALID_TYPES: DeliverableType[] = ['projection', 'guide', 'contract', 'readiness'];

let _sb: SupabaseClient | null = null;
function getSupabase(): SupabaseClient {
  if (_sb) return _sb;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
  _sb = createClient(url, key);
  return _sb;
}

export async function GET(request: NextRequest) {
  try {
    const id = request.nextUrl.searchParams.get('id');
    const type = (request.nextUrl.searchParams.get('type') || 'projection') as DeliverableType;
    const token = request.nextUrl.searchParams.get('token');
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });
    if (!VALID_TYPES.includes(type)) {
      return NextResponse.json({ error: `type must be one of ${VALID_TYPES.join(', ')}` }, { status: 400 });
    }

    // Access check. Helm staff session always wins; anonymous requests
    // for the contract type must present a valid onboarding_token.
    const session = await auth();
    const hasStaffAuth = !!session?.user?.email;
    let propertyAddress = 'Prospect';
    let projectionToken: string | null = null;
    try {
      const sb = getSupabase();
      const { data } = await sb
        .from('projections')
        .select('property_address, onboarding_token')
        .eq('id', id)
        .maybeSingle();
      if (data?.property_address) propertyAddress = data.property_address as string;
      if (data?.onboarding_token) projectionToken = data.onboarding_token as string;
    } catch {
      // Lookup is best-effort; if it fails we'll fall through to the
      // authorization checks below (which will deny without staff auth).
    }

    const hasValidToken =
      type === 'contract' && !!token && !!projectionToken && token === projectionToken;
    if (!hasStaffAuth && !hasValidToken) {
      return NextResponse.json(
        {
          error:
            type === 'contract'
              ? 'unauthorized — sign in or provide a valid token'
              : 'unauthorized',
        },
        {
          status: 401,
          headers: { 'X-Robots-Tag': 'noindex, nofollow' },
        },
      );
    }

    const origin = request.nextUrl.origin;
    const pdf = await renderProjectionPdf({ projectionId: id, type, origin });
    const filename = projectionPdfFilename(propertyAddress, type);

    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'private, no-store',
        // Belt-and-suspenders: tell crawlers never to index a PDF
        // endpoint, even if a URL ever leaks into a public context.
        'X-Robots-Tag': 'noindex, nofollow',
      },
    });
  } catch (err) {
    console.error('projection-pdf error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500, headers: { 'X-Robots-Tag': 'noindex, nofollow' } },
    );
  }
}
