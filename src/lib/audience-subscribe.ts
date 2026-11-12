/**
 * The one writer of a guest's own signup to the marketing list
 * (`audience_contacts`), for every surface where a person types their email:
 * staycapeann.com through /api/guests/subscribe, and the guest app's stay
 * link on a direct booking (src/lib/guest-app-join.ts).
 *
 * Idempotent on email:
 *   - new email: insert as 'subscribed', push to Resend, send the welcome
 *   - existing 'subscribed': merge the tags, nothing else
 *   - existing anything else: resubscribe (they are opting back in)
 *
 * The Guesty guests sync has its own upsert (guests-guesty-sync.ts) on
 * purpose: it never resubscribes, because nobody typed anything.
 */
import 'server-only';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import { isProxyEmail } from '@/lib/guests-types';
import { pushContactToResend, sendTransactionalViaResend } from '@/lib/resend';

export type SubscribeInput = {
  /** Already trimmed and lowercased by the caller's own check. */
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  /** What the signup surface calls itself, kept in source_detail and the event. */
  sourceLabel: string;
  tags?: string[];
  skipWelcome?: boolean;
  marketingConsent?: boolean;
  /** Merged into the audience_events row. */
  eventMetadata?: Record<string, unknown>;
};

export type SubscribeResult =
  | { ok: true; action: 'inserted' | 'resubscribed' | 'noop' }
  | { ok: false; error: 'insert_failed' };

export function isPlausibleEmail(email: string): boolean {
  // Loose check; real validation happens on Resend's side at send time.
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) && email.length <= 320;
}

export async function subscribeAudienceContact(input: SubscribeInput): Promise<SubscribeResult> {
  const { email, sourceLabel } = input;
  const firstName = (input.firstName || '').trim() || null;
  const lastName = (input.lastName || '').trim() || null;
  const tags = [...(input.tags ?? [])];
  if (isProxyEmail(email)) tags.push('proxy_email');

  // Look up by email first to decide insert vs. resubscribe.
  const { data: existing } = await supabase
    .from('audience_contacts')
    .select('id, status, resend_contact_id, tags')
    .eq('email', email)
    .maybeSingle();

  let contactId: string | null = existing?.id ?? null;
  let resendContactId: string | null = existing?.resend_contact_id ?? null;
  let action: 'inserted' | 'resubscribed' | 'noop' = 'inserted';

  if (existing) {
    // Merge incoming tags with existing (dedup).
    const merged = Array.from(new Set([...(existing.tags ?? []), ...tags]));

    if (existing.status === 'subscribed') {
      // Touch tags only.
      await supabase.from('audience_contacts').update({ tags: merged }).eq('id', existing.id);
      action = 'noop';
    } else {
      await supabase
        .from('audience_contacts')
        .update({
          status: 'subscribed',
          subscribed_at: new Date().toISOString(),
          unsubscribed_at: null,
          unsubscribe_reason: null,
          marketing_consent: true,
          tags: merged,
          first_name: firstName ?? undefined,
          last_name: lastName ?? undefined,
        })
        .eq('id', existing.id);
      action = 'resubscribed';
    }
  } else {
    const { data, error } = await supabase
      .from('audience_contacts')
      .insert({
        email,
        first_name: firstName,
        last_name: lastName,
        status: 'subscribed',
        subscribed_at: new Date().toISOString(),
        source: sourceLabel.startsWith('staycapeann') ? 'staycapeann_signup' : 'manual',
        source_detail: sourceLabel,
        tags,
        marketing_consent: input.marketingConsent !== false,
      })
      .select('id')
      .single();

    if (error) {
      console.error('[audience/subscribe] insert failed', error);
      return { ok: false, error: 'insert_failed' };
    }
    contactId = data.id;
  }

  // Best-effort Resend mirror. Failures don't block the local insert.
  if (contactId && !isProxyEmail(email)) {
    try {
      const id = await pushContactToResend({ email, firstName, lastName });
      if (id && id !== resendContactId) {
        resendContactId = id;
        await supabase
          .from('audience_contacts')
          .update({ resend_contact_id: id, resend_synced_at: new Date().toISOString() })
          .eq('id', contactId);
      }
    } catch (err) {
      console.error('[audience/subscribe] resend sync failed', err);
    }
  }

  await supabase.from('audience_events').insert({
    contact_id: contactId,
    event_type: action === 'resubscribed' ? 'resubscribed' : 'subscribed',
    metadata: { source: sourceLabel, ...(input.eventMetadata ?? {}), action },
  });

  // Welcome email on fresh signup. Skip on resubscribe (they know us).
  if (action === 'inserted' && !isProxyEmail(email) && input.skipWelcome !== true) {
    try {
      await sendTransactionalViaResend({
        to: email,
        subject: 'Welcome to Stay Cape Ann',
        fromName: 'Stay Cape Ann',
        html: welcomeHtml({ firstName }),
        text: welcomeText({ firstName }),
      });
    } catch (err) {
      console.error('[guests/subscribe] welcome send failed', err);
    }
  }

  return { ok: true, action };
}

function welcomeHtml({ firstName }: { firstName: string | null }): string {
  const greeting = firstName ? `Hi ${escapeHtml(firstName)},` : 'Hi there,';
  return `<!doctype html>
<html>
  <body style="font-family: Georgia, 'Times New Roman', serif; color:#1e2e34; background:#faf7f1; padding:32px; max-width:560px; margin:0 auto;">
    <p style="font-size:16px; line-height:1.6;">${greeting}</p>
    <p style="font-size:16px; line-height:1.6;">
      Welcome to Stay Cape Ann. You'll be the first to hear when a new home opens, when a calendar frees up unexpectedly, and when an insider rate is on the table.
    </p>
    <p style="font-size:16px; line-height:1.6;">
      Quiet by default. Easy to leave. Glad you're here.
    </p>
    <p style="font-size:16px; line-height:1.6; margin-top:32px;">
      The Stay Cape Ann team<br />
      <a href="https://staycapeann.com" style="color:#c85a3a; text-decoration:none;">staycapeann.com</a>
    </p>
  </body>
</html>`;
}

function welcomeText({ firstName }: { firstName: string | null }): string {
  const greeting = firstName ? `Hi ${firstName},` : 'Hi there,';
  return `${greeting}

Welcome to Stay Cape Ann. You'll be the first to hear when a new home opens, when a calendar frees up unexpectedly, and when an insider rate is on the table.

Quiet by default. Easy to leave. Glad you're here.

The Stay Cape Ann team
https://staycapeann.com
`;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
