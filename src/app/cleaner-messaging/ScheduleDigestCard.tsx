import Link from 'next/link';
import { Section } from '@/components/Section';
import { SubmitButton } from '@/components/SubmitButton';
import { supabaseAdmin as supabase } from '@/lib/supabase-admin';
import {
  getOpenDigest,
  listScheduleRecipients,
  portalLink,
  digestBaseUrl,
  composeDigestBodyLive,
  type DigestRow,
  type ScheduleRecipient,
} from '@/lib/cleaner-digest';
import {
  buildCheckoutSchedule,
  formatTime12,
  adjustmentSourceLabel,
  type ScheduleDay,
  type ScheduleRow,
} from '@/lib/checkout-schedule';
import {
  approveAndSendDigest,
  sendDigestUpdate,
  refreshDigestDraft,
  rescanMessagesAction,
  toggleRecipientAction,
  applyProposalAction,
  dismissProposalAction,
  ensureTomorrowDraft,
} from '../turnovers/schedule/actions';

/**
 * The daily cleaner-schedule digest card: Helm-native (unlike the
 * concierge queue below it), so it renders even when the Mac Mini is
 * unreachable. Drafted by /api/cron/cleaner-schedule the afternoon
 * before; approving here is the ONLY thing that texts Rosa.
 */

const ROW_BORDER = '1px solid var(--rule)';

function fmtDay(date: string): string {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(`${date}T12:00:00Z`));
}

function Chip({ children, tone }: { children: React.ReactNode; tone: 'signal' | 'muted' | 'warn' }) {
  const colors = {
    signal: { color: 'var(--signal)', border: '1px solid var(--signal)' },
    muted: { color: 'var(--ink-3)', border: '1px solid var(--rule)' },
    warn: { color: '#8a6d1a', border: '1px solid #d6a51e' },
  }[tone];
  return (
    <span
      style={{
        fontSize: 10,
        letterSpacing: '.08em',
        textTransform: 'uppercase',
        fontWeight: 600,
        padding: '2px 7px',
        borderRadius: 3,
        whiteSpace: 'nowrap',
        ...colors,
      }}
    >
      {children}
    </span>
  );
}

function RowLine({ row }: { row: ScheduleRow }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'baseline',
        gap: 12,
        padding: '9px 0',
        borderTop: ROW_BORDER,
        flexWrap: 'wrap',
      }}
    >
      <span style={{ fontFamily: 'var(--font-mono), monospace', fontSize: 15, fontWeight: 600, minWidth: 52 }}>
        {row.time}
      </span>
      <span style={{ fontSize: 14, fontWeight: 600 }}>{row.propertyName}</span>
      {row.guestName && <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>{row.guestName}</span>}
      <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {row.sameDayTurnover && (
          <Chip tone="signal">same-day · in {row.nextCheckinTime && formatTime12(row.nextCheckinTime)}</Chip>
        )}
        {row.adjustment?.adjustedTime && (
          <span title={row.adjustment.note || row.adjustment.evidence || ''}>
            <Chip tone="muted">
              {adjustmentSourceLabel(row.adjustment.source)} · was {formatTime12(row.defaultTime)}
            </Chip>
          </span>
        )}
        {row.adjustment?.adjustedDate && row.adjustment.adjustedDate !== row.baseCheckOut && (
          <span title={row.adjustment.note || row.adjustment.evidence || ''}>
            <Chip tone="muted">extended ({adjustmentSourceLabel(row.adjustment.source)}) · Guesty says {row.baseCheckOut.slice(5)}</Chip>
          </span>
        )}
        {row.adjustment?.drifted && <Chip tone="warn">Guesty moved · re-check</Chip>}
      </span>
    </div>
  );
}

