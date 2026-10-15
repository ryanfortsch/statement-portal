import { NextRequest, NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { sessionRole } from '@/lib/helm-access-server';
import { readSealedCopy, sha256Hex } from '@/lib/contract-seal';
import type { WithdrawnSignature } from '@/lib/projections-types';

/**
 * GET /api/contracts/sealed?id=<projection>&copy=signed|executed
 * GET /api/contracts/sealed?id=<projection>&copy=withdrawn&n=<index>
 *
 * Downloads a sealed management-contract copy: the exact PDF Helm emailed
 * at signing or countersign (src/lib/contract-seal.ts), or the copy of a
 * signature later withdrawn for changes. Before serving, the bytes are
 * hashed again and compared with the fingerprint on the row; a mismatch is
 * refused, not served, because a sealed copy that no longer matches is no
 * longer the record.
 *
 * Owners only. /api/contracts is an owner prefix in the proxy; the role is
 * checked here too so the route never depends on the path list alone.
 */

export const runtime = 'nodejs';

type SealedColumns = {
  property_address: string | null;
  contract_signed_pdf_path: string | null;
  contract_signed_pdf_sha256: string | null;
  contract_executed_pdf_path: string | null;
  contract_executed_pdf_sha256: string | null;
  contract_signature_history: WithdrawnSignature[] | null;
};

export async function GET(request: NextRequest) {
  const role = await sessionRole();
  if (!role) return NextResponse.json({ error: 'Sign in' }, { status: 401 });
  if (role !== 'owner') return NextResponse.json({ error: 'Owners only' }, { status: 403 });

  const id = request.nextUrl.searchParams.get('id');
  const copy = request.nextUrl.searchParams.get('copy');
  if (!id || (copy !== 'signed' && copy !== 'executed' && copy !== 'withdrawn')) {
    return NextResponse.json({ error: 'id and copy=signed|executed|withdrawn are required' }, { status: 400 });
  }

  const { data, error } = await supabaseAdmin
    .from('projections')
    .select(
      'property_address, contract_signed_pdf_path, contract_signed_pdf_sha256, ' +
        'contract_executed_pdf_path, contract_executed_pdf_sha256, contract_signature_history',
    )
    .eq('id', id)
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!data) return NextResponse.json({ error: 'Prospect not found' }, { status: 404 });
  const row = data as unknown as SealedColumns;

  let path: string | null = null;
  let sha: string | null = null;
  let label = '';
  if (copy === 'signed') {
    path = row.contract_signed_pdf_path;
    sha = row.contract_signed_pdf_sha256;
    label = 'Owner signed';
  } else if (copy === 'executed') {
    path = row.contract_executed_pdf_path;
    sha = row.contract_executed_pdf_sha256;
    label = 'Executed';
  } else {
    const n = Number(request.nextUrl.searchParams.get('n'));
    const entry = Number.isInteger(n) ? row.contract_signature_history?.[n] : undefined;
    path = entry?.signed_pdf_path ?? null;
    sha = entry?.signed_pdf_sha256 ?? null;
    label = 'Withdrawn signature';
  }
  if (!path || !sha) return NextResponse.json({ error: 'No sealed copy on file' }, { status: 404 });

  const pdf = await readSealedCopy(path);
  if (!pdf) return NextResponse.json({ error: 'Sealed copy could not be read' }, { status: 502 });
  if (sha256Hex(pdf) !== sha) {
    console.error(`[contracts/sealed] fingerprint mismatch on ${path} for projection ${id}`);
    return NextResponse.json(
      { error: 'The stored copy no longer matches its fingerprint. It was not served.' },
      { status: 409 },
    );
  }

  const filename = `${row.property_address ?? 'Contract'} - Management contract - ${label}.pdf`
    .replace(/[\\/:*?"<>|]/g, '')
    .trim();
  return new NextResponse(new Uint8Array(pdf), {
    status: 200,
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'private, no-store',
      'X-Content-SHA256': sha,
      'X-Robots-Tag': 'noindex, nofollow',
    },
  });
}
