/**
 * Google Drive archival for Helm artifacts.
 *
 * Uploads PDFs (executed contracts, and later statements / inspections /
 * onboarding intake) into the "Rising Tide" Google Shared Drive so there's
 * a durable second system-of-record outside the Helm/Supabase/Vercel stack.
 *
 * Auth: reuses the service-account JWT token minted by
 * src/lib/marketing/auth.ts (getGoogleAccessToken). The service account
 * (helm-analytics-sync@…) must be granted Content manager on the target
 * folder, and the Drive API must be enabled in the Cloud project.
 *
 * Shared Drive note: the target lives in a Google SHARED DRIVE, not a
 * personal My Drive folder. That matters for two reasons —
 *   1. Files created in a Shared Drive count against the SHARED DRIVE's
 *      storage, not the service account's (service accounts have ~no
 *      personal Drive quota — uploading into My Drive would fail).
 *   2. Every Drive API call must pass supportsAllDrives=true (and
 *      includeItemsFromAllDrives=true for list queries) or the API
 *      behaves as if Shared Drives don't exist.
 *
 * All functions are best-effort: failures return { ok: false, reason }
 * rather than throwing, so a Drive outage never blocks a countersign.
 */

import { getGoogleAccessToken } from '@/lib/marketing/auth';

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive';
const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3';

/** True when the Drive archive is wired up (folder id + service account). */
export const isDriveArchiveConfigured = () =>
  !!process.env.DRIVE_HELM_RECORDS_FOLDER_ID && !!process.env.GOOGLE_SERVICE_ACCOUNT_KEY;

/**
 * Find a child folder by name under `parentId`, or create it if absent.
 * Idempotent — safe to call on every archive (the year folder gets
 * created once, then found thereafter).
 */
async function findOrCreateFolder(
  token: string,
  name: string,
  parentId: string,
): Promise<string> {
  // Drive query: a non-trashed folder with this exact name under parent.
  // Escape single quotes in the name per Drive query syntax.
  const safeName = name.replace(/'/g, "\\'");
  const q = [
    `name = '${safeName}'`,
    `'${parentId}' in parents`,
    `mimeType = 'application/vnd.google-apps.folder'`,
    'trashed = false',
  ].join(' and ');

  const listUrl =
    `${DRIVE_API}/files?q=${encodeURIComponent(q)}` +
    `&fields=files(id,name)&supportsAllDrives=true&includeItemsFromAllDrives=true`;
  const listRes = await fetch(listUrl, { headers: { Authorization: `Bearer ${token}` } });
  if (!listRes.ok) {
    throw new Error(`Drive folder list failed: ${listRes.status} ${await listRes.text()}`);
  }
  const listData = (await listRes.json()) as { files?: { id: string }[] };
  if (listData.files && listData.files.length > 0) return listData.files[0].id;

  // Not found — create it.
  const createRes = await fetch(
    `${DRIVE_API}/files?supportsAllDrives=true&fields=id`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [parentId],
      }),
    },
  );
  if (!createRes.ok) {
    throw new Error(`Drive folder create failed: ${createRes.status} ${await createRes.text()}`);
  }
  const created = (await createRes.json()) as { id: string };
  return created.id;
}

/**
 * Upload a PDF into a Drive folder via multipart upload. Returns the
 * file's webViewLink (a normal Drive URL anyone with folder access can
 * open).
 */
async function uploadPdf(
  token: string,
  args: { filename: string; pdf: Buffer; parentId: string },
): Promise<string> {
  const boundary = `helm${Date.now().toString(36)}`;
  const metadata = JSON.stringify({ name: args.filename, parents: [args.parentId] });

  // multipart/related body: JSON metadata part, then the PDF bytes part.
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\n` +
        `Content-Type: application/json; charset=UTF-8\r\n\r\n` +
        `${metadata}\r\n` +
        `--${boundary}\r\n` +
        `Content-Type: application/pdf\r\n\r\n`,
    ),
    args.pdf,
    Buffer.from(`\r\n--${boundary}--`),
  ]);

  const res = await fetch(
    `${DRIVE_UPLOAD_API}/files?uploadType=multipart&supportsAllDrives=true&fields=id,webViewLink`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body: new Uint8Array(body),
    },
  );
  if (!res.ok) {
    throw new Error(`Drive upload failed: ${res.status} ${await res.text()}`);
  }
  const data = (await res.json()) as { id: string; webViewLink?: string };
  return data.webViewLink || `https://drive.google.com/file/d/${data.id}/view`;
}

/**
 * Archive a PDF to a nested folder path under the Helm Records root:
 *   Helm Records / <folderPath[0]> / <folderPath[1]> / ... / <filename>
 *
 * Each segment of folderPath is found-or-created in order, so the first
 * artifact of a new year/month creates that folder and the rest land
 * beside it. Examples:
 *   folderPath: ['Contracts', '2026']
 *   folderPath: ['Statements', '2026', '04 April']
 *   folderPath: ['Inspections', '2026', '21 Horton']
 *
 * The Helm Records root folder id comes from DRIVE_HELM_RECORDS_FOLDER_ID.
 *
 * Returns { ok: true, url } on success. Best-effort — any failure
 * returns { ok: false, reason } and is logged, never thrown.
 */
export async function archiveToDrive(args: {
  pdf: Buffer;
  filename: string;
  folderPath: string[];
}): Promise<{ ok: boolean; url?: string; reason?: string }> {
  const rootId = process.env.DRIVE_HELM_RECORDS_FOLDER_ID;
  if (!rootId) return { ok: false, reason: 'DRIVE_HELM_RECORDS_FOLDER_ID not set' };
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
    return { ok: false, reason: 'GOOGLE_SERVICE_ACCOUNT_KEY not set' };
  }
  if (args.folderPath.length === 0) {
    return { ok: false, reason: 'folderPath is empty' };
  }

  try {
    const token = await getGoogleAccessToken([DRIVE_SCOPE]);
    // Walk the folder path, find-or-creating each segment under its parent.
    let parentId = rootId;
    for (const segment of args.folderPath) {
      parentId = await findOrCreateFolder(token, segment, parentId);
    }
    const url = await uploadPdf(token, {
      filename: args.filename,
      pdf: args.pdf,
      parentId,
    });
    return { ok: true, url };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error('[drive-archive] archive failed:', reason);
    return { ok: false, reason };
  }
}

/**
 * Archive a fully-executed contract PDF to Helm Records / Contracts /
 * <year>/. Thin wrapper over archiveToDrive — kept so the call site in
 * countersignContract doesn't need to know the folder convention.
 */
export async function archiveContractToDrive(args: {
  pdf: Buffer;
  filename: string;
  /** Calendar year for the sub-folder, e.g. "2026". */
  year: string;
}): Promise<{ ok: boolean; url?: string; reason?: string }> {
  return archiveToDrive({
    pdf: args.pdf,
    filename: args.filename,
    folderPath: ['Contracts', args.year],
  });
}
