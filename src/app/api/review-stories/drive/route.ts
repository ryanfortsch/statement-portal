import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { getGoogleAccessToken } from '@/lib/marketing/auth';
import { uploadFileToDrive } from '@/lib/drive-archive';

/**
 * Review Stories -> Google Drive.
 *
 * The daily Stay Cape Ann review story renders on Dotti's Mac, which holds
 * no Google credential of its own. This route copies finished stories into
 * a Drive folder with Helm's service account: the Mac puts each file on
 * Vercel Blob (the same leg send_email.py uses for the emailed video,
 * because Vercel's ~4.5MB ingress cap rules out inline bytes) and posts the
 * Blob URLs here; the function fetches each one server-side and uploads it
 * into the folder.
 *
 * POST { secret, folderId, files: [{ url, filename, mime? }] }
 *   -> { ok, uploaded: [{ filename, id, url }], failed: [{ filename, reason }] }
 *
 * Auth is the same fail-closed shared secret as /api/notify-dotti
 * (STORY_FACTORY_SECRET): env unset means every request is rejected. Source
 * URLs are restricted to Vercel Blob hosts so the route cannot be pointed at
 * arbitrary servers, and the destination must be a Drive folder the service
 * account can write to (it is a member of the Rising Tide shared drive).
 */

export const maxDuration = 300;

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';
const MAX_FILES = 8;
const MAX_BYTES = 80 * 1024 * 1024;
const BLOB_HOST = /^https:\/\/[a-z0-9-]+\.public\.blob\.vercel-storage\.com\//;
const FOLDER_ID = /^[A-Za-z0-9_-]{10,}$/;
const MIME = /^[\w.-]+\/[\w.+-]+$/;

function secretMatches(given: string): boolean {
  const expected = process.env.STORY_FACTORY_SECRET;
  if (!expected) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

type IncomingFile = { url?: unknown; filename?: unknown; mime?: unknown };

export async function POST(request: NextRequest) {
  let payload: { secret?: string; folderId?: string; files?: IncomingFile[] };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON' }, { status: 400 });
  }

  if (!secretMatches(payload.secret ?? '')) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const folderId = typeof payload.folderId === 'string' ? payload.folderId.trim() : '';
  const files = (Array.isArray(payload.files) ? payload.files : []).slice(0, MAX_FILES);
  if (!FOLDER_ID.test(folderId) || files.length === 0) {
    // `marker` doubles as a deploy probe: an authorized empty payload never
    // touches Drive but proves this revision is live.
    return NextResponse.json(
      { ok: false, error: 'folderId and files required', marker: 'review-stories-drive' },
      { status: 400 },
    );
  }
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
    return NextResponse.json({ ok: false, error: 'drive not configured' }, { status: 503 });
  }

  const token = await getGoogleAccessToken([DRIVE_SCOPE]);
  const uploaded: Array<{ filename: string; id: string; url: string }> = [];
  const failed: Array<{ filename: string; reason: string }> = [];

  for (const f of files) {
    const url = typeof f?.url === 'string' ? f.url : '';
    const filename = typeof f?.filename === 'string' ? f.filename.trim().slice(0, 150) : '';
    const mime = typeof f?.mime === 'string' && MIME.test(f.mime) ? f.mime : 'application/octet-stream';
    if (!filename || !BLOB_HOST.test(url)) {
      failed.push({ filename: filename || '(unnamed)', reason: 'filename missing or url not a Vercel Blob' });
      continue;
    }
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`source fetch ${res.status}`);
      const declared = Number(res.headers.get('content-length') || 0);
      if (declared > MAX_BYTES) throw new Error('source too large');
      const bytes = Buffer.from(await res.arrayBuffer());
      if (bytes.length === 0 || bytes.length > MAX_BYTES) throw new Error('source empty or too large');
      const out = await uploadFileToDrive(token, { filename, mime, bytes, parentId: folderId });
      uploaded.push({ filename, id: out.id, url: out.url });
    } catch (err) {
      failed.push({ filename, reason: err instanceof Error ? err.message.slice(0, 200) : 'upload failed' });
    }
  }

  return NextResponse.json({ ok: failed.length === 0, uploaded, failed });
}
