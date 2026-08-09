import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { sendTransactionalViaResend } from '@/lib/resend';

/**
 * Story Factory notifier: lets the daily local story-card run (Dotti's Mac)
 * email Ryan through the production Resend account, since local dev only
 * holds a test-mode Resend key that cannot deliver externally.
 *
 * POST { secret, subject, body } -> plain-text email to Ryan, sent as Dotti's
 * own address (Dotti's standing instruction, confirmed directly 2026-08-09;
 * the domain is verified in Resend so her address is a valid sender).
 *
 * Auth is a dedicated shared secret (STORY_FACTORY_SECRET) checked fail-closed
 * like cron-auth: env unset means every request is rejected. Recipient is
 * hard-coded, so a leaked secret can at worst send Ryan a note.
 */

const TO = 'ryan@risingtidestr.com';
const FROM_NAME = 'Dotti';
const FROM_EMAIL = 'dotti@risingtidestr.com';

function secretMatches(given: string): boolean {
  const expected = process.env.STORY_FACTORY_SECRET;
  if (!expected) return false;
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function POST(request: NextRequest) {
  let payload: { secret?: string; subject?: string; body?: string };
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid JSON' }, { status: 400 });
  }

  if (!secretMatches(payload.secret ?? '')) {
    return NextResponse.json({ ok: false, error: 'unauthorized' }, { status: 401 });
  }

  const subject = (payload.subject ?? '').trim();
  const body = (payload.body ?? '').trim();
  if (!subject || !body) {
    return NextResponse.json({ ok: false, error: 'subject and body required' }, { status: 400 });
  }

  const escaped = body
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');

  const sent = await sendTransactionalViaResend({
    to: TO,
    subject,
    fromName: FROM_NAME,
    fromEmail: FROM_EMAIL,
    text: body,
    html: `<pre style="font-family: ui-monospace, Menlo, monospace; font-size: 14px; white-space: pre-wrap;">${escaped}</pre>`,
  });

  if (!sent) {
    return NextResponse.json({ ok: false, error: 'resend send failed' }, { status: 502 });
  }
  return NextResponse.json({ ok: true });
}

export const dynamic = 'force-dynamic';
