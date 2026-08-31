import { NextRequest, NextResponse } from 'next/server';
import { authorizeCron } from '@/lib/cron-auth';
import { archiveToDrive, isDriveArchiveConfigured } from '@/lib/drive-archive';

/**
 * POST /api/contracts/upload-pdf — multipart form: `file` (the PDF),
 * `year` (Drive sub-folder, e.g. "2025"), optional `filename` override.
 *
 * Files a signed management-contract PDF into the canonical Drive archive
 * (Helm Records / Contracts / <year>/) through the service account — the
 * front door for contracts that surface OUTSIDE the Helm signing flow
 * (Docusign-era paper someone digs out of an inbox). The weekly
 * contracts-sweep then flags the new file as unregistered until a
 * property_contracts row carries its id.
 *
 * Auth: same plane as the sweep — Vercel cron secret or a signed-in Helm
 * session (authorizeCron). Middleware note: /api/contracts/ is NOT in the
 * public prefixes, so anonymous callers are already 401'd before this
 * handler runs; authorizeCron here keeps the contract explicit.
 */

export const runtime = 'nodejs';
export const maxDuration = 60;

const MAX_BYTES = 15 * 1024 * 1024;

export async function POST(request: NextRequest) {
  const denied = await authorizeCron(request);
  if (denied) return denied;

  if (!isDriveArchiveConfigured()) {
    return NextResponse.json({ ok: false, error: 'Drive archive not configured' }, { status: 503 });
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ ok: false, error: 'expected multipart/form-data' }, { status: 400 });
  }

  const file = form.get('file');
  const year = String(form.get('year') || '').trim();
  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, error: 'file is required' }, { status: 400 });
  }
  if (!/^20\d{2}$/.test(year)) {
    return NextResponse.json({ ok: false, error: 'year must look like 2025' }, { status: 400 });
  }
  if (file.size === 0 || file.size > MAX_BYTES) {
    return NextResponse.json({ ok: false, error: 'file is empty or over 15MB' }, { status: 400 });
  }
  const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
  if (!isPdf) {
    return NextResponse.json({ ok: false, error: 'only PDFs are archived here' }, { status: 400 });
  }

  const filename = (String(form.get('filename') || '').trim() || file.name)
    .replace(/[\\/:*?"<>|]/g, '')
    .trim();

  const pdf = Buffer.from(await file.arrayBuffer());
  const archive = await archiveToDrive({ pdf, filename, folderPath: ['Contracts', year] });
  if (!archive.ok || !archive.url) {
    return NextResponse.json({ ok: false, error: archive.reason || 'Drive archive failed' }, { status: 502 });
  }
  return NextResponse.json({ ok: true, url: archive.url, filename, year });
}
