import Link from 'next/link';
import { notFound } from 'next/navigation';
import { listSegments } from '@/lib/guests';
import {
  campaignSendProgress,
  campaignSentContactIds,
  getCampaign,
  getSegment,
  resolveSegmentRecipients,
} from '@/lib/guests-campaigns';
import { renderEmail } from '@/lib/email-render';
import {
  updateDraftCampaign,
  sendCampaignTest,
  reviewCampaignSend,
  sendCampaign,
  resetStuckCampaign,
} from '../actions';
import { SubmitButton } from '@/components/SubmitButton';
import { AutoRefresh } from '@/components/AutoRefresh';
import { isOwnerSession } from '@/lib/helm-access-server';
import {
  campaignFromLine,
  campaignSendMissing,
  campaignSendStopped,
  recipientsLabel,
} from '@/lib/campaign-send';

const FROM_DEFAULTS = {
  name: 'Stay Cape Ann',
  email: process.env.RESEND_FROM_EMAIL || 'hello@staycapeann.com',
};

export const dynamic = 'force-dynamic';

export default async function CampaignDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ test_sent?: string; drafted?: string; review?: string; changed?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const testSentTo = sp.test_sent || null;
  const justDrafted = sp.drafted === '1';
  const campaign = await getCampaign(id);
  if (!campaign) notFound();

  const [segments, segment, progress, isOwner] = await Promise.all([
    listSegments(),
    campaign.segment_id ? getSegment(campaign.segment_id) : Promise.resolve(null),
    campaignSendProgress(campaign.id),
    isOwnerSession(),
  ]);

  const isDraft = campaign.status === 'draft';
  const isSent = campaign.status === 'sent';
  const isSending = campaign.status === 'sending';

  // The live count is who a send would reach now: a draft reset after a
  // stopped send skips the people the first run already reached, and so
  // does sendCampaign, so the two numbers agree.
  const matched = segment && isDraft ? await resolveSegmentRecipients(segment, { emailOnly: true }) : [];
  const alreadySent = isDraft && progress.sentCount > 0 ? await campaignSentContactIds(campaign.id) : null;
  const recipientCount = alreadySent ? matched.filter((r) => !alreadySent.has(r.id)).length : matched.length;
  const reviewing = isDraft && sp.review === '1';
  const missing = campaignSendMissing(campaign, recipientCount);
  const lastActivity = [campaign.updated_at, progress.lastSentAt].filter(Boolean).sort().pop() ?? null;
  const sendStopped = isSending && campaignSendStopped(lastActivity);
  // Mirrors resetStuckCampaign: everyone got it and only the closing write was lost.
  const allOut = (campaign.recipient_count ?? 0) > 0 && progress.sentCount >= (campaign.recipient_count ?? 0);

  // Preview rendering. Use a fake unsubscribe URL so the component can
  // render without sweating tokens.
  const previewSubject = campaign.subject || '(no subject yet)';
  const previewBody = campaign.body_text || '_Body goes here. Markdown is supported: **bold**, *italic*, [links](https://staycapeann.com), bullet lists with `-`, headings with `#`, and blockquotes with `>`._';
  const preview = renderEmail({
    subject: previewSubject,
    preheader: campaign.preheader || undefined,
    bodyMarkdown: previewBody,
    unsubscribeUrl: '#unsubscribe',
    fromName: campaign.from_name || 'Stay Cape Ann',
  });

  return (
    <div className="flex-1 flex flex-col">
      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingTop: 48, paddingBottom: 24, width: '100%' }}>
        <div className="eyebrow" style={{ marginBottom: 14 }}>
          <Link href="/guests/campaigns" style={{ color: 'var(--ink-3)', textDecoration: 'none' }}>← Campaigns</Link>
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, flexWrap: 'wrap' }}>
          <h1 className="font-serif" style={{
            fontSize: 32,
            lineHeight: 1.05,
            fontWeight: 300,
            letterSpacing: '-0.02em',
            color: 'var(--ink)',
            margin: 0,
          }}>
            {campaign.name}
          </h1>
          <StatusBadge status={campaign.status} />
        </div>
      </section>

      {/* SENT STATS (only when sent) */}
      {isSent && (
        <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 36 }}>
          <div
            className="rt-helm-stat-strip"
            style={{
              borderTop: '1px solid var(--ink)',
              borderBottom: '1px solid var(--ink)',
              display: 'grid',
              gridTemplateColumns: 'repeat(5, 1fr)',
            }}
          >
            <Stat label="Recipients" value={String(campaign.recipient_count ?? 0)} />
            <Stat label="Delivered" value={String(campaign.delivered_count)} />
            <Stat label="Opened" value={String(campaign.opened_count)} />
            <Stat label="Clicked" value={String(campaign.clicked_count)} />
            <Stat label="Unsubs" value={String(campaign.unsubscribed_count)} accent={campaign.unsubscribed_count > 0} last />
          </div>
          <p style={{ marginTop: 12, fontSize: 12, color: 'var(--ink-3)' }}>
            Sent {campaign.sent_at ? new Date(campaign.sent_at).toLocaleString('en-US', { timeZone: 'America/New_York' }) : ''}
          </p>
        </section>
      )}

      {isSending && (
        <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 24 }}>
          <div style={{ borderLeft: '3px solid var(--signal)', padding: '12px 16px', background: 'var(--paper-2)', fontSize: 13, display: 'grid', gap: 10 }}>
            {sendStopped ? (
              <>
                {allOut ? (
                  <span>
                    Every email went out ({progress.sentCount} of {campaign.recipient_count}), but the send stopped before it recorded the finish.
                    {isOwner ? ' Mark it sent to close it.' : ' An owner can mark it sent.'}
                  </span>
                ) : (
                  <span>
                    This send stopped after {progress.sentCount} of {campaign.recipient_count ?? progress.sentCount}.
                    {' '}Nothing has gone out for over ten minutes.
                    {isOwner
                      ? ' Put it back to draft to send the rest; nobody gets it twice.'
                      : ' An owner can put it back to draft to send the rest.'}
                  </span>
                )}
                {isOwner && (
                  <form action={resetStuckCampaign}>
                    <input type="hidden" name="id" value={campaign.id} />
                    <SubmitButton
                      label={allOut ? 'Mark sent' : 'Back to draft'}
                      busyLabel="Saving…"
                      style={secondaryButtonStyle}
                      spinnerTone="ink"
                    />
                  </form>
                )}
              </>
            ) : (
              <>
                <span>
                  Sending now: {progress.sentCount} of {campaign.recipient_count ?? '…'} so far. This page refreshes every ten seconds until it finishes.
                </span>
                <AutoRefresh intervalMs={10000} />
              </>
            )}
          </div>
        </section>
      )}

      {campaign.failed_reason && (
        <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 24 }}>
          <div style={{ borderLeft: '3px solid var(--signal)', padding: '12px 16px', background: 'var(--paper-2)', fontSize: 13 }}>
            {campaign.failed_reason}
          </div>
        </section>
      )}

      {/* JUST-DRAFTED FLASH (after AI draft) */}
      {justDrafted && (
        <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 24 }}>
          <div style={{ borderLeft: '3px solid var(--positive, #2d6b50)', padding: '12px 16px', background: 'var(--paper-2)', fontSize: 13, color: 'var(--ink)' }}>
            Drafted. Send a test to yourself before the real send.
          </div>
        </section>
      )}

      {/* TEST SENT FLASH */}
      {testSentTo && (
        <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 24 }}>
          <div style={{ borderLeft: '3px solid var(--positive, #2d6b50)', padding: '12px 16px', background: 'var(--paper-2)', fontSize: 13, color: 'var(--ink)' }}>
            Test sent to <strong>{testSentTo}</strong>.
          </div>
        </section>
      )}

      {/* COMPOSER + PREVIEW */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 56, flex: 1, width: '100%' }}>
        <div className="rt-composer" style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 32 }}>
          {/* LEFT: the review panel (step two of a send), else the form;
              on a phone the editor sits above the preview. */}
          {reviewing ? (
            <ReviewPanel
              campaignId={campaign.id}
              audience={segment?.name ?? null}
              recipientCount={recipientCount}
              alreadySent={progress.sentCount}
              subject={campaign.subject}
              from={campaignFromLine(campaign.from_name, campaign.from_email, FROM_DEFAULTS)}
              missing={missing}
              changed={sp.changed === '1'}
              isOwner={isOwner}
            />
          ) : (
          <form
            action={updateDraftCampaign}
            style={{ display: 'grid', gap: 18 }}
          >
            <input type="hidden" name="id" value={campaign.id} />

            <Field label="Working name">
              <input
                name="name"
                type="text"
                defaultValue={campaign.name}
                disabled={!isDraft}
                style={inputStyle}
              />
            </Field>

            <Field label="Subject">
              <input
                name="subject"
                type="text"
                defaultValue={campaign.subject ?? ''}
                placeholder="Something they'd actually open"
                disabled={!isDraft}
                style={inputStyle}
              />
            </Field>

            <Field label="Preheader (preview text)">
              <input
                name="preheader"
                type="text"
                defaultValue={campaign.preheader ?? ''}
                placeholder="One short line shown next to the subject"
                disabled={!isDraft}
                style={inputStyle}
              />
            </Field>

            <div className="rt-form-pair" style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 12 }}>
              <Field label="From name">
                <input
                  name="from_name"
                  type="text"
                  defaultValue={campaign.from_name ?? 'Stay Cape Ann'}
                  disabled={!isDraft}
                  style={inputStyle}
                />
              </Field>
              <Field label="From email">
                <input
                  name="from_email"
                  type="email"
                  defaultValue={campaign.from_email ?? ''}
                  placeholder="hello@staycapeann.com"
                  disabled={!isDraft}
                  style={inputStyle}
                />
              </Field>
            </div>

            <Field label="Send to (segment)">
              <select
                name="segment_id"
                defaultValue={campaign.segment_id ?? ''}
                disabled={!isDraft}
                style={selectStyle}
              >
                <option value="" disabled>Pick one…</option>
                {segments.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
              {segment && isDraft && (
                <p style={{ marginTop: 6, fontSize: 12, color: 'var(--ink-3)' }}>
                  <strong>{recipientCount}</strong> recipient{recipientCount === 1 ? '' : 's'} match this segment right now
                  {alreadySent ? ', not counting the people the last send reached' : ''}.
                </p>
              )}
            </Field>

            <Field label="Body (Markdown)">
              <textarea
                name="body"
                rows={18}
                defaultValue={campaign.body_text ?? ''}
                placeholder={DEFAULT_BODY_HINT}
                disabled={!isDraft}
                style={{ ...inputStyle, fontFamily: 'var(--font-mono, ui-monospace, SFMono-Regular, Menlo, monospace)', fontSize: 13, lineHeight: 1.6, resize: 'vertical' }}
              />
              <p style={{ marginTop: 6, fontSize: 12, color: 'var(--ink-3)' }}>
                Markdown works. Save before previewing.
              </p>
            </Field>

            {/* The foot of the form. Every button saves the form first; they
                route to different server actions via formAction on the SAME
                form (nested <form>s would be flattened by the browser and
                trigger the outer action). Nothing here reaches the list:
                Review and send opens the panel that does. */}
            {isDraft && (
              <div style={{ display: 'grid', gap: 10, paddingTop: 14, borderTop: '1px solid var(--rule)' }}>
                <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                  <SubmitButton label="Save draft" busyLabel="Saving…" formAction={updateDraftCampaign} style={primaryButtonStyle} />
                  <SubmitButton
                    formAction={sendCampaignTest}
                    style={secondaryButtonStyle}
                    spinnerTone="ink"
                    label="Send test to me"
                    busyLabel="Sending test…"
                  />
                  <SubmitButton
                    formAction={reviewCampaignSend}
                    style={secondaryButtonStyle}
                    spinnerTone="ink"
                    label="Review and send →"
                    busyLabel="Saving…"
                  />
                </div>
              </div>
            )}
          </form>
          )}

          {/* RIGHT: live preview */}
          <div>
            <div className="eyebrow" style={{ marginBottom: 10 }}>Preview</div>
            <div style={{ border: '1px solid var(--rule)', background: '#faf7f1', maxHeight: 'min(720px, 75svh)', overflow: 'auto' }}>
              <iframe
                title="Campaign preview"
                srcDoc={preview.html}
                /* sandbox without allow-top-navigation so clicks inside the
                   preview (e.g. the staycapeann.com link in the footer)
                   can't replace this iframe or the parent page. The
                   preview stays put as you click around. */
                sandbox=""
                style={{ width: '100%', height: 'min(720px, 75svh)', border: 'none', display: 'block' }}
              />
            </div>
          </div>
        </div>

      </section>

      <footer style={{ borderTop: '1px solid var(--ink)' }}>
        <div className="max-w-[1100px] mx-auto px-10 flex items-center justify-between" style={{
          padding: '14px 40px',
          fontSize: 10,
          letterSpacing: '.18em',
          textTransform: 'uppercase',
          color: 'var(--ink-4)',
        }}>
          <span>Rising Tide &middot; Guests &middot; Campaign</span>
          <span style={{ fontStyle: 'italic', textTransform: 'none', letterSpacing: 0, color: 'var(--ink-3)', fontSize: 11 }}>
            id: {campaign.id.slice(0, 8)}
          </span>
        </div>
      </footer>
    </div>
  );
}

