import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';
import { loadHandoffItem, signedHandoffUrl } from '@/lib/close-handoff-db';

/**
 * GET /api/close-handoff/:id/url -- a ten-minute signed URL for the item's
 * photo or PDF. The bucket is private, so viewing goes through this
 * auth-gated route, the same way a receipt's own file is viewed.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  const { id } = await params;
  const item = await loadHandoffItem(id).catch(() => null);
  if (!item) return NextResponse.json({ error: 'not found' }, { status: 404 });
  if (!item.file_path) return NextResponse.json({ error: 'This item has no file attached.' }, { status: 404 });
  const url = await signedHandoffUrl(item.file_path);
  if (!url) return NextResponse.json({ error: 'Could not sign the file URL' }, { status: 500 });
  return NextResponse.json({ url });
}
