'use client';

import { useActionState, useState, useTransition } from 'react';
import Link from 'next/link';
import {
  clearSeasonAction,
  saveRatePlanAction,
  saveTaxConfigAction,
  testQuoteAction,
  writeSeasonAction,
  type RatesFormState,
  type TestQuoteResult,
} from './rates-actions';
import type { RateDayRow, RatePlanRow, TaxConfigRow } from '@/lib/rate-plan';
import { regionLabel } from '@/lib/property-scope';

/**
 * The property Rates & taxes tab: Guesty's Pricing & policies, Tax
 * configuration and Calendar rules on one screen.
 *
 *   - property_rate_plans editor (nightly, fees, discounts, the direct markup
 *     as a visible number, stay rules, guest times, policies)
 *   - property_tax_config editor (jurisdiction, rates, what it applies to,
 *     the long-stay exemption, channels that collect their own)
 *   - a seasons tool that bulk-writes property_rate_days, and a clear tool
 *   - a live quote tester that prices a stay the way staycapeann.com will
 *
 * Every number says where it reaches: authoritative for direct quotes and
 * the Helm calendar when this home is helm-run, a draft otherwise (Guesty
 * and PriceLabs set the live prices until the cutover).
 */

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const CHANNELS = ['direct', 'sca', 'airbnb', 'vrbo', 'booking_com', 'manual'];
const CANCELLATION_OPTIONS: Array<{ id: string; label: string }> = [
  { id: 'sca_50_30', label: 'Stay Cape Ann standard (50% past 30 days)' },
  { id: 'flexible', label: 'Flexible' },
  { id: 'moderate', label: 'Moderate' },
  { id: 'strict', label: 'Strict' },
  { id: 'non_refundable', label: 'Non-refundable' },
  { id: 'custom', label: 'Custom (terms below)' },
];

const dollars = (cents: number | null | undefined): string => (cents == null ? '' : (cents / 100).toFixed(cents % 100 === 0 ? 0 : 2));
const money = (cents: number, currency = 'USD'): string =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 2 }).format(cents / 100);
const pct = (rate: number): string => `${Math.round(rate * 10000) / 100}%`;

export function RatesPanel({
  propertyId,
  plan,
  tax,
  days,
  helmRun,
  region,
  today,
}: {
  propertyId: string;
  plan: RatePlanRow | null;
  tax: TaxConfigRow | null;
  /** Overrides from today forward (a year), for the summary strip. */
  days: RateDayRow[];
  helmRun: boolean;
  region: string | null;
  today: string;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 28, paddingBottom: 8 }}>
      <ReachBanner helmRun={helmRun} hasPlan={!!plan} hasTax={!!tax} region={region} />
      <PlanForm propertyId={propertyId} plan={plan} />
      <TaxForm propertyId={propertyId} tax={tax} region={region} />
      <OverridesStrip days={days} plan={plan} today={today} />
      <SeasonsTool propertyId={propertyId} today={today} hasPlan={!!plan} />
      <QuoteTester propertyId={propertyId} today={today} hasPlan={!!plan} guestsIncluded={plan?.guests_included ?? 2} />
    </div>
  );
}

// ── Banner ──────────────────────────────────────────────────────────────────

function ReachBanner({ helmRun, hasPlan, hasTax, region }: { helmRun: boolean; hasPlan: boolean; hasTax: boolean; region: string | null }) {
  const isCapeAnn = (region ?? 'cape_ann') === 'cape_ann';
  return (
    <div style={{ borderLeft: `3px solid ${helmRun ? 'var(--positive)' : 'var(--signal)'}`, padding: '10px 14px', background: 'var(--paper-2)', fontSize: 13, color: 'var(--ink-2)', lineHeight: 1.55 }}>
      <div style={{ fontWeight: 600, color: 'var(--ink)', marginBottom: 2 }}>
        {helmRun ? 'Authoritative for direct quotes and the Helm calendar.' : 'Draft: Guesty and PriceLabs set the live prices.'}
      </div>
      {helmRun
        ? 'staycapeann.com, custom quotes and payment links price from this plan and these day overrides. OTA nightly rates are pushed by PriceLabs directly; this is the operator reference for them.'
        : 'Until this home is cut over, the OTAs and staycapeann.com read Guesty. Fill this in now so the switch has a rate card waiting.'}
      {!hasPlan && <div style={{ marginTop: 6, color: 'var(--negative)' }}>No rate plan yet. A base nightly rate is the one required field.</div>}
      {!hasTax && !isCapeAnn && (
        <div style={{ marginTop: 6, color: 'var(--negative)' }}>
          No tax config for a {regionLabel(region)} home. Quotes and payment links refuse until the jurisdiction is saved; Helm never assumes 11.7%.
        </div>
      )}
      {!hasTax && isCapeAnn && <div style={{ marginTop: 6, color: 'var(--ink-3)' }}>No tax config row: quotes fall back to the Massachusetts occupancy table (occupancy-tax.ts) for this Cape Ann home.</div>}
    </div>
  );
}

