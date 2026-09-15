import Link from 'next/link';
import { notFound } from 'next/navigation';
import { HelmMasthead } from '@/components/HelmMasthead';
import { MarketingTabs } from '@/components/MarketingTabs';
import { SubmitButton } from '@/components/SubmitButton';
import { getQuoteById, quoteGuestUrl } from '@/lib/sca-quotes';
import {
  SCA_QUOTE_STATUS_LABEL,
  deriveQuoteStatus,
  displayTitle,
  fmtCents,
  fmtLongDate,
  fmtShortDate,
  type ScaQuoteStatus,
} from '@/lib/sca-quotes-types';
import {
  duplicateQuote,
  extendQuoteExpiry,
  markBalancePaidManually,
  markQuoteAcceptedManually,
  markQuoteSent,
  sendBalanceReminder,
  sendQuote,
  unvoidQuote,
  voidQuote,
} from '../actions';
import { CopyTextButton } from './CopyTextButton';

export const dynamic = 'force-dynamic';

/**
 * Quote detail: the operator's control surface for one Stay Cape Ann
 * custom quote. The guest link, the send rails, what the guest has done
 * (viewed, accepted, paid), the balance leg of a split plan, and the
 * manual escape hatches for when staycapeann.com could not finish the
 * job. The guest-facing page itself lives at staycapeann.com/quote/<token>.
 */