/**
 * Step two of a send. Everything here is the SAVED campaign, which is what
 * goes out; the preview beside it renders the same row. The button repeats
 * the count and posts it, and sendCampaign refuses a count the list no
 * longer matches.
 */
function ReviewPanel({
  campaignId,
  audience,
  recipientCount,
  alreadySent,
  subject,
  from,
  missing,
  changed,
  isOwner,
}: {
  campaignId: string;
  audience: string | null;
  recipientCount: number;
  alreadySent: number;
  subject: string | null;
  from: string;
  missing: string[];
  changed: boolean;
  isOwner: boolean;
}) {
  const ready = missing.length === 0;
  return (
    <div style={{ display: 'grid', gap: 18, alignContent: 'start' }}>
      <div className="eyebrow">Review and send</div>
      <h2 className="font-serif" style={{ fontSize: 26, lineHeight: 1.15, fontWeight: 300, margin: 0 }}>
        {ready ? <>This emails {recipientsLabel(recipientCount)}.</> : 'Not ready to send yet.'}
      </h2>
      {changed && (
        <p style={{ margin: 0, fontSize: 13, color: 'var(--signal)' }}>
          The list changed since you reviewed it. This is the count now.
        </p>
      )}
      <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'max-content 1fr', columnGap: 18, rowGap: 10, fontSize: 14 }}>
        <dt className="eyebrow" style={{ alignSelf: 'baseline' }}>Audience</dt>
        <dd style={{ margin: 0 }}>
          {audience ?? 'None picked'}
          {audience && <> &middot; {recipientsLabel(recipientCount)} right now</>}
          {alreadySent > 0 && (
            <span style={{ display: 'block', fontSize: 12, color: 'var(--ink-3)', marginTop: 2 }}>
              {alreadySent} already got it before the last send stopped; they are skipped.
            </span>
          )}
        </dd>
        <dt className="eyebrow" style={{ alignSelf: 'baseline' }}>Subject</dt>
        <dd style={{ margin: 0 }}>{subject?.trim() || 'None yet'}</dd>
        <dt className="eyebrow" style={{ alignSelf: 'baseline' }}>From</dt>
        <dd style={{ margin: 0 }}>{from}</dd>
      </dl>
      {!ready && (
        <p style={{ margin: 0, fontSize: 13, color: 'var(--ink-3)' }}>
          Still needs {missing.join(', ')}. Go back to editing to add it.
        </p>
      )}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', paddingTop: 14, borderTop: '1px solid var(--rule)' }}>
        {ready && isOwner && (
          <form action={sendCampaign}>
            <input type="hidden" name="id" value={campaignId} />
            <input type="hidden" name="confirm_count" value={String(recipientCount)} />
            <SubmitButton label={<>Send to {recipientsLabel(recipientCount)}</>} busyLabel="Sending…" style={dangerButtonStyle} />
          </form>
        )}
        <Link href={`/guests/campaigns/${campaignId}`} style={{ ...secondaryButtonStyle, textDecoration: 'none' }}>
          Back to editing
        </Link>
      </div>
      {ready && !isOwner && (
        <p style={{ margin: 0, fontSize: 12, color: 'var(--ink-3)' }}>
          An owner sends to the list. Send a test to yourself, then hand it over.
        </p>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="eyebrow" style={{ display: 'block', marginBottom: 6 }}>{label}</label>
      {children}
    </div>
  );
}

