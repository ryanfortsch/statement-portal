import { NextRequest, NextResponse } from 'next/server';
import { listPhoneNumbers, normalizePhone, sendMessage } from '@/lib/quo';
import { briefHeadline, helmBaseUrl, loadDailyBrief } from '@/lib/daily-brief';

export const runtime = 'nodejs';
export const maxDuration = 60;

/**
 * GET /api/cron/daily-brief
 *
 * Builds today's brief, then texts Dotti a one-line headline + a link to
 * /today via Quo. Triggered by Vercel cron daily (vercel.json).
 *
 * Env:
 *   DOTTI_PHONE        — E.164 recipient (e.g. +15555551234). Required.
 *   QUO_FROM_NUMBER    — E.164 of the Quo line to send from. Optional;
 *                        falls back to the first phone returned by Quo.
 *   CRON_SECRET        — Optional; if set, requests must include
 *                        `Authorization: Bearer <secret>`.
 *
 * Same `?dry=1` escape hatch as the other cron handlers: returns the
 * brief without sending an SMS, useful for manual smoke-testing.
 */
export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const dry = url.searchParams.get('dry') === '1';

  try {
    const brief = await loadDailyBrief();
    const headline = briefHeadline(brief);
    const link = `${helmBaseUrl()}/today`;
    const body = `Helm · ${headline}\n${link}`;

    if (dry) {
      return NextResponse.json({ ok: true, dry: true, body, brief });
    }

    const to = process.env.DOTTI_PHONE;
    if (!to) {
      return NextResponse.json(
        { error: 'DOTTI_PHONE not set; add the E.164 recipient to Vercel env' },
        { status: 500 },
      );
    }

    let from = process.env.QUO_FROM_NUMBER;
    if (!from) {
      const phones = await listPhoneNumbers();
      if (!phones.length) {
        return NextResponse.json(
          { error: 'No Quo phone numbers available; set QUO_FROM_NUMBER or check Quo config' },
          { status: 500 },
        );
      }
      from = phones[0].number;
    }

    // Light normalization so a `(617) 555-1212` value in env still works.
    const toNorm = to.startsWith('+') ? to : `+1${normalizePhone(to)}`;
    const fromNorm = from.startsWith('+') ? from : `+1${normalizePhone(from)}`;

    const sent = await sendMessage({ from: fromNorm, to: toNorm, content: body });

    return NextResponse.json({
      ok: true,
      sent_id: sent.id,
      to: toNorm,
      headline,
    });
  } catch (err) {
    console.error('[cron/daily-brief]', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