export default async function QuoteDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const q = await getQuoteById(id);
  if (!q) notFound();
  const status = deriveQuoteStatus(q);
  const guestUrl = quoteGuestUrl(q.token);
  const editable = status !== 'accepted' && status !== 'voided';
  const sendable = status !== 'accepted' && status !== 'voided' && status !== 'expired';
  const guestName = `${q.guest_first_name} ${q.guest_last_name}`.trim();
  // edited_at moves only on a composer save; updated_at also moves on every
  // bridge event (a repeat view), which is why it is not the comparison.
  const editedSinceSend = !!q.last_sent_at && !!q.edited_at && Date.parse(q.edited_at) > Date.parse(q.last_sent_at);
  const guestyMismatch =
    q.guesty_total_cents != null && Math.abs(q.guesty_total_cents - q.total_cents) > 100 ? q.guesty_total_cents : null;
  const nightly = q.nightly_cents ?? (q.nights > 0 ? Math.round(q.accommodation_cents / q.nights) : 0);
  const extrasTotal = q.extra_lines.reduce((s, l) => s + l.cents, 0);

  return (
    <div className="min-h-screen flex flex-col" style={{ background: 'var(--paper)', color: 'var(--ink)' }}>
      <HelmMasthead />
      <MarketingTabs current="guests" />

      {/* Header */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ paddingTop: 56, paddingBottom: 24, width: '100%' }}>
        <div className="eyebrow" style={{ marginBottom: 14 }}>
          <Link href="/guests/quotes" style={{ color: 'var(--ink-3)', textDecoration: 'none' }}>
            ← Quotes
          </Link>
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, flexWrap: 'wrap' }}>
          <h1
            className="font-serif"
            style={{ fontSize: 36, lineHeight: 1.05, fontWeight: 300, letterSpacing: '-0.02em', color: 'var(--ink)', margin: 0 }}
          >
            {displayTitle(q.property_title)}
          </h1>
          <StatusChip status={status} />
          {q.property_internal_name && <span style={{ fontSize: 13, color: 'var(--ink-4)' }}>{q.property_internal_name}</span>}
        </div>
        <p style={{ marginTop: 8, fontSize: 14, color: 'var(--ink-3)' }}>
          {guestName || 'No guest name yet'}
          {q.guest_email ? ` · ${q.guest_email}` : ''}
          {q.guest_phone ? ` · ${q.guest_phone}` : ''}
          {q.source_kind ? ` · from ${q.source_kind}` : ''}
        </p>
      </section>

      {/* Meta strip */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 28 }}>
        <div
          style={{
            borderTop: '1px solid var(--ink)',
            borderBottom: '1px solid var(--ink)',
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
          }}
        >
          <Field label="Stay" value={`${fmtShortDate(q.check_in)} to ${fmtShortDate(q.check_out)} · ${q.nights} night${q.nights === 1 ? '' : 's'}`} />
          <Field label="Guests" value={String(q.guests)} />
          <Field label="Total" value={fmtCents(q.total_cents, q.currency)} />
          <Field
            label="Plan"
            value={
              q.payment_plan === 'split' && q.deposit_cents != null && q.balance_cents != null
                ? `Deposit ${fmtCents(q.deposit_cents, q.currency)} now, ${fmtCents(q.balance_cents, q.currency)} by ${q.balance_due_on ? fmtShortDate(q.balance_due_on) : 'TBD'}`
                : 'Pay in full'
            }
            last
          />
        </div>
      </section>

      {/* Guest link */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 36 }}>
        <div className="eyebrow" style={{ marginBottom: 12 }}>Guest link</div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <CopyTextButton text={guestUrl} />
          <a href={guestUrl} target="_blank" rel="noreferrer" style={linkBtnStyle}>
            Open guest page ↗
          </a>
          {editable && (
            <Link href={`/guests/quotes/${q.id}/edit`} style={linkBtnStyle}>
              Edit
            </Link>
          )}
          <form action={duplicateQuote}>
            <input type="hidden" name="id" value={q.id} />
            <SubmitButton label="Duplicate" busyLabel="Duplicating…" style={actionGhost} spinnerTone="ink" />
          </form>
        </div>
        <p style={{ marginTop: 12, fontSize: 12, color: 'var(--ink-4)', maxWidth: 640, lineHeight: 1.55 }}>
          <span style={{ fontFamily: 'var(--font-mono), monospace', fontSize: 11 }}>{guestUrl}</span>
          . Anyone with the link can accept and pay, so share it only with the guest.
          {status === 'draft' ? ' The page reads as not found until the quote is sent or marked as sent.' : ''}
        </p>
      </section>

      {/* Price breakdown */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 36 }}>
        <div className="eyebrow" style={{ marginBottom: 12 }}>Price</div>
        <div style={{ maxWidth: 480, borderTop: '1px solid var(--rule)' }}>
          <PriceRow k={`${fmtCents(nightly, q.currency)} x ${q.nights} night${q.nights === 1 ? '' : 's'}`} v={fmtCents(q.accommodation_cents, q.currency)} />
          {q.discount_cents > 0 && <PriceRow k={q.discount_label || 'Discount'} v={`-${fmtCents(q.discount_cents, q.currency)}`} tone="signal" />}
          {q.cleaning_cents > 0 && <PriceRow k="Cleaning fee" v={fmtCents(q.cleaning_cents, q.currency)} />}
          {q.extra_lines.map((l, i) => (
            <PriceRow key={i} k={l.label} v={fmtCents(l.cents, q.currency)} />
          ))}
          {q.tax_exempt ? (
            <PriceRow k="Tax exempt" v="" muted />
          ) : (
            <PriceRow k={`Lodging tax (${Math.round(q.tax_rate * 1000) / 10}%)`} v={fmtCents(q.tax_cents, q.currency)} />
          )}
          <PriceRow k="Total" v={fmtCents(q.total_cents, q.currency)} bold />
          {q.payment_plan === 'split' && q.deposit_cents != null && q.balance_cents != null && (
            <>
              <PriceRow k="Deposit at acceptance" v={fmtCents(q.deposit_cents, q.currency)} />
              <PriceRow k={`Balance by ${q.balance_due_on ? fmtLongDate(q.balance_due_on) : 'TBD'}`} v={fmtCents(q.balance_cents, q.currency)} />
            </>
          )}
        </div>
        {q.reference_quote && q.reference_quote.total > 0 && (
          <p style={{ marginTop: 12, fontSize: 12, color: 'var(--ink-4)', maxWidth: 640, lineHeight: 1.55 }}>
            Guesty would have charged {fmtDollars(q.reference_quote.total)} for these dates
            {q.reference_quote.estimated ? ' (estimated)' : ''}
            {q.reference_quote.achieved_nightly != null
              ? `; last year this window achieved ${fmtDollars(q.reference_quote.achieved_nightly)}/night over ${q.reference_quote.achieved_sample_nights ?? 0} nights`
              : ''}
            .{extrasTotal > 0 || q.discount_cents > 0 ? ' Guesty receives accommodation minus discount plus extras as the fare; cleaning rides separately.' : ''}
          </p>
        )}
        {(q.override_calendar || q.override_terms) && (
          <p style={{ marginTop: 10, fontSize: 12, color: 'var(--signal)', maxWidth: 640, lineHeight: 1.55 }}>
            Overrides on: {[q.override_calendar ? 'books closed or unreleased nights' : null, q.override_terms ? 'ignores the minimum-night rule' : null].filter(Boolean).join('; ')}.
          </p>
        )}
      </section>

      {/* Workflow */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 36 }}>
        <div className="eyebrow" style={{ marginBottom: 12 }}>Workflow</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 720 }}>
          {/* 1. Send */}
          <WorkflowRow
            done={!!q.sent_at}
            label={
              q.sent_at
                ? `Sent ${fmtStamp(q.sent_at)}${q.last_sent_at && q.last_sent_at !== q.sent_at ? `, last ${fmtStamp(q.last_sent_at)}` : ''}${q.sent_via.length ? ` via ${q.sent_via.join(', ')}` : ''}`
                : 'Send the quote to the guest'
            }
          >
            {editedSinceSend && sendable && (
              <span style={{ fontSize: 12, color: 'var(--signal)', fontWeight: 600 }}>Edited since the last send. Resend so the guest sees the new terms.</span>
            )}
            {status === 'expired' && (
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12, color: 'var(--ink-4)' }}>
                  Expired {q.expires_at ? fmtStamp(q.expires_at) : ''}. Extend it to send again.
                </span>
                <form action={extendQuoteExpiry} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input type="hidden" name="id" value={q.id} />
                  <input type="number" name="days" min={1} max={90} defaultValue={7} style={{ ...smallInput, width: 64 }} aria-label="Days" />
                  <SubmitButton label="Extend" busyLabel="Extending…" style={actionGhost} spinnerTone="ink" />
                </form>
              </div>
            )}
            {sendable && (
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
                <form action={sendQuote}>
                  <input type="hidden" name="id" value={q.id} />
                  <input type="hidden" name="via" value="email" />
                  <SubmitButton
                    label={q.sent_via.includes('email') ? 'Resend email' : 'Email quote'}
                    busyLabel="Sending…"
                    style={q.guest_email ? actionPrimary : { ...actionPrimary, opacity: 0.45 }}
                    disabled={!q.guest_email}
                  />
                </form>
                {q.guest_phone && (
                  <form action={sendQuote}>
                    <input type="hidden" name="id" value={q.id} />
                    <input type="hidden" name="via" value="sms" />
                    <SubmitButton label="Text quote" busyLabel="Sending…" style={actionGhost} spinnerTone="ink" />
                  </form>
                )}
                {q.guest_email && q.guest_phone && (
                  <form action={sendQuote}>
                    <input type="hidden" name="id" value={q.id} />
                    <input type="hidden" name="via" value="both" />
                    <SubmitButton label="Email + text" busyLabel="Sending…" style={actionGhost} spinnerTone="ink" />
                  </form>
                )}
                {!q.sent_at && (
                  <form action={markQuoteSent}>
                    <input type="hidden" name="id" value={q.id} />
                    <SubmitButton label="Mark as sent" busyLabel="Marking…" style={actionGhost} spinnerTone="ink" />
                  </form>
                )}
                {!q.guest_email && (
                  <span style={{ fontSize: 12, color: 'var(--ink-4)' }}>Add a guest email (Edit) to send from Helm, or copy the link and share it by hand.</span>
                )}
              </div>
            )}
            {q.expires_at && status !== 'expired' && status !== 'accepted' && status !== 'voided' && (
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={{ fontSize: 12, color: 'var(--ink-4)' }}>Good through {fmtStamp(q.expires_at)}.</span>
                <form action={extendQuoteExpiry} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input type="hidden" name="id" value={q.id} />
                  <input type="number" name="days" min={1} max={90} defaultValue={7} style={{ ...smallInput, width: 64 }} aria-label="Days" />
                  <SubmitButton label="Extend" busyLabel="Extending…" style={actionGhost} spinnerTone="ink" />
                </form>
              </div>
            )}
          </WorkflowRow>

          {/* 2. Guest reviews */}
          <WorkflowRow
            done={!!q.viewed_at}
            label={
              q.viewed_at
                ? `Opened ${fmtStamp(q.viewed_at)}${q.view_count > 1 ? `, ${q.view_count} views` : ''}`
                : status === 'declined'
                  ? `Declined ${q.declined_at ? fmtStamp(q.declined_at) : ''}${q.decline_reason ? `: ${q.decline_reason}` : ''}`
                  : 'Guest opens the link, reviews the price and the terms'
            }
          >
            {status === 'declined' && q.viewed_at && q.declined_at && (
              <span style={{ fontSize: 12, color: 'var(--signal)' }}>
                Declined {fmtStamp(q.declined_at)}{q.decline_reason ? `: ${q.decline_reason}` : ''}. Duplicate to offer new terms.
              </span>
            )}
          </WorkflowRow>

          {/* 3. Accepted */}
          <WorkflowRow
            done={!!q.accepted_at}
            label={
              q.accepted_at
                ? `Accepted ${fmtStamp(q.accepted_at)}${q.guesty_confirmation_code ? `, confirmation ${q.guesty_confirmation_code}` : ''}`
                : 'Guest accepts the rental agreement and pays on staycapeann.com'
            }
          >
            {q.accepted_at && (
              <div style={{ fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.7, fontFamily: 'var(--font-mono), monospace' }}>
                {q.guesty_reservation_id && <div>reservation: {q.guesty_reservation_id}</div>}
                {q.stripe_payment_intent_id && <div>payment_intent: {q.stripe_payment_intent_id}</div>}
                {q.amount_paid_cents != null && <div>charged: {fmtCents(q.amount_paid_cents, q.currency)}</div>}
                {q.stripe_account_key && <div>stripe_account: {q.stripe_account_key}</div>}
                {q.guesty_total_cents != null && <div>guesty_total: {fmtCents(q.guesty_total_cents, q.currency)}</div>}
              </div>
            )}
            {guestyMismatch != null && (
              <div style={signalBanner}>
                Guesty computed {fmtCents(guestyMismatch, q.currency)} for this reservation; the guest paid {fmtCents(q.total_cents, q.currency)}. Check the
                reservation&apos;s taxes in Guesty.
              </div>
            )}
            {q.accept_error && !q.accepted_at && (
              <div style={signalBanner}>
                <div style={{ fontWeight: 600, marginBottom: 4 }}>
                  The guest&apos;s last attempt failed{q.accept_error_at ? ` ${fmtStamp(q.accept_error_at)}` : ''}.
                </div>
                <div style={{ fontFamily: 'var(--font-mono), monospace', fontSize: 11 }}>{q.accept_error}</div>
                <div style={{ marginTop: 6, fontWeight: 400 }}>
                  Check Stripe and Guesty. If the reservation exists, mark it accepted below; otherwise ask the guest to try again.
                </div>
              </div>
            )}
            {(q.accept_error || status === 'sent') && !q.accepted_at && (
              <form action={markQuoteAcceptedManually} style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <input type="hidden" name="id" value={q.id} />
                <label style={smallLabel}>
                  Confirmation code
                  <input type="text" name="confirmation_code" required placeholder="ABC123XYZ" style={{ ...smallInput, width: 150 }} />
                </label>
                <label style={smallLabel}>
                  Reservation id
                  <input type="text" name="reservation_id" placeholder="optional" style={{ ...smallInput, width: 220 }} />
                </label>
                <label style={smallLabel}>
                  Note
                  <input type="text" name="note" placeholder="optional" style={{ ...smallInput, width: 220 }} />
                </label>
                <SubmitButton label="Mark accepted manually" busyLabel="Marking…" style={actionGhost} spinnerTone="ink" />
              </form>
            )}
          </WorkflowRow>

          {/* 4. Balance (split only) */}
          {q.payment_plan === 'split' && (
            <WorkflowRow
              done={!!q.balance_paid_at}
              label={
                q.balance_paid_at
                  ? `Balance paid ${fmtStamp(q.balance_paid_at)}`
                  : `Balance of ${fmtCents(q.balance_cents ?? 0, q.currency)} due by ${q.balance_due_on ? fmtLongDate(q.balance_due_on) : 'TBD'}`
              }
            >
              {q.balance_paid_at && q.balance_payment_intent_id && (
                <div style={{ fontSize: 12, color: 'var(--ink-3)', fontFamily: 'var(--font-mono), monospace' }}>
                  payment_intent: {q.balance_payment_intent_id}
                  {q.balance_paid_cents != null ? ` (charged ${fmtCents(q.balance_paid_cents, q.currency)})` : ''}
                </div>
              )}
              {q.accepted_at && !q.balance_paid_at && status === 'accepted' && (
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
                  <form action={sendBalanceReminder}>
                    <input type="hidden" name="id" value={q.id} />
                    <SubmitButton
                      label={q.balance_reminder_sent_at ? `Remind again (last ${fmtStamp(q.balance_reminder_sent_at)})` : 'Send balance reminder'}
                      busyLabel="Sending…"
                      style={actionPrimary}
                      disabled={!q.guest_email && !q.guest_phone}
                    />
                  </form>
                  <form action={markBalancePaidManually} style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                    <input type="hidden" name="id" value={q.id} />
                    <label style={smallLabel}>
                      Note
                      <input type="text" name="note" placeholder="paid by check, etc." style={{ ...smallInput, width: 200 }} />
                    </label>
                    <SubmitButton label="Mark balance paid" busyLabel="Marking…" style={actionGhost} spinnerTone="ink" />
                  </form>
                </div>
              )}
              {!q.accepted_at && (
                <span style={{ fontSize: 12, color: 'var(--ink-4)' }}>The guest pays the balance on the same page once the deposit is in.</span>
              )}
            </WorkflowRow>
          )}
        </div>
      </section>

      {/* Message + terms the guest sees */}
      {(q.message || q.cancellation_terms) && (
        <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 36 }}>
          {q.message && (
            <>
              <div className="eyebrow" style={{ marginBottom: 10 }}>Note to the guest</div>
              <p style={{ fontSize: 13, color: 'var(--ink)', maxWidth: 640, lineHeight: 1.6, whiteSpace: 'pre-wrap', marginBottom: 20 }}>{q.message}</p>
            </>
          )}
          {q.cancellation_terms && (
            <>
              <div className="eyebrow" style={{ marginBottom: 10 }}>Cancellation terms</div>
              <p style={{ fontSize: 13, color: 'var(--ink-3)', maxWidth: 640, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{q.cancellation_terms}</p>
            </>
          )}
        </section>
      )}

      {/* Danger zone */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 48 }}>
        <div className="eyebrow" style={{ marginBottom: 12 }}>Danger zone</div>
        {q.voided_at ? (
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, color: 'var(--signal)', fontWeight: 600 }}>
              Voided {fmtStamp(q.voided_at)}. The guest link is dead.
            </span>
            {!q.accepted_at && (
              <form action={unvoidQuote}>
                <input type="hidden" name="id" value={q.id} />
                <SubmitButton label="Restore" busyLabel="Restoring…" style={actionGhost} spinnerTone="ink" />
              </form>
            )}
          </div>
        ) : status === 'accepted' ? (
          <span style={{ fontSize: 12, color: 'var(--ink-4)', maxWidth: 560, lineHeight: 1.5, display: 'block' }}>
            An accepted quote is the record of what the guest paid, so it cannot be voided. Cancel the reservation in Guesty and refund in Stripe if the stay is off.
          </span>
        ) : (
          <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <form action={voidQuote}>
              <input type="hidden" name="id" value={q.id} />
              <SubmitButton label="Void quote" busyLabel="Voiding…" style={actionDanger} spinnerTone="ink" />
            </form>
            <span style={{ fontSize: 12, color: 'var(--ink-4)', maxWidth: 480, lineHeight: 1.5 }}>
              Kills the guest link. Duplicate first if you want to offer new terms.
            </span>
          </div>
        )}
      </section>

      {/* Audit + notes */}
      <section className="max-w-[1100px] mx-auto px-10" style={{ width: '100%', paddingBottom: 96 }}>
        <div className="eyebrow" style={{ marginBottom: 12 }}>Audit</div>
        <div style={{ fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.8, fontFamily: 'var(--font-mono), monospace' }}>
          <div>id: {q.id}</div>
          <div>status: {q.status}{status !== q.status ? ` (reads as ${status})` : ''}</div>
          <div>created_at: {q.created_at}{q.created_by ? ` by ${q.created_by}` : ''}</div>
          <div>updated_at: {q.updated_at}</div>
          {q.edited_at && <div>edited_at: {q.edited_at}</div>}
          {q.expires_at && <div>expires_at: {q.expires_at}</div>}
          {q.sent_at && <div>sent_at: {q.sent_at}</div>}
          {q.last_sent_at && <div>last_sent_at: {q.last_sent_at}</div>}
          {q.viewed_at && <div>viewed_at: {q.viewed_at} (views: {q.view_count})</div>}
          {q.accepted_at && <div>accepted_at: {q.accepted_at}</div>}
          {q.accept_ip && <div>accept_ip: {q.accept_ip}</div>}
          {q.agreement_version && <div>agreement_version: {q.agreement_version}</div>}
          {q.agreement_accepted_at && <div>agreement_accepted_at: {q.agreement_accepted_at}</div>}
          {q.deposit_paid_at && <div>deposit_paid_at: {q.deposit_paid_at}</div>}
          {q.balance_paid_at && <div>balance_paid_at: {q.balance_paid_at}</div>}
          {q.balance_reminder_sent_at && <div>balance_reminder_sent_at: {q.balance_reminder_sent_at}</div>}
          {q.declined_at && <div>declined_at: {q.declined_at}</div>}
          {q.voided_at && <div>voided_at: {q.voided_at}</div>}
          {q.accept_error_at && <div>accept_error_at: {q.accept_error_at}</div>}
          <div>terms_version: {q.terms_version ?? '(none)'}</div>
          <div>guesty_listing_id: {q.guesty_listing_id}</div>
          {q.source_ref && <div>source_ref: {q.source_ref}</div>}
        </div>
        {q.internal_notes && (
          <>
            <div className="eyebrow" style={{ margin: '24px 0 10px' }}>Internal notes</div>
            <p style={{ fontSize: 13, color: 'var(--ink)', maxWidth: 640, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{q.internal_notes}</p>
          </>
        )}
      </section>
    </div>
  );
}

