/**
 * Contractor-side photo upload (profile photo). Mirrors /api/upload but auths
 * via the contractor session cookie instead of Helm SSO, so an inspector on the
 * /field portal can upload. Public Blob URL returned; the caller persists it on
 * contractors.photo_url via the saveProfilePhoto action.
 */
import { NextRequest, NextResponse } from 'next/server';
import { put } from '@vercel/blob';
import { resolveContractorFromCookie } from '@/lib/field-auth';

const MAX_BYTES = 12 * 1024 * 1024;
const ALLOWED_TYPES = new Set(['image/jpeg', 'image/jpg', 'image/png', 'image/heic', 'image/heif', 'image/webp']);

export async function POST(req: NextRequest) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json({ error: 'Photo storage not configured.' }, { status: 503 });
  }
  const contractor = await resolveContractorFromCookie();
  if (!contractor) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: 'Invalid form data' }, { status: 400 });
  }

  const file = formData.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'No file uploaded' }, { status: 400 });
  }
  if (!ALLOWED_TYPES.has(file.type)) {
    return NextResponse.json({ error: `Unsupported file type: ${file.type}.` }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: `File too large. Max is ${MAX_BYTES / 1024 / 1024} MB.` }, { status: 413 });
  }

  try {
    const blob = await put(`field-avatars/${contractor.id}.jpg`, file, {
      access: 'public',
      addRandomSuffix: true,
      contentType: file.type,
    });
    return NextResponse.json({ ok: true, url: blob.url });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Upload failed' }, { status: 500 });
  }
}
