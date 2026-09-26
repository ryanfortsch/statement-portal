/**
 * The pure half of the message-automation engine (Guesty Message Automation
 * replacement). Everything here is a rule with no I/O so `npm test` covers
 * it without a database:
 *
 *   - which rules apply to a home (fleet defaults, per-property overrides,
 *     a disabled property row silences the fleet row);
 *   - when a rule fires for a stay (anchor date, offset, wall-clock time in
 *     the rule's timezone via Intl, DST-correct, stale after 12h);
 *   - how a template renders (merge fields, missing fields reported, door
 *     and wifi values masked in the copy that is stored);
 *   - which rail carries it (sms / email / cleaner_sms / ota_manual / none);
 *   - the planner's row set for a batch of stays, and the dispatcher's
 *     decision for one claimed row after it re-reads the stay.
 *
 * The I/O half (planAutomations, dispatchDue, approveSend, skipSend) lives
 * in automations.ts. Relative `.ts` imports so node:test resolves them.
 */
import { normalizeEmail, toE164Phone } from './guests-identity-core.ts';
import { guestNameKey } from './stay-continuation.ts';
import { propertyInScope, recipientScope } from './cleaner-digest-core.ts';

// ── Vocabulary ──────────────────────────────────────────────────────────

export const AUTOMATION_TRIGGERS = [
  'booking_confirmed',
  'pre_arrival',
  'checkin_day',
  'mid_stay',
  'pre_checkout',
  'post_checkout',
] as const;
export type AutomationTrigger = (typeof AUTOMATION_TRIGGERS)[number];

export const AUTOMATION_DELIVERIES = ['sms', 'email', 'sms_then_email', 'ota_manual'] as const;
export type AutomationDelivery = (typeof AUTOMATION_DELIVERIES)[number];

export type AutomationAudience = 'guest' | 'cleaner';
export type SendMode = 'auto' | 'approve';

export const TRIGGER_LABELS: Record<AutomationTrigger, string> = {
  booking_confirmed: 'When a booking is confirmed',
  pre_arrival: 'Before arrival',
  checkin_day: 'On the check-in day',
  mid_stay: 'Mid-stay',
  pre_checkout: 'Before checkout',
  post_checkout: 'After checkout',
};

export const DELIVERY_LABELS: Record<AutomationDelivery, string> = {
  sms: 'Text',
  email: 'Email',
  sms_then_email: 'Text, else email',
  ota_manual: 'Paste into the OTA app',
};

/** A message_automations row as the engine reads it. */
export type AutomationRule = {
  id: string;
  key: string;
  /** null = fleet default. */
  property_id: string | null;
  audience: AutomationAudience;
  trigger: AutomationTrigger;
  offset_days: number;
  /** 'HH:MM' or 'HH:MM:SS' in `timezone`; null = fire as soon as the trigger is true. */
  at_local: string | null;
  timezone: string;
  channel_exclusions: string[];
  delivery: AutomationDelivery;
  send_mode: SendMode;
  min_nights: number | null;
  subject: string | null;
  body: string;
  enabled: boolean;
  /** The operator says the OTA's own scheduled message already covers this. */
  configured_in_ota: boolean;
};

/** The slice of a bookings row the engine needs. */
export type AutomationBooking = {
  id: string;
  property_id: string;
  channel: string;
  status: string;
  check_in: string;
  check_out: string;
  guest_name: string | null;
  guest_phone: string | null;
  guest_email: string | null;
  guest_id?: string | null;
  duplicate_of: string | null;
  first_seen_at: string;
  external_confirmation_code?: string | null;
  num_guests?: number | null;
};

/** The guest-facing times from property_rate_plans (never the cleaner guidance on properties). */
export type StayPlanLike = {
  checkin_time: string | null;
  checkout_time: string | null;
} | null;

/** The active checkout_adjustments row for the stay, if any. */
export type CheckoutAdjustmentLike = {
  adjusted_check_out: string | null;
  adjusted_checkout_time: string | null;
} | null;

/** A guests row, when the booking is linked to one. */
export type GuestLike = {
  phone_e164?: string | null;
  phone?: string | null;
  email?: string | null;
  first_name?: string | null;
  full_name?: string | null;
} | null;

/** A cleaner_schedule_recipients row, shaped (cleaner-digest-core shapeRecipient). */
export type RecipientLike = {
  phone: string;
  display_name: string;
  enabled: boolean;
  property_ids: string[];
  region: string;
};

// ── Guest names ─────────────────────────────────────────────────────────

/**
 * Placeholders the turnover rail's list (stay-continuation.ts) does not
 * catch but an iCal feed routinely writes as the SUMMARY: Airbnb and VRBO
 * both export "Reserved", Booking.com "CLOSED". A message must never greet
 * one of these, and two of them in a row are two different guests.
 */