// ── Rate plan ───────────────────────────────────────────────────────────────

function PlanForm({ propertyId, plan }: { propertyId: string; plan: RatePlanRow | null }) {
  const action = saveRatePlanAction.bind(null, propertyId);
  const [state, formAction, pending] = useActionState<RatesFormState, FormData>(action, { error: null });
  const weekendDays = new Set(plan?.weekend_days ?? [5, 6]);
  const formKey = plan?.updated_at ?? 'new';
  return (
    <form key={formKey} action={formAction} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <SectionHead
        title="Rate plan"
        note={plan?.updated_at ? `Saved ${new Date(plan.updated_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}${plan.updated_by ? ` by ${plan.updated_by}` : ''}` : 'Not saved yet'}
      />

      <Group label="Nightly">
        <Field label="Base nightly" hint="USD per night" required>
          <input name="base_nightly" inputMode="decimal" defaultValue={dollars(plan?.base_nightly_cents)} placeholder="350" style={input} required />
        </Field>
        <Field label="Weekend nightly" hint="blank = same as base">
          <input name="weekend_nightly" inputMode="decimal" defaultValue={dollars(plan?.weekend_nightly_cents)} placeholder="350" style={input} />
        </Field>
        <Field label="Weekend days" hint="which nights take the weekend rate">
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {WEEKDAYS.map((d, i) => (
              <label key={d} style={chip}>
                <input type="checkbox" name="weekend_days" value={i} defaultChecked={weekendDays.has(i)} /> {d}
              </label>
            ))}
          </div>
        </Field>
        <Field label="Currency">
          <input name="currency" defaultValue={plan?.currency ?? 'USD'} style={{ ...input, maxWidth: 90 }} />
        </Field>
      </Group>

      <Group label="Guests and fees">
        <Field label="Guests included" hint="in the nightly rate">
          <input name="guests_included" inputMode="numeric" defaultValue={plan?.guests_included ?? 2} style={input} />
        </Field>
        <Field label="Extra guest" hint="per guest per night, taxed like the fare">
          <input name="extra_guest" inputMode="decimal" defaultValue={dollars(plan?.extra_guest_cents_per_night ?? 0)} style={input} />
        </Field>
        <Field label="Cleaning fee" hint="per stay">
          <input name="cleaning_fee" inputMode="decimal" defaultValue={dollars(plan?.cleaning_fee_cents ?? 0)} style={input} />
        </Field>
        <Field label="Pet fee" hint="blank = no pets fee">
          <input name="pet_fee" inputMode="decimal" defaultValue={dollars(plan?.pet_fee_cents)} style={input} />
        </Field>
        <Field label="Security deposit" hint="held, not charged">
          <input name="security_deposit" inputMode="decimal" defaultValue={dollars(plan?.security_deposit_cents)} style={input} />
        </Field>
        <Field label="Max occupancy" hint="a quote above this is flagged">
          <input name="max_occupancy" inputMode="numeric" defaultValue={plan?.max_occupancy ?? ''} style={input} />
        </Field>
      </Group>

      <Group label="Discounts and markup">
        <Field label="Weekly discount" hint="% off accommodation at 7+ nights">
          <input name="weekly_discount_pct" inputMode="decimal" defaultValue={plan?.weekly_discount_pct ?? 0} style={input} />
        </Field>
        <Field label="Monthly discount" hint="% off at 28+ nights, wins over weekly">
          <input name="monthly_discount_pct" inputMode="decimal" defaultValue={plan?.monthly_discount_pct ?? 0} style={input} />
        </Field>
        <Field label="Direct markup" hint="% on accommodation for direct / SCA only. Guesty hid +6% here; it is a visible line now.">
          <input name="direct_markup_pct" inputMode="decimal" defaultValue={plan?.direct_markup_pct ?? 0} style={input} />
        </Field>
      </Group>

      <Group label="Stay rules">
        <Field label="Min nights" hint="default; a day override can raise it">
          <input name="min_nights_default" inputMode="numeric" defaultValue={plan?.min_nights_default ?? 2} style={input} />
        </Field>
        <Field label="Max nights" hint="blank = no cap">
          <input name="max_nights" inputMode="numeric" defaultValue={plan?.max_nights ?? ''} style={input} />
        </Field>
        <Field label="Advance notice" hint="hours before check-in">
          <input name="advance_notice_hours" inputMode="numeric" defaultValue={plan?.advance_notice_hours ?? 24} style={input} />
        </Field>
        <Field label="Booking window" hint="days ahead a stay may start">
          <input name="booking_window_days" inputMode="numeric" defaultValue={plan?.booking_window_days ?? 365} style={input} />
        </Field>
        <Field label="Turnover buffer" hint="nights kept free between stays">
          <input name="turnover_buffer_days" inputMode="numeric" defaultValue={plan?.turnover_buffer_days ?? 0} style={input} />
        </Field>
      </Group>

      <Group label="Guest times and house">
        <Field label="Check-in" hint="guest-facing; cleaner guidance lives on the registry">
          <input name="checkin_time" defaultValue={plan?.checkin_time ?? '16:00'} placeholder="16:00" style={input} />
        </Field>
        <Field label="Checkout">
          <input name="checkout_time" defaultValue={plan?.checkout_time ?? '11:00'} placeholder="11:00" style={input} />
        </Field>
        <Field label="Pets">
          <label style={chip}>
            <input type="checkbox" name="pets_allowed" defaultChecked={plan?.pets_allowed ?? false} /> Pets allowed
          </label>
        </Field>
        <Field label="Quiet hours" hint="free text, e.g. 10 PM to 8 AM">
          <input name="quiet_hours" defaultValue={plan?.quiet_hours ?? ''} style={input} />
        </Field>
      </Group>

      <Group label="Policies" wide>
        <Field label="Cancellation" hint="the key staycapeann.com prints">
          <select name="cancellation_policy_key" defaultValue={plan?.cancellation_policy_key ?? 'sca_50_30'} style={input}>
            {CANCELLATION_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </select>
        </Field>
        <Field label="Cancellation terms" hint="shown to the guest when the key is custom" wide>
          <textarea name="cancellation_terms" rows={3} defaultValue={plan?.cancellation_terms ?? ''} style={{ ...input, resize: 'vertical', fontFamily: 'inherit' }} />
        </Field>
        <Field label="House rules" hint="the policy copy; the guest-facing listing text lives on the Listing tab" wide>
          <textarea name="house_rules" rows={3} defaultValue={plan?.house_rules ?? ''} style={{ ...input, resize: 'vertical', fontFamily: 'inherit' }} />
        </Field>
      </Group>

      <FormFooter state={state} pending={pending} label="Save rate plan" busy="Saving…" />
    </form>
  );
}

// ── Tax config ──────────────────────────────────────────────────────────────

function TaxForm({ propertyId, tax, region }: { propertyId: string; tax: TaxConfigRow | null; region: string | null }) {
  const action = saveTaxConfigAction.bind(null, propertyId);
  const [state, formAction, pending] = useActionState<RatesFormState, FormData>(action, { error: null });
  const applies = new Set(tax?.applies_to ?? ['accommodation', 'cleaning']);
  const collected = new Set(tax?.collected_by_channels ?? []);
  const defaultJurisdiction = tax?.jurisdiction ?? (region === 'bridgeport_ct' ? 'CT' : region === 'lighthouse_point_fl' ? 'FL' : 'MA');
  const total = tax ? tax.state_rate + tax.local_rate + tax.cif_rate : null;
  return (
    <form key={tax ? JSON.stringify(tax) : 'new'} action={formAction} style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <SectionHead title="Taxes" note={total != null ? `${pct(total)} on ${[...applies].join(' + ')}` : 'No row yet'} />
      <p style={{ margin: 0, fontSize: 12, color: 'var(--ink-3)', lineHeight: 1.55 }}>
        Quote-side jurisdiction only. Owner statements keep reading the Massachusetts table in occupancy-tax.ts; this row is what
        staycapeann.com, custom quotes and payment links charge for this home.
      </p>
      <Group label="Jurisdiction and rates">
        <Field label="Jurisdiction" required>
          <select name="jurisdiction" defaultValue={defaultJurisdiction} style={input}>
            <option value="MA">MA (Massachusetts)</option>
            <option value="CT">CT (Connecticut)</option>
            <option value="FL">FL (Florida)</option>
          </select>
        </Field>
        <Field label="State rate" hint="percent, e.g. 15 or 5.7">
          <input name="state_pct" inputMode="decimal" defaultValue={tax ? Math.round(tax.state_rate * 10000) / 100 : ''} style={input} />
        </Field>
        <Field label="Local rate" hint="percent; Gloucester adds 6">
          <input name="local_pct" inputMode="decimal" defaultValue={tax ? Math.round(tax.local_rate * 10000) / 100 : ''} style={input} />
        </Field>
        <Field label="Community impact fee" hint="percent; 3 on CIF homes, else 0">
          <input name="cif_pct" inputMode="decimal" defaultValue={tax ? Math.round(tax.cif_rate * 10000) / 100 : ''} style={input} />
        </Field>
        <Field label="Effective from">
          <input name="effective_from" type="date" defaultValue={tax?.effective_from ?? ''} style={input} />
        </Field>
      </Group>
      <Group label="What it applies to">
        <Field label="Taxed base">
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <label style={chip}>
              <input type="checkbox" name="applies_to" value="accommodation" defaultChecked={applies.has('accommodation')} /> Accommodation
            </label>
            <label style={chip}>
              <input type="checkbox" name="applies_to" value="cleaning" defaultChecked={applies.has('cleaning')} /> Cleaning fee
            </label>
          </div>
        </Field>
        <Field label="Long-stay exemption" hint="exempt when nights exceed this; blank = never">
          <input name="long_stay_exempt_over_nights" inputMode="numeric" defaultValue={tax?.long_stay_exempt_over_nights ?? ''} style={input} />
        </Field>
        <Field label="Collected by the channel" hint="channels that collect and remit themselves">
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {['airbnb', 'vrbo', 'booking_com'].map((c) => (
              <label key={c} style={chip}>
                <input type="checkbox" name="collected_by_channels" value={c} defaultChecked={collected.has(c)} /> {c}
              </label>
            ))}
          </div>
        </Field>
        <Field label="Notes" wide>
          <input name="notes" defaultValue={tax?.notes ?? ''} placeholder="Where the rate came from" style={input} />
        </Field>
      </Group>
      <FormFooter state={state} pending={pending} label="Save tax config" busy="Saving…" />
    </form>
  );
}

// ── Overrides summary ───────────────────────────────────────────────────────

function OverridesStrip({ days, plan, today }: { days: RateDayRow[]; plan: RatePlanRow | null; today: string }) {
  const priced = days.filter((d) => d.nightly_cents != null);
  const min = priced.length ? Math.min(...priced.map((d) => d.nightly_cents as number)) : null;
  const max = priced.length ? Math.max(...priced.map((d) => d.nightly_cents as number)) : null;
  const sixty = new Date(`${today}T00:00:00Z`);
  sixty.setUTCDate(sixty.getUTCDate() + 60);
  const sixtyIso = sixty.toISOString().slice(0, 10);
  const distinct60 = new Set(priced.filter((d) => d.date < sixtyIso).map((d) => d.nightly_cents)).size;
  const closed = days.filter((d) => d.closed).length;
  const sources = [...new Set(days.map((d) => d.source))];
  return (
    <div>
      <SectionHead title="Day overrides" note={`${days.length} in the next year`} />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 0, borderTop: '1px solid var(--rule)', borderBottom: '1px solid var(--rule)', marginTop: 10 }}>
        <Cell label="Priced days" value={String(priced.length)} />
        <Cell label="Range" value={min != null && max != null ? `${money(min, plan?.currency)} to ${money(max, plan?.currency)}` : '-'} />
        <Cell label="Distinct next 60d" value={String(distinct60)} hint={distinct60 >= 2 ? 'pricing is flowing' : 'flat: a pricing feed has not written here'} />
        <Cell label="Closed nights" value={String(closed)} />
        <Cell label="Sources" value={sources.length ? sources.join(', ') : '-'} />
      </div>
      <div style={{ marginTop: 10, fontSize: 12, color: 'var(--ink-3)' }}>
        Edit a single night, or drag a range, on the <Link href="/channels/calendar" style={{ color: 'var(--ink)', textDecoration: 'underline' }}>month grid</Link>. Bulk seasons below.
      </div>
    </div>
  );
}

