import { NextResponse } from 'next/server';
import { auth } from '@/auth';
import { recordStaySeen, revealStayCode } from '@/lib/guest-app-stays-db';

/**
 * POST /h/s/<token>/code: the stay's door code, for the guest's tap on
 * "Show my door code". The only door through which a stay link hands out
 * digits (src/lib/guest-app-stays.ts says why it is a POST and not the
 * page). Everything is re-read at the tap: the link, the stay, the window
 * (10:00 AM the day before check-in to checkout) and the live Seam code.
 *
 * The token in the path is the credential, as on the page; /h/ is a public
 * proxy prefix. POST only: a GET (a crawler, a preview fetcher, the service
 * worker) gets a 405 and no code. Never cached, never indexed.
 */
export const dynamic = 'force-dynamic';

const HEADERS = {
  'Cache-Control': 'no-store, max-age=0',
  'X-Robots-Tag': 'noindex, nofollow',
  'Referrer-Policy': 'no-referrer',
};

export async function POST(_req: Request, { params }: { params: Promise<{ stay: string }> }) {
  const { stay: token } = await params;
  const result = await revealStayCode(token);
  if (!result.ok) {
    const status = result.reason === 'not_found' ? 404 : result.reason === 'not_open' ? 403 : 409;
    return NextResponse.json({ ok: false, reason: result.reason }, { status, headers: HEADERS });
  }
  // A teammate checking the page from Helm is not the guest finding their code.
  if (!(await auth())?.user) await recordStaySeen(token, true);
  return NextResponse.json(result, { headers: HEADERS });
}
