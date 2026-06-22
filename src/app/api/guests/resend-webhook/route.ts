/**
 * Resend webhook receiver.
 *
 * Resend posts engagement events here. We map them onto audience_events,
 * bump the matching contact's denormalized counters, and update status on
 * bounce/complain/unsubscribe.
 *
 * Signature verification: Resend uses Svix for webhook signing. Headers:
 *   svix-id, svix-timestamp, svix-signature
 * Signature is base64(hmac-sha256(svix-id.svix-timestamp.body, secret))
 * where secret is the raw bytes from RESEND_WEBHOOK_SECRET (which Resend
 * gives you with a `whsec_` prefix that we strip + base64-decode).
 *
 * If RESEND_WEBHOOK_SECRET is unset, we log a warning and accept the payload
 * (so dev can pipe events without configuring signing). Production should
 * always have the secret set.
 */

import { NextRequest, NextResponse } from 'next/server';
import crypto from 'node:crypto';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import type { GuestEventType, GuestStatus } from '@/lib/guests-types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type ResendWebhookPayload = {
  type: string;          // e.g. "email.delivered", "email.opened", "contact.created"
  created_at?: string;
  data?: {
    email_id?: string;
    to?: string[] | string;
    from?: string;
    subject?: string;
    broadcast_id?: string;
    contact_id?: string;
    email?: string;
  };
};

export async function POST(req: NextRequest) {
  const rawBody = await req.text();

  if (!verifySignature(req, rawBody)) {
    return NextResponse.json({ error: 'invalid_signature' }, { status: 401 });
  }

  let payload: ResendWebhookPayload;
  try {
    payload = JSON.parse(rawBody) as ResendWebhookPayload;
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }

  const eventType = mapEventType(payload.type);
  if (!eventType) {
    // Unknown event types are still logged but not counted.
    await supabase.from('audience_events').insert({
      event_type: 'sent', // fallback bucket
      metadata: { raw: payload, unmapped_type: payload.type },
    });
    return NextResponse.json({ ok: true, ignored: payload.type });
  }

  const recipientEmail = extractRecipientEmail(payload);
  let contactId: string | null = null;
  let resendContactId: string | null = payload.data?.contact_id ?? null;

  if (recipientEmail) {
    const { data: contact } = await supabase
      .from('audience_contacts')
      .select('id, total_sent, total_opened, total_clicked, total_bounced')
      .eq('email', recipientEmail.toLowerCase())
      .maybeSingle();
    contactId = contact?.id ?? null;
  } else if (resendContactId) {
    const { data: contact } = await supabase
      .from('audience_contacts')
      .select('id')
      .eq('resend_contact_id', resendContactId)
      .maybeSingle();
    contactId = contact?.id ?? null;
  }

  let campaignId: string | null = null;
  if (payload.data?.broadcast_id) {
    const { data: campaign } = await supabase
      .from('audience_campaigns')
      .select('id')
      .eq('resend_broadcast_id', payload.data.broadcast_id)
      .maybeSingle();
    campaignId = campaign?.id ?? null;
  }

  const occurredAt = payload.created_at || new Date().toISOString();

  await supabase.from('audience_events').insert({
    contact_id: contactId,
    campaign_id: campaignId,
    event_type: eventType,
    occurred_at: occurredAt,
    metadata: {
      email_id: payload.data?.email_id,
      raw_type: payload.type,
    },
  });

  if (contactId) await applyContactCounter(contactId, eventType, occurredAt);
  if (contactId) await applyContactStatus(contactId, eventType);
  if (campaignId) await applyCampaignCounter(campaignId, eventType);

  return NextResponse.json({ ok: true });
}

function mapEventType(resendType: string): GuestEventType | null {
  switch (resendType) {
    case 'email.sent': return 'sent';
    case 'email.delivered': return 'delivered';
    case 'email.opened': return 'opened';
    case 'email.clicked': return 'clicked';
    case 'email.bounced': return 'bounced';
    case 'email.complained': return 'complained';
    case 'email.failed': return 'failed';
    case 'contact.created': return 'subscribed';
    case 'contact.deleted': return 'unsubscribed';
    case 'contact.updated': return null; // log raw only
    default: return null;
  }
}

