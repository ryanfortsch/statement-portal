/**
 * The pure half of the property page's Pricing section (RatesPanel.tsx):
 * which rate plan fields each of its three questions edits, the plan as the
 * form posts it, the sentences each question reads as, and the month grid
 * the nights-that-differ calendar draws.
 *
 * saveRatePlanAction writes the whole plan from one post, filling a default
 * for any field it does not receive. So each question's form posts its own
 * fields visibly and every other field hidden, at its saved value
 * (`planFormValues`); a field no question carried would be reset to its
 * default on every save. pricing-panel.test.ts checks the three questions
 * cover every field the action reads, once each.
 *
 * Type imports only, so the client panel can load it.
 */
import type { RateDayRow, RatePlanRow, TaxConfigRow } from './rate-plan.ts';

export type PlanQuestion = 'night' | 'stay' | 'fees';

/** The rate plan form's field names, by the question that edits them. */
export const PLAN_FIELDS: Record<PlanQuestion, readonly string[]> = {
  night: ['base_nightly', 'weekend_nightly', 'weekend_days', 'currency', 'weekly_discount_pct', 'monthly_discount_pct', 'direct_markup_pct'],
  stay: ['min_nights_default', 'max_nights', 'advance_notice_hours', 'booking_window_days', 'turnover_buffer_days', 'checkin_time'],
  fees: ['guests_included', 'extra_guest', 'cleaning_fee', 'pet_fee', 'security_deposit'],
};

export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/** Cents as the form types them: whole dollars stay whole. */
export const dollarsField = (cents: number | null | undefined): string =>
  cents == null ? '' : (cents / 100).toFixed(cents % 100 === 0 ? 0 : 2);

/**
 * Every plan field at its saved value, as the form posts it, with the same
 * defaults the one-form editor showed for a home with no plan yet.
 * weekend_days is the one multi-valued field.
 */
export function planFormValues(plan: RatePlanRow | null): Record<string, string | string[]> {
  return {
    base_nightly: dollarsField(plan?.base_nightly_cents),
    weekend_nightly: dollarsField(plan?.weekend_nightly_cents),
    weekend_days: (plan?.weekend_days ?? [5, 6]).map(String),
    currency: plan?.currency ?? 'USD',
    weekly_discount_pct: String(plan?.weekly_discount_pct ?? 0),
    monthly_discount_pct: String(plan?.monthly_discount_pct ?? 0),
    direct_markup_pct: String(plan?.direct_markup_pct ?? 0),
    min_nights_default: String(plan?.min_nights_default ?? 2),
    max_nights: plan?.max_nights == null ? '' : String(plan.max_nights),
    advance_notice_hours: String(plan?.advance_notice_hours ?? 24),
    booking_window_days: String(plan?.booking_window_days ?? 365),
    turnover_buffer_days: String(plan?.turnover_buffer_days ?? 0),
    checkin_time: plan?.checkin_time ?? '16:00',
    guests_included: String(plan?.guests_included ?? 2),
    extra_guest: dollarsField(plan?.extra_guest_cents_per_night ?? 0),
    cleaning_fee: dollarsField(plan?.cleaning_fee_cents ?? 0),
    pet_fee: dollarsField(plan?.pet_fee_cents),
    security_deposit: dollarsField(plan?.security_deposit_cents),
  };
}

export function money(cents: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: cents % 100 === 0 ? 0 : 2 }).format(cents / 100);
}

export const pctLabel = (rate: number): string => `${Math.round(rate * 10000) / 100}%`;

/** '16:00' -> '4:00 PM'. */
export function clockLabel(hhmm: string | null | undefined): string {
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm ?? '');
  if (!m) return hhmm ?? '';
  const h = Number(m[1]);
  return `${h % 12 === 0 ? 12 : h % 12}:${m[2]} ${h >= 12 ? 'PM' : 'AM'}`;
}