function Proposals({ day }: { day: ScheduleDay }) {
  const withProposals = day.rows.filter((r) => r.proposals.length > 0);
  if (withProposals.length === 0) return null;
  return (
    <div style={{ marginTop: 14, padding: '12px 14px', border: '1px solid #d6a51e', borderRadius: 6, background: 'rgba(214,165,30,.06)' }}>
      <div style={{ fontSize: 11, letterSpacing: '.14em', textTransform: 'uppercase', fontWeight: 700, color: '#8a6d1a' }}>
        Detected but not applied · needs your call
      </div>
      {withProposals.flatMap((r) =>
        r.proposals.map((p) => (
          <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13 }}>
              <strong>{r.propertyName}</strong>
              {': '}
              {p.adjusted_checkout_time ? `checkout ${formatTime12(p.adjusted_checkout_time)}` : ''}
              {p.adjusted_checkout_time && p.adjusted_check_out ? ', ' : ''}
              {p.adjusted_check_out ? `until ${p.adjusted_check_out}` : ''}
              {p.evidence && (
                <span style={{ color: 'var(--ink-3)' }}>
                  {' '}
                  &ldquo;{p.evidence.length > 90 ? `${p.evidence.slice(0, 90)}...` : p.evidence}&rdquo;
                </span>
              )}
            </span>
            <span style={{ display: 'flex', gap: 8 }}>
              <form action={applyProposalAction}>
                <input type="hidden" name="id" value={p.id} />
                <input type="hidden" name="back" value="card" />
                <SubmitButton
                  label="Apply"
                  busyLabel="Applying..."
                  spinnerTone="ink"
                  style={{ fontSize: 11, padding: '4px 10px', background: 'var(--ink)', color: 'var(--paper)', border: 'none', borderRadius: 4, cursor: 'pointer' }}
                />
              </form>
              <form action={dismissProposalAction}>
                <input type="hidden" name="id" value={p.id} />
                <input type="hidden" name="back" value="card" />
                <SubmitButton
                  label="Dismiss"
                  busyLabel="..."
                  spinnerTone="ink"
                  style={{ fontSize: 11, padding: '4px 10px', background: 'transparent', color: 'var(--ink-3)', border: '1px solid var(--rule)', borderRadius: 4, cursor: 'pointer' }}
                />
              </form>
            </span>
          </div>
        )),
      )}
    </div>
  );
}

function Recipients({ recipients, serviceDate }: { recipients: ScheduleRecipient[]; serviceDate: string }) {
  const enabled = recipients.filter((r) => r.enabled);
  return (
    <div id="schedule-recipients" style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      <span style={{ fontSize: 11, letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 700, color: 'var(--ink-4)' }}>
        Texts to
      </span>
      {recipients.map((r) => (
        <form
          key={r.phone}
          action={toggleRecipientAction}
          style={{ display: 'inline' }}
          title={r.enabled ? 'Click to stop texting this cleaner' : 'Click to include this cleaner'}
        >
          <input type="hidden" name="phone" value={r.phone} />
          <input type="hidden" name="enabled" value={r.enabled ? 'false' : 'true'} />
          <input type="hidden" name="back" value="card" />
          <SubmitButton
            label={r.enabled ? `${r.display_name} ✓` : `${r.display_name} · off`}
            busyLabel="..."
            spinnerTone="ink"
            style={{
              fontSize: 12,
              padding: '4px 10px',
              borderRadius: 12,
              cursor: 'pointer',
              border: r.enabled ? '1px solid var(--ink)' : '1px solid var(--rule)',
              background: r.enabled ? 'var(--ink)' : 'transparent',
              color: r.enabled ? 'var(--paper)' : 'var(--ink-4)',
            }}
          />
        </form>
      ))}
      {enabled.length === 0 && (
        <span style={{ fontSize: 12, color: 'var(--signal)', fontWeight: 600 }}>
          No recipient enabled - the send button stays dead until one is on.
        </span>
      )}
      {enabled[0] && (
        <a
          href={portalLink(enabled[0].portal_token, serviceDate)}
          target="_blank"
          rel="noreferrer"
          style={{ fontSize: 12, color: 'var(--tide-deep)', textDecoration: 'underline', textUnderlineOffset: 3 }}
        >
          Preview {enabled[0].display_name}&rsquo;s live page →
        </a>
      )}
    </div>
  );
}

