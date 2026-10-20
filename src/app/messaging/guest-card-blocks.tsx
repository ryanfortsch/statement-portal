import Link from 'next/link';
import type { ReactNode } from 'react';
import type { AddonCharge, TeamHandoff } from '@/lib/stay-concierge';
import type { CardQuoteBlock } from '@/lib/guest-quote-context-core';
import { fmtCents, type ScaQuoteStatus } from '@/lib/sca-quotes-types';
import { roleMayOpen, type HelmRole } from '@/lib/helm-access';
import { SecondaryButton } from '@/components/messaging/card/buttons';
import type { AlsoItem } from '@/components/messaging/card/types';
import { formatStayDates } from './format';

/**
 * The guest card's Also on approve lines (2026-10-18): what approving a guest
 * reply will also do, each said in one line with its controls behind it. The
 * quote, add-on and handoff blocks used to stack between the reply and its
 * buttons in four colours with four explainers.
 */

// Existing Stay Cape Ann quotes: context the operator reads, never an action.
const QUOTE_TONE = 'var(--ink-3)';
// Add-on payment link: money being collected.
const ADDON_TONE = '#6b4f7a';
// The teammate handoff: internal work, never the guest or their money.
const HANDOFF_TONE = '#3d6b63';
const HANDOFF_LABEL: Record<string, string> = { cleaner: 'Cleaner note', contractor: 'Contractor note', owner: 'Owner note' };
const HANDOFF_HREF: Record<string, string> = { cleaner: '/messaging/team?audience=cleaners', contractor: '/messaging/team?audience=contractors', owner: '/owner-messaging' };
const HANDOFF_SURFACE: Record<string, string> = { cleaner: 'the Team inbox', contractor: 'the Team inbox', owner: 'Owner messaging' };

/** One colour per quote state. Sent and accepted are the two the operator
 *  is looking for; the rest stay quiet. */
function quoteStatusTone(status: ScaQuoteStatus): string {
  if (status === 'accepted') return 'var(--go, #2e7d32)';
  if (status === 'sent') return ADDON_TONE;
  if (status === 'expired' || status === 'declined') return 'var(--signal)';
  return 'var(--ink-3)';
}

/** A quote on file: a link into Quotes for an owner, the same row as plain
 *  text for staff, who should still know one went out so the guest is not
 *  priced twice. */
function QuoteRow({ href, linked, children }: { href: string; linked: boolean; children: ReactNode }) {
  const style = { color: 'var(--ink)', textDecoration: 'none', display: 'block' } as const;
  return linked ? <a href={href} style={style}>{children}</a> : <span style={style}>{children}</span>;
}

/** Stay Cape Ann quotes already on file for this guest, as one line. The
 *  TRUE count, never the length of the truncated list: a cap printed as a
 *  total reads as a complete history, which is how a guest gets quoted twice
 *  for the same dates. */