// ─── Bits ───────────────────────────────────────────────────────────────────

const actionBtnBase: React.CSSProperties = {
  font: 'inherit',
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: '.06em',
  padding: '8px 14px',
};
const actionPrimary: React.CSSProperties = { ...actionBtnBase, color: 'var(--paper)', background: 'var(--ink)', border: '1px solid var(--ink)' };
const actionGhost: React.CSSProperties = { ...actionBtnBase, color: 'var(--ink)', background: 'transparent', border: '1px solid var(--ink)' };
const actionDanger: React.CSSProperties = { ...actionBtnBase, color: 'var(--signal)', background: 'transparent', border: '1px solid var(--signal)' };

const linkBtnStyle: React.CSSProperties = {
  display: 'inline-block',
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: '.06em',
  color: 'var(--ink)',
  border: '1px solid var(--ink)',
  padding: '8px 14px',
  textDecoration: 'none',
};

const smallInput: React.CSSProperties = {
  font: 'inherit',
  fontSize: 12,
  color: 'var(--ink)',
  background: 'var(--paper)',
  border: '1px solid var(--rule)',
  padding: '7px 8px',
  outline: 'none',
  boxSizing: 'border-box',
};

const smallLabel: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 4,
  fontSize: 10,
  letterSpacing: '.08em',
  textTransform: 'uppercase',
  fontWeight: 600,
  color: 'var(--ink-3)',
};

