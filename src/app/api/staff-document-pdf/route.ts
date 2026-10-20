import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { isOwnerSession } from '@/lib/helm-access-server';
import { renderStaffDocumentPdf } from '@/lib/staff-document-pdf';
import { staffDocumentFilename } from '@/lib/staff-documents';

/**
 * GET /api/staff-document-pdf?id=<uuid>&token=<signing token>
 *
 * The staff document as a PDF. An owner session may download any one; a
 * request without one must carry the document's own signing token, which
 * is how the sign and countersign actions fetch the copy they email and
 * archive. Public in the proxy for that reason (PUBLIC_API_PREFIXES).
 */
export const runtime = 'nodejs';
export const maxDuration = 60;

export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get('id');
  const token = request.nextUrl.searchParams.get('token');
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 });

  const { data } = await supabaseAdmin
    .from('staff_documents')
    .select('id, token, title, recipient_name, status, countersigned_at')
    .eq('id', id)
    .maybeSingle();
  const doc = data as { id: string; token: string; title: string; recipient_name: string; status: string; countersigned_at: string | null } | null;
  if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const owner = await isOwnerSession();
  if (!owner && !(token && token === doc.token)) {
    return NextResponse.json(
      { error: 'unauthorized' },
      { status: 401, headers: { 'X-Robots-Tag': 'noindex, nofollow' } },
    );
  }

  try {
    const pdf = await renderStaffDocumentPdf({ token: doc.token, origin: request.nextUrl.origin });
    const executedOn = doc.countersigned_at ? doc.countersigned_at.slice(0, 10) : undefined;
    return new NextResponse(new Uint8Array(pdf), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${staffDocumentFilename(doc, executedOn)}"`,
        'Cache-Control': 'private, no-store',
        'X-Robots-Tag': 'noindex, nofollow',
      },
    });
  } catch (err) {
    console.error('[staff-document-pdf] render failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ error: 'render failed' }, { status: 500 });
  }
}