const PLACEHOLDER_EXTRA = /^(reserved|closed|unavailable|block|booked|owner)$/i;

/** Case- and whitespace-insensitive identity for a REAL guest name; empty for a placeholder or a blank. */
export function guestNameIdentity(name: string | null | undefined): string {
  const key = guestNameKey(name);
  if (!key) return '';
  return PLACEHOLDER_EXTRA.test(key.split(' ')[0]) ? '' : key;
}

// ── Rule resolution ─────────────────────────────────────────────────────

export type EffectiveRule = {
  /** The row that applies (the override when there is one, else the fleet row). */
  rule: AutomationRule;
  source: 'fleet' | 'property';
  fleet: AutomationRule | null;
  override: AutomationRule | null;
  /** A disabled property row over an enabled fleet row: the home opted out. */
  silenced: boolean;
  /** Would the planner fire this? */
  active: boolean;
};

/**
 * Every key that exists for a home, fleet defaults merged with the home's
 * own rows. A property row with the same key overrides the fleet row; a
 * disabled property row silences it. Ordered by key for stable rendering.
 */
export function effectiveRulesFor(propertyId: string, rows: readonly AutomationRule[]): EffectiveRule[] {
  const fleet = new Map<string, AutomationRule>();
  const mine = new Map<string, AutomationRule>();
  for (const r of rows) {
    if (r.property_id === null || r.property_id === undefined) fleet.set(r.key, r);
    else if (r.property_id === propertyId) mine.set(r.key, r);
  }
  const keys = [...new Set([...fleet.keys(), ...mine.keys()])].sort();
  const out: EffectiveRule[] = [];
  for (const key of keys) {
    const f = fleet.get(key) ?? null;
    const o = mine.get(key) ?? null;
    if (o) {
      out.push({
        rule: o,
        source: 'property',
        fleet: f,
        override: o,
        silenced: !o.enabled && !!f?.enabled,
        active: o.enabled,
      });
    } else if (f) {
      out.push({ rule: f, source: 'fleet', fleet: f, override: null, silenced: false, active: f.enabled });
    }
  }
  return out;
}

/** The rules the planner fires for a home: the effective, enabled ones. */
export function resolveAutomationsFor(propertyId: string, rows: readonly AutomationRule[]): AutomationRule[] {
  return effectiveRulesFor(propertyId, rows)
    .filter((e) => e.active)
    .map((e) => e.rule);
}

// ── Time ────────────────────────────────────────────────────────────────

export const DEFAULT_TIMEZONE = 'America/New_York';
/** A fire time older than this at planning or dispatch is never sent. */
export const STALE_AFTER_MS = 12 * 60 * 60 * 1000;

const YMD = /^\d{4}-\d{2}-\d{2}$/;

export function isYmd(s: string | null | undefined): s is string {
  return typeof s === 'string' && YMD.test(s);
}