const signalBanner: React.CSSProperties = {
  border: '1px solid var(--signal)',
  color: 'var(--signal)',
  padding: '10px 12px',
  fontSize: 12,
  lineHeight: 1.5,
  maxWidth: 640,
};

function StatusChip({ status }: { status: ScaQuoteStatus }) {
  const tone =
    status === 'accepted' ? { color: '#1d6b46', border: '#1d6b46' } :
    status === 'sent' ? { color: 'var(--ink)', border: 'var(--ink)' } :
    status === 'declined' ? { color: 'var(--signal)', border: 'var(--signal)' } :
    status === 'voided' || status === 'expired' ? { color: 'var(--ink-4)', border: 'var(--ink-4)' } :
    { color: 'var(--ink-3)', border: 'var(--rule)' };
  return (
    <span
      style={{
        fontSize: 11,
        letterSpacing: '.1em',
        textTransform: 'uppercase',
        fontWeight: 700,
        color: tone.color,
        border: `1px solid ${tone.border}`,
        padding: '4px 10px',
      }}
    >
      {SCA_QUOTE_STATUS_LABEL[status]}
    </span>
  );
}

function WorkflowRow({ done, label, children }: { done: boolean; label: string; children?: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start' }}>
      <span
        aria-hidden="true"
        style={{
          width: 18,
          height: 18,
          borderRadius: '50%',
          flexShrink: 0,
          marginTop: 1,
          border: `2px solid ${done ? '#1d6b46' : 'var(--rule)'}`,
          background: done ? '#1d6b46' : 'transparent',
          color: 'var(--paper)',
          fontSize: 11,
          lineHeight: '14px',
          textAlign: 'center',
          fontWeight: 700,
        }}
      >
        {done ? '✓' : ''}
      </span>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, flex: 1 }}>
        <span style={{ fontSize: 13, color: done ? 'var(--ink)' : 'var(--ink-3)', lineHeight: 1.5 }}>{label}</span>
        {children}
      </div>
    </div>
  );
}

function Field({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <div style={{ padding: '14px 16px 14px 0', borderRight: last ? 'none' : '1px solid var(--rule)' }}>
      <div className="eyebrow" style={{ fontSize: 10, marginBottom: 6 }}>{label}</div>
      <div style={{ fontSize: 14, color: 'var(--ink)' }}>{value}</div>
    </div>
  );
}

function PriceRow({ k, v, bold, muted, tone }: { k: string; v: string; bold?: boolean; muted?: boolean; tone?: 'signal' }) {
  const color = tone === 'signal' ? 'var(--signal)' : muted ? 'var(--ink-4)' : 'var(--ink)';
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, padding: '9px 0', borderBottom: '1px solid var(--rule)', fontSize: 13, color }}>
      <span style={{ fontWeight: bold ? 600 : 400 }}>{k}</span>
      <span className="tabular-nums" style={{ fontWeight: bold ? 600 : 400 }}>{v}</span>
    </div>
  );
}

function fmtDollars(dollars: number): string {
  return fmtCents(Math.round(dollars * 100));
}

function fmtStamp(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'America/New_York',
  });
}
