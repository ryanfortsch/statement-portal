import { NextRequest, NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { sendTransactionalViaResend } from '@/lib/resend';

/**
 * Story Factory notifier: lets the daily local story-card run (Dotti's Mac)
 * email Ryan through the production Resend account, since local dev only
 * holds a test-mode Resend key that cannot deliver outside the account owner.
 *
 * POST { secret, subject, body } -> plain-text email to Ryan, sent from
 * Dotti's address (her 2026-08-09 directive; replies land in her inbox).
 * Route path keeps its original name so the local send_email.py keeps working.
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

// Resend caps the full message around 40MB; leave headroom for headers/html.
const MAX_ATTACHMENT_B64_TOTAL = 35_000_000;
const MAX_ATTACHMENTS = 6;

type IncomingAttachment = { filename?: unknown; content?: unknown };

export async function POST(request: NextRequest) {
  let payload: {
    secret?: string;
    subject?: string;
    body?: string;
    attachments?: IncomingAttachment[];
  };
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
    // `target`/`attachments` double as deploy markers so callers can probe
    // (with an empty payload, which never sends mail) that this revision is live.
    return NextResponse.json(
      { ok: false, error: 'subject and body required', target: 'ryan', attachments: true },
      { status: 400 }
    );
  }

  const attachments = (Array.isArray(payload.attachments) ? payload.attachments : [])
    .slice(0, MAX_ATTACHMENTS)
    .filter(
      (a): a is { filename: string; content: string } =>
        typeof a?.filename === 'string' &&
        a.filename.trim().length > 0 &&
        a.filename.length <= 120 &&
        typeof a?.content === 'string' &&
        a.content.length > 0
    );
  const totalB64 = attachments.reduce((n, a) => n + a.content.length, 0);
  if (totalB64 > MAX_ATTACHMENT_B64_TOTAL) {
    return NextResponse.json(
      { ok: false, error: `attachments too large (${totalB64} b64 bytes)` },
      { status: 413 }
    );
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
    attachments: attachments.length > 0 ? attachments : undefined,
    // Video attachments need upload time, same as work-order photo emails.
    timeoutMs: attachments.length > 0 ? 60_000 : undefined,
  });

  if (!sent) {
    return NextResponse.json({ ok: false, error: 'resend send failed' }, { status: 502 });
  }
  return NextResponse.json({ ok: true, attached: attachments.length });
}

export const dynamic = 'force-dynamic';
export const maxDuration = 60;
