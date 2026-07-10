import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { renderAgreementPdf, agreementPdfFilename } from '@/lib/agreement-pdf';

/**
 * GET /api/agreement-pdf?id=<agreement_uuid>&token=<signing_token>
 *
 * Renders a guest rental agreement to PDF and streams it back. Mirrors
 * /api/projection-pdf's access model:
 *   - Authenticated Helm staff can download any agreement's PDF (the
 *     Download button on /guests/agreements/<id>).
 *   - Unauthenticated requests must present the agreement's signing
 *     token — that's how the guest downloads a copy from the
 *     /agreement/<token>/signed confirmation page, and how server
 *     actions fetch the attachment for the signed/executed emails.
 *
 * Without the token check, anyone holding a bare agreement UUID could
 * pull a document containing the guest's name, contact info, stay
 * dates, and rental fee.
 */
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  try {
    const id = request.nextUrl.searchParams.get('id');
    const token = request.nextUrl.searchParams.get('token');
    if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

    const { data: agreement } = await supabaseAdmin
      .from('guest_agreements')
      .select('id, property_address, guest_name, signing_token')
      .eq('id', id)
      .maybeSingle();
    if (!agreement) return NextResponse.json({ error: 'Agreement not found' }, { status: 404 });

    const session = await auth();
    const hasStaffAuth = !!session?.user?.email;
    const hasValidToken = !!token && token === agreement.signing_token;
    if (!hasStaffAuth && !hasValidToken) {
      return NextResponse.json(
        { error: 'unauthorized — sign in or provide a valid token' },
        { status: 401, headers: { 'X-Robots-Tag': 'noindex, nofollow' } },
      );
    }

    const origin = request.nextUrl.origin;
    const pdf = await renderAgreementPdf({ token: agreement.signing_token, origin });
    const filename = agreementPdfFilename(agreement.property_address, agreement.guest_name);

    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'private, no-store',
        'X-Robots-Tag': 'noindex, nofollow',
      },
    });
  } catch (err) {
    console.error('[agreement-pdf] render failed:', err instanceof Error ? err.message : err);
    return NextResponse.json(
      { error: 'PDF render failed' },
      { status: 500, headers: { 'X-Robots-Tag': 'noindex, nofollow' } },
    );
  }
}