function Cell({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div style={{ padding: '12px 14px 12px 0' }}>
      <div className="eyebrow">{label}</div>
      <div className="font-serif" style={{ fontSize: 20, color: 'var(--ink)', marginTop: 4, letterSpacing: '-0.01em' }}>{value}</div>
      {hint && <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 2 }}>{hint}</div>}
    </div>
  );
}

// ── Seasons ─────────────────────────────────────────────────────────────────

function SeasonsTool({ propertyId, today, hasPlan }: { propertyId: string; today: string; hasPlan: boolean }) {
  const write = writeSeasonAction.bind(null, propertyId);
  const clear = clearSeasonAction.bind(null, propertyId);
  const [wState, writeAction, writing] = useActionState<RatesFormState, FormData>(write, { error: null });
  const [cState, clearAction, clearing] = useActionState<RatesFormState, FormData>(clear, { error: null });
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
      <SectionHead title="Seasons" note="bulk-write day overrides" />
      {!hasPlan && <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>Save the rate plan first; overrides sit on top of it.</div>}
      <form action={writeAction} style={{ display: 'flex', flexDirection: 'column', gap: 14, border: '1px solid var(--rule)', padding: '16px 18px' }}>
        <div className="eyebrow">Write a season</div>
        <Group label="">
          <Field label="From" required>
            <input name="from" type="date" defaultValue={today} style={input} required />
          </Field>
          <Field label="To" hint="inclusive" required>
            <input name="to" type="date" style={input} required />
          </Field>
          <Field label="Nightly" hint="blank = keep each day's rate">
            <input name="nightly" inputMode="decimal" placeholder="425" style={input} />
          </Field>
          <Field label="Min nights" hint="blank = keep">
            <input name="min_nights" inputMode="numeric" style={input} />
          </Field>
          <Field label="Closed">
            <select name="closed_mode" defaultValue="" style={input}>
              <option value="">keep</option>
              <option value="close">close these nights</option>
              <option value="open">reopen</option>
            </select>
          </Field>
          <Field label="No arrival (CTA)">
            <select name="cta_mode" defaultValue="" style={input}>
              <option value="">keep</option>
              <option value="set">no check-in on these days</option>
              <option value="clear">allow check-in</option>
            </select>
          </Field>
          <Field label="No departure (CTD)">
            <select name="ctd_mode" defaultValue="" style={input}>
              <option value="">keep</option>
              <option value="set">no checkout on these days</option>
              <option value="clear">allow checkout</option>
            </select>
          </Field>
          <Field label="Note" hint="why, e.g. Fourth of July">
            <input name="note" style={input} />
          </Field>
        </Group>
        <Field label="Days of week" hint="only these weekdays inside the range">
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {WEEKDAYS.map((d, i) => (
              <label key={d} style={chip}>
                <input type="checkbox" name="weekdays" value={i} defaultChecked /> {d}
              </label>
            ))}
          </div>
        </Field>
        <FormFooter state={wState} pending={writing} label="Write season" busy="Writing…" />
      </form>
      <form action={clearAction} style={{ display: 'flex', flexDirection: 'column', gap: 14, border: '1px solid var(--rule)', padding: '16px 18px' }}>
        <div className="eyebrow">Clear overrides</div>
        <Group label="">
          <Field label="From" required>
            <input name="from" type="date" defaultValue={today} style={input} required />
          </Field>
          <Field label="To" hint="inclusive" required>
            <input name="to" type="date" style={input} required />
          </Field>
        </Group>
        <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>Every override in the range goes; the plan's own rate and rules return. Seeded PriceLabs days go too.</div>
        <FormFooter state={cState} pending={clearing} label="Clear range" busy="Clearing…" ghost />
      </form>
    </div>
  );
}