function Stat({ label, value, accent = false, last = false }: { label: string; value: string; accent?: boolean; last?: boolean }) {
  return (
    <div className="rt-helm-stat" style={{ padding: '20px 22px', borderRight: last ? 'none' : '1px solid var(--rule)' }}>
      <div className="eyebrow" style={{ marginBottom: 8 }}>{label}</div>
      <div className="font-serif tabular-nums rt-helm-stat-value" style={{
        fontSize: 26,
        fontWeight: 400,
        color: accent ? 'var(--signal)' : 'var(--ink)',
        lineHeight: 1.05,
      }}>
        {value}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, { bg: string; fg: string }> = {
    draft: { bg: 'transparent', fg: 'var(--ink-3)' },
    scheduled: { bg: 'var(--paper-2)', fg: 'var(--ink)' },
    sending: { bg: 'var(--signal)', fg: 'var(--paper)' },
    sent: { bg: 'var(--ink)', fg: 'var(--paper)' },
    failed: { bg: 'var(--signal)', fg: 'var(--paper)' },
  };
  const c = colors[status] || colors.draft;
  return (
    <span
      style={{
        fontSize: 10,
        letterSpacing: '.22em',
        textTransform: 'uppercase',
        fontWeight: 600,
        padding: '4px 10px',
        background: c.bg,
        color: c.fg,
        border: status === 'draft' ? '1px solid var(--rule)' : 'none',
      }}
    >
      {status}
    </span>
  );
}

const DEFAULT_BODY_HINT = `# 21 Horton just opened up

A surprise opening for the week of July 4. Members of the list see it first, before the booking calendar catches up.

[Take a look](https://staycapeann.com/stays/21-horton)

> Sleeps six. Two minutes from Rocky Neck. Walking distance to the harbor.

- Check in Saturday
- Check out the following Saturday
- Insider rate, this week only`;

const inputStyle: React.CSSProperties = {
  width: '100%',
  background: 'transparent',
  border: '1px solid var(--rule)',
  color: 'var(--ink)',
  fontSize: 14,
  padding: '10px 12px',
  outline: 'none',
  fontFamily: 'inherit',
};

const selectStyle: React.CSSProperties = {
  ...inputStyle,
  cursor: 'pointer',
  paddingRight: 28,
};

const primaryButtonStyle: React.CSSProperties = {
  background: 'var(--ink)',
  color: 'var(--paper)',
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '.18em',
  textTransform: 'uppercase',
  padding: '12px 22px',
  border: 'none',
  cursor: 'pointer',
};

const secondaryButtonStyle: React.CSSProperties = {
  background: 'transparent',
  color: 'var(--ink)',
  fontSize: 11,
  fontWeight: 500,
  letterSpacing: '.18em',
  textTransform: 'uppercase',
  padding: '12px 22px',
  border: '1px solid var(--ink)',
  cursor: 'pointer',
};

const dangerButtonStyle: React.CSSProperties = {
  background: 'var(--signal)',
  color: 'var(--paper)',
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '.18em',
  textTransform: 'uppercase',
  padding: '12px 22px',
  border: 'none',
  cursor: 'pointer',
};
