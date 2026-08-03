import { NextResponse } from 'next/server';

/**
 * Deployment identity probe for version-skew detection.
 *
 * Returns the deployment id this server bundle was BUILT with (inlined
 * from next.config.ts `env`, not a runtime lookup), so the comparison in
 * AutoRefresh is exact: an open tab holds the same constant from its own
 * build. After a deploy the two disagree, and the tab hard-reloads once
 * to pick up the new bundle instead of refreshing new-build RSC payloads
 * into an old client. Null outside Vercel (local dev), which tells the
 * client to skip the check.
 *
 * GET /api/version -> { deploymentId: string | null }
 */
export async function GET(): Promise<NextResponse> {
  return NextResponse.json(
    { deploymentId: process.env.NEXT_PUBLIC_DEPLOYMENT_ID || null },
    // Route handlers aren't cached by default, but the browser or a proxy
    // could still hold onto a 200 without this; a stale id here would make
    // every open tab reload against the wrong target.
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
