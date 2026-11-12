import { guestAppOrigin } from '@/lib/guest-app-db';
import { joinStayList } from '@/lib/guest-app-join';
import { STAY_TOKEN_RE } from '@/lib/guest-app-stays';

/**
 * POST /h/s/<token>/join: the stay link's email line (direct bookings only;
 * src/lib/guest-app-stays.ts says why). A plain HTML form posts here, so it
 * works with JavaScript off; the answer is a 303 back to the stay page with
 * ?join=<result>, which the page reads to say it worked or what to fix.
 *
 * The token in the path is the credential, as on the page and the code
 * reveal. A form from another site is refused (the Origin must be this
 * host, or the guest-facing domain in front of it), and a filled honeypot
 * is told it worked and writes nothing. POST only, never cached.
 */
export const dynamic = 'force-dynamic';

const HEADERS = {
  'Cache-Control': 'no-store, max-age=0',
  'X-Robots-Tag': 'noindex, nofollow',
  'Referrer-Policy': 'no-referrer',
};

function sameOrigin(req: Request): boolean {
  const origin = req.headers.get('origin');
  if (!origin) return true;
  try {
    const host = new URL(origin).host;
    return host === new URL(req.url).host || host === new URL(guestAppOrigin()).host;
  } catch {
    return false;
  }
}

export async function POST(req: Request, { params }: { params: Promise<{ stay: string }> }) {
  const { stay: token } = await params;
  if (!STAY_TOKEN_RE.test(token)) return new Response(null, { status: 404, headers: HEADERS });
  if (!sameOrigin(req)) return new Response(null, { status: 403, headers: HEADERS });

  const back = (result: string | null) =>
    new Response(null, {
      status: 303,
      headers: { ...HEADERS, Location: `/h/s/${token}${result ? `?join=${result}` : ''}#join` },
    });

  const form = await req.formData().catch(() => null);
  if (!form) return back('invalid');
  if (String(form.get('website') ?? '').trim()) return back('joined');
  const result = await joinStayList(token, form.get('email'));
  return back(result === 'closed' ? null : result);
}
