'use client';

import { useActionState, useState, useTransition, type ReactNode } from 'react';
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
import { clearRatesConfirm } from '@/lib/irreversible-confirms';
import { useConfirm } from '@/components/ConfirmDialog';
import { askFromSentence } from '@/lib/confirm-question';
import { HousePolicyReadout, type HousePolicyValues } from './HousePolicyReadout';
import { etStamp } from '@/lib/stable-time';
import { buttonClass } from '@/lib/button-class';
import {
  CHANNEL_LABELS,
  PLAN_FIELDS,
  WEEKDAYS,
  feeLines,
  money,
  monthLabel,
  monthStart,
  monthWeeks,
  nightLines,
  overridesSummary,
  pctLabel,
  planFormValues,
  planNightCents,
  stayLines,
  taxLine,
  type PlanQuestion,
} from '@/lib/pricing-panel';

/**
 * The property page's Pricing section (Guest & listing tab): Guesty's
 * Pricing & policies, Tax configuration and Calendar rules, as three plain
 * questions and two tools.
 *
 *   What does a night cost?          base, weekend, discounts, direct markup
 *   How long must a guest stay?      minimum and maximum, notice, window,
 *                                    the guest check-in
 *   What fees and taxes are added?   cleaning, extra guests, pets, deposit,
 *                                    and the tax the quotes charge
 *   Nights that differ               a month calendar of the day overrides;
 *                                    select nights to set or clear them
 *   Price a stay                     one line, priced as staycapeann.com would
 *
 * Each question reads as a sentence until its Edit. The plan saves whole, so
 * a question's form posts its own fields and every other field hidden at its
 * saved value (src/lib/pricing-panel.ts). Checkout, occupancy, pets, quiet
 * hours, cancellation and house rules are the House policy columns on
 * properties and are read, not edited, here.
 *
 * Who may edit these is unchanged: anyone who reaches the page, as before.
 * On a Guesty-run home the page's section head says once that this is
 * Helm's plan and Guesty's prices are what guests pay today.
 */

export function RatesPanel({
  propertyId,
  plan,
  tax,
  days,
  region,
  today,
  housePolicy,
}: {
  propertyId: string;
  plan: RatePlanRow | null;
  /** The House policy columns on properties, which the plan reads. */
  housePolicy: HousePolicyValues;
  tax: TaxConfigRow | null;
  /** Overrides from today forward (a year), for the calendar. */
  days: RateDayRow[];
  helmRun: boolean;
  region: string | null;
  today: string;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <PlanBlock
        q="night"
        title="What does a night cost?"
        name="the nightly price"
        propertyId={propertyId}
        plan={plan}
        note={plan?.updated_at ? `Saved ${etStamp(plan.updated_at)}${plan.updated_by ? ` by ${plan.updated_by}` : ''}` : undefined}
        read={(p) => <Sentence lines={nightLines(p)} />}
        fields={(v) => (
          <>
            <Field label="Base nightly" required>
              <input name="base_nightly" inputMode="decimal" defaultValue={v.base_nightly as string} placeholder="350" style={input} required />
            </Field>
            <Field label="Weekend nightly" hint="blank: same as base">
              <input name="weekend_nightly" inputMode="decimal" defaultValue={v.weekend_nightly as string} style={input} />
            </Field>
            <Field label="Weekend nights" wide>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {WEEKDAYS.map((d, i) => (
                  <label key={d} style={chip}>
                    <input type="checkbox" name="weekend_days" value={i} defaultChecked={(v.weekend_days as string[]).includes(String(i))} /> {d}
                  </label>
                ))}
              </div>
            </Field>
            <Field label="Off a week" hint="% at 7 nights or more">
              <input name="weekly_discount_pct" inputMode="decimal" defaultValue={v.weekly_discount_pct as string} style={input} />
            </Field>
            <Field label="Off a month" hint="% at 28 nights or more">
              <input name="monthly_discount_pct" inputMode="decimal" defaultValue={v.monthly_discount_pct as string} style={input} />
            </Field>
            <Field label="Direct bookings" hint="% more, direct and Stay Cape Ann only">
              <input name="direct_markup_pct" inputMode="decimal" defaultValue={v.direct_markup_pct as string} style={input} />
            </Field>
            <Field label="Currency">
              <input name="currency" defaultValue={v.currency as string} style={{ ...input, maxWidth: 90 }} />
            </Field>
          </>
        )}
      />

      <PlanBlock
        q="stay"
        title="How long must a guest stay?"
        name="the stay rules"
        propertyId={propertyId}
        plan={plan}
        read={(p) => <Sentence lines={stayLines(p)} />}
        footer={<HousePolicyReadout propertyId={propertyId} values={housePolicy} fields={['checkout', 'pets', 'cancellation']} />}
        fields={(v) => (
          <>
            <Field label="Minimum nights" hint="a night in the calendar can ask more">
              <input name="min_nights_default" inputMode="numeric" defaultValue={v.min_nights_default as string} style={input} />
            </Field>
            <Field label="Maximum nights" hint="blank: no cap">
              <input name="max_nights" inputMode="numeric" defaultValue={v.max_nights as string} style={input} />
            </Field>
            <Field label="Notice" hint="hours before check-in">
              <input name="advance_notice_hours" inputMode="numeric" defaultValue={v.advance_notice_hours as string} style={input} />
            </Field>
            <Field label="Book ahead" hint="days ahead a stay may start">
              <input name="booking_window_days" inputMode="numeric" defaultValue={v.booking_window_days as string} style={input} />
            </Field>
            <Field label="Nights kept free" hint="between stays">
              <input name="turnover_buffer_days" inputMode="numeric" defaultValue={v.turnover_buffer_days as string} style={input} />
            </Field>
            <Field label="Guest check-in" hint="what the guest is told; the cleaner deadline is on Facts">
              <input name="checkin_time" defaultValue={v.checkin_time as string} placeholder="16:00" style={input} />
            </Field>
          </>
        )}
      />

      <FeesAndTaxes propertyId={propertyId} plan={plan} tax={tax} region={region} />
      <NightsThatDiffer propertyId={propertyId} plan={plan} days={days} today={today} />
      <PriceAStay propertyId={propertyId} today={today} hasPlan={!!plan} guestsIncluded={plan?.guests_included ?? 2} />
    </div>
  );
}

