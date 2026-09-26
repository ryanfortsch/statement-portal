import { NextResponse } from 'next/server';
import { authorizeStayConcierge } from '@/lib/stay-concierge-auth';
import { getHelmThread, getHelmThreadRow, recordOutboundSms, recordOutboundEmail } from '@/lib/helm-inbox';
import { channelLabel, helmThreadIdOf, smsRailOf } from '@/lib/helm-inbox-core';
import { normalizeEmail } from '@/lib/guests-identity-core';
import { sendMessage } from '@/lib/quo';
import { quoFromNumber } from '@/lib/quo-lines';
import { sendTransactionalViaResend } from '@/lib/resend';
import { fleetNameMap } from '@/lib/fleet';

/**
 * /api/pms/threads/<id>/messages
 *
 * GET: the thread's timeline, oldest first, in the ThreadMessage shape
 * Thread.tsx renders. The id is a guest_threads.id or a 'helm:<id>'
 * conversation id.
 *
 * POST: a concierge-approved reply. Helm sends on the thread's rail and
 * records it on the thread:
 *   - a thread with a phone goes out by SMS on the GUESTS line
 *     (quoFromNumber('guests')), never any other line;
 *   - an email thread goes out through Resend as Stay Cape Ann;
 *   - an OTA thread has no rail Helm can send on: 409 {error:'no_rail',
 *     external_thread_url} so the caller opens the OTA app instead.
 *
 *   {body, sender:'host_ai'|'host_human', actor, approval_id?, subject?}
 *   -> {ok, message_id, rail:'sms'|'email', to}
 *
 * The recorded sender_kind is what the caller says it is, so an AI send
 * renders as "Helm AI" and a human's as the team member, not as a Helm
 * automation. Auth: x-stay-concierge-key header only.
 */
export const dynamic = 'force-dynamic';
export const revalidate = 0;

type Ctx = { params: Promise<{ id: string }> };

function threadIdFrom(raw: string): string {
  const s = decodeURIComponent(raw ?? '').trim();
  return helmThreadIdOf(s) ?? s;
}

export async function GET(req: Request, ctx: Ctx) {
  const denied = authorizeStayConcierge(req);
  if (denied) return denied;
  const { id } = await ctx.params;
  const threadId = threadIdFrom(id);
  if (!threadId) return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
  try {
    const thread = await getHelmThreadRow(threadId);
    if (!thread) return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });
    const messages = await getHelmThread(thread.id);
    return NextResponse.json({
      ok: true,
      thread_id: thread.id,
      conversation_id: `helm:${thread.id}`,
      channel: channelLabel(thread.channel),
      external_thread_url: thread.external_thread_url,
      messages,
      count: messages.length,
    });
  } catch (err) {
    console.error('[pms/threads/id/messages] GET failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ ok: false, error: 'unavailable_service' }, { status: 503 });
  }
}

const escapeHtml = (s: string): string =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function bodyToHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 1em 0;font-family:Inter,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.55;color:#1e2e34">${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

export async function POST(req: Request, ctx: Ctx) {
  const denied = authorizeStayConcierge(req);
  if (denied) return denied;
  const { id } = await ctx.params;
  const threadId = threadIdFrom(id);
  if (!threadId) return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });

  let body: { body?: unknown; sender?: unknown; actor?: unknown; approval_id?: unknown; subject?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: 'invalid', detail: 'body must be JSON' }, { status: 400 });
  }
  const text = typeof body?.body === 'string' ? body.body.trim() : '';
  if (!text) return NextResponse.json({ ok: false, error: 'invalid', detail: 'body is required' }, { status: 400 });
  const sender = body.sender === 'host_human' ? 'host_human' : body.sender === 'host_ai' ? 'host_ai' : null;
  if (!sender) return NextResponse.json({ ok: false, error: 'invalid', detail: "sender must be 'host_ai' or 'host_human'" }, { status: 400 });
  const actor = typeof body.actor === 'string' && body.actor.trim() ? body.actor.trim() : sender === 'host_ai' ? 'Helm AI' : 'Rising Tide';
  const approvalId = typeof body.approval_id === 'string' ? body.approval_id : null;
  const source = sender === 'host_ai' ? 'concierge' : 'helm';
  const at = new Date().toISOString();

  try {
    const thread = await getHelmThreadRow(threadId);
    if (!thread) return NextResponse.json({ ok: false, error: 'not_found' }, { status: 404 });

    // SMS rail: any thread whose guest has a phone, on the GUESTS line only.
    const phone = smsRailOf(thread);
    if (phone) {
      let quoId: string | null = null;
      try {
        const sent = await sendMessage({ from: quoFromNumber('guests'), to: phone, content: text });
        quoId = sent?.id ?? null;
      } catch (err) {
        return NextResponse.json(
          { ok: false, error: 'send_failed', rail: 'sms', detail: err instanceof Error ? err.message : String(err) },
          { status: 502 },
        );
      }
      const r = await recordOutboundSms({
        phone,
        body: text,
        at,
        quoMessageId: quoId,
        senderKind: sender,
        senderLabel: actor,
        source,
        threadId: thread.id,
        createForStranger: true,
        raw: { approval_id: approvalId, rail: 'sms', from_line: 'guests', bridge: 'pms' },
      });
      return NextResponse.json({ ok: true, rail: 'sms', to: phone, message_id: r.recorded ? r.messageId : null, recorded: r.recorded });
    }

    // Email rail: an email thread with an address.
    const email = normalizeEmail(thread.guest_email) ?? (thread.channel === 'email' ? normalizeEmail(thread.external_thread_key) : null);
    if (thread.channel === 'email' && email) {
      const names = await fleetNameMap({ includeInactive: true }).catch(() => new Map<string, string>());
      const propertyName = thread.property_id ? names.get(thread.property_id) ?? null : null;
      const subject =
        typeof body.subject === 'string' && body.subject.trim()
          ? body.subject.trim()
          : propertyName
            ? `Your stay at ${propertyName}`
            : 'Your stay with Stay Cape Ann';
      const sent = await sendTransactionalViaResend({ to: email, subject, html: bodyToHtml(text), text });
      if (!sent) return NextResponse.json({ ok: false, error: 'send_failed', rail: 'email', detail: 'Resend refused or is not configured' }, { status: 502 });
      const r = await recordOutboundEmail({
        email,
        body: text,
        at,
        subject,
        provider: 'resend',
        senderKind: sender,
        senderLabel: actor,
        source,
        bookingId: thread.booking_id,
        propertyId: thread.property_id,
        guestName: thread.guest_name,
        raw: { approval_id: approvalId, rail: 'email', bridge: 'pms' },
      });
      return NextResponse.json({ ok: true, rail: 'email', to: email, message_id: r.recorded ? r.messageId : null, recorded: r.recorded });
    }

    // OTA thread, or a guest with no contact on file: nothing Helm can send on.
    return NextResponse.json(
      { ok: false, error: 'no_rail', channel: channelLabel(thread.channel), external_thread_url: thread.external_thread_url },
      { status: 409 },
    );
  } catch (err) {
    console.error('[pms/threads/id/messages] POST failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ ok: false, error: 'unavailable_service' }, { status: 503 });
  }
}
