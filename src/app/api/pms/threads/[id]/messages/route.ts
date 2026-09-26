import { NextResponse } from 'next/server';
import { authorizeStayConcierge } from '@/lib/stay-concierge-auth';
import { getHelmThread, getHelmThreadRow, recordOutboundSms, recordOutboundEmail } from '@/lib/helm-inbox';
import { channelLabel, helmThreadIdOf, replyClaimVerdict, smsRailOf } from '@/lib/helm-inbox-core';
import { normalizeEmail } from '@/lib/guests-identity-core';
import { sendMessage } from '@/lib/quo';
import { quoFromNumber } from '@/lib/quo-lines';
import { sendTransactionalViaResend } from '@/lib/resend';
import { fleetNameMap } from '@/lib/fleet';
import { supabaseAdmin } from '@/lib/supabase-admin';

/**
 * Claim an approval before sending on it (pms_reply_claims): the first call
 * gets 'claimed'; a repeat learns whether the first was sent ('duplicate')
 * or is still sending ('in_flight'). A claim left 'sending' by a call that
 * died is taken over, compare-and-set on its created_at so two retries
 * cannot both take it. A failed send releases its claim.
 */
type ClaimResult = { claimed: true } | { claimed: false; verdict: 'duplicate' | 'in_flight'; messageId: string | null };

async function claimApproval(approvalId: string, threadId: string): Promise<ClaimResult> {
  const { error } = await supabaseAdmin.from('pms_reply_claims').insert({ approval_id: approvalId, thread_id: threadId, status: 'sending' });
  if (!error) return { claimed: true };
  if (error.code !== '23505') throw new Error(`claim approval: ${error.message}`);
  const { data } = await supabaseAdmin
    .from('pms_reply_claims')
    .select('status, message_id, created_at')
    .eq('approval_id', approvalId)
    .maybeSingle();
  const row = (data ?? null) as { status: string | null; message_id: string | null; created_at: string | null } | null;
  // Released between our insert and this read: the caller may try again.
  if (!row) return { claimed: false, verdict: 'in_flight', messageId: null };
  const verdict = replyClaimVerdict(row, Date.now());
  if (verdict !== 'expired') return { claimed: false, verdict, messageId: row.message_id };
  const { data: taken } = await supabaseAdmin
    .from('pms_reply_claims')
    .update({ created_at: new Date().toISOString(), thread_id: threadId })
    .eq('approval_id', approvalId)
    .eq('status', 'sending')
    .eq('created_at', row.created_at as string)
    .select('approval_id');
  return (taken ?? []).length > 0 ? { claimed: true } : { claimed: false, verdict: 'in_flight', messageId: null };
}

/** The provider accepted the reply: a retry from here on is a duplicate,
 *  even if recording it below throws. */
async function markClaimSent(approvalId: string | null): Promise<void> {
  if (!approvalId) return;
  await supabaseAdmin.from('pms_reply_claims').update({ status: 'sent' }).eq('approval_id', approvalId);
}

async function settleClaim(approvalId: string | null, messageId: string | null, ok: boolean): Promise<void> {
  if (!approvalId) return;
  if (ok) await supabaseAdmin.from('pms_reply_claims').update({ message_id: messageId, status: 'sent' }).eq('approval_id', approvalId);
  else await supabaseAdmin.from('pms_reply_claims').delete().eq('approval_id', approvalId);
}

/** An aborted fetch may still have reached the provider: the outcome is unknown. */
function isTimeout(err: unknown): boolean {
  const name = err instanceof Error ? err.name : '';
  return name === 'TimeoutError' || name === 'AbortError';
}

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
 * With an approval_id the call is idempotent: the first claims it
 * (pms_reply_claims) before sending. A retry of the same approval after the
 * provider accepted gets {ok, duplicate: true, message_id} and texts nobody;
 * one that arrives while the first is still sending gets 409 in_flight, so
 * the caller asks again rather than marking a reply sent that may yet fail.
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

    // One send per approval: a retry gets the first send back.
    if (approvalId) {
      const claim = await claimApproval(approvalId, thread.id);
      if (!claim.claimed) {
        return claim.verdict === 'duplicate'
          ? NextResponse.json({ ok: true, duplicate: true, message_id: claim.messageId })
          : NextResponse.json({ ok: false, error: 'in_flight', detail: 'This approval is still sending; ask again shortly.' }, { status: 409 });
      }
    }

    // SMS rail: any thread whose guest has a phone, on the GUESTS line only.
    const phone = smsRailOf(thread);
    if (phone) {
      let quoId: string | null = null;
      try {
        const sent = await sendMessage({ from: quoFromNumber('guests'), to: phone, content: text });
        quoId = sent?.id ?? null;
      } catch (err) {
        await settleClaim(approvalId, null, false);
        return NextResponse.json(
          { ok: false, error: 'send_failed', rail: 'sms', detail: err instanceof Error ? err.message : String(err) },
          { status: 502 },
        );
      }
      await markClaimSent(approvalId);
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
      await settleClaim(approvalId, r.recorded ? r.messageId : null, true);
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
      let sent: boolean;
      try {
        sent = await sendTransactionalViaResend({ to: email, subject, html: bodyToHtml(text), text });
      } catch (err) {
        // A timeout may have reached Resend: keep the claim 'sending' so a
        // retry is told in_flight until it expires, rather than emailing
        // twice. Any other throw never left: release it.
        if (!isTimeout(err)) await settleClaim(approvalId, null, false);
        return NextResponse.json(
          { ok: false, error: isTimeout(err) ? 'send_timeout' : 'send_failed', rail: 'email', detail: err instanceof Error ? err.message : String(err) },
          { status: isTimeout(err) ? 504 : 502 },
        );
      }
      if (sent) await markClaimSent(approvalId);
      if (!sent) {
        await settleClaim(approvalId, null, false);
        return NextResponse.json({ ok: false, error: 'send_failed', rail: 'email', detail: 'Resend refused or is not configured' }, { status: 502 });
      }
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
      await settleClaim(approvalId, r.recorded ? r.messageId : null, true);
      return NextResponse.json({ ok: true, rail: 'email', to: email, message_id: r.recorded ? r.messageId : null, recorded: r.recorded });
    }

    // OTA thread, or a guest with no contact on file: nothing Helm can send on.
    await settleClaim(approvalId, null, false);
    return NextResponse.json(
      { ok: false, error: 'no_rail', channel: channelLabel(thread.channel), external_thread_url: thread.external_thread_url },
      { status: 409 },
    );
  } catch (err) {
    console.error('[pms/threads/id/messages] POST failed:', err instanceof Error ? err.message : String(err));
    return NextResponse.json({ ok: false, error: 'unavailable_service' }, { status: 503 });
  }
}
