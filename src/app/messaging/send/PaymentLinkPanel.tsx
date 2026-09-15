'use client';

/**
 * Payment link, proactive: charge the picked guest for something we decided
 * on (late checkout, pet, extra night, replacement cost) without waiting for
 * them to ask. Type what for and how much; the link mints in the home's own
 * Stripe account (same bridge the reactive add-on cards use) and texts to
 * the guest's real phone on the GUESTS line. The text is previewed here and
 * editable, and sends as shown. After that the ledger below and the home
 * feed's Payments cards say whether it was paid.
 *
 * Sits under the composer because it is the other thing "I need to reach
 * this guest" means: a message, or a bill.
 */

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { ConversationSummary } from '@/lib/stay-concierge';
import {
  buildPaymentLinkSms,
  firstName,
  LINK_PLACEHOLDER,
  money,
  prettyPhone,
  toE164,
} from '@/lib/payment-links-text';
import {
  createPaymentLinkAction,
  preparePaymentLinkAction,
  type CreateLinkResult,
  type PreparedLink,
} from './payment-link-actions';
import { CopyLinkButton } from './CopyLinkButton';

const MIN_USD = 1;
const MAX_USD = 2000;

function pct(rate: number): string {
  return `${(rate * 100).toFixed(1).replace(/\.0$/, '')}%`;
}