export async function ScheduleDigestCard({
  notice,
}: {
  notice?: { sent?: string; failed?: string; err?: string };
}) {
  let digest: DigestRow | null = null;
  let recipients: ScheduleRecipient[] = [];
  try {
    [digest, recipients] = await Promise.all([getOpenDigest(supabase), listScheduleRecipients(supabase)]);
  } catch {
    return null; // pre-migration or DB hiccup: never block the messaging page
  }

  if (!digest) {
    return (
      <Section id="schedule-digest" title="Cleaner schedule digest" eyebrow="Daily · day before">
        <div style={{ borderTop: '1px solid var(--ink)', padding: '16px 0', fontSize: 13, color: 'var(--ink-3)', display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <span>No digest drafted yet. The cron drafts tomorrow&rsquo;s every afternoon, or draft it now.</span>
          <form action={ensureTomorrowDraft}>
            <SubmitButton
              label="Draft tomorrow's digest"
              busyLabel="Drafting..."
              spinnerTone="ink"
              style={{ fontSize: 12, padding: '6px 12px', background: 'var(--ink)', color: 'var(--paper)', border: 'none', borderRadius: 4, cursor: 'pointer' }}
            />
          </form>
        </div>
      </Section>
    );
  }

  let day: ScheduleDay | null = null;
  try {
    [day] = await buildCheckoutSchedule(supabase, { startDate: digest.service_date, days: 1 });
  } catch {
    day = null;
  }

  const pending = digest.status === 'pending' || digest.status === 'sending';
  // Show the LIVE composition, not the stored snapshot. The stored body is
  // whatever the schedule looked like when the cron (or a refresh) last ran,
  // so any adjustment logged afterwards left the operator reading stale text
  // -- on 2026-08-24 the draft still said "prox. entrada 16:00" minutes after
  // check-in guidance moved to 15:00 (#1293). The send already recomposed
  // live, so the textarea was the only thing lying. Recomposing here makes
  // what she reads and what Rosa receives the same string by construction,
  // and draftedBody carries it too so the unedited-check still holds.
  const shownBody = pending && day ? await composeDigestBodyLive(supabase, day) : digest.body;
  const lastBatch = digest.sent_log?.[digest.sent_log.length - 1];
  const enabledList = recipients.filter((r) => r.enabled);
  const anyEnabled = enabledList.length > 0;

  return (
    <Section
      id="schedule-digest"
      title={`Cleaner schedule · ${fmtDay(digest.service_date)}`}
      eyebrow={pending ? 'Waiting on your approval' : digest.status === 'sent' ? 'Sent' : 'Skipped'}
    >
      <div style={{ borderTop: '1px solid var(--ink)', padding: '14px 0 6px' }}>
        {notice?.err && (
          <div style={{ marginBottom: 10, fontSize: 12, color: 'var(--signal)', fontWeight: 600 }}>
            {notice.err === 'no_recipients' && 'Nothing sent: no recipient is enabled below.'}
            {notice.err === 'quo_unconfigured' && 'Nothing sent: QUO_API_KEY is not set in this environment.'}
            {notice.err === 'all_failed' && 'Quo rejected every send - see the log below and try again.'}
            {notice.err === 'raced' && 'Already handled in another tab - this is the fresh state.'}
            {!['no_recipients', 'quo_unconfigured', 'all_failed', 'raced'].includes(notice.err) && `Error: ${notice.err}`}
          </div>
        )}
        {notice?.sent && (
          <div style={{ marginBottom: 10, fontSize: 12, color: 'var(--positive, #2e7d4f)', fontWeight: 600 }}>
            Sent to {notice.sent} cleaner{notice.sent === '1' ? '' : 's'}
            {notice.failed ? ` (${notice.failed} failed - see log)` : ''}.
          </div>
        )}

        {day && (
          <>
            <div style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: 4 }}>
              {day.counts.checkouts === 0
                ? 'No checkouts that day.'
                : `${day.counts.checkouts} checkout${day.counts.checkouts === 1 ? '' : 's'}${day.counts.sameDay ? `, ${day.counts.sameDay} same-day turn${day.counts.sameDay === 1 ? '' : 's'}` : ''}${day.counts.adjusted ? `, ${day.counts.adjusted} adjusted` : ''}. Live as of now.`}
            </div>
            {day.rows.map((r) => (
              <RowLine key={`${r.propertyId}|${r.checkIn}`} row={r} />
            ))}
            <Proposals day={day} />
          </>
        )}

        <Recipients recipients={recipients} serviceDate={digest.service_date} />

        {pending ? (
          <form action={approveAndSendDigest} style={{ marginTop: 16 }}>
            <input type="hidden" name="digestId" value={digest.id} />
            <input type="hidden" name="serviceDate" value={digest.service_date} />
            <input type="hidden" name="draftedBody" value={shownBody} />
            <label style={{ display: 'block', fontSize: 11, letterSpacing: '.12em', textTransform: 'uppercase', fontWeight: 700, color: 'var(--ink-4)', marginBottom: 6 }}>
              The text that goes out
            </label>
            <textarea
              name="body"
              defaultValue={shownBody}
              rows={Math.min(14, shownBody.split('\n').length + 2)}
              style={{
                width: '100%',
                fontFamily: 'var(--font-mono), monospace',
                fontSize: 13,
                lineHeight: 1.5,
                padding: 12,
                border: '1px solid var(--rule)',
                borderRadius: 6,
                background: 'transparent',
                color: 'var(--ink)',
                resize: 'vertical',
              }}
            />
            <div style={{ fontSize: 11, color: 'var(--ink-4)', margin: '6px 0 12px' }}>
              This is composed from the live schedule right now, and left untouched the send recomposes it again at that moment. Edited text goes verbatim.
            </div>
            {/* The live-schedule link is appended per recipient at send time
                (each cleaner has their own token), so it never appears in the
                editable body above -- which reads as though no link goes out
                at all. Show the real thing instead of claiming it. */}
            <div
              style={{
                margin: '0 0 12px',
                padding: '8px 10px',
                border: '1px dashed var(--rule)',
                borderRadius: 5,
                fontSize: 11,
                color: 'var(--ink-4)',
                lineHeight: 1.55,
              }}
            >
              <span style={{ letterSpacing: '.1em', textTransform: 'uppercase', fontWeight: 700 }}>
                Added to the end of each text
              </span>
              <div style={{ fontFamily: 'var(--font-mono), monospace', marginTop: 4, wordBreak: 'break-all', color: 'var(--ink-3)' }}>
                Agenda ao vivo / live schedule:
                <br />
                {enabledList[0]
                  ? portalLink(enabledList[0].portal_token, digest.service_date)
                  : `${digestBaseUrl()}/clean/<each cleaner's own token>`}
                {enabledList.length > 1 ? ` (${enabledList[0].display_name}; the others get their own)` : ''}
              </div>
            </div>
            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <SubmitButton
                label="Approve &amp; send via Quo"
                busyLabel="Sending..."
                formAction={approveAndSendDigest}
                disabled={!anyEnabled}
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  padding: '9px 18px',
                  background: anyEnabled ? 'var(--signal)' : 'var(--rule)',
                  color: anyEnabled ? '#fff' : 'var(--ink-4)',
                  border: 'none',
                  borderRadius: 5,
                  cursor: anyEnabled ? 'pointer' : 'not-allowed',
                }}
              />
              <SubmitButton
                label="Refresh draft"
                busyLabel="Refreshing..."
                spinnerTone="ink"
                formAction={refreshDigestDraft}
                name="serviceDate"
                value={digest.service_date}
                style={{ fontSize: 12, padding: '8px 14px', background: 'transparent', color: 'var(--ink)', border: '1px solid var(--ink)', borderRadius: 5, cursor: 'pointer' }}
              />
              <span title="Mine the last 3 days of guest threads for agreed late checkouts / extensions right now">
                <SubmitButton
                  label="Re-scan messages"
                  busyLabel="Scanning threads..."
                  spinnerTone="ink"
                  formAction={rescanMessagesAction}
                  style={{ fontSize: 12, padding: '8px 14px', background: 'transparent', color: 'var(--ink)', border: '1px solid var(--rule)', borderRadius: 5, cursor: 'pointer' }}
                />
              </span>
              <Link href="/turnovers/schedule" style={{ fontSize: 12, color: 'var(--tide-deep)', textDecoration: 'underline', textUnderlineOffset: 3 }}>
                Full schedule &amp; adjustments →
              </Link>
            </div>
            <input type="hidden" name="back" value="card" />
          </form>
        ) : (
          <div style={{ marginTop: 14 }}>
            {lastBatch && (
              <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>
                {digest.status === 'sent' ? 'Sent' : 'Last attempt'}{' '}
                {digest.sent_at &&
                  new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'America/New_York' }).format(new Date(digest.sent_at))}{' '}
                by {digest.sent_by}
                {' · '}
                {lastBatch.results.map((r) => `${r.name} ${r.ok ? '✓' : `✕ (${r.error?.slice(0, 60) ?? 'failed'})`}`).join(' · ')}
              </div>
            )}
            <pre
              style={{
                marginTop: 10,
                fontFamily: 'var(--font-mono), monospace',
                fontSize: 12,
                lineHeight: 1.5,
                padding: 12,
                border: '1px solid var(--rule)',
                borderRadius: 6,
                whiteSpace: 'pre-wrap',
                color: 'var(--ink-3)',
              }}
            >
              {digest.body}
            </pre>
            {digest.status === 'sent' && (
              <form action={sendDigestUpdate} style={{ marginTop: 10, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <input type="hidden" name="digestId" value={digest.id} />
                <input type="hidden" name="serviceDate" value={digest.service_date} />
                <input type="hidden" name="back" value="card" />
                <SubmitButton
                  label="Send an update"
                  busyLabel="Sending..."
                  spinnerTone="ink"
                  disabled={!anyEnabled}
                  style={{ fontSize: 12, padding: '8px 14px', background: 'transparent', color: 'var(--ink)', border: '1px solid var(--ink)', borderRadius: 5, cursor: 'pointer' }}
                />
                <span style={{ fontSize: 11, color: 'var(--ink-4)' }}>
                  Schedule changed since? This texts the fresh version, marked as an update.
                </span>
              </form>
            )}
          </div>
        )}
      </div>
    </Section>
  );
}