function joinDays(days: readonly number[]): string {
  const names = [...days].sort((a, b) => a - b).map((d) => WEEKDAYS[d]).filter(Boolean);
  if (names.length <= 1) return names.join('');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

const plural = (n: number, one: string, many = `${one}s`): string => `${n} ${n === 1 ? one : many}`;

/** What does a night cost? */
export function nightLines(plan: RatePlanRow): string[] {
  const cur = plan.currency;
  const out = [`${money(plan.base_nightly_cents, cur)} a night`];
  if (plan.weekend_nightly_cents != null && plan.weekend_nightly_cents !== plan.base_nightly_cents && plan.weekend_days.length > 0) {
    out.push(`${money(plan.weekend_nightly_cents, cur)} on ${joinDays(plan.weekend_days)} nights`);
  }
  if (plan.weekly_discount_pct > 0) out.push(`${plan.weekly_discount_pct}% off a week`);
  if (plan.monthly_discount_pct > 0) out.push(`${plan.monthly_discount_pct}% off a month`);
  if (plan.direct_markup_pct > 0) out.push(`direct bookings ${plan.direct_markup_pct}% more`);
  return out;
}

/** How long must a guest stay? */
export function stayLines(plan: RatePlanRow): string[] {
  const out = [`${plural(plan.min_nights_default, 'night')} minimum`];
  if (plan.max_nights != null) out.push(`${plural(plan.max_nights, 'night')} maximum`);
  out.push(`book up to ${plural(plan.booking_window_days, 'day')} ahead`);
  out.push(plan.advance_notice_hours > 0 ? `${plural(plan.advance_notice_hours, 'hour')}' notice` : 'same-day bookings');
  if (plan.turnover_buffer_days > 0) out.push(`${plural(plan.turnover_buffer_days, 'night')} kept free between stays`);
  out.push(`guest check-in ${clockLabel(plan.checkin_time)}`);
  return out;
}

/** The fees half of: what fees and taxes are added? */
export function feeLines(plan: RatePlanRow): string[] {
  const cur = plan.currency;
  const out = [plan.cleaning_fee_cents > 0 ? `${money(plan.cleaning_fee_cents, cur)} cleaning` : 'no cleaning fee'];
  out.push(
    plan.extra_guest_cents_per_night > 0
      ? `${money(plan.extra_guest_cents_per_night, cur)} a night for each guest over ${plan.guests_included}`
      : `${plural(plan.guests_included, 'guest')} in the rate, no extra-guest fee`,
  );
  out.push(plan.pet_fee_cents != null ? `${money(plan.pet_fee_cents, cur)} pet fee` : 'no pet fee');
  if (plan.security_deposit_cents != null) out.push(`${money(plan.security_deposit_cents, cur)} deposit held`);
  return out;
}

export const CHANNEL_LABELS: Record<string, string> = {
  direct: 'Direct',
  sca: 'Stay Cape Ann',
  airbnb: 'Airbnb',
  vrbo: 'Vrbo',
  booking_com: 'Booking.com',
  manual: 'Manual',
};

/** The taxes half. `refuses` marks a home whose quotes stop until a rate is saved. */
export function taxLine(tax: TaxConfigRow | null, region: string | null): { text: string; refuses: boolean } {
  if (!tax) {
    const capeAnn = (region ?? 'cape_ann') === 'cape_ann';
    return capeAnn
      ? { text: 'Massachusetts occupancy tax for this home (no rate saved here)', refuses: false }
      : { text: 'No tax rate saved: quotes and payment links refuse until one is', refuses: true };
  }
  const total = tax.state_rate + tax.local_rate + tax.cif_rate;
  const on = tax.applies_to.map((a) => (a === 'cleaning' ? 'cleaning' : 'the nights')).join(' and ');
  const parts = [`${pctLabel(total)} tax on ${on}`];
  if (tax.long_stay_exempt_over_nights != null) parts.push(`none over ${plural(tax.long_stay_exempt_over_nights, 'night')}`);
  if (tax.collected_by_channels.length) {
    parts.push(`${tax.collected_by_channels.map((c) => CHANNEL_LABELS[c] ?? c).join(' and ')} collect their own`);
  }
  return { text: parts.join(' · '), refuses: false };
}

// ── The nights-that-differ calendar ─────────────────────────────────────────

const isoUtc = (y: number, m: number, d: number): string => new Date(Date.UTC(y, m, d)).toISOString().slice(0, 10);

/** First of the month for an ISO day, shifted by `by` months. */
export function monthStart(iso: string, by = 0): string {
  const [y, m] = iso.split('-').map(Number);
  return isoUtc(y, m - 1 + by, 1);
}

export function monthLabel(firstOfMonth: string): string {
  return new Date(`${firstOfMonth}T00:00:00Z`).toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

/** The month as Sunday-first weeks; days outside the month are null. */
export function monthWeeks(firstOfMonth: string): Array<Array<string | null>> {
  const [y, m] = firstOfMonth.split('-').map(Number);
  const lead = new Date(Date.UTC(y, m - 1, 1)).getUTCDay();
  const count = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const cells: Array<string | null> = [...Array(lead).fill(null)];
  for (let d = 1; d <= count; d++) cells.push(isoUtc(y, m - 1, d));
  while (cells.length % 7) cells.push(null);
  const weeks: Array<Array<string | null>> = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** What a night would be priced at from the plan alone (weekend or base). */
export function planNightCents(plan: RatePlanRow | null, iso: string): number | null {
  if (!plan) return null;
  const dow = new Date(`${iso}T00:00:00Z`).getUTCDay();
  return plan.weekend_nightly_cents != null && plan.weekend_days.includes(dow) ? plan.weekend_nightly_cents : plan.base_nightly_cents;
}

/** One line for the calendar's head: how many nights differ, the range, the closed ones. */
export function overridesSummary(days: readonly RateDayRow[], currency = 'USD'): string {
  if (days.length === 0) return 'Every night uses the plan';
  const priced = days.filter((d) => d.nightly_cents != null).map((d) => d.nightly_cents as number);
  const closed = days.filter((d) => d.closed).length;
  const parts = [`${plural(days.length, 'night')} differ in the next year`];
  if (priced.length) {
    const lo = Math.min(...priced);
    const hi = Math.max(...priced);
    parts.push(lo === hi ? money(lo, currency) : `${money(lo, currency)} to ${money(hi, currency)}`);
  }
  if (closed) parts.push(`${closed} closed`);
  return parts.join(' · ');
}