// ── Blocks ──────────────────────────────────────────────────────────────────

function Block({ title, note, action, children }: { title: string; note?: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <section style={{ borderTop: '1px solid var(--rule)', padding: '16px 0 22px' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap', minWidth: 0 }}>
          <h3 className="font-serif" style={{ fontSize: 18, fontWeight: 400, letterSpacing: '-0.01em', margin: 0, color: 'var(--ink)' }}>{title}</h3>
          {note && <span style={{ fontSize: 11, color: 'var(--ink-4)', letterSpacing: '.04em' }}>{note}</span>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function Sentence({ lines }: { lines: string[] }) {
  return <div style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--ink)', maxWidth: 820 }}>{lines.join(' · ')}</div>;
}

function EditButton({ what, label = 'Edit', onClick }: { what: string; label?: string; onClick: () => void }) {
  return (
    <button type="button" className={buttonClass('secondary', 'sm')} aria-label={label === 'Edit' ? `Edit ${what}` : undefined} onClick={onClick}>
      {label}
    </button>
  );
}

/** Close an open editor once a save brings a newer row (render-phase, no flash). */
function useCloseOnNewer(version: string): [boolean, (open: boolean) => void] {
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState(version);
  if (seen !== version) {
    setSeen(version);
    setOpen(false);
  }
  return [open, setOpen];
}

// ── The three questions ─────────────────────────────────────────────────────

function PlanBlock({
  q,
  title,
  name,
  propertyId,
  plan,
  note,
  read,
  fields,
  footer,
}: {
  q: PlanQuestion;
  title: string;
  /** What its Edit button says to a screen reader: "Edit the nightly price". */
  name: string;
  propertyId: string;
  plan: RatePlanRow | null;
  note?: ReactNode;
  read: (plan: RatePlanRow) => ReactNode;
  fields: (values: Record<string, string | string[]>) => ReactNode;
  footer?: ReactNode;
}) {
  const [editing, setEditing] = useCloseOnNewer(plan?.updated_at ?? 'new');
  // With no plan, the nightly price is the one thing to set, and every other
  // question waits for it (the save needs a base rate).
  const open = editing || (!plan && q === 'night');
  return (
    <Block
      title={title}
      note={note}
      action={plan && !open ? <EditButton what={name} onClick={() => setEditing(true)} /> : null}
    >
      {open ? (
        <PlanForm propertyId={propertyId} plan={plan} q={q} onCancel={plan ? () => setEditing(false) : undefined}>
          {fields(planFormValues(plan))}
        </PlanForm>
      ) : plan ? (
        read(plan)
      ) : (
        <div style={{ fontSize: 13, color: 'var(--ink-4)' }}>Set the nightly price first.</div>
      )}
      {footer && <div style={{ marginTop: 12 }}>{footer}</div>}
    </Block>
  );
}

function PlanForm({ propertyId, plan, q, onCancel, children }: { propertyId: string; plan: RatePlanRow | null; q: PlanQuestion; onCancel?: () => void; children: ReactNode }) {
  const action = saveRatePlanAction.bind(null, propertyId);
  const [state, formAction, pending] = useActionState<RatesFormState, FormData>(action, { error: null });
  // The plan saves whole: every field this question does not edit rides
  // along at its saved value, so nothing else resets to a default.
  const carried = Object.entries(planFormValues(plan))
    .filter(([name]) => !PLAN_FIELDS[q].includes(name))
    .flatMap(([name, v]) => (Array.isArray(v) ? v : [v]).map((value, i) => <input key={`${name}-${i}`} type="hidden" name={name} value={value} />));
  return (
    <form action={formAction} aria-label={`Rate plan: ${q}`} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {carried}
      <div style={grid}>{children}</div>
      <Footer state={state} pending={pending} label="Save" onCancel={onCancel} />
    </form>
  );
}

function FeesAndTaxes({ propertyId, plan, tax, region }: { propertyId: string; plan: RatePlanRow | null; tax: TaxConfigRow | null; region: string | null }) {
  const [feesOpen, setFeesOpen] = useCloseOnNewer(plan?.updated_at ?? 'new');
  const [taxOpen, setTaxOpen] = useCloseOnNewer(tax ? JSON.stringify(tax) : 'new');
  const t = taxLine(tax, region);
  return (
    <Block title="What fees and taxes are added?">
      <div style={{ display: 'grid', gap: 14 }}>
        <Row
          label="Fees"
          action={plan && !feesOpen ? <EditButton what="the fees" onClick={() => setFeesOpen(true)} /> : null}
          body={
            feesOpen && plan ? (
              <PlanForm propertyId={propertyId} plan={plan} q="fees" onCancel={() => setFeesOpen(false)}>
                {(() => {
                  const v = planFormValues(plan);
                  return (
                    <>
                      <Field label="Cleaning fee" hint="per stay">
                        <input name="cleaning_fee" inputMode="decimal" defaultValue={v.cleaning_fee as string} style={input} />
                      </Field>
                      <Field label="Guests in the rate">
                        <input name="guests_included" inputMode="numeric" defaultValue={v.guests_included as string} style={input} />
                      </Field>
                      <Field label="Each extra guest" hint="per night, taxed like the nights">
                        <input name="extra_guest" inputMode="decimal" defaultValue={v.extra_guest as string} style={input} />
                      </Field>
                      <Field label="Pet fee" hint="blank: none">
                        <input name="pet_fee" inputMode="decimal" defaultValue={v.pet_fee as string} style={input} />
                      </Field>
                      <Field label="Deposit" hint="held, not charged; blank: none">
                        <input name="security_deposit" inputMode="decimal" defaultValue={v.security_deposit as string} style={input} />
                      </Field>
                    </>
                  );
                })()}
              </PlanForm>
            ) : plan ? (
              <Sentence lines={feeLines(plan)} />
            ) : (
              <div style={{ fontSize: 13, color: 'var(--ink-4)' }}>Set the nightly price first.</div>
            )
          }
        />
        <Row
          label="Taxes"
          action={!taxOpen ? <EditButton what="the taxes" onClick={() => setTaxOpen(true)} /> : null}
          body={
            taxOpen ? (
              <TaxForm propertyId={propertyId} tax={tax} region={region} onCancel={() => setTaxOpen(false)} />
            ) : (
              <div style={{ fontSize: 14, lineHeight: 1.6, color: t.refuses ? 'var(--negative)' : 'var(--ink)' }}>{t.text}</div>
            )
          }
        />
      </div>
    </Block>
  );
}

function Row({ label, action, body }: { label: string; action: ReactNode; body: ReactNode }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(70px, 110px) 1fr auto', gap: 12, alignItems: 'baseline' }}>
      <div style={term}>{label}</div>
      <div style={{ minWidth: 0 }}>{body}</div>
      <div>{action}</div>
    </div>
  );
}

function TaxForm({ propertyId, tax, region, onCancel }: { propertyId: string; tax: TaxConfigRow | null; region: string | null; onCancel: () => void }) {
  const action = saveTaxConfigAction.bind(null, propertyId);
  const [state, formAction, pending] = useActionState<RatesFormState, FormData>(action, { error: null });
  const applies = new Set(tax?.applies_to ?? ['accommodation', 'cleaning']);
  const collected = new Set(tax?.collected_by_channels ?? []);
  const defaultJurisdiction = tax?.jurisdiction ?? (region === 'bridgeport_ct' ? 'CT' : region === 'lighthouse_point_fl' ? 'FL' : 'MA');
  const pctOf = (rate: number | undefined) => (rate == null ? '' : String(Math.round(rate * 10000) / 100));
  return (
    <form action={formAction} aria-label="Taxes" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={grid}>
        <Field label="State" required>
          <select name="jurisdiction" defaultValue={defaultJurisdiction} style={input}>
            <option value="MA">Massachusetts</option>
            <option value="CT">Connecticut</option>
            <option value="FL">Florida</option>
          </select>
        </Field>
        <Field label="State rate" hint="%, e.g. 5.7">
          <input name="state_pct" inputMode="decimal" defaultValue={pctOf(tax?.state_rate)} style={input} />
        </Field>
        <Field label="Local rate" hint="%; Gloucester adds 6">
          <input name="local_pct" inputMode="decimal" defaultValue={pctOf(tax?.local_rate)} style={input} />
        </Field>
        <Field label="Community impact fee" hint="%; 3 where it applies">
          <input name="cif_pct" inputMode="decimal" defaultValue={pctOf(tax?.cif_rate)} style={input} />
        </Field>
        <Field label="From">
          <input name="effective_from" type="date" defaultValue={tax?.effective_from ?? ''} style={input} />
        </Field>
        <Field label="None over" hint="nights; blank: always taxed">
          <input name="long_stay_exempt_over_nights" inputMode="numeric" defaultValue={tax?.long_stay_exempt_over_nights ?? ''} style={input} />
        </Field>
        <Field label="Taxed" wide>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <label style={chip}>
              <input type="checkbox" name="applies_to" value="accommodation" defaultChecked={applies.has('accommodation')} /> The nights
            </label>
            <label style={chip}>
              <input type="checkbox" name="applies_to" value="cleaning" defaultChecked={applies.has('cleaning')} /> Cleaning fee
            </label>
          </div>
        </Field>
        <Field label="Collect their own" wide>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {['airbnb', 'vrbo', 'booking_com'].map((c) => (
              <label key={c} style={chip}>
                <input type="checkbox" name="collected_by_channels" value={c} defaultChecked={collected.has(c)} /> {CHANNEL_LABELS[c]}
              </label>
            ))}
          </div>
        </Field>
        <Field label="Notes" wide>
          <input name="notes" defaultValue={tax?.notes ?? ''} placeholder="Where the rate came from" style={input} />
        </Field>
      </div>
      <Footer state={state} pending={pending} label="Save taxes" onCancel={onCancel} />
    </form>
  );
}

// ── Nights that differ: the day overrides on a calendar ─────────────────────

function NightsThatDiffer({ propertyId, plan, days, today }: { propertyId: string; plan: RatePlanRow | null; days: RateDayRow[]; today: string }) {
  const write = writeSeasonAction.bind(null, propertyId);
  const clear = clearSeasonAction.bind(null, propertyId);
  const [wState, writeAction, writing] = useActionState<RatesFormState, FormData>(write, { error: null });
  const [cState, clearAction, clearing] = useActionState<RatesFormState, FormData>(clear, { error: null });
  const [, startClear] = useTransition();
  const { ask } = useConfirm();
  const [offset, setOffset] = useState(0);
  const [anchor, setAnchor] = useState<string | null>(null);
  const [range, setRange] = useState<{ from: string; to: string } | null>(null);
  // Which of the two writes spoke last, so one status line shows, not two.
  const [last, setLast] = useState<'write' | 'clear' | null>(null);
  const byDate = new Map(days.map((d) => [d.date, d]));
  const month = monthStart(today, offset);
  const cur = plan?.currency ?? 'USD';

  // First click starts a range, the second ends it (either direction), a
  // third starts over.
  const pick = (d: string) => {
    if (anchor) {
      setRange(anchor <= d ? { from: anchor, to: d } : { from: d, to: anchor });
      setAnchor(null);
    } else {
      setAnchor(d);
      setRange({ from: d, to: d });
    }
  };
  const inRange = (d: string) => !!range && d >= range.from && d <= range.to;

  const onClear = async () => {
    if (clearing || !range) return;
    const fd = new FormData();
    fd.set('from', range.from);
    fd.set('to', range.to);
    // Clearing deletes every override in the range, PriceLabs seeds
    // included, and nothing brings them back: ask once, with the count.
    const msg = clearRatesConfirm(String(fd.get('from') ?? ''), String(fd.get('to') ?? ''), days, today);
    if (!(await ask({ ...askFromSentence(msg), confirmLabel: 'Clear range', tone: 'danger', irreversible: true }))) return;
    setLast('clear');
    startClear(() => clearAction(fd));
  };

  return (
    <Block
      title="Nights that differ"
      note={overridesSummary(days, cur)}
      action={!range ? <EditButton what="dates" label="Type dates" onClick={() => setRange({ from: today, to: today })} /> : null}
    >
      <div style={{ maxWidth: 760 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <button type="button" className={buttonClass('quiet')} onClick={() => setOffset((o) => Math.max(0, o - 1))} disabled={offset === 0} aria-label="Previous month">
            &larr;
          </button>
          <div className="font-serif" style={{ fontSize: 16, color: 'var(--ink)' }} aria-live="polite">{monthLabel(month)}</div>
          <button type="button" className={buttonClass('quiet')} onClick={() => setOffset((o) => Math.min(11, o + 1))} disabled={offset === 11} aria-label="Next month">
            &rarr;
          </button>
        </div>
        <div role="grid" aria-label={`Nights in ${monthLabel(month)}`} style={{ border: '1px solid var(--rule)' }}>
          <div role="row" style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', background: 'var(--paper-2)', borderBottom: '1px solid var(--rule)' }}>
            {WEEKDAYS.map((w) => (
              <div key={w} role="columnheader" style={{ ...term, padding: '6px 6px' }}>{w}</div>
            ))}
          </div>
          {monthWeeks(month).map((week, wi) => (
            <div key={wi} role="row" style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)' }}>
              {week.map((d, ci) => {
                if (!d) return <div key={ci} style={{ borderTop: wi ? '1px solid var(--rule)' : undefined, minHeight: 56 }} />;
                const o = byDate.get(d);
                const past = d < today;
                const selected = inRange(d);
                const priceCents = o?.nightly_cents ?? planNightCents(plan, d);
                const marks = [o?.min_nights ? `min ${o.min_nights}` : null, o?.cta ? 'no in' : null, o?.ctd ? 'no out' : null].filter(Boolean);
                return (
                  <button
                    key={d}
                    type="button"
                    role="gridcell"
                    aria-selected={selected}
                    disabled={past}
                    onClick={() => pick(d)}
                    title={o?.note ?? undefined}
                    style={{
                      textAlign: 'left',
                      minHeight: 56,
                      padding: '4px 6px',
                      border: 'none',
                      borderTop: wi ? '1px solid var(--rule)' : undefined,
                      borderLeft: ci ? '1px solid var(--rule)' : undefined,
                      background: selected ? 'color-mix(in srgb, var(--tide) 20%, transparent)' : o ? 'var(--paper-2)' : 'transparent',
                      outline: anchor === d ? '2px solid var(--tide-deep)' : 'none',
                      outlineOffset: -2,
                      cursor: past ? 'default' : 'pointer',
                      opacity: past ? 0.4 : 1,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 1,
                      minWidth: 0,
                      font: 'inherit',
                      color: 'var(--ink)',
                    }}
                  >
                    <span style={{ fontSize: 11, color: 'var(--ink-3)' }}>{Number(d.slice(8))}</span>
                    {o?.closed ? (
                      <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--negative)' }}>Closed</span>
                    ) : priceCents != null ? (
                      <span style={{ fontSize: 12, fontWeight: o?.nightly_cents != null ? 600 : 400, color: o?.nightly_cents != null ? 'var(--ink)' : 'var(--ink-4)' }}>
                        {money(priceCents, cur)}
                      </span>
                    ) : null}
                    {marks.length > 0 && <span style={{ fontSize: 10, color: 'var(--ink-3)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{marks.join(' · ')}</span>}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>

      {range && (
        <form action={writeAction} onSubmit={() => setLast('write')} aria-label="Nights that differ" style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 16, maxWidth: 820 }}>
          {!plan && <div style={{ fontSize: 12, color: 'var(--ink-3)' }}>Set the nightly price first; these nights sit on top of it.</div>}
          <div style={grid}>
            <Field label="From" required>
              <input name="from" type="date" value={range.from} onChange={(e) => { setAnchor(null); setRange({ ...range, from: e.target.value }); }} style={input} required />
            </Field>
            <Field label="To" hint="that night included" required>
              <input name="to" type="date" value={range.to} onChange={(e) => { setAnchor(null); setRange({ ...range, to: e.target.value }); }} style={input} required />
            </Field>
            <Field label="Nightly" hint="blank: keep each night's">
              <input name="nightly" inputMode="decimal" placeholder="425" style={input} />
            </Field>
            <Field label="Minimum nights" hint="blank: keep">
              <input name="min_nights" inputMode="numeric" style={input} />
            </Field>
            <Field label="Closed" hint="Stay Cape Ann and quotes only">
              <select name="closed_mode" defaultValue="" style={input}>
                <option value="">keep</option>
                <option value="close">close these nights</option>
                <option value="open">reopen</option>
              </select>
            </Field>
            <Field label="No check-in">
              <select name="cta_mode" defaultValue="" style={input}>
                <option value="">keep</option>
                <option value="set">no check-in these days</option>
                <option value="clear">allow check-in</option>
              </select>
            </Field>
            <Field label="No checkout">
              <select name="ctd_mode" defaultValue="" style={input}>
                <option value="">keep</option>
                <option value="set">no checkout these days</option>
                <option value="clear">allow checkout</option>
              </select>
            </Field>
            <Field label="Note" hint="why, e.g. Fourth of July">
              <input name="note" style={input} />
            </Field>
            <Field label="Only on" wide>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {WEEKDAYS.map((d, i) => (
                  <label key={d} style={chip}>
                    <input type="checkbox" name="weekdays" value={i} defaultChecked /> {d}
                  </label>
                ))}
              </div>
            </Field>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <button type="submit" className={buttonClass('primary', 'sm')} disabled={writing || clearing} aria-busy={writing}>
              {writing ? 'Saving…' : 'Set these nights'}
            </button>
            <button type="button" className={buttonClass('danger', 'sm')} onClick={onClear} disabled={writing || clearing} aria-busy={clearing}>
              {clearing ? 'Clearing…' : 'Clear these nights'}
            </button>
            <button type="button" className={buttonClass('quiet')} onClick={() => { setRange(null); setAnchor(null); }} disabled={writing || clearing}>
              Cancel
            </button>
            {last && <Status state={last === 'clear' ? cState : wState} />}
          </div>
        </form>
      )}
      {!range && last && (
        <div style={{ marginTop: 10 }}>
          <Status state={last === 'clear' ? cState : wState} />
        </div>
      )}
    </Block>
  );
}

// ── Price a stay ────────────────────────────────────────────────────────────

function PriceAStay({ propertyId, today, hasPlan, guestsIncluded }: { propertyId: string; today: string; hasPlan: boolean; guestsIncluded: number }) {
  const [checkIn, setCheckIn] = useState(today);
  const [checkOut, setCheckOut] = useState('');
  const [guests, setGuests] = useState(String(guestsIncluded));
  const [channel, setChannel] = useState('direct');
  const [result, setResult] = useState<TestQuoteResult | null>(null);
  const [nightsOpen, setNightsOpen] = useState(false);
  const [pending, start] = useTransition();

  const run = () => {
    start(async () => {
      try {
        setResult(await testQuoteAction(propertyId, { checkIn, checkOut, guests: Number(guests) || 1, channel }));
      } catch {
        setResult({ ok: false, error: 'Could not price it. Try again.' });
      }
    });
  };

  const q = result?.ok ? result.quote : null;
  return (
    <Block title="Price a stay">
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <input type="date" aria-label="Check-in" value={checkIn} onChange={(e) => setCheckIn(e.target.value)} style={{ ...input, width: 150 }} />
        <span aria-hidden style={{ color: 'var(--ink-4)' }}>&rarr;</span>
        <input type="date" aria-label="Checkout" value={checkOut} onChange={(e) => setCheckOut(e.target.value)} style={{ ...input, width: 150 }} />
        <input inputMode="numeric" aria-label="Guests" value={guests} onChange={(e) => setGuests(e.target.value)} style={{ ...input, width: 64 }} />
        <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>guests on</span>
        <select aria-label="Channel" value={channel} onChange={(e) => setChannel(e.target.value)} style={{ ...input, width: 'auto' }}>
          {Object.entries(CHANNEL_LABELS).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        <button type="button" className={buttonClass('primary', 'sm')} onClick={run} disabled={pending || !hasPlan || !checkOut} aria-busy={pending}>
          {pending ? 'Pricing…' : 'Price it'}
        </button>
      </div>
      {result && !result.ok && <div role="alert" style={{ marginTop: 10, fontSize: 12, color: 'var(--negative)' }}>{result.error}</div>}
      {q && result?.ok && (
        <div role="status" style={{ marginTop: 12, fontSize: 13, lineHeight: 1.6, color: 'var(--ink-2)', maxWidth: 820 }}>
          <span style={{ fontWeight: 600, color: 'var(--ink)' }}>
            {q.nights} night{q.nights === 1 ? '' : 's'} · {money(q.total_cents, q.currency)} total
          </span>
          {' · '}
          {[
            `${money(q.accommodation_cents, q.currency)} nights`,
            q.extra_guest_cents > 0 ? `${money(q.extra_guest_cents, q.currency)} extra guests` : null,
            q.discount_cents > 0 ? `${q.discount_label ?? 'discount'} -${money(q.discount_cents, q.currency)}` : null,
            q.markup_cents > 0 ? `${money(q.markup_cents, q.currency)} direct rate` : null,
            q.cleaning_cents > 0 ? `${money(q.cleaning_cents, q.currency)} cleaning` : null,
            q.tax_exempt ? 'no tax (long stay)' : `${money(q.tax_cents, q.currency)} tax at ${pctLabel(q.tax_rate)}${result.taxSource === 'config' ? '' : ' (Massachusetts rate)'}`,
          ]
            .filter(Boolean)
            .join(' · ')}
          {q.violations.length > 0 && (
            <div style={{ color: 'var(--negative)' }}>Outside the rules: {q.violations.map((v) => v.replace(/_/g, ' ')).join(', ')}. A guest would be told, not priced.</div>
          )}
          <div>
            <button type="button" className={buttonClass('quiet')} onClick={() => setNightsOpen((o) => !o)} aria-expanded={nightsOpen}>
              {nightsOpen ? 'Hide each night' : 'Each night'}
            </button>
          </div>
          {nightsOpen && (
            <div style={{ maxHeight: 240, overflowY: 'auto', border: '1px solid var(--rule)', maxWidth: 360 }}>
              {q.nightly.map((n) => (
                <div key={n.date} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 10px', fontSize: 12, borderBottom: '1px solid var(--rule)' }}>
                  <span className="font-mono" style={{ color: 'var(--ink-2)' }}>{n.date}</span>
                  <span className="font-mono">{money(n.cents, q.currency)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </Block>
  );
}

// ── Shared bits ─────────────────────────────────────────────────────────────

function Field({ label, hint, children, required, wide }: { label: string; hint?: string; children: ReactNode; required?: boolean; wide?: boolean }) {
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

function Status({ state }: { state: RatesFormState }) {
  if (state.error) return <span role="alert" style={{ fontSize: 12, color: 'var(--negative)' }}>{state.error}</span>;
  if (state.ok && state.message) return <span role="status" style={{ fontSize: 12, color: 'var(--positive)' }}>{state.message}</span>;
  return null;
}

function Footer({ state, pending, label, onCancel }: { state: RatesFormState; pending: boolean; label: string; onCancel?: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
      <button type="submit" className={buttonClass('primary', 'sm')} disabled={pending} aria-busy={pending}>
        {pending ? 'Saving…' : label}
      </button>
      {onCancel && (
        <button type="button" className={buttonClass('quiet')} onClick={onCancel} disabled={pending}>
          Cancel
        </button>
      )}
      <Status state={state} />
    </div>
  );
}

const grid: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(190px, 1fr))', gap: '12px 18px' };

const term: React.CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  letterSpacing: '.14em',
  textTransform: 'uppercase',
  color: 'var(--ink-4)',
};

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
