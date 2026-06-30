/**
 * Canonical writers for public.sync_status.
 *
 * Today every Helm sync (Guesty, Stripe, Quo, Seam, iCal, Gmail, the CSV
 * fallback) only stamps sync_status.last_synced_at on SUCCESS. When a sync
 * fails the row simply doesn't update and nobody finds out -- a bad Guesty
 * pull can drift owner statement inputs for days. This helper writes both
 * success AND failure so the daily brief can call out a stuck feed instead.
 *
 * One call site per source: routes import recordSyncSuccess / recordSyncFailure
 * (or recordSyncResult for routes whose work already accumulates per-entity
 * errors) and wrap their work in try / catch / finally. Helper itself never
 * throws -- a broken sync_status write must never take down a sync.
 *
 * Schema requirements live in
 * supabase/migrations/20260621d_sync_status_failure_tracking.sql.
 */

import { supabaseAdmin } from '@/lib/supabase-admin';

/**
 * The set of source keys daily-brief.ts knows about. Keep in sync with
 * EXPECTED_FEEDS there: adding a key here without adding a cadence entry there
 * means the source is recorded but never watched.
 */
export const SYNC_SOURCES = [
  'guesty-listings',
  'guesty-reviews',
  'guesty-reservations',
  'guesty-calendar',
  'guesty-guests',
  'gmail-replies',
  'gmail-invoices',
  'csv-fallback',
  'stripe',
  'quo',
  'seam',
  'ical',
] as const;
export type SyncSource = (typeof SYNC_SOURCES)[number];

/**
 * Strip well-known secret shapes before persisting. sync_status is anon-
 * readable today (the row count is small and the audit only flagged it for
 * scrubbing of error messages), so any stray Stripe/Resend/Bearer token in a
 * library's thrown error must not land in last_error.
 */
function scrubError(input: unknown): string {
  const raw = input instanceof Error ? input.message : String(input ?? 'unknown error');
  return raw
    .replace(/sk_[a-z]+_[A-Za-z0-9]+/g, 'sk_***')
    .replace(/rk_[a-z]+_[A-Za-z0-9]+/g, 'rk_***')
    .replace(/whsec_[A-Za-z0-9]+/g, 'whsec_***')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/g, 'Bearer ***')
    .slice(0, 500);
}

/**
 * Record a clean success. Resets error_count and clears the error fields so
 * the daily brief stops flagging a previously-stuck feed once it recovers.
 * lastResult is an optional JSON blob the route can stash for debugging.
 */
export async function recordSyncSuccess(
  source: SyncSource,
  lastResult?: Record<string, unknown>,
): Promise<void> {
  try {
    const now = new Date().toISOString();
    const payload: Record<string, unknown> = {
      source,
      last_synced_at: now,
      last_attempted_at: now,
      last_status: 'ok',
      last_error: null,
      last_error_at: null,
      error_count: 0,
      updated_at: now,
    };
    if (lastResult !== undefined) payload.last_result = lastResult;
    const { error } = await supabaseAdmin
      .from('sync_status')
      .upsert(payload, { onConflict: 'source' });
    if (error) console.error('[sync-status] recordSyncSuccess failed', source, error.message);
  } catch (e) {
    console.error('[sync-status] recordSyncSuccess threw', source, e);
  }
}

/**
 * Record a failure. Bumps error_count atomically via the SQL RPC so an
 * overlapping cron + manual sync don't lose increments to a JS-side
 * read-modify-write. Never throws; logs and moves on.
 */
export async function recordSyncFailure(
  source: SyncSource,
  err: unknown,
): Promise<void> {
  try {
    const { error } = await supabaseAdmin.rpc('record_sync_failure', {
      p_source: source,
      p_error: scrubError(err),
    });
    if (error) console.error('[sync-status] recordSyncFailure failed', source, error.message);
  } catch (e) {
    console.error('[sync-status] recordSyncFailure threw', source, e);
  }
}

/**
 * Convenience for routes whose work already aggregates per-entity errors
 * (sync-quo, sync-seam, sync-stripe). Records success if every entity
 * succeeded, failure with the first error otherwise. Caller decides what
 * counts as a "failed" entity vs an expected no-op (e.g. SEAM_API_KEY missing
 * is configuration, not failure).
 */
export async function recordSyncResult(
  source: SyncSource,
  opts: {
    processed: number;
    failed: number;
    firstError?: string;
    result?: Record<string, unknown>;
  },
): Promise<void> {
  if (opts.failed > 0) {
    const msg =
      opts.firstError ?? `${opts.failed}/${opts.processed + opts.failed} entities failed`;
    await recordSyncFailure(source, msg);
  } else {
    await recordSyncSuccess(source, opts.result);
  }
}
