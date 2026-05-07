import { NextRequest, NextResponse } from 'next/server';
import { searchEverything } from '@/lib/search';

/**
 * Live cross-module search. Powers the dropdown on the home page.
 *
 * GET /api/search?q=<query>
 *
 * Returns JSON: { pages, properties, contacts, slips, tasks, total }.
 * Empty groups for queries shorter than 2 characters.
 *
 * No auth check — middleware already lets `/api/*` through, and the
 * underlying tables are protected by Helm's Auth.js session at the page
 * level. If we ever surface this externally we'd add a session check
 * here.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const q = url.searchParams.get('q') ?? '';

  const results = await searchEverything(q);
  return NextResponse.json(results, {
    headers: { 'Cache-Control': 'no-store' },
  });
}
