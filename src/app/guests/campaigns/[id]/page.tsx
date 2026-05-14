import Link from 'next/link';
import { notFound } from 'next/navigation';
import { HelmMasthead } from '@/components/HelmMasthead';
import { listSegments } from '@/lib/guests';
import {
  getCampaign,
  getSegment,
  resolveSegmentRecipients,
} from '@/lib/guests-campaigns';
import { renderEmail } from '@/lib/email-render';
import {
  updateDraftCampaign,
  sendCampaignTest,
  sendCampaign,
} from '../actions';

export const dynamic = 'force-dynamic';

export default async function CampaignDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ test_sent?: string; drafted?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const testSentTo = sp.test_sent || null;
  const justDrafted = sp.drafted === '1';
  const campaign = await getCampaign(id);
  if (!campaign) notFound();

  const [segments, segment] = await Promise.all([
    listSegments(),
    campaign.segment_id ? getSegment(campaign.segment_id) : Promise.resolve(null),
  ]);

  const recipientCount = segment
    ? (await resolveSegmentRecipients(segment, { emailOnly: true })).length
    : 0;

  const isDraft = campaign.status === 'draft';
  const isSent = campaign.status === 'sent';
  const isSending = campaign.status === 'sending';

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
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead current="guests" />

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
            Sent {campaign.sent_at ? new Date(campaign.sent_at).toLocaleString('en-US') : ''}
          </p>
        </section>
      )}

      {isSending && (
        <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 24 }}>
          <div style={{ borderLeft: '3px solid var(--signal)', padding: '12px 16px', background: 'var(--paper-2)', fontSize: 13 }}>
            Send is in flight. This page will refresh when complete.
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
            Helm drafted this for you. Read it through, tweak anything that doesn&rsquo;t sound right, then send a test to yourself before the real send.
          </div>
        </section>
      )}

      {/* TEST SENT FLASH */}
      {testSentTo && (
        <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 24 }}>
          <div style={{ borderLeft: '3px solid var(--positive, #2d6b50)', padding: '12px 16px', background: 'var(--paper-2)', fontSize: 13, color: 'var(--ink)' }}>
            Test sent to <strong>{testSentTo}</strong>. Check the inbox (and spam) for the [TEST] copy.
          </div>
        </section>
      )}

      {/* COMPOSER + PREVIEW */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingBottom: 56, flex: 1, width: '100%' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 32 }}>
          {/* LEFT: form */}
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

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 12 }}>
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
              {segment && (
                <p style={{ marginTop: 6, fontSize: 12, color: 'var(--ink-3)' }}>
                  <strong>{recipientCount}</strong> recipient{recipientCount === 1 ? '' : 's'} match this segment right now.
                </p>
              )}
            </Field>

            {/* SEND BUTTONS. These submit the SAME parent form but route
                to different server actions via formAction. Nested <form>s
                here would be silently flattened by browsers and the
                buttons would secretly trigger the outer Save Draft action
                instead. The send actions auto-persist form values before
                sending so no separate Save click is needed. */}
            {isDraft && (
              <div style={{ display: 'grid', gap: 10, padding: '14px 0', borderTop: '1px solid var(--rule)', borderBottom: '1px solid var(--rule)' }}>
                <div className="eyebrow">Send</div>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  <button
                    type="submit"
                    formAction={sendCampaignTest}
                    style={secondaryButtonStyle}
                  >
                    Send test to me
                  </button>
                  <button
                    type="submit"
                    formAction={sendCampaign}
                    style={dangerButtonStyle}
                    disabled={!campaign.subject || !campaign.body_text || !campaign.segment_id}
                  >
                    Send to {recipientCount > 0 ? recipientCount : '0'} recipient{recipientCount === 1 ? '' : 's'} →
                  </button>
                </div>
                <p style={{ fontSize: 11, color: 'var(--ink-3)', margin: 0 }}>
                  Test sends arrive with a [TEST] subject prefix and don&rsquo;t lock the campaign. Both buttons use the latest values in this form. No separate Save click needed.
                </p>
              </div>
            )}

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
                Headings (#), **bold**, *italic*, [links](https://...), bullet lists (-), blockquotes (&gt;), horizontal rule (---). Save before previewing.
              </p>
            </Field>

            {isDraft && (
              <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                <button type="submit" style={primaryButtonStyle}>
                  Save draft
                </button>
              </div>
            )}
          </form>

          {/* RIGHT: live preview */}
          <div>
            <div className="eyebrow" style={{ marginBottom: 10 }}>Preview</div>
            <div style={{ border: '1px solid var(--rule)', background: '#faf7f1', maxHeight: 720, overflow: 'auto' }}>
              <iframe
                title="Campaign preview"
                srcDoc={preview.html}
                /* sandbox without allow-top-navigation so clicks inside the
                   preview (e.g. the staycapeann.com link in the footer)
                   can't replace this iframe or the parent page. The
                   preview stays put as you click around. */
                sandbox=""
                style={{ width: '100%', height: 720, border: 'none', display: 'block' }}
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
    <div style={{ padding: '20px 22px', borderRight: last ? 'none' : '1px solid var(--rule)' }}>
      <div className="eyebrow" style={{ marginBottom: 8 }}>{label}</div>
      <div className="font-serif tabular-nums" style={{
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
