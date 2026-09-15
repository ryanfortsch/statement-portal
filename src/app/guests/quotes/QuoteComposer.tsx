'use client';

import { useEffect, useMemo, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { owedOccupancyTaxRate } from '@/lib/occupancy-tax';
import {
  DEFAULT_QUOTE_EXPIRY_DAYS,
  SPLIT_BALANCE_LEAD_DAYS,
  SPLIT_DEPOSIT_PCT,
  TAX_EXEMPT_OVER_NIGHTS,
  computeQuoteMoney,
  defaultCancellationTerms,
  displayTitle,
  fmtCents,
  fmtLongDate,
  fmtShortDate,
  isIsoDay,
  nightsBetween,
  shiftIsoDay,
  todayInEastern,
  type ExtraLine,
  type ReferenceQuote,
  type ScaQuoteRow,
} from '@/lib/sca-quotes-types';
import type { QuotableProperty } from '@/lib/sca-quotes';
import { previewQuoteContext, saveQuote, type QuoteFormInput, type QuotePreview } from './actions';

/**
 * The custom quote composer. One client component, one save.
 *
 * Every number the operator types is a dollar string in local state; the
 * money the guest will see is derived on every render through the same
 * computeQuoteMoney the server persists with and staycapeann.com re-checks
 * before charging, so the sticky summary on the right IS the guest page.
 *
 * The nightly rate and the accommodation total are two views of one number:
 * whichever the operator typed last is the anchor and the other is derived
 * from it and the night count. That avoids the effect ping-pong of keeping
 * two synced inputs in state.
 *
 * "Check dates" is the only round trip before save. It asks the server for
 * the calendar (staycapeann.com's public availability, which carries the
 * 2027 pre-release overlay), Guesty's own price for the dates, last year's
 * achieved nightly from the statements, and fills the rate fields when they
 * are still empty. The overrides (book closed or unreleased nights, ignore
 * the min-night rule) only appear once the check has found something to
 * override, so a quote on an open calendar never shows them.
 */

export type QuotePrefill = {
  property_id?: string;
  check_in?: string;
  check_out?: string;
  guests?: number;
  first?: string;
  last?: string;
  email?: string;
  phone?: string;
  source_kind?: string;
  source_ref?: string;
};

type ExtraDraft = { key: number; label: string; dollars: string; taxable: boolean };
type Preview = Extract<QuotePreview, { ok: true }>;

export function QuoteComposer({
  properties,
  prefill,
  initial,
}: {
  properties: QuotableProperty[];
  prefill?: QuotePrefill;
  initial?: ScaQuoteRow;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [isSaving, startSave] = useTransition();
  const extraKey = useRef(0);

  // ── Property + stay ──
  const [propertyId, setPropertyId] = useState(initial?.property_id ?? prefill?.property_id ?? '');
  const [checkIn, setCheckIn] = useState(initial?.check_in ?? prefill?.check_in ?? '');
  const [checkOut, setCheckOut] = useState(initial?.check_out ?? prefill?.check_out ?? '');
  const [guestsStr, setGuestsStr] = useState(String(initial?.guests ?? prefill?.guests ?? 2));

  // ── Price ──
  const [anchor, setAnchor] = useState<'nightly' | 'total'>(initial && initial.nightly_cents == null ? 'total' : 'nightly');
  const [nightlyStr, setNightlyStr] = useState(initial?.nightly_cents != null ? dollarsStr(initial.nightly_cents) : '');
  const [accommodationStr, setAccommodationStr] = useState(initial ? dollarsStr(initial.accommodation_cents) : '');
  const [cleaningStr, setCleaningStr] = useState(initial ? dollarsStr(initial.cleaning_cents) : '');
  const [extras, setExtras] = useState<ExtraDraft[]>(() =>
    (initial?.extra_lines ?? []).map((l) => ({ key: ++extraKey.current, label: l.label, dollars: dollarsStr(l.cents), taxable: l.taxable })),
  );
  const [discountLabel, setDiscountLabel] = useState(initial?.discount_label ?? '');
  const [discountStr, setDiscountStr] = useState(initial && initial.discount_cents > 0 ? dollarsStr(initial.discount_cents) : '');
  const [taxExempt, setTaxExempt] = useState(initial?.tax_exempt ?? false);
  const [taxExemptTouched, setTaxExemptTouched] = useState(!!initial);

  // ── Plan ──
  const [plan, setPlan] = useState<'full' | 'split'>(initial?.payment_plan ?? 'full');
  const [depositMode, setDepositMode] = useState<'pct' | 'amount'>(initial?.payment_plan === 'split' ? 'amount' : 'pct');
  const [depositPctStr, setDepositPctStr] = useState(String(SPLIT_DEPOSIT_PCT));
  const [depositStr, setDepositStr] = useState(initial?.deposit_cents != null ? dollarsStr(initial.deposit_cents) : '');
  const [balanceDueOn, setBalanceDueOn] = useState(initial?.balance_due_on ?? '');
  const [balanceTouched, setBalanceTouched] = useState(!!initial?.balance_due_on);

  // ── Overrides ──
  const [overrideCalendar, setOverrideCalendar] = useState(initial?.override_calendar ?? false);
  const [overrideTerms, setOverrideTerms] = useState(initial?.override_terms ?? false);

  // ── Guest + copy ──
  const [firstName, setFirstName] = useState(initial?.guest_first_name ?? prefill?.first ?? '');
  const [lastName, setLastName] = useState(initial?.guest_last_name ?? prefill?.last ?? '');
  const [email, setEmail] = useState(initial?.guest_email ?? prefill?.email ?? '');
  const [phone, setPhone] = useState(initial?.guest_phone ?? prefill?.phone ?? '');
  const [message, setMessage] = useState(initial?.message ?? '');
  // Filled after mount (see the effect below): a local-time conversion in the
  // initial state renders in the server's zone and again in the browser's.
  const [expiresLocal, setExpiresLocal] = useState('');
  const [terms, setTerms] = useState(initial?.cancellation_terms ?? '');
  const [termsTouched, setTermsTouched] = useState(() =>
    initial
      ? (initial.cancellation_terms ?? '') !==
        defaultCancellationTerms({ payment_plan: initial.payment_plan, check_in: initial.check_in, balance_due_on: initial.balance_due_on })
      : false,
  );
  const [internalNotes, setInternalNotes] = useState(initial?.internal_notes ?? '');

  // ── Server round trips ──
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewKey, setPreviewKey] = useState('');
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [reference, setReference] = useState<ReferenceQuote | null>(initial?.reference_quote ?? null);
  const [saveError, setSaveError] = useState<string | null>(null);

  // ── Derived ──
  const property = properties.find((p) => p.id === propertyId) ?? null;
  const nights = nightsBetween(checkIn, checkOut);
  const stayValid = isIsoDay(checkIn) && isIsoDay(checkOut) && nights >= 1 && nights <= 365;
  const guests = Math.round(Number(guestsStr)) || 0;
  const taxRate = property ? owedOccupancyTaxRate(property.id) : 0;

  const nightlyCents = anchor === 'nightly' ? toCents(nightlyStr) : nights > 0 ? Math.round(toCents(accommodationStr) / nights) : 0;
  const accommodationCents = anchor === 'nightly' ? toCents(nightlyStr) * Math.max(nights, 0) : toCents(accommodationStr);
  const cleaningCents = toCents(cleaningStr);
  const discountCents = toCents(discountStr);
  // Every extra line is taxed with the rent (saveQuote forces it too): Guesty
  // folds extras into the fare and taxes the whole fare, so the preview must
  // add tax the same way or the summary would promise a different total.
  const extraLines: ExtraLine[] = extras.map((l) => ({ label: l.label.trim(), cents: toCents(l.dollars), taxable: true }));

  const splitOk = isIsoDay(checkIn) && shiftIsoDay(checkIn, -SPLIT_BALANCE_LEAD_DAYS) > todayInEastern();
  const effectivePlan: 'full' | 'split' = plan === 'split' && splitOk ? 'split' : 'full';

  const money = useMemo(
    () =>
      computeQuoteMoney({
        accommodation_cents: accommodationCents,
        cleaning_cents: cleaningCents,
        extra_lines: extraLines,
        discount_cents: discountCents,
        tax_rate: taxRate,
        tax_exempt: taxExempt,
        payment_plan: effectivePlan,
        deposit_pct: depositMode === 'pct' ? Number(depositPctStr) || SPLIT_DEPOSIT_PCT : undefined,
        deposit_cents: depositMode === 'amount' ? toCents(depositStr) : null,
      }),
    // extraLines is rebuilt each render; its inputs are `extras`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [accommodationCents, cleaningCents, extras, discountCents, taxRate, taxExempt, effectivePlan, depositMode, depositPctStr, depositStr],
  );

  const currentKey = `${propertyId}|${checkIn}|${checkOut}|${guests}`;
  const previewStale = !!preview && previewKey !== currentKey;

  // ── Defaults that follow the stay ──
  // Expiry is set on the client after mount, for a saved quote and a new one
  // alike: toLocalInput reads the clock's zone, and a value computed during
  // the server render (UTC on Vercel) would not match the browser's and trip
  // hydration on every edit-page load.
  useEffect(() => {
    if (!expiresLocal) {
      setExpiresLocal(
        toLocalInput(initial?.expires_at ?? new Date(Date.now() + DEFAULT_QUOTE_EXPIRY_DAYS * 86_400_000).toISOString()),
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A changed stay invalidates what the last check found: the overrides and
  // the reference price were about other nights. The verified key is the
  // last check's, or the saved row's when editing without a fresh check.
  const initialKey = initial ? `${initial.property_id ?? ''}|${initial.check_in}|${initial.check_out}|${initial.guests}` : '';
  useEffect(() => {
    const verifiedKey = preview ? previewKey : initialKey;
    if (verifiedKey && currentKey !== verifiedKey) {
      setOverrideCalendar(false);
      setOverrideTerms(false);
      setReference(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentKey]);

  useEffect(() => {
    if (!taxExemptTouched) setTaxExempt(nights > TAX_EXEMPT_OVER_NIGHTS);
  }, [nights, taxExemptTouched]);

  useEffect(() => {
    if (!balanceTouched && isIsoDay(checkIn)) setBalanceDueOn(shiftIsoDay(checkIn, -SPLIT_BALANCE_LEAD_DAYS));
  }, [checkIn, balanceTouched]);

  useEffect(() => {
    if (termsTouched || !isIsoDay(checkIn)) return;
    setTerms(defaultCancellationTerms({ payment_plan: effectivePlan, check_in: checkIn, balance_due_on: effectivePlan === 'split' ? balanceDueOn : null }));
  }, [termsTouched, effectivePlan, checkIn, balanceDueOn]);

  // ── Check dates ──
  function runPreview() {
    setPreviewError(null);
    startTransition(async () => {
      const r = await previewQuoteContext({ property_id: propertyId, check_in: checkIn, check_out: checkOut, guests });
      if (!r.ok) {
        setPreviewError(r.error);
        return;
      }
      setPreview(r);
      setPreviewKey(currentKey);
      setReference(r.reference);
      // Fill the rate fields only when they are still empty: an operator's
      // typed price never gets overwritten by a refresh of the calendar.
      if (!nightlyStr && !accommodationStr && r.suggested_nightly_cents) {
        setAnchor('nightly');
        setNightlyStr(dollarsStr(r.suggested_nightly_cents));
      }
      if (!cleaningStr && r.suggested_cleaning_cents) setCleaningStr(dollarsStr(r.suggested_cleaning_cents));
      if (!taxExemptTouched) setTaxExempt(r.tax_exempt_default);
      // Nothing to override any more? Drop a stale override so it cannot
      // ride along silently after the calendar opened up.
      if (r.availability.checked && r.availability.blocked_dates.length === 0 && r.availability.unreleased_dates.length === 0) {
        setOverrideCalendar(false);
      }
      if (!r.terms_violation) setOverrideTerms(false);
    });
  }

  // ── Save ──
  function save() {
    setSaveError(null);
    const input: QuoteFormInput = {
      id: initial?.id,
      property_id: propertyId,
      check_in: checkIn,
      check_out: checkOut,
      guests,
      guest_first_name: firstName,
      guest_last_name: lastName,
      guest_email: email,
      guest_phone: phone,
      nightly_cents: nightlyCents > 0 ? nightlyCents : null,
      accommodation_cents: accommodationCents,
      cleaning_cents: cleaningCents,
      extra_lines: extraLines,
      discount_label: discountLabel,
      discount_cents: discountCents,
      tax_exempt: taxExempt,
      payment_plan: effectivePlan,
      deposit_cents: effectivePlan === 'split' ? money.deposit_cents : null,
      balance_due_on: effectivePlan === 'split' ? balanceDueOn || null : null,
      override_calendar: overrideCalendar,
      override_terms: overrideTerms,
      message,
      cancellation_terms: terms,
      internal_notes: internalNotes,
      expires_at: expiresLocal ? new Date(expiresLocal).toISOString() : null,
      reference_quote: reference,
      source_kind: initial?.source_kind ?? prefill?.source_kind ?? null,
      source_ref: initial?.source_ref ?? prefill?.source_ref ?? null,
    };
    startSave(async () => {
      const r = await saveQuote(input);
      if (!r.ok) {
        setSaveError(r.error);
        return;
      }
      router.push(`/guests/quotes/${r.id}`);
    });
  }

  const canPreview = !!property?.guesty_listing_id && stayValid && guests >= 1 && !isPending;
  const showCalendarOverride =
    !!preview && !previewStale && (preview.availability.blocked_dates.length > 0 || preview.availability.unreleased_dates.length > 0);
  const showTermsOverride = !!preview && !previewStale && !!preview.terms_violation;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 340px', gap: 48, alignItems: 'start' }}>
      {/* ── Left: the form ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 36 }}>
        <FormBlock title="Property">
          <Field label="Stay Cape Ann home" required>
            <select value={propertyId} onChange={(e) => setPropertyId(e.target.value)} style={inputStyle}>
              <option value="">Pick a property</option>
              {properties.map((p) => (
                <option key={p.id} value={p.id} disabled={!p.guesty_listing_id}>
                  {p.name}
                  {p.title ? ` (${displayTitle(p.title)})` : ''}
                  {!p.guesty_listing_id ? ', not on Stay Cape Ann yet' : ''}
                </option>
              ))}
            </select>
          </Field>
          {initial && initial.property_id !== propertyId && (
            <p style={{ ...hintStyle, color: 'var(--signal)' }}>
              Changing the home re-snapshots the title and the listing on save. Check the dates again before sending.
            </p>
          )}
        </FormBlock>

        <FormBlock title="Stay">
          <div style={grid3}>
            <Field label="Check-in" required>
              <input type="date" value={checkIn} onChange={(e) => setCheckIn(e.target.value)} style={inputStyle} />
            </Field>
            <Field label="Check-out" required>
              <input type="date" value={checkOut} min={checkIn || undefined} onChange={(e) => setCheckOut(e.target.value)} style={inputStyle} />
            </Field>
            <Field label="Guests" required>
              <input type="number" min={1} max={30} value={guestsStr} onChange={(e) => setGuestsStr(e.target.value)} style={inputStyle} />
            </Field>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 13, color: 'var(--ink-3)' }}>
              {stayValid ? `${nights} night${nights === 1 ? '' : 's'}` : checkIn && checkOut ? 'Check-out must be after check-in' : 'Pick the dates'}
            </span>
            <button type="button" onClick={runPreview} disabled={!canPreview} style={{ ...ghostBtn, opacity: canPreview ? 1 : 0.5 }}>
              {isPending ? 'Checking…' : preview && !previewStale ? 'Check again' : "Check dates and pull Guesty's price"}
            </button>
            {previewStale && <span style={{ fontSize: 12, color: 'var(--signal)' }}>Dates changed since the last check.</span>}
          </div>
          {previewError && <p style={{ ...hintStyle, color: 'var(--signal)', marginTop: 10 }}>{previewError}</p>}

          {preview && !previewStale && (
            <div style={{ marginTop: 18, display: 'flex', flexDirection: 'column', gap: 14 }}>
              <AvailabilityStrip preview={preview} nights={nights} />
              {showCalendarOverride && (
                <Check
                  checked={overrideCalendar}
                  onChange={setOverrideCalendar}
                  label="Book these nights anyway. Never books over an existing reservation."
                />
              )}
              {showTermsOverride && (
                <Check checked={overrideTerms} onChange={setOverrideTerms} label="Ignore the minimum-night rule" />
              )}
              <ReferenceBox preview={preview} nights={nights} />
            </div>
          )}
        </FormBlock>

        <FormBlock title="Price" hint="Nightly and total are the same number two ways; edit either.">
          <div style={grid3}>
            <Field label="Nightly rate ($)">
              <input
                type="number"
                min={0}
                step="0.01"
                value={anchor === 'nightly' ? nightlyStr : nights > 0 ? dollarsStr(nightlyCents) : ''}
                onChange={(e) => {
                  setAnchor('nightly');
                  setNightlyStr(e.target.value);
                }}
                placeholder="450"
                style={inputStyle}
              />
            </Field>
            <Field label="Accommodation total ($)">
              <input
                type="number"
                min={0}
                step="0.01"
                value={anchor === 'total' ? accommodationStr : nights > 0 && nightlyStr ? dollarsStr(accommodationCents) : ''}
                onChange={(e) => {
                  setAnchor('total');
                  setAccommodationStr(e.target.value);
                }}
                placeholder="3150"
                style={inputStyle}
              />
            </Field>
            <Field label="Cleaning fee ($)">
              <input type="number" min={0} step="0.01" value={cleaningStr} onChange={(e) => setCleaningStr(e.target.value)} placeholder="250" style={inputStyle} />
            </Field>
          </div>

          <div style={{ marginBottom: 16 }}>
            <div className="eyebrow" style={{ fontSize: 10, marginBottom: 8 }}>Extra lines</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {extras.map((l) => (
                <div key={l.key} style={{ display: 'grid', gridTemplateColumns: '1fr 140px auto', gap: 10, alignItems: 'center' }}>
                  <input
                    type="text"
                    value={l.label}
                    onChange={(e) => setExtras((xs) => xs.map((x) => (x.key === l.key ? { ...x, label: e.target.value } : x)))}
                    placeholder="Pet fee"
                    style={inputStyle}
                  />
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={l.dollars}
                    onChange={(e) => setExtras((xs) => xs.map((x) => (x.key === l.key ? { ...x, dollars: e.target.value } : x)))}
                    placeholder="150"
                    style={inputStyle}
                  />
                  <button type="button" onClick={() => setExtras((xs) => xs.filter((x) => x.key !== l.key))} style={textBtn} aria-label="Remove line">
                    Remove
                  </button>
                </div>
              ))}
              {extras.length > 0 && (
                <p style={hintStyle}>Extra lines are taxed with the rent; Guesty folds them into the fare.</p>
              )}
              <div>
                <button
                  type="button"
                  onClick={() => setExtras((xs) => [...xs, { key: ++extraKey.current, label: '', dollars: '', taxable: true }])}
                  style={textBtn}
                >
                  + Add a line
                </button>
              </div>
            </div>
          </div>

          <div style={grid3}>
            <Field label="Discount label">
              <input type="text" value={discountLabel} onChange={(e) => setDiscountLabel(e.target.value)} placeholder="Returning guest" style={inputStyle} />
            </Field>
            <Field label="Discount ($)" hint="Comes off the accommodation before tax.">
              <input type="number" min={0} step="0.01" value={discountStr} onChange={(e) => setDiscountStr(e.target.value)} placeholder="0" style={inputStyle} />
            </Field>
            <Field label="Occupancy tax" hint={property ? `${pct(taxRate)} owed for ${property.name}. Exempt at ${TAX_EXEMPT_OVER_NIGHTS + 1}+ nights.` : 'Rate follows the property.'}>
              <div style={{ paddingTop: 8 }}>
                <Check
                  checked={taxExempt}
                  onChange={(v) => {
                    setTaxExemptTouched(true);
                    setTaxExempt(v);
                  }}
                  label={taxExempt ? 'Tax exempt' : `Taxed at ${pct(taxRate)}: ${fmtCents(money.tax_cents)}`}
                />
              </div>
            </Field>
          </div>
        </FormBlock>

        <FormBlock title="Payment plan">
          <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
            <RadioCard
              checked={effectivePlan === 'full'}
              onSelect={() => setPlan('full')}
              title="Pay in full at acceptance"
              body="One charge when the guest accepts. The standard Stay Cape Ann checkout."
            />
            <RadioCard
              checked={effectivePlan === 'split'}
              onSelect={() => setPlan('split')}
              disabled={!splitOk}
              title="Deposit now, balance later"
              body={
                splitOk
                  ? `A deposit at acceptance, the rest by a date you pick (default ${SPLIT_BALANCE_LEAD_DAYS} days before check-in).`
                  : `Check-in is within ${SPLIT_BALANCE_LEAD_DAYS} days, so the full amount is due at acceptance.`
              }
            />
          </div>
          {plan === 'split' && splitOk && (
            <div style={{ ...grid3, marginTop: 16 }}>
              <Field label="Deposit">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <select value={depositMode} onChange={(e) => setDepositMode(e.target.value as 'pct' | 'amount')} style={inputStyle}>
                    <option value="pct">Percent</option>
                    <option value="amount">Amount ($)</option>
                  </select>
                  {depositMode === 'pct' ? (
                    <input type="number" min={1} max={99} value={depositPctStr} onChange={(e) => setDepositPctStr(e.target.value)} style={inputStyle} />
                  ) : (
                    <input type="number" min={1} step="0.01" value={depositStr} onChange={(e) => setDepositStr(e.target.value)} placeholder="1000" style={inputStyle} />
                  )}
                </div>
              </Field>
              <Field label="Balance due by" hint="Must fall between today and check-in.">
                <input
                  type="date"
                  value={balanceDueOn}
                  min={todayInEastern()}
                  max={checkIn || undefined}
                  onChange={(e) => {
                    setBalanceTouched(true);
                    setBalanceDueOn(e.target.value);
                  }}
                  style={inputStyle}
                />
              </Field>
              <Field label="Split">
                <div style={{ fontSize: 13, color: 'var(--ink)', paddingTop: 9, lineHeight: 1.5 }}>
                  {money.deposit_cents != null && money.balance_cents != null ? (
                    <>
                      <span className="tabular-nums">{fmtCents(money.deposit_cents)}</span> now,{' '}
                      <span className="tabular-nums">{fmtCents(money.balance_cents)}</span> later
                    </>
                  ) : (
                    'Set a price first'
                  )}
                </div>
              </Field>
            </div>
          )}
        </FormBlock>

        <FormBlock title="Guest">
          <div style={grid3}>
            <Field label="First name">
              <input type="text" value={firstName} onChange={(e) => setFirstName(e.target.value)} placeholder="Emily" style={inputStyle} />
            </Field>
            <Field label="Last name">
              <input type="text" value={lastName} onChange={(e) => setLastName(e.target.value)} placeholder="Hancock" style={inputStyle} />
            </Field>
            <div />
          </div>
          <div style={grid3}>
            <Field label="Email" hint="Needed to email the quote.">
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="guest@example.com" style={inputStyle} />
            </Field>
            <Field label="Phone" hint="Needed to text the quote.">
              <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="914-262-4310" style={inputStyle} />
            </Field>
            <div />
          </div>
        </FormBlock>

        <FormBlock title="Message to the guest" hint="Shown on the quote page and in the email, as a note from Allie.">
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={4}
            placeholder="Hi Emily, so glad you reached out. Here is what the week would look like."
            style={{ ...inputStyle, resize: 'vertical' }}
          />
        </FormBlock>

        <FormBlock title="Terms">
          <div style={grid3}>
            <Field label="Quote expires" hint="Local time. The link stops working after this.">
              <input type="datetime-local" value={expiresLocal} onChange={(e) => setExpiresLocal(e.target.value)} style={inputStyle} />
            </Field>
          </div>
          <Field
            label="Cancellation terms"
            hint={termsTouched ? 'Edited by hand; it will not regenerate when the plan or dates change.' : 'Follows the plan and dates until you edit it.'}
          >
            <textarea
              value={terms}
              onChange={(e) => {
                setTermsTouched(true);
                setTerms(e.target.value);
              }}
              rows={4}
              style={{ ...inputStyle, resize: 'vertical' }}
            />
          </Field>
          {termsTouched && (
            <div style={{ marginTop: 8 }}>
              <button
                type="button"
                onClick={() => {
                  setTermsTouched(false);
                }}
                style={textBtn}
              >
                Reset to the default wording
              </button>
            </div>
          )}
        </FormBlock>

        <FormBlock title="Internal notes" hint="Staff only. Never shown to the guest.">
          <textarea value={internalNotes} onChange={(e) => setInternalNotes(e.target.value)} rows={2} style={{ ...inputStyle, resize: 'vertical' }} />
        </FormBlock>

        <div style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
          <button type="button" onClick={save} disabled={isSaving} style={{ ...primaryBtn, opacity: isSaving ? 0.7 : 1 }}>
            {isSaving ? 'Saving…' : initial ? 'Save changes' : 'Save quote'}
          </button>
          {saveError && <span style={{ fontSize: 13, color: 'var(--signal)' }}>{saveError}</span>}
          {!saveError && (
            <span style={{ fontSize: 12, color: 'var(--ink-4)' }}>Saving does not send anything. The detail page has the send buttons.</span>
          )}
        </div>
      </div>

      {/* ── Right: what the guest will see ── */}
      <aside style={{ position: 'sticky', top: 24 }}>
        <SummaryCard
          title={property?.title || property?.name || 'Your stay'}
          checkIn={checkIn}
          checkOut={checkOut}
          nights={nights}
          guests={guests}
          nightlyCents={nightlyCents}
          accommodationCents={accommodationCents}
          discountLabel={discountLabel}
          discountCents={Math.min(discountCents, accommodationCents)}
          cleaningCents={cleaningCents}
          extraLines={extraLines}
          taxRate={taxRate}
          taxExempt={taxExempt}
          taxCents={money.tax_cents}
          totalCents={money.total_cents}
          plan={effectivePlan}
          depositCents={money.deposit_cents}
          balanceCents={money.balance_cents}
          balanceDueOn={balanceDueOn}
          terms={terms}
          expiresLocal={expiresLocal}
        />
      </aside>
    </div>
  );
}

// ─── Pieces ─────────────────────────────────────────────────────────────────

function AvailabilityStrip({ preview, nights }: { preview: Preview; nights: number }) {
  const a = preview.availability;
  if (!a.checked) {
    return (
      <Note tone="signal">
        Could not read the calendar{a.error ? ` (${a.error})` : ''}. Guesty will still refuse a booked night at acceptance.
      </Note>
    );
  }
  const blocked = a.blocked_dates.length;
  const unreleased = a.unreleased_dates.length;
  if (blocked === 0 && unreleased === 0) {
    return (
      <Note tone="ok">
        All {nights} night{nights === 1 ? '' : 's'} open on the calendar.
        {a.min_nights && a.min_nights > nights ? ` The listing asks for ${a.min_nights} nights minimum.` : ''}
      </Note>
    );
  }
  return (
    <Note tone="signal">
      {blocked > 0 && (
        <div>
          {blocked} night{blocked === 1 ? '' : 's'} closed: {a.blocked_dates.map(fmtShortDate).join(', ')}.
        </div>
      )}
      {unreleased > 0 && (
        <div>
          {unreleased} night{unreleased === 1 ? '' : 's'} not released yet: {a.unreleased_dates.map(fmtShortDate).join(', ')}.
        </div>
      )}
      {a.min_nights && a.min_nights > nights ? <div>The listing asks for {a.min_nights} nights minimum.</div> : null}
    </Note>
  );
}

function ReferenceBox({ preview, nights }: { preview: Preview; nights: number }) {
  const r = preview.reference;
  const achieved = preview.achieved;
  if (!r && !achieved && !preview.terms_violation && !preview.reference_error) return null;
  return (
    <div style={{ border: '1px solid var(--rule)', padding: '12px 14px', fontSize: 13, lineHeight: 1.6, color: 'var(--ink-3)' }}>
      <div className="eyebrow" style={{ fontSize: 10, marginBottom: 6 }}>For reference, never shown to the guest</div>
      {preview.reference_error && (
        <div style={{ color: 'var(--signal)' }}>
          Guesty&apos;s live price could not be read ({preview.reference_error}). Check again before trusting the rate below.
        </div>
      )}
      {r && (
        <div>
          Guesty would charge <strong style={{ color: 'var(--ink)' }}>{fmtDollars(r.total)}</strong> for these dates:{' '}
          {fmtDollars(nights > 0 ? r.subtotal / nights : r.subtotal)}/night, cleaning {fmtDollars(r.cleaning_fee)}, tax {fmtDollars(r.taxes)}
          {r.extra_guest_fee > 0 ? `, extra guests ${fmtDollars(r.extra_guest_fee)}` : ''}
          {r.estimated ? ' (an estimate, Guesty did not answer)' : ''}.
        </div>
      )}
      {preview.terms_violation && <div>Guesty declined to quote: {preview.terms_violation}</div>}
      {achieved && (
        <div>
          Last year this window achieved <strong style={{ color: 'var(--ink)' }}>{fmtDollars(achieved.nightly)}/night</strong> over{' '}
          {achieved.sample_nights} nights.
        </div>
      )}
    </div>
  );
}

function SummaryCard(p: {
  title: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  guests: number;
  nightlyCents: number;
  accommodationCents: number;
  discountLabel: string;
  discountCents: number;
  cleaningCents: number;
  extraLines: ExtraLine[];
  taxRate: number;
  taxExempt: boolean;
  taxCents: number;
  totalCents: number;
  plan: 'full' | 'split';
  depositCents: number | null;
  balanceCents: number | null;
  balanceDueOn: string;
  terms: string;
  expiresLocal: string;
}) {
  const datesOk = isIsoDay(p.checkIn) && isIsoDay(p.checkOut) && p.nights > 0;
  return (
    <div style={{ border: '1px solid var(--ink)', padding: '22px 22px 20px', background: 'var(--paper-2, var(--paper))' }}>
      <div className="eyebrow" style={{ fontSize: 10, marginBottom: 8 }}>What the guest sees</div>
      <div className="font-serif" style={{ fontSize: 22, fontWeight: 400, letterSpacing: '-0.01em', color: 'var(--ink)', lineHeight: 1.15 }}>
        {displayTitle(p.title) || 'Your stay'}
      </div>

      <div style={{ borderTop: '1px solid var(--rule)', marginTop: 16, paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <Row k="Dates" v={datesOk ? `${fmtShortDate(p.checkIn)} to ${fmtShortDate(p.checkOut)}` : 'Pick the dates'} />
        <Row k="Nights" v={datesOk ? String(p.nights) : ''} />
        <Row k="Guests" v={p.guests > 0 ? String(p.guests) : ''} />
      </div>

      <div style={{ borderTop: '1px solid var(--rule)', marginTop: 12, paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
        <Row
          k={datesOk && p.nightlyCents > 0 ? `${fmtCents(p.nightlyCents)} x ${p.nights} night${p.nights === 1 ? '' : 's'}` : 'Accommodation'}
          v={fmtCents(p.accommodationCents)}
        />
        {p.discountCents > 0 && <Row k={p.discountLabel.trim() || 'Discount'} v={`-${fmtCents(p.discountCents)}`} tone="signal" />}
        {p.cleaningCents > 0 && <Row k="Cleaning fee" v={fmtCents(p.cleaningCents)} />}
        {p.extraLines.filter((l) => l.cents > 0).map((l, i) => (
          <Row key={i} k={l.label || 'Extra'} v={fmtCents(l.cents)} />
        ))}
        {p.taxExempt ? (
          <Row k="Tax exempt" v="" muted />
        ) : (
          <Row k={`Lodging tax (${pct(p.taxRate)})`} v={fmtCents(p.taxCents)} />
        )}
        <Row k="Total" v={fmtCents(p.totalCents)} bold />
      </div>

      {p.plan === 'split' && p.depositCents != null && p.balanceCents != null && (
        <div style={{ borderTop: '1px solid var(--rule)', marginTop: 12, paddingTop: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <Row k="Due today" v={fmtCents(p.depositCents)} bold />
          <Row k={`Balance by ${isIsoDay(p.balanceDueOn) ? fmtLongDate(p.balanceDueOn) : 'a date you pick'}`} v={fmtCents(p.balanceCents)} />
        </div>
      )}

      {p.terms && (
        <div style={{ borderTop: '1px solid var(--rule)', marginTop: 12, paddingTop: 12 }}>
          <div className="eyebrow" style={{ fontSize: 10, marginBottom: 6 }}>Cancellation</div>
          <p style={{ fontSize: 12, lineHeight: 1.55, color: 'var(--ink-3)', margin: 0, whiteSpace: 'pre-line' }}>{p.terms}</p>
        </div>
      )}

      {p.expiresLocal && (
        <p style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 14, marginBottom: 0 }}>
          This quote is good through {fmtLocalInput(p.expiresLocal)}.
        </p>
      )}
    </div>
  );
}

function Row({ k, v, bold, muted, tone }: { k: string; v: string; bold?: boolean; muted?: boolean; tone?: 'signal' }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 13, color: muted ? 'var(--ink-4)' : 'var(--ink)' }}>
      <span style={{ fontWeight: bold ? 600 : 400, color: tone === 'signal' ? 'var(--signal)' : undefined }}>{k}</span>
      <span className="tabular-nums" style={{ fontWeight: bold ? 600 : 400, color: tone === 'signal' ? 'var(--signal)' : undefined }}>
        {v}
      </span>
    </div>
  );
}

function Note({ tone, children }: { tone: 'ok' | 'signal'; children: React.ReactNode }) {
  const color = tone === 'ok' ? '#1d6b46' : 'var(--signal)';
  return (
    <div style={{ borderLeft: `3px solid ${color}`, paddingLeft: 12, fontSize: 13, lineHeight: 1.55, color: 'var(--ink)' }}>{children}</div>
  );
}

// ─── Small building blocks (mirroring AgreementForm) ────────────────────────

const grid3: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(3, 1fr)',
  gap: 16,
  marginBottom: 16,
};

const inputStyle: React.CSSProperties = {
  font: 'inherit',
  fontSize: 13,
  color: 'var(--ink)',
  background: 'var(--paper)',
  border: '1px solid var(--rule)',
  padding: '9px 10px',
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
};

const hintStyle: React.CSSProperties = { fontSize: 12, color: 'var(--ink-4)', lineHeight: 1.5, margin: 0 };

const ghostBtn: React.CSSProperties = {
  font: 'inherit',
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: '.06em',
  color: 'var(--ink)',
  background: 'transparent',
  border: '1px solid var(--ink)',
  padding: '8px 14px',
  cursor: 'pointer',
};

const primaryBtn: React.CSSProperties = {
  font: 'inherit',
  background: 'var(--ink)',
  color: 'var(--paper)',
  fontSize: 12,
  fontWeight: 600,
  letterSpacing: '.18em',
  textTransform: 'uppercase',
  padding: '16px 32px',
  border: 'none',
  cursor: 'pointer',
};

const textBtn: React.CSSProperties = {
  font: 'inherit',
  fontSize: 12,
  fontWeight: 600,
  color: 'var(--ink-3)',
  background: 'transparent',
  border: 'none',
  padding: 0,
  cursor: 'pointer',
  textDecoration: 'underline',
  textUnderlineOffset: 3,
};

function FormBlock({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section>
      <div style={{ borderBottom: '1px solid var(--ink)', paddingBottom: 8, marginBottom: 16 }}>
        <span className="font-serif" style={{ fontSize: 16, fontWeight: 500, color: 'var(--ink)', letterSpacing: '-0.01em' }}>
          {title}
        </span>
        {hint && <span style={{ marginLeft: 12, fontSize: 12, color: 'var(--ink-4)' }}>{hint}</span>}
      </div>
      {children}
    </section>
  );
}

function Field({ label, hint, required, children }: { label: string; hint?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{ fontSize: 11, letterSpacing: '.08em', textTransform: 'uppercase', fontWeight: 600, color: 'var(--ink-3)' }}>
        {label}
        {required && <span style={{ color: 'var(--signal)' }}> *</span>}
      </span>
      {children}
      {hint && <span style={{ fontSize: 11, color: 'var(--ink-4)', lineHeight: 1.45 }}>{hint}</span>}
    </label>
  );
}

function RadioCard({
  checked,
  onSelect,
  disabled,
  title,
  body,
}: {
  checked: boolean;
  onSelect: () => void;
  disabled?: boolean;
  title: string;
  body: string;
}) {
  return (
    <label
      style={{
        display: 'flex',
        gap: 10,
        alignItems: 'flex-start',
        border: `1px solid ${checked ? 'var(--ink)' : 'var(--rule)'}`,
        padding: '14px 16px',
        cursor: disabled ? 'not-allowed' : 'pointer',
        maxWidth: 380,
        flex: '1 1 300px',
        opacity: disabled ? 0.55 : 1,
      }}
    >
      <input type="radio" checked={checked} disabled={disabled} onChange={onSelect} style={{ marginTop: 3, accentColor: 'var(--signal)' }} />
      <span>
        <span style={{ display: 'block', fontSize: 13, fontWeight: 600, color: 'var(--ink)' }}>{title}</span>
        <span style={{ display: 'block', fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.5, marginTop: 3 }}>{body}</span>
      </span>
    </label>
  );
}

function Check({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <label style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--ink)', cursor: 'pointer' }}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} style={{ accentColor: 'var(--signal)' }} />
      {label}
    </label>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function toCents(s: string): number {
  const n = Math.round(Number(String(s).replace(/[^0-9.\-]/g, '')) * 100);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** Cents to an input-friendly dollar string: "300" or "123.45". */
function dollarsStr(cents: number): string {
  if (!Number.isFinite(cents) || cents <= 0) return '';
  return cents % 100 === 0 ? String(cents / 100) : (cents / 100).toFixed(2);
}

function fmtDollars(dollars: number): string {
  return fmtCents(Math.round(dollars * 100));
}

function pct(rate: number): string {
  return `${Math.round(rate * 1000) / 10}%`;
}

/** ISO instant -> the browser-local "YYYY-MM-DDTHH:mm" a datetime-local input wants. */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fmtLocalInput(local: string): string {
  const d = new Date(local);
  if (Number.isNaN(d.getTime())) return local;
  return d.toLocaleString('en-US', { month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}