export function addDays(iso: string, days: number): string {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

function utcMidnight(iso: string): number {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

export function nightsBetween(checkIn: string, checkOut: string): number {
  return Math.round((utcMidnight(checkOut) - utcMidnight(checkIn)) / 86_400_000);
}

/**
 * The instant a wall-clock time (HH:MM on an ISO date) happens in a
 * timezone, in epoch ms. Intl only: take the UTC guess, read it back in the
 * zone and correct by the difference; a second pass settles a DST edge.
 */
export function zonedTimeToMs(iso: string, hhmm: string, timeZone: string = DEFAULT_TIMEZONE): number {
  const [y, mo, d] = iso.slice(0, 10).split('-').map(Number);
  const m = /^(\d{1,2}):(\d{2})/.exec(hhmm ?? '');
  const hh = m ? Math.min(23, Number(m[1])) : 0;
  const mm = m ? Math.min(59, Number(m[2])) : 0;
  let fmt: Intl.DateTimeFormat;
  try {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return zonedTimeToMs(iso, hhmm, DEFAULT_TIMEZONE);
  }
  const asUtc = (ms: number): number => {
    const p: Record<string, number> = {};
    for (const part of fmt.formatToParts(new Date(ms))) {
      if (part.type !== 'literal') p[part.type] = Number(part.value);
    }
    return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  };
  const target = Date.UTC(y, mo - 1, d, hh, mm, 0);
  let guess = target;
  for (let i = 0; i < 2; i++) {
    const diff = asUtc(guess) - target;
    if (diff === 0) break;
    guess -= diff;
  }
  return guess;
}

/** The day the guest actually leaves: the adjustment's date when it moved. */
export function effectiveCheckOut(booking: Pick<AutomationBooking, 'check_out'>, adjustment: CheckoutAdjustmentLike): string {
  const adj = adjustment?.adjusted_check_out;
  return isYmd(adj) ? adj : booking.check_out;
}

/** HH:MM the guest must be out by: a paid late checkout overrides the plan. */
export function effectiveCheckOutTime(plan: StayPlanLike, adjustment: CheckoutAdjustmentLike): string | null {
  const adj = (adjustment?.adjusted_checkout_time ?? '').trim();
  if (/^\d{1,2}:\d{2}/.test(adj)) return adj.slice(0, 5);
  const p = (plan?.checkout_time ?? '').trim();
  return /^\d{1,2}:\d{2}/.test(p) ? p.slice(0, 5) : null;
}

export function effectiveCheckInTime(plan: StayPlanLike): string | null {
  const p = (plan?.checkin_time ?? '').trim();
  return /^\d{1,2}:\d{2}/.test(p) ? p.slice(0, 5) : null;
}

/** The date a trigger is measured from, before offset_days. */
export function anchorDateFor(
  rule: Pick<AutomationRule, 'trigger'>,
  booking: Pick<AutomationBooking, 'check_in' | 'check_out'>,
  adjustment: CheckoutAdjustmentLike,
): string {
  switch (rule.trigger) {
    case 'booking_confirmed':
    case 'pre_arrival':
    case 'checkin_day':
      return booking.check_in;
    case 'mid_stay': {
      const out = effectiveCheckOut(booking, adjustment);
      const nights = Math.max(1, nightsBetween(booking.check_in, out));
      return addDays(booking.check_in, Math.floor(nights / 2));
    }
    case 'pre_checkout':
    case 'post_checkout':
      return effectiveCheckOut(booking, adjustment);
  }
}

/**
 * When a rule fires for a stay, or null when that moment is already more
 * than 12 hours gone (never send stale). booking_confirmed fires now: a
 * late-imported stay still gets its confirmation. Other triggers land on
 * anchor + offset_days at at_local in the rule's timezone; with no at_local
 * they fire the moment the trigger becomes true (midnight local, or the
 * checkout time for post_checkout on the checkout day itself).
 */
export function fireAtFor(
  rule: Pick<AutomationRule, 'trigger' | 'offset_days' | 'at_local' | 'timezone'>,
  booking: Pick<AutomationBooking, 'check_in' | 'check_out'>,
  plan: StayPlanLike,
  adjustment: CheckoutAdjustmentLike,
  now: Date,
): Date | null {
  if (rule.trigger === 'booking_confirmed') return new Date(now.getTime());
  const day = addDays(anchorDateFor(rule, booking, adjustment), rule.offset_days ?? 0);
  let hhmm = (rule.at_local ?? '').trim().slice(0, 5);
  if (!/^\d{1,2}:\d{2}$/.test(hhmm)) {
    hhmm =
      rule.trigger === 'post_checkout' && (rule.offset_days ?? 0) === 0
        ? effectiveCheckOutTime(plan, adjustment) ?? '11:00'
        : '00:00';
  }
  const ms = zonedTimeToMs(day, hhmm, rule.timezone || DEFAULT_TIMEZONE);
  if (ms < now.getTime() - STALE_AFTER_MS) return null;
  return new Date(ms);
}

// ── Merge fields and rendering ──────────────────────────────────────────

export const MERGE_FIELDS = [
  'guest_first',
  'guest_name',
  'property_title',
  'property_name',
  'address',
  'check_in_long',
  'check_in_short',
  'check_out_long',
  'check_out_short',
  'check_in_time',
  'check_out_time',
  'nights',
  'door_code',
  'wifi_name',
  'wifi_password',
  'parking',
  'trash_day',
] as const;
export type MergeField = (typeof MERGE_FIELDS)[number];

export const MERGE_FIELD_HELP: Record<MergeField, string> = {
  guest_first: 'First name',
  guest_name: 'Full name',
  property_title: 'The listing title guests see',
  property_name: 'The internal name (crew)',
  address: 'Street address',
  check_in_long: 'Friday, October 16',
  check_in_short: 'Oct 16',
  check_out_long: 'Sunday, October 18',
  check_out_short: 'Oct 18',
  check_in_time: 'From the rate plan',
  check_out_time: 'Rate plan, or the paid late checkout',
  nights: 'Night count',
  door_code: 'Stay code, else the smart lock code, else the key location (masked until sent)',
  wifi_name: 'Network name',
  wifi_password: 'Masked until sent',
  parking: 'The parking note on the property',
  trash_day: 'Collection day (Cape Ann only)',
};

/** Values that go over the wire but never into a stored body. */
export const SECRET_FIELDS: ReadonlySet<string> = new Set<MergeField>(['door_code', 'wifi_password']);
export const MASK = '••••';

export type MergeContext = Partial<Record<MergeField, string | null | undefined>>;

const TOKEN = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;

/** Every field name a template references, in order, deduped. */
export function templateFields(body: string | null | undefined): string[] {
  const out: string[] = [];
  for (const m of (body ?? '').matchAll(TOKEN)) {
    if (!out.includes(m[1])) out.push(m[1]);
  }
  return out;
}

export function templateHasSecret(body: string | null | undefined): boolean {
  return templateFields(body).some((f) => SECRET_FIELDS.has(f));
}

export function templateHasDoorCode(body: string | null | undefined): boolean {
  return templateFields(body).includes('door_code');
}

export type Rendered = {
  /** The real text, for the wire only. */
  text: string;
  /** The same text with door and wifi values masked, for storage and cards. */
  masked: string;
  /** Fields the template asked for that the context could not supply. */
  missing: string[];
};

/**
 * Fill a template. A field with no value is reported in `missing` and left
 * as a visible [field] marker rather than a blank, so a card shows what is
 * wanting; the dispatcher parks any render with missing fields for approval.
 */
export function renderTemplate(body: string | null | undefined, ctx: MergeContext): Rendered {
  const missing: string[] = [];
  const fill = (mask: boolean) =>
    (body ?? '').replace(TOKEN, (_m, name: string) => {
      const raw = (ctx as Record<string, string | null | undefined>)[name];
      const v = raw === null || raw === undefined ? '' : String(raw).trim();
      if (!v) {
        if (!mask && !missing.includes(name)) missing.push(name);
        return `[${name}]`;
      }
      return mask && SECRET_FIELDS.has(name) ? MASK : v;
    });
  const text = fill(false);
  const masked = fill(true);
  return { text: tidy(text), masked: tidy(masked), missing };
}

/** Collapse the doubled spaces an empty optional field leaves behind. */
function tidy(s: string): string {
  return s.replace(/[ \t]{2,}/g, ' ').replace(/ +([.,!?])/g, '$1').trim();
}

function utcDateOf(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** "Friday, October 16". Formatted in UTC from the date parts, so no zone shifts the day. */
export function formatLongDate(iso: string | null | undefined): string {
  if (!isYmd(iso)) return '';
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric' }).format(utcDateOf(iso));
}

/** "Oct 16". */
export function formatShortDate(iso: string | null | undefined): string {
  if (!isYmd(iso)) return '';
  return new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' }).format(utcDateOf(iso));
}

/** "4:00 PM" from "16:00" or "16:00:00". Empty for anything unparseable. */
export function formatClock(hhmm: string | null | undefined): string {
  const m = /^(\d{1,2}):(\d{2})/.exec((hhmm ?? '').trim());
  if (!m) return '';
  const h = Number(m[1]);
  const min = m[2];
  if (h > 23) return '';
  const suffix = h >= 12 ? 'PM' : 'AM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${min} ${suffix}`;
}

export function firstNameOf(full: string | null | undefined): string {
  const t = (full ?? '').trim();
  if (!t) return '';
  return t.split(/\s+/)[0];
}

export type MergeInput = {
  booking: Pick<AutomationBooking, 'guest_name' | 'check_in' | 'check_out'>;
  guest?: GuestLike;
  property: { name: string; title: string | null; address: string | null; wifi_name: string | null; parking: string | null };
  plan: StayPlanLike;
  adjustment: CheckoutAdjustmentLike;
  access: { smart_lock_code: string | null; key_code_location: string | null; wifi_password: string | null } | null;
  /** guest_access_codes.code for this booking, when a lock is mapped and a code is live. */
  stayCode: string | null;
  lockMapped: boolean;
  trashDay: string | null;
};

/**
 * Assemble the merge fields for one stay. Placeholder guest names (an iCal
 * "Reserved") yield no name so the template reports it missing rather than
 * greeting "Reserved". The door code is the stay's own code when a lock is
 * mapped and one is live, then the property's smart lock code, then the key
 * location. Times come from the rate plan, never the cleaner guidance.
 */
export function buildMergeContext(input: MergeInput): MergeContext {
  const { booking, guest, property, plan, adjustment, access } = input;
  const realName = guestNameIdentity(booking.guest_name) ? (booking.guest_name ?? '').trim() : '';
  const fullName = realName || (guest?.full_name ?? '').trim();
  const first = (guest?.first_name ?? '').trim() || firstNameOf(fullName);
  const out = effectiveCheckOut(booking, adjustment);
  const doorCode =
    (input.lockMapped && (input.stayCode ?? '').trim()) ||
    (access?.smart_lock_code ?? '').trim() ||
    (access?.key_code_location ?? '').trim() ||
    '';
  return {
    guest_first: first,
    guest_name: fullName,
    property_title: (property.title ?? '').trim() || property.name,
    property_name: property.name,
    address: (property.address ?? '').trim(),
    check_in_long: formatLongDate(booking.check_in),
    check_in_short: formatShortDate(booking.check_in),
    check_out_long: formatLongDate(out),
    check_out_short: formatShortDate(out),
    check_in_time: formatClock(effectiveCheckInTime(plan)),
    check_out_time: formatClock(effectiveCheckOutTime(plan, adjustment)),
    nights: String(Math.max(1, nightsBetween(booking.check_in, out))),
    door_code: doorCode,
    wifi_name: (property.wifi_name ?? '').trim(),
    wifi_password: (access?.wifi_password ?? '').trim(),
    parking: (property.parking ?? '').trim(),
    trash_day: (input.trashDay ?? '').trim(),
  };
}

// ── Rails ───────────────────────────────────────────────────────────────

export type Rail = 'sms' | 'email' | 'cleaner_sms' | 'ota_manual';

/** OTA relay addresses: a message to one lands in the OTA thread, not a mailbox we can use. */
const PROXY_EMAIL_DOMAINS = [
  'guest.airbnb.com',
  'reply.airbnb.com',
  'airbnb.com',
  'mchat.booking.com',
  'guest.booking.com',
  'booking.com',
  'messages.homeaway.com',
  'messages.vrbo.com',
  'reply.vrbo.com',
  'guest.vrbo.com',
  'homeaway.com',
  'vrbo.com',
];

export function isProxyEmail(email: string | null | undefined): boolean {
  const e = normalizeEmail(email);
  if (!e) return false;
  const domain = e.slice(e.indexOf('@') + 1);
  return PROXY_EMAIL_DOMAINS.some((d) => domain === d || domain.endsWith(`.${d}`));
}

export const OTA_CHANNELS: ReadonlySet<string> = new Set(['airbnb', 'vrbo', 'booking_com']);

export function isOtaChannel(channel: string | null | undefined): boolean {
  return !!channel && OTA_CHANNELS.has(channel);
}

/** The guest's phone in E.164: the booking's own first, then the linked guest record. */
export function guestPhoneOf(booking: Pick<AutomationBooking, 'guest_phone'>, guest: GuestLike): string | null {
  return toE164Phone(booking.guest_phone) ?? toE164Phone(guest?.phone_e164) ?? toE164Phone(guest?.phone) ?? null;
}

/** A real, deliverable address: never an OTA relay. */
export function guestEmailOf(booking: Pick<AutomationBooking, 'guest_email'>, guest: GuestLike): string | null {
  for (const candidate of [booking.guest_email, guest?.email]) {
    const e = normalizeEmail(candidate);
    if (e && !isProxyEmail(e)) return e;
  }
  return null;
}

/**
 * The cleaner_schedule_recipients rows whose scope covers a home: enabled,
 * and either naming the property in property_ids or carrying '{}' with the
 * home's region. Never cleaner_phones (its '{}' means every property and is
 * only for inbound attribution).
 */
export function recipientsCovering<T extends RecipientLike>(
  recipients: readonly T[],
  property: { id: string; region?: string | null },
): T[] {
  return recipients.filter((r) => r.enabled && !!toE164Phone(r.phone) && propertyInScope(property, recipientScope(r)));
}

/**
 * Which rail carries a rule for a stay. Cleaner rules ride the ops line to
 * the covering recipients or nowhere. Guest rules honour the delivery
 * preference in order; an OTA guest with no reachable contact falls to
 * ota_manual (the text is pasted into the OTA app); a direct guest with no
 * contact has no rail at all, which the dispatcher records as
 * skipped_no_contact, loudly.
 */
export function pickRail(
  rule: Pick<AutomationRule, 'audience' | 'delivery'>,
  booking: Pick<AutomationBooking, 'channel' | 'guest_phone' | 'guest_email'>,
  guest: GuestLike,
  recipients: readonly RecipientLike[],
): Rail | null {
  if (rule.audience === 'cleaner') return recipients.length > 0 ? 'cleaner_sms' : null;
  if (rule.delivery === 'ota_manual') return isOtaChannel(booking.channel) ? 'ota_manual' : null;
  const phone = guestPhoneOf(booking, guest);
  const email = guestEmailOf(booking, guest);
  const ota = isOtaChannel(booking.channel) ? 'ota_manual' : null;
  switch (rule.delivery) {
    case 'sms':
      return phone ? 'sms' : ota;
    case 'email':
      return email ? 'email' : ota;
    case 'sms_then_email':
      return phone ? 'sms' : email ? 'email' : ota;
  }
  return null;
}

// ── Stay continuation ───────────────────────────────────────────────────

export type ContinuationFlags = {
  /** The same real guest departs this home on this stay's check-in day: the stay continues one before it. */
  arrivalContinuation: boolean;
  /** The same real guest arrives at this home on this stay's checkout day: nobody leaves yet. */
  departureContinuation: boolean;
};

/**
 * Same-name back-to-back rows at one home are one stay (stay-continuation.ts).
 * The earlier row must not say goodbye and the later row must not say hello
 * again, so each side of the seam is flagged separately.
 */
export function continuationFlags(
  booking: Pick<AutomationBooking, 'id' | 'property_id' | 'guest_name' | 'check_in' | 'check_out'>,
  all: readonly Pick<AutomationBooking, 'id' | 'property_id' | 'guest_name' | 'check_in' | 'check_out' | 'status' | 'duplicate_of'>[],
  adjustment: CheckoutAdjustmentLike = null,
): ContinuationFlags {
  const key = guestNameIdentity(booking.guest_name);
  if (!key) return { arrivalContinuation: false, departureContinuation: false };
  const out = effectiveCheckOut(booking, adjustment);
  let arrivalContinuation = false;
  let departureContinuation = false;
  for (const other of all) {
    if (other.id === booking.id || other.property_id !== booking.property_id) continue;
    if (other.duplicate_of || (other.status !== 'confirmed' && other.status !== 'completed')) continue;
    if (guestNameIdentity(other.guest_name) !== key) continue;
    if (other.check_out === booking.check_in) arrivalContinuation = true;
    if (other.check_in === out) departureContinuation = true;
  }
  return { arrivalContinuation, departureContinuation };
}

const ARRIVAL_TRIGGERS: ReadonlySet<AutomationTrigger> = new Set(['booking_confirmed', 'pre_arrival', 'checkin_day']);
const DEPARTURE_TRIGGERS: ReadonlySet<AutomationTrigger> = new Set(['pre_checkout', 'post_checkout']);

/** Does a rule apply to this stay given its continuation seams and status? */
export function triggerAppliesTo(
  rule: Pick<AutomationRule, 'trigger' | 'audience'>,
  booking: Pick<AutomationBooking, 'status'>,
  flags: ContinuationFlags,
): boolean {
  if (booking.status === 'completed') return rule.trigger === 'post_checkout';
  if (booking.status !== 'confirmed') return false;
  if (flags.arrivalContinuation && ARRIVAL_TRIGGERS.has(rule.trigger)) return false;
  if (flags.departureContinuation && (DEPARTURE_TRIGGERS.has(rule.trigger) || rule.audience === 'cleaner')) return false;
  return true;
}

// ── Planner ─────────────────────────────────────────────────────────────

export const PLAN_WINDOW_DAYS = 30;
export const CONFIRMED_WINDOW_MS = 24 * 60 * 60 * 1000;

export type PlannedStatus = 'scheduled' | 'skipped_cancelled';

export type PlannedSend = {
  booking_id: string;
  automation_id: string;
  property_id: string;
  /** ISO instant; a stale plan carries the computed moment and status skipped_cancelled. */
  fire_at: string;
  status: PlannedStatus;
  error: string | null;
  planned_check_in: string;
  planned_check_out: string;
};

export type PlanInput = {
  bookings: readonly AutomationBooking[];
  /** Every message_automations row (fleet and property); resolved per home here. */
  rules: readonly AutomationRule[];
  /** property_id -> rate plan times. */
  plans: Readonly<Record<string, StayPlanLike>>;
  /** `${property_id}|${check_in}` -> the active adjustment. */
  adjustments: Readonly<Record<string, CheckoutAdjustmentLike>>;
  now: Date;
};

export function adjustmentKey(propertyId: string, checkIn: string): string {
  return `${propertyId}|${checkIn}`;
}

/**
 * The rows the planner wants for a batch of canonical stays. Excluded
 * channels and short stays produce nothing; a fire time already more than
 * 12h gone produces a skipped_cancelled row with a note, so the ledger says
 * why nothing went out. booking_confirmed rules only apply to stays first
 * seen in the last 24h: enabling automations on a home must never confirm
 * every stay already on its calendar.
 */
export function planAutomationSends(input: PlanInput): PlannedSend[] {
  const out: PlannedSend[] = [];
  const byProperty = new Map<string, AutomationRule[]>();
  const nowMs = input.now.getTime();
  for (const b of input.bookings) {
    if (b.duplicate_of) continue;
    if (b.status !== 'confirmed' && b.status !== 'completed') continue;
    let rules = byProperty.get(b.property_id);
    if (!rules) {
      rules = resolveAutomationsFor(b.property_id, input.rules);
      byProperty.set(b.property_id, rules);
    }
    if (rules.length === 0) continue;
    const adjustment = input.adjustments[adjustmentKey(b.property_id, b.check_in)] ?? null;
    const plan = input.plans[b.property_id] ?? null;
    const flags = continuationFlags(b, input.bookings, adjustment);
    const nights = nightsBetween(b.check_in, effectiveCheckOut(b, adjustment));
    const firstSeen = Date.parse(b.first_seen_at);
    for (const rule of rules) {
      if (!triggerAppliesTo(rule, b, flags)) continue;
      if (rule.channel_exclusions.includes(b.channel)) continue;
      if (rule.min_nights !== null && rule.min_nights !== undefined && nights < rule.min_nights) continue;
      if (rule.trigger === 'booking_confirmed') {
        if (!Number.isFinite(firstSeen) || nowMs - firstSeen > CONFIRMED_WINDOW_MS) continue;
      }
      const fireAt = fireAtFor(rule, b, plan, adjustment, input.now);
      const base = {
        booking_id: b.id,
        automation_id: rule.id,
        property_id: b.property_id,
        planned_check_in: b.check_in,
        planned_check_out: b.check_out,
      };
      if (fireAt) {
        out.push({ ...base, fire_at: fireAt.toISOString(), status: 'scheduled', error: null });
      } else {
        // Recompute without the staleness gate so the ledger shows the moment that was missed.
        const day = addDays(anchorDateFor(rule, b, adjustment), rule.offset_days ?? 0);
        const hhmm = (rule.at_local ?? '').trim().slice(0, 5) || '00:00';
        const missed = new Date(zonedTimeToMs(day, hhmm, rule.timezone || DEFAULT_TIMEZONE)).toISOString();
        out.push({
          ...base,
          fire_at: missed,
          status: 'skipped_cancelled',
          error: 'stale: the fire time was more than 12h in the past when planned',
        });
      }
    }
  }
  return out;
}

export type ExistingSend = {
  id: string;
  booking_id: string;
  automation_id: string;
  fire_at: string;
  status: string;
  planned_check_in: string;
  planned_check_out: string;
};

/** Statuses the planner may re-time. Anything else is history and stays put. */
export const REPLANNABLE_STATUSES: ReadonlySet<string> = new Set(['scheduled', 'skipped_dates_moved']);

export type PlanDiff = {
  inserts: PlannedSend[];
  updates: Array<{ id: string; patch: Pick<PlannedSend, 'fire_at' | 'status' | 'error' | 'planned_check_in' | 'planned_check_out'> }>;
  unchanged: number;
  frozen: number;
};

/**
 * Reconcile a fresh plan against the ledger. UNIQUE(booking_id, automation_id)
 * is the per-stay dedupe, so a planned row either inserts, re-times a
 * scheduled (or dates-moved) row, or leaves a sent / skipped / awaiting row
 * alone. Within a minute counts as unchanged so a 15-minute cron does not
 * churn booking_confirmed rows whose fire_at is "now".
 */
export function diffPlan(planned: readonly PlannedSend[], existing: readonly ExistingSend[]): PlanDiff {
  const byKey = new Map<string, ExistingSend>();
  for (const e of existing) byKey.set(`${e.booking_id}|${e.automation_id}`, e);
  const diff: PlanDiff = { inserts: [], updates: [], unchanged: 0, frozen: 0 };
  for (const p of planned) {
    const e = byKey.get(`${p.booking_id}|${p.automation_id}`);
    if (!e) {
      diff.inserts.push(p);
      continue;
    }
    if (!REPLANNABLE_STATUSES.has(e.status)) {
      diff.frozen += 1;
      continue;
    }
    const sameDates = e.planned_check_in === p.planned_check_in && e.planned_check_out === p.planned_check_out;
    const closeEnough = Math.abs(Date.parse(e.fire_at) - Date.parse(p.fire_at)) < 60_000;
    if (e.status === p.status && sameDates && closeEnough) {
      diff.unchanged += 1;
      continue;
    }
    diff.updates.push({
      id: e.id,
      patch: {
        fire_at: p.fire_at,
        status: p.status,
        error: p.error,
        planned_check_in: p.planned_check_in,
        planned_check_out: p.planned_check_out,
      },
    });
  }
  return diff;
}

// ── Dispatcher decision ─────────────────────────────────────────────────

export type DispatchOutcome =
  | 'send'
  | 'awaiting_approval'
  | 'configured_in_ota'
  | 'skipped_no_contact'
  | 'skipped_channel'
  | 'skipped_cancelled'
  | 'skipped_dates_moved'
  | 'cancelled';

export type DispatchDecision = {
  outcome: DispatchOutcome;
  rail: Rail | null;
  reason: string | null;
};

export type DecisionInput = {
  row: Pick<ExistingSend, 'planned_check_in' | 'planned_check_out'>;
  booking: Pick<AutomationBooking, 'status' | 'duplicate_of' | 'check_in' | 'check_out' | 'channel' | 'guest_phone' | 'guest_email'> | null;
  rule: AutomationRule | null;
  property: { automations_enabled: boolean; calendar_authority: string } | null;
  guest: GuestLike;
  recipients: readonly RecipientLike[];
  rendered: Pick<Rendered, 'missing'>;
  lockMapped: boolean;
  /** An operator already approved this row (approveSend): approve-mode gates are satisfied. */
  approved: boolean;
};

/**
 * What to do with a claimed row now that the stay has been re-read. The
 * order matters: a dead stay skips before any rail is chosen; a rail is
 * chosen before the approve gates so an OTA guest is parked with the deep
 * link and a no-contact guest is recorded loudly; then the approve gates
 * (missing fields, a door code without a mapped lock, approve mode) park
 * the row; only a clean auto row sends.
 */
export function decideDispatch(input: DecisionInput): DispatchDecision {
  const { row, booking, rule, property } = input;
  if (!booking) return { outcome: 'skipped_cancelled', rail: null, reason: 'booking_missing' };
  if (booking.status === 'cancelled') return { outcome: 'skipped_cancelled', rail: null, reason: 'booking_cancelled' };
  if (booking.duplicate_of) return { outcome: 'skipped_cancelled', rail: null, reason: 'booking_duplicate' };
  if (booking.check_in !== row.planned_check_in || booking.check_out !== row.planned_check_out) {
    return { outcome: 'skipped_dates_moved', rail: null, reason: `dates moved to ${booking.check_in}..${booking.check_out}` };
  }
  if (!rule || !rule.enabled) return { outcome: 'cancelled', rail: null, reason: 'rule_disabled' };
  if (!property || !property.automations_enabled || property.calendar_authority !== 'helm') {
    return { outcome: 'cancelled', rail: null, reason: 'property_not_automated' };
  }
  if (rule.channel_exclusions.includes(booking.channel)) return { outcome: 'skipped_channel', rail: null, reason: `channel ${booking.channel} excluded` };

  const rail = pickRail(rule, booking, input.guest, input.recipients);
  if (!rail) return { outcome: 'skipped_no_contact', rail: null, reason: rule.audience === 'cleaner' ? 'no cleaner recipient covers this home' : 'guest has no phone or email on file' };
  if (rail === 'ota_manual') {
    if (input.approved) return { outcome: 'send', rail, reason: null };
    return rule.configured_in_ota
      ? { outcome: 'configured_in_ota', rail, reason: 'handled by the OTA scheduled message' }
      : { outcome: 'awaiting_approval', rail, reason: 'paste into the OTA app' };
  }
  if (input.rendered.missing.length > 0) {
    return { outcome: 'awaiting_approval', rail, reason: `missing ${input.rendered.missing.join(', ')}` };
  }
  if (!input.approved) {
    if (templateHasDoorCode(rule.body) && !input.lockMapped) {
      return { outcome: 'awaiting_approval', rail, reason: 'door code without a mapped lock' };
    }
    if (rule.send_mode === 'approve') return { outcome: 'awaiting_approval', rail, reason: 'approve mode' };
  }
  return { outcome: 'send', rail, reason: null };
}

/** Human copy for a ledger status. */
export const SEND_STATUS_LABELS: Record<string, string> = {
  scheduled: 'Scheduled',
  sending: 'Sending',
  awaiting_approval: 'Awaiting approval',
  sent: 'Sent',
  skipped_no_contact: 'No contact on file',
  skipped_channel: 'Channel excluded',
  skipped_cancelled: 'Stay cancelled',
  skipped_dates_moved: 'Dates moved',
  configured_in_ota: 'Handled in the OTA app',
  failed: 'Failed',
  cancelled: 'Cancelled',
};

/** A Quo 402 is billing, not code: say so and do not retry blindly. */
export function classifySendError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err);
  if (/\(402\)/.test(msg) || /\b402\b/.test(msg)) return `quo_402_out_of_credits: ${msg.slice(0, 200)}`;
  return msg.slice(0, 300);
}
