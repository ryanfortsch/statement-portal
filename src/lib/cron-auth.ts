import { auth } from '@/auth';
import { NextResponse } from 'next/server';

/**
 * Authorize a cron route. Returns `null` when the caller is allowed, or a 401
 * Response when it is not.
 *
 * Allowed callers:
 *   - Vercel Cron, which sends `Authorization: Bearer <CRON_SECRET>`.
 *   - A signed-in Helm user triggering a manual sync from the dashboard
 *     (the same-origin fetch carries the session cookie).
 *
 * This replaces the old `x-helm-manual-sync: 1` header escape hatch, which was
 * a static, non-secret string any unauthenticated caller could send to skip
 * the CRON_SECRET check entirely.
 *
 * When CRON_SECRET is unset we deliberately preserve the prior fail-open
 * behavior so a missing env var can't silently disable every sync. Production
 * should always have CRON_SECRET set; once confirmed, this branch can be made
 * fail-closed.
 */
export async function authorizeCron(request: Request): Promise<NextResponse | null> {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get('authorization');

  // Unconfigured: keep working rather than break every cron (see note above).
  if (!cronSecret) return null;

  // Vercel Cron.
  if (authHeader === `Bearer ${cronSecret}`) return null;

  // Signed-in Helm user running a manual sync from the dashboard.
  const session = await auth();
  if (session?.user?.email) return null;

  return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
}
