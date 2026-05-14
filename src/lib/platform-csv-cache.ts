/**
 * Cached Platform CSV storage helpers.
 *
 * The Platform CSV is a Guesty accounting export covering every property
 * in the portfolio for a given month. Until now, /api/ingest required
 * the operator to re-attach the same file on every property's upload
 * (9 properties × the same file = 9 file pickers). This module lets the
 * upload page treat the first upload as a per-month cache: subsequent
 * property ingests for the same month find the file already on file and
 * skip the upload step entirely.
 *
 * Path convention:
 *   platform-csvs/{YYYY-MM}/{epoch_ms}-{sanitized_filename}.csv
 *
 * One file per upload (we keep history); the "active" cached CSV for a
 * month is the most recent one in the folder. /api/ingest writes here
 * whenever a file is uploaded, and reads the most recent here when no
 * file is in the request.
 */

import type { SupabaseClient } from '@supabase/supabase-js';

const BUCKET = 'platform-csvs';

export type CachedPlatformCSV = {
  path: string;
  filename: string;        // sanitized filename used in the path
  original_filename: string; // best-effort recovery of original (sans the epoch prefix)
  uploaded_at: string;     // ISO timestamp parsed from the filename's epoch prefix
  size: number | null;     // bytes; null if Storage didn't return it
};

function sanitizeFilename(name: string): string {
  // Storage paths reject most special chars; keep only alphanumerics, dot, dash, underscore.
  const cleaned = name.replace(/[^a-zA-Z0-9._-]/g, '_');
  return cleaned.length > 80 ? cleaned.slice(0, 80) : cleaned;
}

function parseUploadInfo(filename: string): { uploaded_at: string; original_filename: string } {
  // Filename shape: "{epoch_ms}-{sanitized_orig}.csv"
  const m = filename.match(/^(\d+)-(.+)$/);
  if (!m) return { uploaded_at: '', original_filename: filename };
  const ms = Number.parseInt(m[1], 10);
  return {
    uploaded_at: Number.isFinite(ms) ? new Date(ms).toISOString() : '',
    original_filename: m[2],
  };
}

/**
 * Return metadata for the most recent cached Platform CSV for a month,
 * or null if no upload has happened for that month yet. Doesn't download
 * the bytes -- caller uses `loadCachedPlatformCSVText` for that.
 */
export async function getCachedPlatformCSV(
  supabase: SupabaseClient,
  month: string,
): Promise<CachedPlatformCSV | null> {
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .list(month, { limit: 100, sortBy: { column: 'name', order: 'desc' } });
  if (error || !data || data.length === 0) return null;

  // Files are named with an epoch_ms prefix, so the lexicographically-
  // largest name in the folder is the most recent upload.
  const top = data[0];
  const { uploaded_at, original_filename } = parseUploadInfo(top.name);
  return {
    path: `${month}/${top.name}`,
    filename: top.name,
    original_filename,
    uploaded_at,
    size: top.metadata && typeof top.metadata === 'object' && 'size' in top.metadata
      ? Number((top.metadata as { size: number }).size) : null,
  };
}

/**
 * Download the cached CSV text for a given month. Returns null when no
 * cached file exists (or when downloading it failed).
 */
export async function loadCachedPlatformCSVText(
  supabase: SupabaseClient,
  month: string,
): Promise<{ text: string; cached: CachedPlatformCSV } | null> {
  const cached = await getCachedPlatformCSV(supabase, month);
  if (!cached) return null;
  const { data, error } = await supabase.storage.from(BUCKET).download(cached.path);
  if (error || !data) return null;
  const text = await data.text();
  return { text, cached };
}

/**
 * Upload a Platform CSV to the cache for a month. The original filename
 * is preserved (post-sanitization) so the upload page can show "Using
 * cached: {filename}" rather than an opaque epoch-prefixed key.
 *
 * Idempotent in the sense that subsequent uploads add new files; the
 * folder grows but `getCachedPlatformCSV` always returns the newest.
 * Pruning history is a future concern -- with 12 months per year and
 * 1-2 uploads per month, this folder stays small enough to ignore.
 */
export async function cachePlatformCSV(
  supabase: SupabaseClient,
  month: string,
  file: { name: string; arrayBuffer: () => Promise<ArrayBuffer>; type?: string },
): Promise<CachedPlatformCSV | null> {
  const safeName = sanitizeFilename(file.name || 'platform.csv');
  const filename = `${Date.now()}-${safeName}`;
  const path = `${month}/${filename}`;
  const bytes = new Uint8Array(await file.arrayBuffer());
  const { error } = await supabase.storage.from(BUCKET).upload(path, bytes, {
    contentType: file.type || 'text/csv',
    upsert: false,
  });
  if (error) {
    console.warn('platform CSV cache upload failed:', error.message);
    return null;
  }
  const { uploaded_at, original_filename } = parseUploadInfo(filename);
  return {
    path,
    filename,
    original_filename,
    uploaded_at,
    size: bytes.byteLength,
  };
}
