/**
 * Photo upload endpoint. Accepts multipart/form-data with a single `file`
 * field, validates type + size, uploads to Vercel Blob (public access),
 * and returns the resulting URL so the caller can store it in the
 * relevant table's photo_urls array column.
 *
 * Requires the BLOB_READ_WRITE_TOKEN env var, which Vercel auto-injects
 * once a Blob store is connected to the project. If the token isn't set
 * the route returns 503 so the client can show a clear "photo storage
 * not configured" message.
 */
import { NextRequest, NextResponse } from 'next/server';
import { put } from '@vercel/blob';
import { auth } from '@/auth';

const MAX_BYTES = 12 * 1024 * 1024; // 12 MB; iPhone photos are ~3-5 MB
const ALLOWED_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/heic',
  'image/heif',
  'image/webp',
]);

export async function POST(req: NextRequest) {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json(
      { error: 'Photo storage not configured. Add a Vercel Blob store to enable uploads.' },
      { status: 503 }
    );
  }

  const session = await auth();
  if (!session?.user?.email) {
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
    return NextResponse.json(
      { error: `Unsupported file type: ${file.type}. Use JPEG, PNG, HEIC, or WebP.` },
      { status: 400 }
    );
  }

  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: `File too large (${Math.round(file.size / 1024 / 1024)} MB). Max is ${MAX_BYTES / 1024 / 1024} MB.` },
      { status: 413 }
    );
  }

  // Optional namespace to keep blobs roughly grouped (purely cosmetic in
  // the Blob store browser; Blob URLs are random suffixes regardless).
  const folder = (formData.get('folder') as string | null)?.trim() || 'inspections';
  const safeFolder = folder.replace(/[^a-z0-9_-]/gi, '_').slice(0, 40);

  // Build a deterministic-ish filename. Blob will append a random suffix.
  const ext = guessExt(file.type);
  const ts = Date.now();
  const safeName = `${ts}-${file.name.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 50)}${ext}`;
  const path = `${safeFolder}/${safeName}`;

  try {
    const blob = await put(path, file, {
      access: 'public',
      addRandomSuffix: true,
      contentType: file.type,
    });
    return NextResponse.json({ ok: true, url: blob.url, pathname: blob.pathname });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Upload failed' },
      { status: 500 }
    );
  }
}

function guessExt(mime: string): string {
  switch (mime) {
    case 'image/jpeg':
    case 'image/jpg':
      return '.jpg';
    case 'image/png':
      return '.png';
    case 'image/heic':
      return '.heic';
    case 'image/heif':
      return '.heif';
    case 'image/webp':
      return '.webp';
    default:
      return '';
  }
}
