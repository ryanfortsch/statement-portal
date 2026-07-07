import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';
import { auth } from '@/auth';

/**
 * GET /api/receipts/:id/url -- short-lived signed URL for the receipt file.
 *
 * The 'expense-receipts' bucket is PRIVATE (financial documents; the anon
 * key is the perimeter) with no storage.objects policies, so the anon key
 * can never read it. Viewing goes through this auth-gated route: the
 * service role generates a 10-minute createSignedUrl on demand when the
 * operator clicks View. First signed-URL use in the repo -- deliberately
 * NOT the public getPublicUrl pattern used for reservation-note
 * attachments.
 */

function getSupabase() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || '',
    process.env.SUPABASE_SERVICE_ROLE_KEY || '',
  );
}

const BUCKET = 'expense-receipts';
const TTL_SECONDS = 600; // 10 minutes; click-to-view, regenerated on demand

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.email) return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  const { id } = await params;
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 });

  const supabase = getSupabase();
  const { data: receipt, error: loadErr } = await supabase
    .from('property_receipts')
    .select('id, receipt_path')
    .eq('id', id)
    .maybeSingle();
  if (loadErr) return NextResponse.json({ error: loadErr.message }, { status: 500 });
  if (!receipt) return NextResponse.json({ error: 'receipt not found' }, { status: 404 });
  if (!receipt.receipt_path) {
    return NextResponse.json({ error: 'This receipt has no file attached (manual entry).' }, { status: 404 });
  }

  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUrl(receipt.receipt_path, TTL_SECONDS);
  if (error || !data?.signedUrl) {
    return NextResponse.json({ error: error?.message || 'Could not sign the receipt URL' }, { status: 500 });
  }
  return NextResponse.json({ url: data.signedUrl });
}
