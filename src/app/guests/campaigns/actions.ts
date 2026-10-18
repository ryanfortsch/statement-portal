'use server';

import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { auth } from '@/auth';
import { requireOwnerEmail } from '@/lib/helm-access-server';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import { renderEmail } from '@/lib/email-render';
import { unsubscribeUrl } from '@/lib/guests-unsubscribe-token';
import { sendTransactionalViaResend } from '@/lib/resend';
import {
  campaignSendProgress,
  campaignSentContactIds,
  getCampaign,
  getSegment,
  resolveSegmentRecipients,
} from '@/lib/guests-campaigns';
import { campaignSendStopped, confirmedCountMatches } from '@/lib/campaign-send';
import { draftCampaign } from '@/lib/ai/draft-campaign';
import type { CampaignTone } from '@/lib/ai/brand-voice';

const FROM_NAME_DEFAULT = 'Stay Cape Ann';
const FROM_EMAIL_DEFAULT = process.env.RESEND_FROM_EMAIL || 'hello@staycapeann.com';

/**
 * Save whatever's in the campaign-edit form into the draft row, then
 * return. Used by sendCampaignTest and sendCampaign so the buttons act
 * on the latest typed values without requiring an explicit Save first.
 *
 * Only updates fields that look "intentionally edited" (present in
 * formData and non-empty for string fields). Leaves segment_id alone
 * when missing so a stray empty form doesn't blow away the targeting.
 */
async function persistDraftFromFormData(id: string, formData: FormData): Promise<void> {
  const updates: Record<string, unknown> = {};

  const name = (formData.get('name') as string | null)?.trim();
  if (name) updates.name = name;

  const subject = (formData.get('subject') as string | null)?.trim();
  if (subject !== undefined) updates.subject = subject || null;

  const preheader = (formData.get('preheader') as string | null)?.trim();
  if (preheader !== undefined) updates.preheader = preheader || null;

  const fromName = (formData.get('from_name') as string | null)?.trim();
  if (fromName) updates.from_name = fromName;

  const fromEmail = (formData.get('from_email') as string | null)?.trim();
  if (fromEmail) updates.from_email = fromEmail;

  const body = formData.get('body') as string | null;
  if (body !== null) updates.body_text = body || null;

  const segmentId = (formData.get('segment_id') as string | null)?.trim();
  if (segmentId) updates.segment_id = segmentId;

  if (Object.keys(updates).length === 0) return;

  const { error } = await supabase
    .from('audience_campaigns')
    .update(updates)
    .eq('id', id)
    .eq('status', 'draft'); // never overwrite a sent campaign

  if (error) throw new Error('Failed to persist draft: ' + error.message);
}

/**
 * AI-assisted draft. Takes a freeform brief + tone + segment, calls the
 * AI generator, and creates a campaign row pre-filled with the AI's
 * subject / preheader / body. Lands the operator on the composer with
 * everything ready to refine and send.
 */
export async function createDraftFromBrief(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.email) throw new Error('Not signed in');

  const brief = String(formData.get('brief') || '').trim();
  const tone = String(formData.get('tone') || 'editorial') as CampaignTone;
  const segmentId = String(formData.get('segment_id') || '').trim() || null;

  if (!brief) throw new Error('Tell me what the campaign is about.');
  if (tone !== 'editorial' && tone !== 'insider' && tone !== 'warm') {
    throw new Error('Pick a tone.');
  }

  let draft;
  try {
    draft = await draftCampaign({ brief, tone, segmentId });
  } catch (err) {
    console.error('[campaigns/createDraftFromBrief] AI generation failed', err);
    throw new Error(
      'Draft generation failed. Ask Ryan: the AI connection is not set up. ' +
      (err instanceof Error ? err.message : ''),
    );
  }

  // Default segment fallback if none picked.
  let resolvedSegmentId = segmentId;
  if (!resolvedSegmentId) {
    const { data: defaultSegment } = await supabase
      .from('audience_segments')
      .select('id')
      .eq('name', 'Insider List')
      .maybeSingle();
    resolvedSegmentId = defaultSegment?.id ?? null;
  }

  // Derive a working name from the subject so the list view reads well.
  const name = draft.subject.slice(0, 80) || 'Untitled draft';

  const { data, error } = await supabase
    .from('audience_campaigns')
    .insert({
      name,
      subject: draft.subject,
      preheader: draft.preheader,
      body_text: draft.body,
      from_name: FROM_NAME_DEFAULT,
      from_email: FROM_EMAIL_DEFAULT,
      status: 'draft',
      segment_id: resolvedSegmentId,
      created_by_email: session.user.email,
      template_key: `ai_${tone}`,
    })
    .select('id')
    .single();

  if (error || !data) throw new Error(error?.message || 'Failed to create campaign');

  revalidatePath('/guests/campaigns');
  redirect(`/guests/campaigns/${data.id}?drafted=1`);
}

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

  // Persist whatever's in the form right now so the test reflects current
  // edits. Avoids the "click Send Test, get the previously-saved body"
  // foot-gun.
  await persistDraftFromFormData(id, formData);

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
    throw new Error('Test send failed. Ask Ryan: email sending is not set up.');
  }

  await supabase.from('audience_events').insert({
    campaign_id: id,
    event_type: 'sent',
    metadata: { test: true, to: session.user.email },
  });

  revalidatePath(`/guests/campaigns/${id}`);
  redirect(`/guests/campaigns/${id}?test_sent=${encodeURIComponent(session.user.email)}`);
}