// ── Quote tester ────────────────────────────────────────────────────────────

function QuoteTester({ propertyId, today, hasPlan, guestsIncluded }: { propertyId: string; today: string; hasPlan: boolean; guestsIncluded: number }) {
  const [checkIn, setCheckIn] = useState(today);
  const [checkOut, setCheckOut] = useState('');
  const [guests, setGuests] = useState(String(guestsIncluded));
  const [channel, setChannel] = useState('direct');
  const [result, setResult] = useState<TestQuoteResult | null>(null);
  const [pending, start] = useTransition();

  const run = () => {
    start(async () => {
      const r = await testQuoteAction(propertyId, { checkIn, checkOut, guests: Number(guests) || 1, channel });
      setResult(r);
    });
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <SectionHead title="Quote tester" note="prices a stay exactly as staycapeann.com will" />
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <Field label="Check-in">
          <input type="date" value={checkIn} onChange={(e) => setCheckIn(e.target.value)} style={input} />
        </Field>
        <Field label="Checkout">
          <input type="date" value={checkOut} onChange={(e) => setCheckOut(e.target.value)} style={input} />
        </Field>
        <Field label="Guests">
          <input inputMode="numeric" value={guests} onChange={(e) => setGuests(e.target.value)} style={{ ...input, maxWidth: 80 }} />
        </Field>
        <Field label="Channel">
          <select value={channel} onChange={(e) => setChannel(e.target.value)} style={input}>
            {CHANNELS.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </Field>
        <button type="button" onClick={run} disabled={pending || !hasPlan || !checkOut} style={{ ...primaryBtn, opacity: pending || !hasPlan || !checkOut ? 0.6 : 1 }}>
          {pending ? 'Pricing…' : 'Price it'}
        </button>
      </div>
      {result && !result.ok && <div style={{ fontSize: 12, color: 'var(--negative)' }}>{result.error}</div>}
      {result && result.ok && <QuoteBreakdown result={result} />}
    </div>
  );
}

function QuoteBreakdown({ result }: { result: Extract<TestQuoteResult, { ok: true }> }) {
  const q = result.quote;
  const cur = q.currency;
  const row = (label: string, value: string, tone?: 'muted' | 'strong') => (
    <div key={label} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '7px 0', borderBottom: '1px solid var(--rule)', fontSize: 13, color: tone === 'muted' ? 'var(--ink-3)' : 'var(--ink)', fontWeight: tone === 'strong' ? 600 : 400 }}>
      <span>{label}</span>
      <span className="font-mono">{value}</span>
    </div>
  );
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(260px, 1fr) minmax(260px, 1fr)', gap: 24 }}>
      <div>
        {row(`${q.nights} night${q.nights === 1 ? '' : 's'}`, money(q.accommodation_cents, cur))}
        {q.extra_guest_cents > 0 && row('Extra guests', money(q.extra_guest_cents, cur))}
        {q.discount_cents > 0 && row(q.discount_label ?? 'Discount', `-${money(q.discount_cents, cur)}`)}
        {q.markup_cents > 0 && row('Direct rate adjustment', money(q.markup_cents, cur))}
        {q.cleaning_cents > 0 && row('Cleaning fee', money(q.cleaning_cents, cur))}
        {row('Subtotal', money(q.subtotal_cents, cur))}
        {row(
          q.tax_exempt ? `Tax (${pct(q.tax_rate)}, exempt)` : `Tax ${pct(q.tax_rate)} on ${money(q.taxable_base_cents, cur)}`,
          money(q.tax_cents, cur),
          'muted',
        )}
        {row('Total', money(q.total_cents, cur), 'strong')}
        <div style={{ marginTop: 8, fontSize: 11, color: 'var(--ink-4)' }}>
          Tax from {result.taxSource === 'config' ? `property_tax_config (${result.tax?.jurisdiction})` : 'the MA occupancy table (no config row)'}.
        </div>
        {q.violations.length > 0 && (
          <div style={{ marginTop: 8, fontSize: 12, color: 'var(--negative)' }}>
            Rules: {q.violations.map((v) => v.replace(/_/g, ' ')).join(', ')}. A guest would be told, not silently priced.
          </div>
        )}
      </div>
      <div>
        <div className="eyebrow" style={{ marginBottom: 6 }}>Nightly</div>
        <div style={{ maxHeight: 260, overflowY: 'auto', border: '1px solid var(--rule)' }}>
          {q.nightly.map((n) => (
            <div key={n.date} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 10px', fontSize: 12, borderBottom: '1px solid var(--rule)' }}>
              <span className="font-mono" style={{ color: 'var(--ink-2)' }}>{n.date}</span>
              <span style={{ color: 'var(--ink-4)' }}>{n.source}</span>
              <span className="font-mono">{money(n.cents, cur)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Shared bits ─────────────────────────────────────────────────────────────

function SectionHead({ title, note }: { title: string; note?: string | null }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, borderBottom: '1px solid var(--ink)', paddingBottom: 8 }}>
      <h3 className="font-serif" style={{ fontSize: 22, fontWeight: 400, letterSpacing: '-0.01em', margin: 0, color: 'var(--ink)' }}>{title}</h3>
      {note && <span style={{ fontSize: 11, color: 'var(--ink-4)', letterSpacing: '.04em' }}>{note}</span>}
    </div>
  );
}

function Group({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return (
    <div>
      {label && <div className="eyebrow" style={{ marginBottom: 10 }}>{label}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: wide ? '1fr' : 'repeat(auto-fill, minmax(200px, 1fr))', gap: '12px 18px' }}>{children}</div>
    </div>
  );
}

function Field({ label, hint, children, required, wide }: { label: string; hint?: string; children: React.ReactNode; required?: boolean; wide?: boolean }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4, gridColumn: wide ? '1 / -1' : undefined }}>
      <span style={{ fontSize: 11, fontWeight: 600, letterSpacing: '.1em', textTransform: 'uppercase', color: 'var(--ink-3)' }}>
        {label}
        {required && <span style={{ color: 'var(--signal)' }}> *</span>}
      </span>
      {children}
      {hint && <span style={{ fontSize: 11, color: 'var(--ink-4)', lineHeight: 1.4 }}>{hint}</span>}
    </label>
  );
}