export function quotesItem({ quotes, canPrice, guestEmail }: { quotes: CardQuoteBlock; canPrice: boolean; guestEmail: string }): AlsoItem {
  const first = quotes.quotes[0];
  return {
    key: 'quotes',
    // The TRUE count, never the length of the truncated list: a cap
    // printed as a total reads as a complete history, which is how a guest
    // gets quoted twice for the same dates.
    line: (
      <>
        {quotes.total === 1 ? 'Quote on file' : `${quotes.total} quotes on file`}: {first.status} · {first.property_internal_name || 'Quote'} ·{' '}
        {formatStayDates(first.check_in, first.check_out) || `${first.check_in} to ${first.check_out}`} · {fmtCents(first.total_cents)}
      </>
    ),
    attention: first.leg_due === 'balance',
    status: first.leg_due === 'balance' ? 'Balance due' : undefined,
    body: (
      <div style={{ borderLeft: `3px solid ${QUOTE_TONE}`, paddingLeft: 12 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
          {quotes.quotes.map((q) => (
            <QuoteRow key={q.id} href={`/guests/quotes/${q.id}`} linked={canPrice}>
              <span style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap', fontSize: 13, lineHeight: 1.5 }}>
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: '0.12em',
                    textTransform: 'uppercase',
                    border: `1px solid ${quoteStatusTone(q.status)}`,
                    color: quoteStatusTone(q.status),
                    padding: '1px 6px',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {q.status}
                </span>
                <span className="font-serif" style={{ fontSize: 14 }}>{q.property_internal_name || 'Quote'}</span>
                <span style={{ color: 'var(--ink-3)' }}>
                  {formatStayDates(q.check_in, q.check_out) || `${q.check_in} to ${q.check_out}`}
                  {q.nights > 0 ? ` · ${q.nights}n` : ''}
                </span>
                <span className="tabular-nums" style={{ marginLeft: 'auto', fontWeight: 600 }}>{fmtCents(q.total_cents)}</span>
              </span>
              {/* An accepted split plan means the DEPOSIT landed, not that
                  the stay is paid for. */}
              {q.leg_due === 'balance' && (
                <span style={{ display: 'block', marginTop: 2, fontSize: 12, color: 'var(--signal)' }}>
                  Balance {fmtCents(q.amount_due_cents)} still due{q.balance_due_on ? ` by ${q.balance_due_on}` : ''}
                </span>
              )}
              {/* A quote re-addressed in the composer keeps its source_ref:
                  say whose it is rather than letting the header imply it. */}
              {q.guest_email && q.guest_email !== (guestEmail || '').trim().toLowerCase() && (
                <span style={{ display: 'block', marginTop: 2, fontSize: 12, color: 'var(--ink-4)' }}>Addressed to {q.guest_email}</span>
              )}
            </QuoteRow>
          ))}
        </div>
        <p style={{ marginTop: 9, fontSize: 12, color: 'var(--ink-4)', lineHeight: 1.5 }}>
          {quotes.quotes.some((q) => q.status === 'draft')
            ? canPrice
              ? 'A draft is not with the guest yet. Open it to send.'
              : 'A draft is not with the guest yet. Ask Ryan to send it.'
            : canPrice
              ? 'Open one to see its terms and what it is waiting on.'
              : 'Ryan can open one for its terms and what it is waiting on.'}
          {canPrice && quotes.total > quotes.quotes.length && (
            <>
              {' '}
              <Link href="/guests/quotes" style={{ color: 'var(--ink-3)' }}>See all {quotes.total} in Quotes</Link>.
            </>
          )}
        </p>
      </div>
    ),
  };
}

/** The add-on charge riding on this card (a pet fee, a late checkout): the
 *  link always travels by text, because OTA platforms block links in-thread. */
export function addonItem({
  addon,
  channel,
  smsPossible: addonSmsPossible,
  send: sendAddonSms,
  setSend: setSendAddonSms,
  linkCopied,
  onCopy: copyAddonLink,
}: {
  addon: AddonCharge;
  channel: string;
  smsPossible: boolean;
  send: boolean;
  setSend: (v: boolean) => void;
  linkCopied: boolean;
  onCopy: () => void;
}): AlsoItem {
  const amount = `$${addon.amount_usd.toFixed(addon.amount_usd % 1 === 0 ? 0 : 2)}`;
  return {
    key: 'addon',
    line: addonSmsPossible
      ? sendAddonSms
        ? `Texts the ${addon.label} payment link (${amount}) to ${addon.guest_phone}`
        : `Does not text the ${addon.label} payment link (${amount})`
      : addon.payment_link_url
        ? `${addon.label} payment link (${amount}): no phone on file, so send it by hand`
        : `${addon.label} (${amount}): no payment link to send`,
    status: addon.paid_at ? 'Paid' : addonSmsPossible ? (sendAddonSms ? 'Text when approved' : 'Skip') : addon.payment_link_url ? 'By hand' : 'Needs a link',
    attention: !addon.paid_at && !addonSmsPossible,
    body: (
      <div style={{ borderLeft: `3px solid ${ADDON_TONE}`, paddingLeft: 12 }}>
        {addonSmsPossible ? (
          <>
            <p style={{ margin: 0, fontSize: 13, lineHeight: 1.55, color: 'var(--ink-2)', whiteSpace: 'pre-wrap' }}>{addon.sms_body}</p>
            <label style={{ marginTop: 10, display: 'flex', alignItems: 'center', gap: 7, fontSize: 12, color: 'var(--ink-2)', cursor: 'pointer' }}>
              <input type="checkbox" checked={sendAddonSms} onChange={(e) => setSendAddonSms(e.target.checked)} style={{ accentColor: ADDON_TONE }} />
              Text this payment link to {addon.guest_phone} when I approve
              <span style={{ color: 'var(--ink-4)' }}>(links can&apos;t go through {channel || 'the platform'})</span>
            </label>
          </>
        ) : addon.payment_link_url ? (
          <div style={{ fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.55 }}>
            Copy it and deliver it by hand:
            <div style={{ marginTop: 6, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <code style={{ fontSize: 12, wordBreak: 'break-all' }}>{addon.payment_link_url}</code>
              <SecondaryButton onClick={copyAddonLink}>{linkCopied ? 'Copied' : 'Copy link'}</SecondaryButton>
            </div>
          </div>
        ) : (
          <p style={{ margin: 0, fontSize: 13, color: 'var(--signal)', lineHeight: 1.55 }}>
            {addon.link_error === 'no_key' || addon.link_error === 'stripe_permission'
              ? 'Payment links are not set up for this home. Ask Ryan. Approve sends the reply only; make the link by hand.'
              : `Payment link creation failed (${addon.link_error || 'unknown error'}). Approve sends the reply only; make the link by hand.`}
          </p>
        )}
      </div>
    ),
  };
}

/** A note to a teammate this reply commits us to (Rosa plans the turnover
 *  around an 11 AM checkout). It files as a card in their queue for a second
 *  approve; on a cleaner note the operator can choose to send it after the
 *  reply instead. */
export function handoffItem({
  id,
  handoff,
  role,
  handoffStatus,
  cleanerAction,
  setCleanerChoice,
  createHandoff,
  setCreateHandoff,
}: {
  id: string;
  handoff: TeamHandoff;
  role: HelmRole;
  handoffStatus: string;
  cleanerAction: 'skip' | 'draft' | 'send';
  setCleanerChoice: (c: { action: 'skip' | 'draft' | 'send'; token: string }) => void;
  createHandoff: boolean;
  setCreateHandoff: (v: boolean) => void;
}): AlsoItem {
  const target = handoff.target_name || HANDOFF_LABEL[handoff.audience] || 'teammate';
  return {
    key: 'handoff',
    line: `Note to ${target}${handoff.urgency === 'today' ? ' · today' : ''}${handoff.reason ? `: ${handoff.reason}` : ''}`,
    status: handoffStatus,
    attention: !!handoff.create_error || (handoff.audience === 'cleaner' && cleanerAction === 'send'),
    body: (
      <div style={{ borderLeft: `3px solid ${HANDOFF_TONE}`, paddingLeft: 12 }}>
        <p style={{ margin: 0, fontSize: 13, lineHeight: 1.55, color: 'var(--ink-1)', whiteSpace: 'pre-wrap' }}>{handoff.preview}</p>
        {handoff.preview_english && (
          <p style={{ margin: '6px 0 0', fontSize: 12, lineHeight: 1.5, color: 'var(--ink-3)', fontStyle: 'italic', whiteSpace: 'pre-wrap' }}>
            {handoff.preview_english}
          </p>
        )}
        {handoff.audience === 'cleaner' ? (
          handoff.note_status === 'approved' ? (
            <p style={{ fontSize: 12 }}>Sent to {handoff.target_name || 'the cleaner'}.</p>
          ) : ['sending', 'scheduled', 'rejected', 'superseded'].includes(handoff.note_status || '') ? (
            <p style={{ fontSize: 12 }}>
              This note is {handoff.note_status}. Review it in the <Link href="/messaging/team?audience=cleaners">Team inbox</Link>.
            </p>
          ) : (
            <>
              <fieldset style={{ border: 0, padding: 0, margin: '10px 0 0', display: 'flex', flexWrap: 'wrap', gap: 18, fontSize: 12 }}>
                <legend className="sr-only">Note to {handoff.target_name || 'the cleaner'}</legend>
                {(['skip', 'draft', 'send'] as const).map((action) => (
                  <label key={action} style={{ cursor: 'pointer' }}>
                    <input
                      type="radio"
                      name={`cleaner-${id}`}
                      checked={cleanerAction === action}
                      disabled={action === 'send' && (!handoff.preview_token || !!handoff.create_error)}
                      onChange={() => setCleanerChoice({ action, token: action === 'send' ? handoff.preview_token || '' : '' })}
                      style={{ accentColor: HANDOFF_TONE }}
                    />{' '}
                    {action === 'skip' ? 'Skip note' : action === 'draft' ? 'Draft for approval' : `Send to ${handoff.target_name || 'cleaner'}`}
                  </label>
                ))}
              </fieldset>
              <p style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--ink-3)' }}>
                {cleanerAction === 'send'
                  ? 'Sends the note shown above after your guest reply sends.'
                  : cleanerAction === 'skip'
                    ? 'No cleaner note will be sent or kept as a draft when you approve.'
                    : 'Keeps this as a draft in Cleaner messaging when you approve. Nothing sends to the cleaner.'}
              </p>
            </>
          )
        ) : (
          // Same row either way, so the eye learns one shape: live, it is a
          // decision; filed, it is a receipt for one already made.
          <label style={{ marginTop: 10, display: 'flex', alignItems: 'flex-start', gap: 7, fontSize: 12, color: 'var(--ink-2)', cursor: handoff.filed ? 'default' : 'pointer' }}>
            <input
              type="checkbox"
              checked={handoff.filed ? true : createHandoff}
              disabled={handoff.filed}
              onChange={(e) => setCreateHandoff(e.target.checked)}
              style={{ accentColor: HANDOFF_TONE, marginTop: 2 }}
            />
            <span>
              {handoff.filed ? (
                <>
                  Drafted for {handoff.target_name || 'them'}
                  <span style={{ color: 'var(--ink-4)' }}>
                    {' '}(waiting on{' '}
                    {roleMayOpen(role, HANDOFF_HREF[handoff.audience] ?? '/messaging') ? (
                      <a href={HANDOFF_HREF[handoff.audience] ?? '/messaging'} style={{ color: 'var(--ink-3)' }}>
                        {HANDOFF_SURFACE[handoff.audience] ?? 'their queue'}
                      </a>
                    ) : (
                      HANDOFF_SURFACE[handoff.audience] ?? 'their queue'
                    )}{' '}
                    for your approval, nothing has sent)
                  </span>
                </>
              ) : (
                <>
                  Draft this for {handoff.target_name || 'them'} when I approve
                  <span style={{ color: 'var(--ink-4)' }}>
                    {' '}(it waits on {HANDOFF_SURFACE[handoff.audience] ?? 'their queue'} for your approval, nothing sends now)
                  </span>
                </>
              )}
            </span>
          </label>
        )}
        {handoff.create_error && (
          <p style={{ marginTop: 8, fontSize: 12, color: 'var(--signal)' }}>
            {handoff.audience === 'cleaner' ? (
              <>
                Note needs review: {handoff.create_error} <Link href="/messaging/team?audience=cleaners">Open the Team inbox</Link>.
              </>
            ) : (
              <>Filing this last time failed ({handoff.create_error}). Approving tries again.</>
            )}
          </p>
        )}
      </div>
    ),
  };
}
