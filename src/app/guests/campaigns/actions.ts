'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import { supabase } from '@/lib/supabase';
import { renderEmail } from '@/lib/email-render';
import { unsubscribeUrl } from '@/lib/guests-unsubscribe-token';
import { sendTransactionalViaResend } from '@/lib/resend';
import {
  getCampaign,
  getSegment,
  resolveSegmentRecipients,
} from '@/lib/guests-campaigns';

const FROM_NAME_DEFAULT = 'Stay Cape Ann';
const FROM_EMAIL_DEFAULT = process.env.RESEND_FROM_EMAIL || 'hello@staycapeann.com';

/**
 * Create a fresh draft campaign and jump to its detail page for editing.
 * The "new campaign" page just submits to this; saves a round-trip vs.
 * having an empty edit form that posts elsewhere.
 */
export async function createDraftCampaign(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.email) throw new Error('Not signed in');

  const name = (formData.get('name') as string)?.trim() || 'Untitled draft';

  // Default to the Insider List segment if it exists.
  const { data: defaultSegment } = await supabase
    .from('audience_segments')
    .select('id')
    .eq('name', 'Insider List')
    .maybeSingle();

  const { data, error } = await supabase
    .from('audience_campaigns')
    .insert({
      name,
      from_name: FROM_NAME_DEFAULT,
      from_email: FROM_EMAIL_DEFAULT,
      status: 'draft',
      segment_id: defaultSegment?.id ?? null,
      created_by_email: session.user.email,
    })
    .select('id')
    .single();

  if (error || !data) throw new Error(error?.message || 'Failed to create campaign');

  revalidatePath('/guests/campaigns');
  redirect(`/guests/campaigns/${data.id}`);
}

/**
 * Save edits to a draft. Allowed fields only; status changes go through
 * sendTest / send / cancel actions.
 */
export async function updateDraftCampaign(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.email) throw new Error('Not signed in');

  const id = formData.get('id') as string;
  if (!id) throw new Error('Missing campaign id');

  const campaign = await getCampaign(id);
  if (!campaign) throw new Error('Campaign not found');
  if (campaign.status !== 'draft') {
    throw new Error('Can only edit drafts. This campaign is ' + campaign.status + '.');
  }

  const updates: Record<string, unknown> = {
    name: (formData.get('name') as string)?.trim() || campaign.name,
    subject: (formData.get('subject') as string)?.trim() || null,
    preheader: (formData.get('preheader') as string)?.trim() || null,
    from_name: (formData.get('from_name') as string)?.trim() || campaign.from_name,
    from_email: (formData.get('from_email') as string)?.trim() || campaign.from_email,
    body_text: (formData.get('body') as string) || null,
    segment_id: (formData.get('segment_id') as string) || null,
  };

  const { error } = await supabase
    .from('audience_campaigns')
    .update(updates)
    .eq('id', id);
  if (error) throw new Error(error.message);

  revalidatePath(`/guests/campaigns/${id}`);
}

/**
 * Render the campaign and send a single copy to the logged-in user as
 * a sanity check. Doesn't mutate campaign status. Uses the same render
 * pipeline that the actual send will use, with a [TEST] subject prefix.
 */
export async function sendCampaignTest(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.email) throw new Error('Not signed in');

  const id = formData.get('id') as string;
  if (!id) throw new Error('Missing campaign id');

  const campaign = await getCampaign(id);
  if (!campaign) throw new Error('Campaign not found');

  const subject = (campaign.subject || '').trim();
  const body = (campaign.body_text || '').trim();
  if (!subject || !body) throw new Error('Subject and body are required before sending a test.');

  // For test sends we still want a real (working) unsubscribe link, but
  // we route it to a phantom contact id. We just pass the user's email
  // as the contact_id placeholder; the actual unsubscribe endpoint
  // handles "contact not found" gracefully.
  const fakeUnsubUrl = unsubscribeUrl(session.user.email, id);

  const rendered = renderEmail({
    subject,
    preheader: campaign.preheader || undefined,
    bodyMarkdown: body,
    unsubscribeUrl: fakeUnsubUrl,
    fromName: campaign.from_name || FROM_NAME_DEFAULT,
  });

  const ok = await sendTransactionalViaResend({
    to: session.user.email,
    subject: `[TEST] ${subject}`,
    fromName: campaign.from_name || FROM_NAME_DEFAULT,
    fromEmail: campaign.from_email || FROM_EMAIL_DEFAULT,
    html: rendered.html,
    text: rendered.text,
  });

  if (!ok) {
    throw new Error('Test send failed. Check that RESEND_API_KEY and RESEND_FROM_EMAIL are set in env.');
  }

  await supabase.from('audience_events').insert({
    campaign_id: id,
    event_type: 'sent',
    metadata: { test: true, to: session.user.email },
  });

  revalidatePath(`/guests/campaigns/${id}`);
}