function FormFooter({ state, pending, label, busy, ghost }: { state: RatesFormState; pending: boolean; label: string; busy: string; ghost?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
      <button type="submit" disabled={pending} style={{ ...(ghost ? ghostBtn : primaryBtn), opacity: pending ? 0.6 : 1 }}>
        {pending ? busy : label}
      </button>
      {state.error && <span style={{ fontSize: 12, color: 'var(--negative)' }}>{state.error}</span>}
      {!state.error && state.ok && state.message && <span style={{ fontSize: 12, color: 'var(--positive)' }}>{state.message}</span>}
    </div>
  );
}

const input: React.CSSProperties = {
  background: 'var(--paper)',
  border: '1px solid var(--rule)',
  padding: '8px 10px',
  fontSize: 13,
  color: 'var(--ink)',
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
};

const chip: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 6,
  fontSize: 12,
  color: 'var(--ink-2)',
  border: '1px solid var(--rule)',
  padding: '5px 9px',
  cursor: 'pointer',
};

const primaryBtn: React.CSSProperties = {
  background: 'var(--ink)',
  color: 'var(--paper)',
  border: '1px solid var(--ink)',
  padding: '9px 16px',
  fontSize: 11,
  fontWeight: 600,
  letterSpacing: '.16em',
  textTransform: 'uppercase',
  cursor: 'pointer',
};

const ghostBtn: React.CSSProperties = {
  background: 'transparent',
  color: 'var(--ink-3)',
  border: '1px solid var(--rule)',
  padding: '9px 14px',
  fontSize: 11,
  fontWeight: 500,
  letterSpacing: '.16em',
  textTransform: 'uppercase',
  cursor: 'pointer',
};