export function PaymentLinkPanel({ picked }: { picked: ConversationSummary }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [prep, setPrep] = useState<PreparedLink | null>(null);
  const [prepError, setPrepError] = useState<string | null>(null);
  const [loadingPrep, setLoadingPrep] = useState(false);
  const [propertyId, setPropertyId] = useState('');
  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState('');
  const [taxable, setTaxable] = useState(true);
  const [phone, setPhone] = useState('');
  const [sms, setSms] = useState('');
  const [smsTouched, setSmsTouched] = useState(false);
  const [result, setResult] = useState<CreateLinkResult | null>(null);
  const [isPending, startTransition] = useTransition();

  const guestName = picked.guest_full || picked.guest_first || '';
  const guestFirst = picked.guest_first || firstName(guestName);

  const loadPrep = () => {
    if (loadingPrep) return;
    setLoadingPrep(true);
    setPrepError(null);
    preparePaymentLinkAction({
      listingSlug: picked.listing_id,
      reservationId: picked.reservation_id || '',
      propertyName: picked.property_name || '',
    })
      .then((r) => {
        if (!r.ok) {
          setPrepError(r.error);
          return;
        }
        setPrep(r);
        setPropertyId(r.propertyId || '');
        setPhone(r.guestPhone);
      })
      .catch(() => setPrepError('Could not load this stay. Try again.'))
      .finally(() => setLoadingPrep(false));
  };

  const openPanel = () => {
    setOpen(true);
    if (!prep) loadPrep();
  };

  const property = prep?.properties.find((p) => p.id === propertyId) ?? null;
  const rate = taxable && property ? property.taxRate : 0;
  const baseCents = Math.round((parseFloat(amount) || 0) * 100);
  const taxCents = Math.round(baseCents * rate);
  const totalCents = baseCents + taxCents;
  const validAmount = baseCents >= MIN_USD * 100 && baseCents <= MAX_USD * 100;
  const phoneOk = !!toE164(phone);
  const canMint = !!property && property.hasKey && !!label.trim() && validAmount && !isPending;

  // The standard text tracks the fields until she edits it herself; after
  // that her version is what shows (and what sends) until Reset.
  const standardSms = useMemo(
    () =>
      buildPaymentLinkSms({
        guestFirst,
        label: label.trim() || 'charge',
        baseCents,
        taxCents,
        totalCents,
        propertyTitle: property?.title || '',
        url: LINK_PLACEHOLDER,
      }),
    [guestFirst, label, baseCents, taxCents, totalCents, property?.title],
  );
  const smsShown = smsTouched ? sms : standardSms;

  const create = (send: boolean) => {
    if (!canMint || !property) return;
    if (send && !phoneOk) return;
    setResult(null);
    startTransition(async () => {
      const r = await createPaymentLinkAction({
        propertyId: property.id,
        label: label.trim(),
        amountUsd: baseCents / 100,
        taxable,
        guestName,
        guestPhone: send ? toE164(phone) : toE164(phone) || '',
        smsBody: smsTouched ? sms : '',
        send,
        reservationId: picked.reservation_id || '',
        conversationId: picked.conversation_id,
      });
      setResult(r);
      if (r.ok) {
        setLabel('');
        setAmount('');
        setSmsTouched(false);
        // The ledger under the composer re-reads the new row.
        router.refresh();
      }
    });
  };

  return (
    <div style={{ marginTop: 22, borderTop: '1px solid var(--rule)', paddingTop: 14 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, flexWrap: 'wrap' }}>
        <button
          type="button"
          onClick={open ? () => setOpen(false) : openPanel}
          className="eyebrow"
          aria-expanded={open}
          style={{
            color: 'var(--ink)',
            background: 'transparent',
            border: '1px solid var(--rule)',
            padding: '6px 10px',
            cursor: 'pointer',
          }}
        >
          {open ? 'Payment link ▴' : 'Payment link ▾'}
        </button>
        {!open && (
          <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>
            Charge {guestFirst} for a late checkout, a pet, an extra night. The link mints in the
            home&apos;s own Stripe and texts to their phone; the home page tells you when it&apos;s paid.
          </span>
        )}
      </div>

      {open && (
        <div style={{ marginTop: 14 }}>
          {loadingPrep && !prep && (
            <div style={{ fontSize: 13, color: 'var(--ink-4)' }}>Looking up the stay...</div>
          )}
          {prepError && (
            <p role="alert" style={{ fontSize: 12, color: 'var(--signal)', fontWeight: 500, margin: 0 }}>
              {prepError}{' '}
              <button type="button" onClick={loadPrep} style={linkButtonStyle}>
                Retry
              </button>
            </p>
          )}

          {prep && (
            <>
              <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 12 }}>
                <label style={fieldLabelStyle}>
                  <span className="eyebrow" style={{ color: 'var(--ink-4)' }}>What for</span>
                  <input
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                    placeholder="Late checkout"
                    maxLength={60}
                    style={inputStyle}
                  />
                </label>
                <label style={fieldLabelStyle}>
                  <span className="eyebrow" style={{ color: 'var(--ink-4)' }}>Amount, before tax</span>
                  <div style={{ position: 'relative' }}>
                    <span style={{ position: 'absolute', left: 12, top: 10, fontSize: 14, color: 'var(--ink-4)' }}>$</span>
                    <input
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      inputMode="decimal"
                      placeholder="200"
                      style={{ ...inputStyle, paddingLeft: 24 }}
                    />
                  </div>
                </label>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap', marginTop: 12 }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 13, color: 'var(--ink-2)', cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={taxable}
                    onChange={(e) => setTaxable(e.target.checked)}
                    style={{ accentColor: 'var(--ink)' }}
                  />
                  Add MA occupancy tax{property ? ` (${pct(property.taxRate)})` : ''}
                  <span style={{ color: 'var(--ink-4)' }}>rent is taxed; a replacement cost is not</span>
                </label>
                {baseCents > 0 && (
                  <span style={{ fontSize: 13, color: 'var(--ink)' }}>
                    Guest pays <b>{money(totalCents)}</b>
                    {taxCents > 0 ? (
                      <span style={{ color: 'var(--ink-3)' }}>
                        {' '}({money(baseCents)} + {money(taxCents)} tax)
                      </span>
                    ) : null}
                  </span>
                )}
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }}>
                <label style={fieldLabelStyle}>
                  <span className="eyebrow" style={{ color: 'var(--ink-4)' }}>Charged through</span>
                  {prep.propertyId ? (
                    <div style={{ ...inputStyle, background: 'var(--paper-2)' }}>
                      {prep.propertyName}
                      <span style={{ color: 'var(--ink-4)' }}> · its own Stripe account</span>
                    </div>
                  ) : (
                    <select value={propertyId} onChange={(e) => setPropertyId(e.target.value)} style={inputStyle}>
                      <option value="">Pick the property</option>
                      {prep.properties.map((p) => (
                        <option key={p.id} value={p.id} disabled={!p.hasKey}>
                          {p.name}{p.hasKey ? '' : ' (no Stripe key)'}
                        </option>
                      ))}
                    </select>
                  )}
                </label>
                <label style={fieldLabelStyle}>
                  <span className="eyebrow" style={{ color: 'var(--ink-4)' }}>Text to</span>
                  <input
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    inputMode="tel"
                    placeholder={prep.guestPhone ? '' : 'No mobile on the reservation'}
                    style={inputStyle}
                  />
                </label>
              </div>
              {property && !property.hasKey && (
                <p role="alert" style={{ fontSize: 12, color: 'var(--signal)', fontWeight: 500, margin: '8px 0 0' }}>
                  Helm has no Stripe key for {property.name}, so it can&apos;t mint a link there yet.
                </p>
              )}
              {!prep.propertyId && (
                <p style={{ fontSize: 12, color: 'var(--ink-3)', margin: '8px 0 0' }}>
                  This stay&apos;s listing didn&apos;t match a Helm property on its own. Pick it so the money lands in
                  the right owner&apos;s account.
                </p>
              )}

              <label style={{ ...fieldLabelStyle, marginTop: 12 }}>
                <span className="eyebrow" style={{ color: 'var(--ink-4)' }}>
                  The text{' '}
                  <span style={{ textTransform: 'none', letterSpacing: 0 }}>
                    · sends from the Guests line as Allie; [link] becomes the real link
                  </span>
                  {smsTouched && (
                    <>
                      {' '}
                      <button
                        type="button"
                        onClick={() => {
                          setSmsTouched(false);
                          setSms('');
                        }}
                        style={linkButtonStyle}
                      >
                        Reset
                      </button>
                    </>
                  )}
                </span>
                <textarea
                  value={smsShown}
                  onChange={(e) => {
                    setSms(e.target.value);
                    setSmsTouched(true);
                  }}
                  rows={4}
                  style={{ ...inputStyle, lineHeight: 1.55, resize: 'vertical' }}
                />
              </label>

              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginTop: 12 }}>
                <button
                  type="button"
                  onClick={() => create(true)}
                  disabled={!canMint || !phoneOk}
                  style={{ ...primaryButtonStyle, opacity: !canMint || !phoneOk ? 0.5 : 1 }}
                >
                  {isPending ? 'Working' : `Create link + text ${guestFirst}`}
                </button>
                <button
                  type="button"
                  onClick={() => create(false)}
                  disabled={!canMint}
                  style={{ ...ghostButtonStyle, opacity: !canMint ? 0.5 : 1 }}
                >
                  Create link only
                </button>
                {!phoneOk && phone.trim() && (
                  <span style={{ fontSize: 12, color: 'var(--signal)' }}>That number doesn&apos;t look like a mobile.</span>
                )}
                {amount.trim() && !validAmount && (
                  <span style={{ fontSize: 12, color: 'var(--signal)' }}>
                    ${MIN_USD} to ${MAX_USD.toLocaleString()} before tax.
                  </span>
                )}
              </div>
            </>
          )}

          {result && !result.ok && (
            <p role="alert" style={{ fontSize: 12, color: 'var(--signal)', fontWeight: 500, margin: '10px 0 0' }}>
              {result.error}
            </p>
          )}
          {result && result.ok && (
            <div
              role="status"
              style={{
                marginTop: 14,
                border: '1px solid var(--rule)',
                borderLeft: '3px solid var(--tide-deep)',
                padding: '12px 14px',
              }}
            >
              <div style={{ fontSize: 13, color: 'var(--ink)', lineHeight: 1.55 }}>
                {result.sent ? (
                  <>
                    Texted {guestFirst} at {prettyPhone(result.sentTo)} for <b>{money(result.totalCents)}</b>. It shows up
                    on the home page when it&apos;s paid, or after a day if it isn&apos;t.
                  </>
                ) : result.note ? (
                  result.note
                ) : result.smsError ? (
                  <>
                    The link was created for {money(result.totalCents)} but the text did not go out ({result.smsError}).
                    Copy it and send it yourself.
                  </>
                ) : (
                  <>
                    Link created for <b>{money(result.totalCents)}</b>. Copy it and send it yourself; the home page tells
                    you when it&apos;s paid.
                  </>
                )}
              </div>
              <div style={{ marginTop: 8, display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <code style={{ fontSize: 12, wordBreak: 'break-all' }}>{result.url}</code>
                <CopyLinkButton url={result.url} requestKey={result.sent ? undefined : result.requestKey} />
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const fieldLabelStyle: React.CSSProperties = { display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 };

const inputStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '10px 12px',
  fontSize: 14,
  fontFamily: 'inherit',
  color: 'var(--ink)',
  background: 'var(--paper)',
  border: '1px solid var(--rule)',
};

const primaryButtonStyle: React.CSSProperties = {
  padding: '11px 18px',
  fontSize: 11,
  letterSpacing: '0.16em',
  textTransform: 'uppercase',
  fontWeight: 600,
  color: 'var(--paper)',
  background: 'var(--ink)',
  border: '1px solid var(--ink)',
  cursor: 'pointer',
};

const ghostButtonStyle: React.CSSProperties = {
  ...primaryButtonStyle,
  color: 'var(--ink)',
  background: 'transparent',
};

const linkButtonStyle: React.CSSProperties = {
  fontSize: 12,
  color: 'var(--ink)',
  background: 'transparent',
  border: 'none',
  padding: 0,
  textDecoration: 'underline',
  cursor: 'pointer',
  fontFamily: 'inherit',
};
