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
 * This replaced the old `x-helm-manual-sync: 1` header escape hatch (which was
 * a static, non-secret string any unauthenticated caller could send to skip
 * the CRON_SECRET check entirely).
 *
 * Fails closed when CRON_SECRET is unset: anonymous callers get 401; the
 * signed-in fallback below still lets a Helm user trigger a manual sync, so a
 * missing env doesn't lock the team out of the dashboard buttons. Earlier the
 * unset branch passed everyone through, which would re-open the surface now
 * that /api/cron routes through this helper.
 */
export async function authorizeCron(request: Request): Promise<NextResponse | null> {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get('authorization');

  // Vercel Cron.
  if (cronSecret && authHeader === `Bearer ${cronSecret}`) return null;

  // Signed-in Helm user running a manual sync from the dashboard. Same check
  // works whether CRON_SECRET is set or not, so a missing env doesn't lock
  // out manual triggers -- only anonymous callers are turned away.
  const session = await auth();
  if (session?.user?.email) return null;

  return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
}