/**
 * Step one of a send: save the form and open the review panel, which names
 * the audience, the live count, the subject and the from address. Nothing
 * goes out from here. Open to any login so staff can see who a draft would
 * reach; only an owner's panel carries the send button.
 */
export async function reviewCampaignSend(formData: FormData): Promise<void> {
  const session = await auth();
  if (!session?.user?.email) throw new Error('Not signed in');

  const id = formData.get('id') as string;
  if (!id) throw new Error('Missing campaign id');

  const campaign = await getCampaign(id);
  if (!campaign) throw new Error('Campaign not found');
  if (campaign.status !== 'draft') {
    throw new Error('Already sent or in flight. Refresh the page.');
  }
  await persistDraftFromFormData(id, formData);

  revalidatePath(`/guests/campaigns/${id}`);
  redirect(`/guests/campaigns/${id}?review=1`);
}

/**
 * Step two: resolve the segment, send the campaign to every recipient, and
 * mark sent. Posted only by the review panel, with the count the operator
 * saw (`confirm_count`); a post without it, or with a count the list no
 * longer matches, lands back on the review instead of sending.
 *
 * A campaign reset after a stopped send (resetStuckCampaign) sends only to
 * the contacts that never got it: everyone with a `sent` event is skipped.
 *
 * v1 sends transactionally per recipient (one POST to Resend per email)
 * instead of using Broadcasts. Reasons:
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
  // Sending to the whole list is the one Growth action with blast radius:
  // owners only. Drafting, segments and the test send stay open to staff.
  await requireOwnerEmail();

  const id = formData.get('id') as string;
  if (!id) throw new Error('Missing campaign id');

  // Persist current form values before sending so the record reflects
  // exactly what went out. The review panel posts only the id and the
  // count, so this is a no-op there; an old tab's full form still saves.
  await persistDraftFromFormData(id, formData);

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

  const alreadySent = await campaignSentContactIds(id);
  const recipients = (await resolveSegmentRecipients(segment, { emailOnly: true }))
    .filter((r) => !alreadySent.has(r.id));
  if (recipients.length === 0) {
    throw new Error('No recipients match this segment. Adjust the filter and try again.');
  }

  // The count on the button the operator pressed must be the count that
  // goes out. Anything else (no count, or the list moved) is a re-review.
  if (!confirmedCountMatches(formData.get('confirm_count'), recipients.length)) {
    redirect(`/guests/campaigns/${id}?review=1${formData.get('confirm_count') ? '&changed=1' : ''}`);
  }

  // Lock the campaign so a second click doesn't double-fire. The row count
  // is the lock: a send that lost the race matches nothing and stops here.
  const { data: locked, error: lockErr } = await supabase
    .from('audience_campaigns')
    .update({
      status: 'sending',
      recipient_count: alreadySent.size + recipients.length,
    })
    .eq('id', id)
    .eq('status', 'draft')
    .select('id');
  if (lockErr) throw new Error(lockErr.message);
  if (!locked?.length) throw new Error('Already sent or in flight. Refresh the page.');

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
      delivered_count: alreadySent.size + delivered,
      failed_reason:
        failed > 0
          ? `${failed} of ${recipients.length} failed. First few: ${failedEmails.slice(0, 5).join(', ')}`
          : null,
    })
    .eq('id', id);

  revalidatePath('/guests/campaigns');
  revalidatePath(`/guests/campaigns/${id}`);
}

/**
 * A send that stopped part way (the function was cut off mid-loop) leaves
 * the row on `sending` forever. An owner puts it back to draft from the
 * page; sending it again goes only to the contacts that never got it.
 * Refuses while the send still shows activity (CAMPAIGN_STUCK_MS).
 */
export async function resetStuckCampaign(formData: FormData): Promise<void> {
  const email = await requireOwnerEmail();

  const id = formData.get('id') as string;
  if (!id) throw new Error('Missing campaign id');

  const campaign = await getCampaign(id);
  if (!campaign) throw new Error('Campaign not found');
  if (campaign.status !== 'sending') throw new Error('This campaign is not sending. Refresh the page.');

  const { sentCount, lastSentAt } = await campaignSendProgress(id);
  const lastActivity = [campaign.updated_at, lastSentAt].filter(Boolean).sort().pop() ?? null;
  if (!campaignSendStopped(lastActivity)) {
    throw new Error('This send is still going. Give it a few minutes, then refresh.');
  }

  const total = campaign.recipient_count ?? sentCount;
  // Every email went out and only the closing write was lost: record the
  // send as finished instead of offering a draft with nobody left to reach.
  const allOut = total > 0 && sentCount >= total;
  const { error } = await supabase
    .from('audience_campaigns')
    .update(
      allOut
        ? { status: 'sent', sent_at: lastSentAt, delivered_count: sentCount, failed_reason: null }
        : {
            status: 'draft',
            failed_reason:
              `The last send stopped after ${sentCount} of ${total}. ${email} put it back to draft; ` +
              'sending it again goes only to the people who did not get it.',
          },
    )
    .eq('id', id)
    .eq('status', 'sending');
  if (error) throw new Error(error.message);

  revalidatePath('/guests/campaigns');
  revalidatePath(`/guests/campaigns/${id}`);
}
