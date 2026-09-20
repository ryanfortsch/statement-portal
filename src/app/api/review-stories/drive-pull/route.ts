import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { put } from '@vercel/blob';
import { getGoogleAccessToken } from '@/lib/marketing/auth';

/**
 * Drive -> Blob pull for the review-story footage library.
 *
 * Cooper's raw drone masters live in the Rising Tide shared drive
 * (Creative Assets - Cooper > <home> > DRONE) and the Mac that cuts the
 * story plates has no Google credential. This route streams one Drive
 * file into Vercel Blob with the service account and returns the public
 * Blob URL; the Mac downloads it from there and deletes the Blob copy.
 * Nothing is buffered in memory: the Drive response body is handed to the
 * Blob multipart uploader as a stream, so a 1GB master is fine within the
 * 300s window.
 *
 * POST { secret, fileId } -> { ok, name, size, mimeType, url }
 *
 * Auth is the same fail-closed STORY_FACTORY_SECRET as /api/notify-dotti.
 * The service account can only read folders shared with it, so this can
 * never reach a file Helm was not already trusted with.
 */

export const maxDuration = 300;

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const FILE_ID = /^[A-Za-z0-9_-]{10,}$/;
const MAX_BYTES = 2 * 1024 * 1024 * 1024;

function secretMatches(given: string): boolean {
  const expected = process.env.STORY_FACTORY_SECRET;
  if (!expected) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: NextRequest) {
  let payload: { secret?: string; fileId?: string };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON' }, { status: 400 });
  }
  if (!secretMatches(payload.secret ?? '')) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }
  const fileId = typeof payload.fileId === 'string' ? payload.fileId.trim() : '';
  if (!FILE_ID.test(fileId)) {
    return NextResponse.json(
      { ok: false, error: 'fileId required', marker: 'review-stories-drive-pull' },
      { status: 400 },
    );
  }
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_KEY || !process.env.BLOB_READ_WRITE_TOKEN) {
    return NextResponse.json({ ok: false, error: 'drive or blob not configured' }, { status: 503 });
  }

  const token = await getGoogleAccessToken([DRIVE_SCOPE]);
  const headers = { Authorization: `Bearer ${token}` };

  const metaRes = await fetch(
    `${DRIVE_API}/files/${fileId}?fields=name,size,mimeType&supportsAllDrives=true`,
    { headers },
  );
  if (!metaRes.ok) {
    return NextResponse.json(
      { ok: false, error: `drive metadata ${metaRes.status}: ${(await metaRes.text()).slice(0, 200)}` },
      { status: 502 },
    );
  }
  const meta = (await metaRes.json()) as { name?: string; size?: string; mimeType?: string };
  const size = Number(meta.size || 0);
  const name = (meta.name || fileId).replace(/[^\w.\- ]+/g, '_');
  if (size > MAX_BYTES) {
    return NextResponse.json({ ok: false, error: 'file too large' }, { status: 413 });
  }

  const mediaRes = await fetch(
    `${DRIVE_API}/files/${fileId}?alt=media&supportsAllDrives=true`,
    { headers },
  );
  if (!mediaRes.ok || !mediaRes.body) {
    return NextResponse.json(
      { ok: false, error: `drive media ${mediaRes.status}` },
      { status: 502 },
    );
  }

  const blob = await put(`review-stories/pull/${name}`, mediaRes.body, {
    access: 'public',
    addRandomSuffix: true,
    multipart: true,
    contentType: meta.mimeType || 'application/octet-stream',
  });

  return NextResponse.json({ ok: true, name, size, mimeType: meta.mimeType ?? null, url: blob.url });
}