function extractRecipientEmail(payload: ResendWebhookPayload): string | null {
  const to = payload.data?.to;
  if (typeof to === 'string') return to;
  if (Array.isArray(to) && to.length > 0) return to[0];
  if (payload.data?.email) return payload.data.email;
  return null;
}

async function applyContactCounter(
  contactId: string,
  eventType: GuestEventType,
  occurredAt: string,
) {
  // PostgREST has no generic "increment"; we read current counters then
  // write incremented values. The race window is acceptable for engagement
  // counters — eventual consistency, no money on the line.
  const { data: cur } = await supabase
    .from('audience_contacts')
    .select('total_sent, total_opened, total_clicked, total_bounced')
    .eq('id', contactId)
    .maybeSingle();

  if (!cur) return;
  const c = cur as {
    total_sent: number;
    total_opened: number;
    total_clicked: number;
    total_bounced: number;
  };

  const final: Record<string, unknown> = {};
  if (eventType === 'sent' || eventType === 'delivered') {
    final.last_sent_at = occurredAt;
    final.total_sent = (c.total_sent ?? 0) + 1;
  } else if (eventType === 'opened') {
    final.last_opened_at = occurredAt;
    final.total_opened = (c.total_opened ?? 0) + 1;
  } else if (eventType === 'clicked') {
    final.last_clicked_at = occurredAt;
    final.total_clicked = (c.total_clicked ?? 0) + 1;
  } else if (eventType === 'bounced') {
    final.total_bounced = (c.total_bounced ?? 0) + 1;
  }

  if (Object.keys(final).length === 0) return;
  await supabase.from('audience_contacts').update(final).eq('id', contactId);
}

async function applyContactStatus(contactId: string, eventType: GuestEventType) {
  const newStatus: GuestStatus | null =
    eventType === 'bounced' ? 'bounced' :
    eventType === 'complained' ? 'complained' :
    eventType === 'unsubscribed' ? 'unsubscribed' :
    null;

  if (!newStatus) return;

  const updates: Record<string, unknown> = { status: newStatus };
  if (newStatus === 'unsubscribed') {
    updates.unsubscribed_at = new Date().toISOString();
    updates.unsubscribe_reason = 'resend webhook';
  }

  await supabase.from('audience_contacts').update(updates).eq('id', contactId);
}

async function applyCampaignCounter(campaignId: string, eventType: GuestEventType) {
  const field =
    eventType === 'delivered' ? 'delivered_count' :
    eventType === 'opened' ? 'opened_count' :
    eventType === 'clicked' ? 'clicked_count' :
    eventType === 'bounced' ? 'bounced_count' :
    eventType === 'complained' ? 'complained_count' :
    eventType === 'unsubscribed' ? 'unsubscribed_count' :
    null;

  if (!field) return;

  const { data: cur } = await supabase
    .from('audience_campaigns')
    .select(field)
    .eq('id', campaignId)
    .maybeSingle();

  if (!cur) return;
  const currentValue = (cur as Record<string, number>)[field] ?? 0;
  await supabase
    .from('audience_campaigns')
    .update({ [field]: currentValue + 1 })
    .eq('id', campaignId);
}

function verifySignature(req: NextRequest, body: string): boolean {
  const secret = process.env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    console.warn('[resend-webhook] RESEND_WEBHOOK_SECRET is unset; accepting unsigned payload');
    return true;
  }

  const svixId = req.headers.get('svix-id');
  const svixTimestamp = req.headers.get('svix-timestamp');
  const svixSignature = req.headers.get('svix-signature');

  if (!svixId || !svixTimestamp || !svixSignature) return false;

  const secretBytes = secret.startsWith('whsec_')
    ? Buffer.from(secret.slice(6), 'base64')
    : Buffer.from(secret, 'utf8');

  const toSign = `${svixId}.${svixTimestamp}.${body}`;
  const expected = crypto
    .createHmac('sha256', secretBytes)
    .update(toSign)
    .digest('base64');

  // svix-signature header looks like: "v1,abc123 v1,xyz789"
  const presented = svixSignature
    .split(' ')
    .map((s) => s.split(',')[1])
    .filter(Boolean);

  return presented.some((sig) => timingSafeEq(sig, expected));
}

function timingSafeEq(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}