/**
 * Resolve the segment, send the campaign to every recipient, and mark
 * sent. v1 sends transactionally per recipient (one POST to Resend per
 * email) instead of using Broadcasts. Reasons:
 *   - Per-contact unsubscribe URLs without managing Resend audiences
 *   - Uniform webhook coverage (delivered/opened/clicked/bounced) for
 *     every send, regardless of channel
 *   - Volume is small enough (hundreds, low thousands) that a per-recipient
 *     loop is well within Vercel function timeouts
 *
 * If we grow past ~1k recipients per send we'll batch into background
 * jobs or switch to Resend Broadcasts with audience mirroring.
 */
export async function sendCampaign(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.email) throw new Error('Not signed in');

  const id = formData.get('id') as string;
  if (!id) throw new Error('Missing campaign id');

  const campaign = await getCampaign(id);
  if (!campaign) throw new Error('Campaign not found');
  if (campaign.status !== 'draft') {
    throw new Error('Already sent or in flight. Refresh the page.');
  }

  const subject = (campaign.subject || '').trim();
  const body = (campaign.body_text || '').trim();
  if (!subject || !body) throw new Error('Subject and body are required before sending.');

  if (!campaign.segment_id) throw new Error('Pick a segment first.');
  const segment = await getSegment(campaign.segment_id);
  if (!segment) throw new Error('Segment not found.');

  const recipients = await resolveSegmentRecipients(segment, { emailOnly: true });
  if (recipients.length === 0) {
    throw new Error('No recipients match this segment. Adjust the filter and try again.');
  }

  // Lock the campaign so a second click doesn't double-fire.
  const { error: lockErr } = await supabase
    .from('audience_campaigns')
    .update({
      status: 'sending',
      recipient_count: recipients.length,
    })
    .eq('id', id)
    .eq('status', 'draft');
  if (lockErr) throw new Error(lockErr.message);

  let delivered = 0;
  let failed = 0;
  const failedEmails: string[] = [];

  for (const r of recipients) {
    const unsubUrl = unsubscribeUrl(r.id, id);
    const rendered = renderEmail({
      subject,
      preheader: campaign.preheader || undefined,
      bodyMarkdown: body,
      unsubscribeUrl: unsubUrl,
      fromName: campaign.from_name || FROM_NAME_DEFAULT,
    });

    try {
      const ok = await sendTransactionalViaResend({
        to: r.email,
        subject,
        fromName: campaign.from_name || FROM_NAME_DEFAULT,
        fromEmail: campaign.from_email || FROM_EMAIL_DEFAULT,
        html: rendered.html,
        text: rendered.text,
      });

      if (ok) {
        delivered++;
        await supabase.from('audience_events').insert({
          contact_id: r.id,
          campaign_id: id,
          event_type: 'sent',
          metadata: { to: r.email },
        });
      } else {
        failed++;
        failedEmails.push(r.email);
      }
    } catch (err) {
      failed++;
      failedEmails.push(r.email);
      console.error('[campaigns/send] failed for', r.email, err);
    }
  }

  await supabase
    .from('audience_campaigns')
    .update({
      status: failed > 0 && delivered === 0 ? 'failed' : 'sent',
      sent_at: new Date().toISOString(),
      delivered_count: delivered,
      failed_reason:
        failed > 0
          ? `${failed} of ${recipients.length} failed. First few: ${failedEmails.slice(0, 5).join(', ')}`
          : null,
    })
    .eq('id', id);

  revalidatePath('/guests/campaigns');
  revalidatePath(`/guests/campaigns/${id}`);
}
