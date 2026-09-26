/**
 * The message-automation engine, I/O half (Guesty Message Automation
 * replacement). message_automations rows are the rules (fleet defaults with
 * per-property overrides); automation_sends rows are the per-stay ledger.
 *
 *   planAutomations   for every home with automations_enabled AND
 *                     calendar_authority = 'helm' (both flags, never
 *                     inferred: a Guesty-run home keeps Guesty's own
 *                     automations), plan the canonical confirmed stays
 *                     within 30 days plus stays first seen in the last 24h
 *                     for booking_confirmed, and upsert the ledger on
 *                     UNIQUE(booking_id, automation_id).
 *   dispatchDue       claim due rows atomically (scheduled -> sending),
 *                     re-read the stay, render with secrets masked, and
 *                     send on the first rail that works: sms on the GUESTS
 *                     line, email via Resend, cleaner_sms on the ops line
 *                     to the covering cleaner_schedule_recipients, or park
 *                     the row (awaiting_approval, configured_in_ota,
 *                     skipped_no_contact, loudly).
 *   approveSend / skipSend
 *                     the operator's two verbs on a parked row.
 *
 * Every delivered send records a guest_messages row through helm-inbox so
 * the stay's thread shows it. Secrets (door code, wifi password) are
 * rendered in memory at send time and go only over the wire; the stored
 * body and the inbox copy carry the masked text.
 *
 * Service role only: both tables are RLS-locked with no anon policy. The
 * rules themselves are pure and tested in automations-core.ts.
 */
import 'server-only';
import { supabaseAdmin, isServiceConfigured } from '@/lib/supabase-admin';
import { selectAllPaged } from '@/lib/paged-select';
import { listFleetProperties, type FleetProperty } from '@/lib/fleet';
import { getPropertyAccessMap, type PropertyAccess } from '@/lib/property-access';
import { sendMessage } from '@/lib/quo';
import { quoFromNumber } from '@/lib/quo-lines';
import { sendTransactionalViaResend } from '@/lib/resend';
import { recordOutboundSms, recordOutboundEmail, ensureOtaThreadForBooking } from '@/lib/helm-inbox';
import { otaChannelOfBooking, otaThreadUrl } from '@/lib/helm-inbox-core';
import { RECIPIENT_COLS, shapeRecipient, type ScheduleRecipient } from '@/lib/cleaner-digest-core';
import { civicForProperty } from '@/lib/civic';
import type { HelmPropertyRow } from '@/lib/properties';
import { toE164Phone } from '@/lib/guests-identity-core';
import {
  AUTOMATION_DELIVERIES,
  AUTOMATION_TRIGGERS,
  CONFIRMED_WINDOW_MS,
  PAUSE_REASON_DISABLED_PREFIX,
  PAUSE_REASON_SUPERSEDED,
  PAUSE_REASON_NO_LONGER_APPLIES,
  PAUSE_REASON_STAY_CANCELLED,
  withdrawnSends,
  stayCancelPausedKeys,
  PLAN_WINDOW_DAYS,
  SECRET_FIELDS,
  addDays,
  adjustmentKey,
  buildMergeContext,
  classifySendError,
  decideDispatch,
  diffPlan,
  effectiveRulesFor,
  fireAtFor,
  guestEmailOf,
  guestNameIdentity,
  guestPhoneOf,
  overrideBodyProblem,
  pickRail,
  planAutomationSends,
  recipientsCovering,
  renderSubject,
  renderTemplate,
  resolveAutomationsFor,
  resumableKeys,
  templateFields,
  templateHasDoorCode,
  type AutomationBooking,
  type AutomationDelivery,
  type AutomationRule,
  type AutomationTrigger,
  type CheckoutAdjustmentLike,
  type ExistingSend,
  type GuestLike,
  type MergeContext,
  type Rail,
  type Rendered,
  type SendMode,
  type StayPlanLike,
} from '@/lib/automations-core';

export type {
  AutomationRule,
  AutomationBooking,
  Rail,
} from '@/lib/automations-core';

// ── Constants ───────────────────────────────────────────────────────────

/** Guest replies to an automation email land where the SCA intake reads them. */
const GUEST_REPLY_TO = (process.env.AUTOMATIONS_REPLY_TO || 'hello@staycapeann.com').trim();
/** A row left in 'sending' this long was abandoned by a dead run; it is failed, never re-sent blindly. */
const STUCK_SENDING_MS = 30 * 60 * 1000;
const IN_CHUNK = 150;

const RULE_COLS =
  'id, key, property_id, audience, trigger, offset_days, at_local, timezone, channel_exclusions, delivery, send_mode, min_nights, subject, body, enabled, configured_in_ota, created_by, created_at, updated_at';

const BOOKING_COLS =
  'id, property_id, channel, status, check_in, check_out, guest_name, guest_phone, guest_email, guest_id, duplicate_of, first_seen_at, booked_at, external_confirmation_code, num_guests, cancel_reason, cancelled_at';

const SEND_COLS =
  'id, booking_id, automation_id, automation_key, property_id, fire_at, status, delivery_used, to_address, subject_rendered, body_rendered, secrets_sent, missing_fields, provider_message_id, guest_message_id, error, planned_check_in, planned_check_out, approved_by, approved_at, sent_at, created_at, updated_at';

const PROPERTY_COLS =
  'id, name, title, address, city, region, calendar_authority, automations_enabled, automations_enabled_at, timezone, wifi_name, parking, parking_regulations, trash_day, recycling_day, is_active';

// ── Shapes ──────────────────────────────────────────────────────────────

export type AutomationSendRow = {
  id: string;
  booking_id: string;
  /** Null once the rule row was deleted (Remove override); the row stays as history. */
  automation_id: string | null;
  automation_key?: string | null;
  property_id: string;
  fire_at: string;
  status: string;
  delivery_used: string | null;
  to_address: string | null;
  subject_rendered: string | null;
  body_rendered: string | null;
  secrets_sent: boolean;
  missing_fields: string[];
  provider_message_id: string | null;
  guest_message_id: string | null;
  error: string | null;
  planned_check_in: string;
  planned_check_out: string;
  approved_by: string | null;
  approved_at: string | null;
  sent_at: string | null;
  created_at: string;
  updated_at: string;
};

type PropertyRow = {
  id: string;
  name: string;
  title: string | null;
  address: string | null;
  city: string | null;
  region: string | null;
  calendar_authority: string | null;
  automations_enabled: boolean | null;
  /** When the switch last went on. Null on a home enabled before the stamp existed. */
  automations_enabled_at: string | null;
  timezone: string | null;
  wifi_name: string | null;
  parking: string | null;
  parking_regulations: string | null;
  trash_day: string | null;
  recycling_day: string | null;
  is_active: boolean | null;
};

type PropertyBundle = {
  property: PropertyRow;
  plan: StayPlanLike;
  access: PropertyAccess | null;
  lockMapped: boolean;
  recipients: ScheduleRecipient[];
  trashDay: string | null;
};

function shapeRule(raw: Record<string, unknown>): AutomationRule {
  const trigger = String(raw.trigger ?? 'pre_arrival') as AutomationTrigger;
  const delivery = String(raw.delivery ?? 'sms_then_email') as AutomationDelivery;
  return {
    id: String(raw.id),
    key: String(raw.key),
    property_id: (raw.property_id as string | null) ?? null,
    audience: raw.audience === 'cleaner' ? 'cleaner' : 'guest',
    trigger: (AUTOMATION_TRIGGERS as readonly string[]).includes(trigger) ? trigger : 'pre_arrival',
    offset_days: Number(raw.offset_days ?? 0),
    at_local: (raw.at_local as string | null) ?? null,
    timezone: String(raw.timezone || 'America/New_York'),
    channel_exclusions: Array.isArray(raw.channel_exclusions) ? (raw.channel_exclusions as string[]) : [],
    delivery: (AUTOMATION_DELIVERIES as readonly string[]).includes(delivery) ? delivery : 'sms_then_email',
    send_mode: raw.send_mode === 'auto' ? 'auto' : 'approve',
    min_nights: raw.min_nights === null || raw.min_nights === undefined ? null : Number(raw.min_nights),
    subject: (raw.subject as string | null) ?? null,
    body: String(raw.body ?? ''),
    enabled: !!raw.enabled,
    configured_in_ota: !!raw.configured_in_ota,
  };
}

function chunk<T>(xs: readonly T[], n = IN_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

/** YYYY-MM-DD in a zone (en-CA renders ISO order). */
function ymdInZone(now: Date, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  } catch {
    return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  }
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function textToHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 14px;font:15px/1.55 Inter,Helvetica,Arial,sans-serif;color:#1e2e34">${escapeHtml(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

// ── Reads ───────────────────────────────────────────────────────────────

/** Fleet defaults plus the rows of the given homes (every row when no ids). */
export async function listAutomationRules(propertyIds?: readonly string[]): Promise<AutomationRule[]> {
  if (!isServiceConfigured) return [];
  const rows = await selectAllPaged<Record<string, unknown>>(
    (from, to) => {
      let q = supabaseAdmin.from('message_automations').select(RULE_COLS).order('id', { ascending: true }).range(from, to);
      if (propertyIds && propertyIds.length > 0) {
        const list = propertyIds.map((id) => `"${id.replace(/"/g, '')}"`).join(',');
        q = q.or(`property_id.is.null,property_id.in.(${list})`);
      }
      return q;
    },
    { label: 'message_automations' },
  );
  return rows.map(shapeRule);
}

export async function getAutomationRule(id: string | null): Promise<AutomationRule | null> {
  if (!isServiceConfigured || !id) return null;
  const { data, error } = await supabaseAdmin.from('message_automations').select(RULE_COLS).eq('id', id).maybeSingle();
  if (error || !data) return null;
  return shapeRule(data as Record<string, unknown>);
}

async function loadPropertyRow(propertyId: string): Promise<PropertyRow | null> {
  const { data, error } = await supabaseAdmin.from('properties').select(PROPERTY_COLS).eq('id', propertyId).maybeSingle();
  if (error || !data) return null;
  return data as unknown as PropertyRow;
}

async function loadPlan(propertyId: string): Promise<StayPlanLike> {
  const { data } = await supabaseAdmin
    .from('property_rate_plans')
    .select('checkin_time, checkout_time')
    .eq('property_id', propertyId)
    .maybeSingle();
  return (data as StayPlanLike) ?? null;
}

async function loadLockMapped(propertyId: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('lock_devices')
    .select('device_id')
    .eq('property_id', propertyId)
    .eq('active', true)
    .limit(1);
  return Array.isArray(data) && data.length > 0;
}

async function loadEnabledRecipients(): Promise<ScheduleRecipient[]> {
  const { data, error } = await supabaseAdmin.from('cleaner_schedule_recipients').select(RECIPIENT_COLS).eq('enabled', true);
  if (error || !data) return [];
  return (data as Parameters<typeof shapeRecipient>[0][]).map(shapeRecipient);
}

async function loadPropertyBundle(propertyId: string): Promise<PropertyBundle | null> {
  const property = await loadPropertyRow(propertyId);
  if (!property) return null;
  const [plan, accessMap, lockMapped, recipients] = await Promise.all([
    loadPlan(propertyId),
    getPropertyAccessMap([propertyId]),
    loadLockMapped(propertyId),
    loadEnabledRecipients(),
  ]);
  let trashDay: string | null = null;
  try {
    // civicForProperty reads city, address, trash_day, recycling_day and
    // parking_regulations; the rest of HelmPropertyRow is not consulted.
    trashDay = civicForProperty(property as unknown as HelmPropertyRow).trashDay;
  } catch {
    trashDay = null;
  }
  return {
    property,
    plan,
    access: accessMap.get(propertyId) ?? null,
    lockMapped,
    recipients: recipientsCovering(recipients, { id: property.id, region: property.region }),
    trashDay,
  };
}

async function loadGuest(guestId: string | null | undefined): Promise<GuestLike> {
  if (!guestId) return null;
  const { data } = await supabaseAdmin.from('guests').select('phone_e164, phone, email, first_name, full_name').eq('id', guestId).maybeSingle();
  return (data as GuestLike) ?? null;
}

async function loadStayCode(bookingId: string): Promise<string | null> {
  const { data } = await supabaseAdmin
    .from('guest_access_codes')
    .select('code')
    .eq('booking_id', bookingId)
    .is('removed_at', null)
    .order('created_at', { ascending: false })
    .limit(1);
  const row = Array.isArray(data) ? (data[0] as { code: string | null } | undefined) : undefined;
  return row?.code ?? null;
}

async function loadBooking(bookingId: string): Promise<AutomationBooking | null> {
  const { data, error } = await supabaseAdmin.from('bookings').select(BOOKING_COLS).eq('id', bookingId).maybeSingle();
  if (error || !data) return null;
  return data as unknown as AutomationBooking;
}

async function loadAdjustments(propertyIds: readonly string[], fromDate: string): Promise<Record<string, CheckoutAdjustmentLike>> {
  const out: Record<string, CheckoutAdjustmentLike> = {};
  for (const ids of chunk(propertyIds)) {
    const { data } = await supabaseAdmin
      .from('checkout_adjustments')
      .select('property_id, stay_check_in, adjusted_check_out, adjusted_checkout_time')
      .eq('status', 'active')
      .in('property_id', ids)
      .gte('stay_check_in', fromDate);
    for (const r of (data ?? []) as Array<{ property_id: string; stay_check_in: string; adjusted_check_out: string | null; adjusted_checkout_time: string | null }>) {
      out[adjustmentKey(r.property_id, r.stay_check_in)] = { adjusted_check_out: r.adjusted_check_out, adjusted_checkout_time: r.adjusted_checkout_time };
    }
  }
  return out;
}

async function loadAdjustmentFor(propertyId: string, checkIn: string): Promise<CheckoutAdjustmentLike> {
  const map = await loadAdjustments([propertyId], checkIn);
  return map[adjustmentKey(propertyId, checkIn)] ?? null;
}

/** The homes the planner runs for: helm-run AND automations_enabled, both flags. */
export async function listAutomatedProperties(propertyId?: string | null): Promise<FleetProperty[]> {
  const rows = await listFleetProperties({ calendarAuthority: 'helm' });
  return rows.filter((p) => p.automations_enabled && (!propertyId || p.id === propertyId));
}

// ── Merge context ───────────────────────────────────────────────────────

async function mergeContextFor(
  booking: AutomationBooking,
  bundle: PropertyBundle,
  guest: GuestLike,
  adjustment: CheckoutAdjustmentLike,
  /** The rule's timezone, so {{arrival_when}} reads the guest's calendar
   *  day at the moment the text goes. */
  timeZone?: string | null,
): Promise<MergeContext> {
  const stayCode = bundle.lockMapped ? await loadStayCode(booking.id) : null;
  return buildMergeContext({
    booking,
    guest,
    property: {
      name: bundle.property.name,
      title: bundle.property.title,
      address: bundle.property.address,
      wifi_name: bundle.property.wifi_name,
      parking: bundle.property.parking,
    },
    plan: bundle.plan,
    adjustment,
    access: bundle.access
      ? { smart_lock_code: bundle.access.smart_lock_code, key_code_location: bundle.access.key_code_location, wifi_password: bundle.access.wifi_password }
      : null,
    stayCode,
    lockMapped: bundle.lockMapped,
    trashDay: bundle.trashDay,
    now: new Date(),
    timeZone: timeZone || undefined,
  });
}

/**
 * properties.automations_enabled_at for the homes in a run. A home missing
 * from the result (or carrying null) gets no booking_confirmed sends: the
 * pure planner reads an unknown enable moment as "not yet", never as
 * "long ago".
 */
async function loadEnabledAt(propertyIds: readonly string[]): Promise<Record<string, string | null>> {
  const out: Record<string, string | null> = {};
  for (const ids of chunk(propertyIds)) {
    const { data, error } = await supabaseAdmin.from('properties').select('id, automations_enabled_at').in('id', ids);
    if (error) {
      console.error('[automations] automations_enabled_at read failed', error.message);
      continue;
    }
    for (const r of (data ?? []) as Array<{ id: string; automations_enabled_at: string | null }>) out[r.id] = r.automations_enabled_at;
  }
  return out;
}

// ── Planner ─────────────────────────────────────────────────────────────

export type PlanSummary = {
  properties: number;
  bookings: number;
  planned: number;
  inserted: number;
  retimed: number;
  /** Rows the engine had paused (switch off, rule superseded) and this run put back on the calendar. */
  resumed: number;
  /** Rows this run wrote as scheduled to go out (inserted, re-timed or resumed); the honest "planned" for an operator. */
  queued: number;
  stale: number;
  unchanged: number;
  frozen: number;
  superseded: number;
  /** Waiting rows paused because the plan no longer wants them (a continuation seam, a shorter stay). */
  withdrawn: number;
  /** Pairs not inserted because the stay already had that message key settled under another rule row. */
  keyed: number;
  dry: boolean;
};

const EMPTY_PLAN: PlanSummary = { properties: 0, bookings: 0, planned: 0, inserted: 0, retimed: 0, resumed: 0, queued: 0, stale: 0, unchanged: 0, frozen: 0, superseded: 0, withdrawn: 0, keyed: 0, dry: false };

export async function planAutomations(opts: { now?: Date; propertyId?: string | null; dry?: boolean } = {}): Promise<PlanSummary> {
  const now = opts.now ?? new Date();
  const dry = !!opts.dry;
  if (!isServiceConfigured) return { ...EMPTY_PLAN, dry };

  const properties = await listAutomatedProperties(opts.propertyId);
  if (properties.length === 0) return { ...EMPTY_PLAN, dry };
  const propertyIds = properties.map((p) => p.id);

  const rules = await listAutomationRules(propertyIds);
  const effectiveByProperty = new Map<string, Set<string>>();
  const activeIds: string[] = [];
  for (const p of properties) {
    const ids = new Set(resolveAutomationsFor(p.id, rules).map((r) => r.id));
    effectiveByProperty.set(p.id, ids);
    if (ids.size > 0) activeIds.push(p.id);
  }

  // Stays: canonical, confirmed (or completed for post_checkout), in the
  // 30-day window, plus anything first seen in the last 24h so a booking
  // the iCal sync inserted at :00 is confirmed by :15.
  const today = ymdInZone(now, 'America/New_York');
  const horizon = addDays(today, PLAN_WINDOW_DAYS);
  const sinceIso = new Date(now.getTime() - CONFIRMED_WINDOW_MS).toISOString();
  const byId = new Map<string, AutomationBooking>();
  for (const ids of chunk(propertyIds)) {
    const windowRows = await selectAllPaged<AutomationBooking>(
      (from, to) =>
        supabaseAdmin
          .from('bookings')
          .select(BOOKING_COLS)
          .in('property_id', ids)
          .in('status', ['confirmed', 'completed'])
          .is('duplicate_of', null)
          .lte('check_in', horizon)
          .gte('check_out', addDays(today, -1))
          .order('id', { ascending: true })
          .range(from, to),
      { label: 'automations plan window' },
    );
    const freshRows = await selectAllPaged<AutomationBooking>(
      (from, to) =>
        supabaseAdmin
          .from('bookings')
          .select(BOOKING_COLS)
          .in('property_id', ids)
          .eq('status', 'confirmed')
          .is('duplicate_of', null)
          // First seen, or BOOKED, in the last 24h: an inquiry confirmed
          // today for a stay two months out is a new booking today.
          .or(`first_seen_at.gte.${sinceIso},booked_at.gte.${sinceIso}`)
          .order('id', { ascending: true })
          .range(from, to),
      { label: 'automations plan fresh' },
    );
    // Stays whose waiting messages a cancel paused: once the stay is live
    // again (a feed that dropped it and put it back, a re-confirm), its
    // messages resume at once, not when it enters the window weeks later.
    const pausedRows = await selectAllPaged<{ id: string; booking_id: string }>(
      (from, to) =>
        supabaseAdmin
          .from('automation_sends')
          .select('id, booking_id')
          .in('property_id', ids)
          .eq('status', 'cancelled')
          .eq('error', PAUSE_REASON_STAY_CANCELLED)
          .gte('planned_check_out', addDays(today, -1))
          .order('id', { ascending: true })
          .range(from, to),
      { label: 'automations paused by a cancel' },
    );
    const pausedIds = [...new Set(pausedRows.map((r) => r.booking_id))].filter((id) => !byId.has(id));
    const revivedRows: AutomationBooking[] = [];
    for (const part of chunk(pausedIds)) {
      const { data } = await supabaseAdmin
        .from('bookings')
        .select(BOOKING_COLS)
        .in('id', part)
        .eq('status', 'confirmed')
        .is('duplicate_of', null)
        .gte('check_out', addDays(today, -1));
      for (const r of (data ?? []) as AutomationBooking[]) revivedRows.push(r);
    }
    for (const b of [...windowRows, ...freshRows, ...revivedRows]) byId.set(b.id, b);
  }
  const bookings = [...byId.values()].filter((b) => effectiveByProperty.get(b.property_id)?.size);

  const plans: Record<string, StayPlanLike> = {};
  await Promise.all(
    activeIds.map(async (id) => {
      plans[id] = await loadPlan(id);
    }),
  );
  const [adjustments, enabledAt] = await Promise.all([loadAdjustments(activeIds, addDays(today, -60)), loadEnabledAt(activeIds)]);

  // The ledger for these stays, read BEFORE planning so the plan reconciles
  // instead of inserting blind. `error` rides along so a row the engine
  // paused (the switch went off, or the rule was superseded) is recognised:
  // the planner lets a paused confirmation past the enable stamp (which the
  // off/on just moved), and diffPlan resumes it rather than freezing it.
  const bookingIds = bookings.map((b) => b.id);
  const existing: ExistingSend[] = [];
  for (const ids of chunk(bookingIds)) {
    // Paged: 150 stays times a handful of rules each can pass the 1000-row
    // cap, and a truncated ledger would silently miss re-times and resumes.
    const rows = await selectAllPaged<ExistingSend>(
      (from, to) =>
        supabaseAdmin
          .from('automation_sends')
          .select('id, booking_id, automation_id, automation_key, fire_at, status, error, planned_check_in, planned_check_out')
          .in('booking_id', ids)
          .order('id', { ascending: true })
          .range(from, to),
      { label: 'automation_sends read' },
    );
    for (const r of rows) existing.push(r);
  }

  const planned = planAutomationSends({
    bookings,
    rules,
    plans,
    adjustments,
    enabledAt,
    resumable: resumableKeys(existing),
    pausedByStayCancel: stayCancelPausedKeys(existing),
    now,
  });
  const diff = diffPlan(planned, existing);

  // Rows waiting on a rule that no longer applies to the home (an override
  // arrived, or the rule was disabled) are paused so a fleet row and its
  // override never both fire for one stay. The pause reason is what lets
  // diffPlan resume them if the rule applies again.
  let superseded = 0;
  for (const ids of chunk(propertyIds)) {
    const { data } = await supabaseAdmin
      .from('automation_sends')
      .select('id, property_id, automation_id')
      .in('property_id', ids)
      .in('status', ['scheduled', 'awaiting_approval']);
    const stale = ((data ?? []) as Array<{ id: string; property_id: string; automation_id: string }>).filter(
      (r) => !effectiveByProperty.get(r.property_id)?.has(r.automation_id),
    );
    superseded += stale.length;
    if (!dry && stale.length > 0) {
      for (const part of chunk(stale.map((r) => r.id))) {
        await supabaseAdmin
          .from('automation_sends')
          .update({ status: 'cancelled', error: PAUSE_REASON_SUPERSEDED, updated_at: now.toISOString() })
          .in('id', part)
          .in('status', ['scheduled', 'awaiting_approval']);
      }
    }
  }

  // Waiting rows the plan no longer wants for a stay it covered (a guest
  // who extended must not be told "checkout tomorrow"; a departure cleaner
  // rule must not send the crew to an occupied house). Paused, not killed:
  // diffPlan resumes them if the pair is planned again.
  const allEffective = new Set<string>();
  for (const ids of effectiveByProperty.values()) for (const id of ids) allEffective.add(id);
  const withdrawn = withdrawnSends(planned, existing, rules, allEffective);
  if (!dry && withdrawn.length > 0) {
    for (const part of chunk(withdrawn)) {
      await supabaseAdmin
        .from('automation_sends')
        .update({ status: 'cancelled', error: PAUSE_REASON_NO_LONGER_APPLIES, updated_at: now.toISOString() })
        .in('id', part)
        .in('status', ['scheduled', 'awaiting_approval']);
    }
  }

  if (!dry) {
    for (const part of chunk(diff.inserts)) {
      const { error } = await supabaseAdmin
        .from('automation_sends')
        .upsert(
          part.map((p) => ({
            booking_id: p.booking_id,
            automation_id: p.automation_id,
            automation_key: p.automation_key,
            property_id: p.property_id,
            fire_at: p.fire_at,
            status: p.status,
            error: p.error,
            planned_check_in: p.planned_check_in,
            planned_check_out: p.planned_check_out,
          })),
          { onConflict: 'booking_id,automation_id', ignoreDuplicates: true },
        );
      if (error) throw new Error(`automation_sends insert: ${error.message}`);
    }
    for (const u of diff.updates) {
      // A re-time only lands on a row still scheduled (or dates-moved); a
      // resume only on a row still cancelled FOR THE SAME PAUSE REASON, so a
      // row an operator skipped, or one that sent, between read and write is
      // never touched.
      const base = supabaseAdmin.from('automation_sends').update({ ...u.patch, updated_at: now.toISOString() }).eq('id', u.id);
      const { error } =
        u.resumeFrom !== null
          ? await base.eq('status', 'cancelled').eq('error', u.resumeFrom)
          : u.movedFrom
            ? await base
                .eq('status', 'awaiting_approval')
                .eq('planned_check_in', u.movedFrom.planned_check_in)
                .eq('planned_check_out', u.movedFrom.planned_check_out)
            : await base.in('status', ['scheduled', 'skipped_dates_moved']);
      if (error) throw new Error(`automation_sends retime: ${error.message}`);
    }
  }

  return {
    properties: activeIds.length,
    bookings: bookings.length,
    planned: planned.length,
    inserted: diff.inserts.length,
    retimed: diff.updates.length - diff.resumed,
    resumed: diff.resumed,
    queued:
      diff.inserts.filter((p) => p.status === 'scheduled').length + diff.updates.filter((u) => u.patch.status === 'scheduled').length,
    stale: planned.filter((p) => p.status === 'skipped_cancelled').length,
    unchanged: diff.unchanged,
    frozen: diff.frozen,
    superseded,
    withdrawn: withdrawn.length,
    keyed: diff.keyed,
    dry,
  };
}

// ── Dispatcher ──────────────────────────────────────────────────────────

export type DispatchSummary = {
  claimed: number;
  sent: number;
  awaiting_approval: number;
  configured_in_ota: number;
  skipped_no_contact: number;
  skipped_channel: number;
  skipped_cancelled: number;
  skipped_dates_moved: number;
  cancelled: number;
  failed: number;
  firstError: string | null;
  dry: boolean;
};

const EMPTY_DISPATCH: DispatchSummary = {
  claimed: 0,
  sent: 0,
  awaiting_approval: 0,
  configured_in_ota: 0,
  skipped_no_contact: 0,
  skipped_channel: 0,
  skipped_cancelled: 0,
  skipped_dates_moved: 0,
  cancelled: 0,
  failed: 0,
  firstError: null,
  dry: false,
};

type RunCache = {
  bundles: Map<string, Promise<PropertyBundle | null>>;
  rulesByProperty: Map<string, Promise<AutomationRule[]>>;
};

function newCache(): RunCache {
  return { bundles: new Map(), rulesByProperty: new Map() };
}

function bundleFor(cache: RunCache, propertyId: string): Promise<PropertyBundle | null> {
  let p = cache.bundles.get(propertyId);
  if (!p) {
    p = loadPropertyBundle(propertyId);
    cache.bundles.set(propertyId, p);
  }
  return p;
}

function rulesFor(cache: RunCache, propertyId: string): Promise<AutomationRule[]> {
  let p = cache.rulesByProperty.get(propertyId);
  if (!p) {
    p = listAutomationRules([propertyId]);
    cache.rulesByProperty.set(propertyId, p);
  }
  return p;
}

type DispatchOptions = {
  now: Date;
  /** An operator approved this row: approve gates are satisfied. */
  approved: boolean;
  actor: string | null;
  /** Operator-edited text (may itself carry merge fields). */
  bodyOverride?: string | null;
  cache: RunCache;
};

type Delivered = {
  to: string;
  providerMessageId: string | null;
  guestMessageId: string | null;
  note: string | null;
};

async function deliverSms(
  to: string,
  rendered: Rendered,
  row: AutomationSendRow,
  rule: AutomationRule,
  booking: AutomationBooking,
  now: Date,
): Promise<Delivered> {
  const msg = await sendMessage({ from: quoFromNumber('guests'), to, content: rendered.text });
  const providerMessageId = (msg as { id?: string } | null)?.id ?? null;
  let guestMessageId: string | null = null;
  try {
    // The stay is handed over by id: a phone lookup alone is bounded by the
    // inbox's 60-day contact window, so a booking_confirmed text for a stay
    // 90 days out would otherwise file on a thread with no stay or home.
    const r = await recordOutboundSms({
      phone: to,
      body: rendered.masked,
      at: now.toISOString(),
      quoMessageId: providerMessageId,
      senderKind: 'automation',
      senderLabel: `Automation: ${rule.key}`,
      source: 'automation',
      bookingId: booking.id,
      propertyId: booking.property_id,
      guestName: guestNameIdentity(booking.guest_name) ? booking.guest_name : null,
      automationSendId: row.id,
      deliveryStatus: 'sent',
      createForStranger: true,
    });
    if (r.recorded) guestMessageId = r.messageId;
  } catch (e) {
    console.error('[automations] guest_messages record failed (sms)', e instanceof Error ? e.message : e);
  }
  return { to, providerMessageId, guestMessageId, note: null };
}

async function deliverEmail(
  to: string,
  subject: Rendered,
  rendered: Rendered,
  row: AutomationSendRow,
  rule: AutomationRule,
  booking: AutomationBooking,
  bundle: PropertyBundle,
  now: Date,
): Promise<Delivered> {
  // The subject is a template like the body: its real text goes to Resend
  // and nowhere else; the inbox copy gets the masked pair.
  const ok = await sendTransactionalViaResend({
    to,
    subject: subject.text,
    html: textToHtml(rendered.text),
    text: rendered.text,
    fromName: bundle.property.title?.trim() || bundle.property.name,
    replyTo: GUEST_REPLY_TO,
  });
  if (!ok) throw new Error('resend_failed: sendTransactionalViaResend returned false');
  let guestMessageId: string | null = null;
  try {
    const r = await recordOutboundEmail({
      email: to,
      body: rendered.masked,
      subject: subject.masked,
      at: now.toISOString(),
      provider: 'resend',
      senderKind: 'automation',
      senderLabel: `Automation: ${rule.key}`,
      source: 'automation',
      bookingId: booking.id,
      propertyId: booking.property_id,
      guestName: guestNameIdentity(booking.guest_name) ? booking.guest_name : null,
      automationSendId: row.id,
      deliveryStatus: 'sent',
    });
    if (r.recorded) guestMessageId = r.messageId;
  } catch (e) {
    console.error('[automations] guest_messages record failed (email)', e instanceof Error ? e.message : e);
  }
  return { to, providerMessageId: null, guestMessageId, note: null };
}

async function deliverCleanerSms(rendered: Rendered, bundle: PropertyBundle): Promise<Delivered> {
  const from = quoFromNumber('ops');
  const sent: string[] = [];
  const failed: string[] = [];
  let firstId: string | null = null;
  for (const r of bundle.recipients) {
    const to = toE164Phone(r.phone);
    if (!to) continue;
    try {
      const msg = await sendMessage({ from, to, content: rendered.text });
      sent.push(r.display_name);
      if (!firstId) firstId = (msg as { id?: string } | null)?.id ?? null;
    } catch (e) {
      failed.push(`${r.display_name}: ${classifySendError(e)}`);
    }
  }
  if (sent.length === 0) throw new Error(failed[0] ?? 'no cleaner recipient could be texted');
  return {
    to: sent.join(', '),
    providerMessageId: firstId,
    guestMessageId: null,
    note: failed.length > 0 ? `partial: ${failed.join('; ')}` : null,
  };
}

/**
 * Finish one claimed row: re-read the stay, decide, deliver or park. The
 * row is already in status 'sending' (claimed by the caller), so every path
 * out of here writes a terminal or parked status.
 */
async function dispatchRow(row: AutomationSendRow, opts: DispatchOptions): Promise<string> {
  const nowIso = opts.now.toISOString();
  const finish = async (patch: Record<string, unknown>): Promise<string> => {
    const { error } = await supabaseAdmin
      .from('automation_sends')
      .update({ ...patch, updated_at: nowIso })
      .eq('id', row.id)
      .eq('status', 'sending');
    if (error) console.error('[automations] ledger write failed', row.id, error.message);
    return String(patch.status);
  };

  const [booking, allRules, bundle] = await Promise.all([loadBooking(row.booking_id), rulesFor(opts.cache, row.property_id), bundleFor(opts.cache, row.property_id)]);
  const ruleRow = allRules.find((r) => r.id === row.automation_id) ?? (await getAutomationRule(row.automation_id));
  // A rule that is no longer the effective one for this home (an override
  // arrived after planning, or it was disabled) reads as disabled.
  const effectiveIds = new Set(resolveAutomationsFor(row.property_id, allRules).map((r) => r.id));
  const rule = ruleRow ? { ...ruleRow, enabled: ruleRow.enabled && effectiveIds.has(ruleRow.id) } : null;

  const guest = booking ? await loadGuest(booking.guest_id) : null;
  const adjustment = booking ? await loadAdjustmentFor(booking.property_id, booking.check_in) : null;
  const ctx = booking && bundle ? await mergeContextFor(booking, bundle, guest, adjustment, rule?.timezone) : {};
  const body = opts.bodyOverride?.trim() || rule?.body || '';
  const rendered = renderTemplate(body, ctx);
  // Rendered pair: .text for the wire only, .masked for the ledger and the inbox.
  const subject = rule ? renderSubject(rule.subject, ctx) : null;

  const decision = decideDispatch({
    row,
    booking,
    rule,
    property: bundle ? { automations_enabled: !!bundle.property.automations_enabled, calendar_authority: bundle.property.calendar_authority ?? 'guesty' } : null,
    guest,
    recipients: bundle?.recipients ?? [],
    rendered,
    lockMapped: !!bundle?.lockMapped,
    approved: opts.approved,
    // The approval is for the rail the card showed.
    approvedRail: opts.approved ? row.delivery_used : null,
  });

  const otaChannel = booking ? otaChannelOfBooking(booking.channel) : null;
  const otaUrl = otaChannel ? otaThreadUrl(otaChannel, booking?.external_confirmation_code) : null;
  const toFor = (rail: Rail | null): string | null => {
    if (!booking || !bundle) return null;
    switch (rail) {
      case 'sms':
        return guestPhoneOf(booking, guest);
      case 'email':
        return guestEmailOf(booking, guest);
      case 'cleaner_sms':
        return bundle.recipients.map((r) => r.display_name).join(', ') || null;
      case 'ota_manual':
        return otaUrl;
      default:
        return null;
    }
  };

  const common = {
    delivery_used: decision.rail,
    to_address: toFor(decision.rail),
    subject_rendered: subject?.masked ?? null,
    body_rendered: rendered.masked,
    missing_fields: rendered.missing,
    ...(opts.approved && opts.actor ? { approved_by: opts.actor, approved_at: nowIso } : {}),
  };

  if (decision.outcome !== 'send') {
    if (decision.rail === 'ota_manual' && booking && decision.outcome === 'awaiting_approval') {
      try {
        await ensureOtaThreadForBooking(booking);
      } catch {
        /* the deep link on the row is enough */
      }
    }
    return finish({ ...common, status: decision.outcome, error: decision.reason });
  }

  if (!booking || !bundle || !rule || !decision.rail) {
    return finish({ ...common, status: 'failed', error: 'dispatch invariant: send decided without a stay, rule or rail' });
  }

  const subjectRendered = subject ?? renderSubject(rule.subject, ctx);
  const secretsPresent =
    templateFields(body).some((f) => SECRET_FIELDS.has(f) && !rendered.missing.includes(f)) ||
    templateFields(rule.subject).some((f) => SECRET_FIELDS.has(f) && !subjectRendered.missing.includes(f));
  try {
    let delivered: Delivered;
    switch (decision.rail) {
      case 'sms': {
        const to = guestPhoneOf(booking, guest);
        if (!to) throw new Error('no phone at send time');
        delivered = await deliverSms(to, rendered, row, rule, booking, opts.now);
        break;
      }
      case 'email': {
        const to = guestEmailOf(booking, guest);
        if (!to) throw new Error('no email at send time');
        delivered = await deliverEmail(to, subjectRendered, rendered, row, rule, booking, bundle, opts.now);
        break;
      }
      case 'cleaner_sms':
        delivered = await deliverCleanerSms(rendered, bundle);
        break;
      case 'ota_manual':
        // The operator pasted the text into the OTA app and pressed Approve.
        delivered = { to: otaUrl ?? 'ota', providerMessageId: null, guestMessageId: null, note: 'pasted into the OTA app by the operator' };
        break;
    }
    return finish({
      ...common,
      status: 'sent',
      to_address: delivered.to,
      provider_message_id: delivered.providerMessageId,
      guest_message_id: delivered.guestMessageId,
      secrets_sent: secretsPresent && decision.rail !== 'ota_manual',
      sent_at: nowIso,
      error: delivered.note,
    });
  } catch (e) {
    return finish({ ...common, status: 'failed', error: classifySendError(e) });
  }
}

/**
 * Claim every due row atomically (one UPDATE ... RETURNING flips
 * scheduled -> sending, so two overlapping runs cannot both take a row),
 * then finish each. ?dry counts what would be claimed and touches nothing.
 */
export async function dispatchDue(opts: { now?: Date; propertyId?: string | null; dry?: boolean } = {}): Promise<DispatchSummary> {
  const now = opts.now ?? new Date();
  const dry = !!opts.dry;
  if (!isServiceConfigured) return { ...EMPTY_DISPATCH, dry };
  const nowIso = now.toISOString();

  if (dry) {
    let q = supabaseAdmin.from('automation_sends').select('id', { count: 'exact', head: true }).eq('status', 'scheduled').lte('fire_at', nowIso);
    if (opts.propertyId) q = q.eq('property_id', opts.propertyId);
    const { count } = await q;
    return { ...EMPTY_DISPATCH, claimed: count ?? 0, dry };
  }

  // A run that died mid-send leaves rows in 'sending'. Re-sending them could
  // double a text whose ledger write was the part that failed, so they are
  // failed with a note for the operator instead of reclaimed.
  {
    const stuckBefore = new Date(now.getTime() - STUCK_SENDING_MS).toISOString();
    let stuck = supabaseAdmin
      .from('automation_sends')
      .update({ status: 'failed', error: 'stuck in sending for 30+ minutes; not retried', updated_at: nowIso })
      .eq('status', 'sending')
      .lt('updated_at', stuckBefore);
    if (opts.propertyId) stuck = stuck.eq('property_id', opts.propertyId);
    await stuck;
  }

  let claim = supabaseAdmin
    .from('automation_sends')
    .update({ status: 'sending', updated_at: nowIso })
    .eq('status', 'scheduled')
    .lte('fire_at', nowIso);
  if (opts.propertyId) claim = claim.eq('property_id', opts.propertyId);
  const { data, error } = await claim.select(SEND_COLS);
  if (error) throw new Error(`automation_sends claim: ${error.message}`);
  const rows = (data ?? []) as AutomationSendRow[];

  const summary: DispatchSummary = { ...EMPTY_DISPATCH, claimed: rows.length, dry };
  const cache = newCache();
  for (const row of rows) {
    let status: string;
    try {
      status = await dispatchRow(row, { now, approved: false, actor: null, cache });
    } catch (e) {
      status = 'failed';
      const msg = classifySendError(e);
      await supabaseAdmin.from('automation_sends').update({ status: 'failed', error: msg, updated_at: nowIso }).eq('id', row.id).eq('status', 'sending');
      if (!summary.firstError) summary.firstError = msg;
    }
    if (status in summary && typeof (summary as Record<string, unknown>)[status] === 'number') {
      (summary as unknown as Record<string, number>)[status] += 1;
    }
    if (status === 'failed' && !summary.firstError) {
      const { data: failedRow } = await supabaseAdmin.from('automation_sends').select('error').eq('id', row.id).maybeSingle();
      summary.firstError = (failedRow as { error: string | null } | null)?.error ?? 'send failed';
    }
  }
  return summary;
}

// ── Operator verbs ──────────────────────────────────────────────────────

export type SendVerbResult = { ok: true; status: string } | { ok: false; error: string };

/**
 * Approve a parked row: send it now on its rail (or, for an OTA row, record
 * that the operator pasted it) and stamp approved_by. An optional edited
 * body replaces the template for this one send; it may carry merge fields,
 * which fill at send time. A body that still holds the stored render's mask
 * or an unfilled [field] marker is refused before the row is touched: the
 * guest would otherwise receive the mask in place of the door code.
 */
export async function approveSend(id: string, actor: string, opts: { body?: string | null } = {}): Promise<SendVerbResult> {
  if (!isServiceConfigured) return { ok: false, error: 'Service role is not configured.' };
  const problem = overrideBodyProblem(opts.body);
  if (problem) return { ok: false, error: problem };
  const now = new Date();
  const { data, error } = await supabaseAdmin
    .from('automation_sends')
    .update({ status: 'sending', updated_at: now.toISOString() })
    .eq('id', id)
    .eq('status', 'awaiting_approval')
    .select(SEND_COLS);
  if (error) return { ok: false, error: error.message };
  const row = (data ?? [])[0] as AutomationSendRow | undefined;
  if (!row) return { ok: false, error: 'That message is no longer awaiting approval.' };
  try {
    const status = await dispatchRow(row, { now, approved: true, actor, bodyOverride: opts.body ?? null, cache: newCache() });
    return { ok: true, status };
  } catch (e) {
    const msg = classifySendError(e);
    await supabaseAdmin.from('automation_sends').update({ status: 'failed', error: msg, updated_at: now.toISOString() }).eq('id', id).eq('status', 'sending');
    return { ok: false, error: msg };
  }
}

/**
 * The real text of a message parked for an OTA paste (rail ota_manual). The
 * ledger keeps only the masked render, and pasted from it a VRBO guest got
 * "Door code: ••••". Rendered afresh from the rule and the stay for the
 * signed-in operator, returned, never stored. Refused while a merge field is
 * missing, so "[guest_first]" is never pasted literally.
 */
export async function otaPasteText(id: string): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  if (!isServiceConfigured) return { ok: false, error: 'Service role is not configured.' };
  const { data, error } = await supabaseAdmin.from('automation_sends').select(SEND_COLS).eq('id', id).maybeSingle();
  if (error) return { ok: false, error: error.message };
  const row = data as AutomationSendRow | null;
  if (!row || row.status !== 'awaiting_approval' || row.delivery_used !== 'ota_manual') {
    return { ok: false, error: 'That message is not waiting to be pasted into an OTA.' };
  }
  const cache = newCache();
  const [booking, allRules, bundle] = await Promise.all([loadBooking(row.booking_id), rulesFor(cache, row.property_id), bundleFor(cache, row.property_id)]);
  const ruleRow = allRules.find((r) => r.id === row.automation_id) ?? (await getAutomationRule(row.automation_id));
  if (!booking || !bundle || !ruleRow) return { ok: false, error: 'The stay or its rule is gone; skip this message.' };
  const effectiveIds = new Set(resolveAutomationsFor(row.property_id, allRules).map((r) => r.id));
  const rule = { ...ruleRow, enabled: ruleRow.enabled && effectiveIds.has(ruleRow.id) };
  const guest = await loadGuest(booking.guest_id);
  const adjustment = await loadAdjustmentFor(booking.property_id, booking.check_in);
  const rendered = renderTemplate(rule.body, await mergeContextFor(booking, bundle, guest, adjustment, rule.timezone));
  // The same checks the send makes, before the door code leaves the server:
  // a stay the feed has cancelled or moved since this was parked, a rule
  // switched off, a home no longer automated. Copying first and learning at
  // "Mark pasted" handed the code to someone who is no longer a guest.
  const decision = decideDispatch({
    row,
    booking,
    rule,
    property: { automations_enabled: !!bundle.property.automations_enabled, calendar_authority: bundle.property.calendar_authority ?? 'guesty' },
    guest,
    recipients: bundle.recipients,
    rendered,
    lockMapped: !!bundle.lockMapped,
    approved: true,
    approvedRail: 'ota_manual',
  });
  // The stay moved: this card was for the old dates. Hand it back to the
  // planner (skipped_dates_moved is re-planned) instead of telling the
  // operator to skip, which ended every arrival message for the new dates.
  if (decision.outcome === 'skipped_dates_moved') {
    await supabaseAdmin
      .from('automation_sends')
      .update({ status: 'skipped_dates_moved', error: decision.reason, updated_at: new Date().toISOString() })
      .eq('id', row.id)
      .eq('status', 'awaiting_approval');
    return { ok: false, error: `The stay moved (${decision.reason}). This message is re-planned for the new dates; nothing to paste now.` };
  }
  // The stay has a phone or email now: the message goes on that rail, and
  // only after an approval that shows who it goes to.
  if (decision.outcome === 'awaiting_approval' && decision.rail && decision.rail !== 'ota_manual') {
    const to = decision.rail === 'sms' ? guestPhoneOf(booking, guest) : decision.rail === 'email' ? guestEmailOf(booking, guest) : null;
    await supabaseAdmin
      .from('automation_sends')
      .update({ delivery_used: decision.rail, to_address: to, error: decision.reason, updated_at: new Date().toISOString() })
      .eq('id', row.id)
      .eq('status', 'awaiting_approval')
      .eq('delivery_used', 'ota_manual');
    return { ok: false, error: `This stay now has ${decision.rail === 'sms' ? 'a phone' : 'an email'} on file, so the message goes by ${decision.rail === 'sms' ? 'SMS' : 'email'}. Reload and approve it there.` };
  }
  if (decision.outcome !== 'send' || decision.rail !== 'ota_manual') {
    return { ok: false, error: `Not to be sent any more (${decision.reason ?? decision.outcome}): skip this message.` };
  }
  if (rendered.missing.length > 0) {
    return { ok: false, error: `Missing ${rendered.missing.join(', ')}: fill the record first, or write the message in the OTA yourself.` };
  }
  return { ok: true, text: rendered.text };
}

/**
 * Skip a parked or scheduled row. It stays in the ledger as cancelled with
 * the actor's note. A row whose live stay has moved since it was planned is
 * the OLD dates' message: it is skipped as skipped_dates_moved, which the
 * planner re-plans for the new dates, so a skip never silently ends the
 * arrival message of a stay that is still coming.
 */
export async function skipSend(id: string, actor: string): Promise<SendVerbResult> {
  if (!isServiceConfigured) return { ok: false, error: 'Service role is not configured.' };
  const { data: current } = await supabaseAdmin
    .from('automation_sends')
    .select('booking_id, planned_check_in, planned_check_out')
    .eq('id', id)
    .maybeSingle();
  const cur = current as { booking_id: string; planned_check_in: string; planned_check_out: string } | null;
  const b = cur ? await loadBooking(cur.booking_id) : null;
  const moved = !!b && !!cur && b.status !== 'cancelled' && !b.duplicate_of && (b.check_in !== cur.planned_check_in || b.check_out !== cur.planned_check_out);
  const patch = moved
    ? { status: 'skipped_dates_moved', error: `dates moved to ${b!.check_in}..${b!.check_out}; the old dates' message was skipped by ${actor}` }
    : { status: 'cancelled', error: `skipped by ${actor}` };
  const { data, error } = await supabaseAdmin
    .from('automation_sends')
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq('id', id)
    .in('status', ['awaiting_approval', 'scheduled'])
    .select('id');
  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) return { ok: false, error: 'That message can no longer be skipped.' };
  return { ok: true, status: patch.status };
}

// ── Property switch ─────────────────────────────────────────────────────

export type SwitchResult = { ok: true; enabled: boolean; planned?: PlanSummary } | { ok: false; error: string };

/**
 * The automations_enabled switch. Enabling requires calendar_authority =
 * 'helm' (a Guesty-run home would receive duplicates of Guesty's own
 * automations), stamps automations_enabled_at (the booking_confirmed gate:
 * a stay already on the calendar at this moment is never "confirmed" by the
 * switch) and plans the home at once. Disabling PAUSES every row that has
 * not gone out: the rows read cancelled with the engine's own reason, and
 * the planner resumes them, re-timed, when the switch goes back on.
 */
export async function setAutomationsEnabled(propertyId: string, enabled: boolean, actor: string): Promise<SwitchResult> {
  if (!isServiceConfigured) return { ok: false, error: 'Service role is not configured.' };
  const property = await loadPropertyRow(propertyId);
  if (!property) return { ok: false, error: 'Property not found.' };
  if (enabled && property.calendar_authority !== 'helm') {
    return { ok: false, error: 'Automations run only once Helm is this home\'s calendar authority. Cut the home over on its Channels page first.' };
  }
  const nowIso = new Date().toISOString();
  const { error } = await supabaseAdmin
    .from('properties')
    .update(enabled ? { automations_enabled: true, automations_enabled_at: nowIso, updated_at: nowIso } : { automations_enabled: false, updated_at: nowIso })
    .eq('id', propertyId);
  if (error) return { ok: false, error: error.message };
  if (!enabled) {
    await supabaseAdmin
      .from('automation_sends')
      .update({ status: 'cancelled', error: `${PAUSE_REASON_DISABLED_PREFIX}${actor}`, updated_at: nowIso })
      .eq('property_id', propertyId)
      .in('status', ['scheduled', 'awaiting_approval']);
    return { ok: true, enabled: false };
  }
  let planned: PlanSummary | undefined;
  try {
    planned = await planAutomations({ propertyId });
  } catch (e) {
    console.error('[automations] plan after enable failed', e instanceof Error ? e.message : e);
  }
  return { ok: true, enabled: true, planned };
}

// ── Rule writes ─────────────────────────────────────────────────────────

export type RuleInput = {
  key: string;
  audience: 'guest' | 'cleaner';
  trigger: AutomationTrigger;
  offset_days: number;
  at_local: string | null;
  delivery: AutomationDelivery;
  send_mode: SendMode;
  min_nights: number | null;
  subject: string | null;
  body: string;
  enabled: boolean;
  channel_exclusions: string[];
  configured_in_ota: boolean;
};

export type RuleWriteResult = { ok: true; rule: AutomationRule } | { ok: false; error: string };

const KEY_RE = /^[a-z0-9][a-z0-9_]{1,39}$/;

export function validateRuleInput(input: RuleInput): string | null {
  if (!KEY_RE.test(input.key)) return 'Key must be 2 to 40 lowercase letters, digits or underscores.';
  if (!(AUTOMATION_TRIGGERS as readonly string[]).includes(input.trigger)) return 'Pick a trigger.';
  if (!(AUTOMATION_DELIVERIES as readonly string[]).includes(input.delivery)) return 'Pick a delivery.';
  if (input.audience !== 'guest' && input.audience !== 'cleaner') return 'Pick an audience.';
  if (input.send_mode !== 'auto' && input.send_mode !== 'approve') return 'Pick a send mode.';
  if (!Number.isInteger(input.offset_days) || input.offset_days < -60 || input.offset_days > 60) return 'Offset must be a whole number of days within 60.';
  if (input.at_local !== null && !/^\d{2}:\d{2}$/.test(input.at_local)) return 'Time must be HH:MM or blank.';
  if (input.min_nights !== null && (!Number.isInteger(input.min_nights) || input.min_nights < 1)) return 'Minimum nights must be a whole number.';
  if (!input.body.trim()) return 'The message body cannot be empty.';
  if (input.body.length > 2000) return 'Keep the body under 2000 characters.';
  return null;
}

async function findPropertyRule(propertyId: string, key: string): Promise<AutomationRule | null> {
  const { data } = await supabaseAdmin.from('message_automations').select(RULE_COLS).eq('property_id', propertyId).eq('key', key).maybeSingle();
  return data ? shapeRule(data as Record<string, unknown>) : null;
}

async function findFleetRule(key: string): Promise<AutomationRule | null> {
  const { data } = await supabaseAdmin.from('message_automations').select(RULE_COLS).is('property_id', null).eq('key', key).maybeSingle();
  return data ? shapeRule(data as Record<string, unknown>) : null;
}

function ruleToRow(input: RuleInput, propertyId: string, actor: string): Record<string, unknown> {
  return {
    key: input.key,
    property_id: propertyId,
    audience: input.audience,
    trigger: input.trigger,
    offset_days: input.offset_days,
    at_local: input.at_local,
    timezone: 'America/New_York',
    channel_exclusions: input.channel_exclusions,
    delivery: input.delivery,
    send_mode: input.send_mode,
    min_nights: input.min_nights,
    subject: input.subject?.trim() || null,
    body: input.body.trim(),
    enabled: input.enabled,
    configured_in_ota: input.configured_in_ota,
    created_by: actor,
  };
}

/** Create or replace this home's own row for a key (the override over the fleet default). */
export async function upsertPropertyRule(propertyId: string, input: RuleInput, actor: string): Promise<RuleWriteResult> {
  if (!isServiceConfigured) return { ok: false, error: 'Service role is not configured.' };
  const invalid = validateRuleInput(input);
  if (invalid) return { ok: false, error: invalid };
  const existing = await findPropertyRule(propertyId, input.key);
  const row = ruleToRow(input, propertyId, actor);
  const q = existing
    ? supabaseAdmin.from('message_automations').update({ ...row, created_by: undefined, updated_at: new Date().toISOString() }).eq('id', existing.id).select(RULE_COLS)
    : supabaseAdmin.from('message_automations').insert(row).select(RULE_COLS);
  const { data, error } = await q;
  if (error) return { ok: false, error: error.message };
  const saved = (data ?? [])[0];
  if (!saved) return { ok: false, error: 'The rule did not save.' };
  return { ok: true, rule: shapeRule(saved as Record<string, unknown>) };
}

/**
 * Flip enabled / send_mode / configured_in_ota for a key on one home. When
 * the home has no row of its own yet, the fleet row is cloned as the
 * override with the flag applied, so the fleet default is never edited
 * from a property page.
 */
export async function setPropertyRuleFlags(
  propertyId: string,
  key: string,
  patch: Partial<Pick<RuleInput, 'enabled' | 'send_mode' | 'configured_in_ota'>>,
  actor: string,
): Promise<RuleWriteResult> {
  if (!isServiceConfigured) return { ok: false, error: 'Service role is not configured.' };
  const own = await findPropertyRule(propertyId, key);
  if (own) {
    const { data, error } = await supabaseAdmin
      .from('message_automations')
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq('id', own.id)
      .select(RULE_COLS);
    if (error) return { ok: false, error: error.message };
    const saved = (data ?? [])[0];
    return saved ? { ok: true, rule: shapeRule(saved as Record<string, unknown>) } : { ok: false, error: 'The rule did not save.' };
  }
  const fleet = await findFleetRule(key);
  if (!fleet) return { ok: false, error: `No rule with key ${key}.` };
  const input: RuleInput = {
    key: fleet.key,
    audience: fleet.audience,
    trigger: fleet.trigger,
    offset_days: fleet.offset_days,
    at_local: fleet.at_local ? fleet.at_local.slice(0, 5) : null,
    delivery: fleet.delivery,
    send_mode: fleet.send_mode,
    min_nights: fleet.min_nights,
    subject: fleet.subject,
    body: fleet.body,
    enabled: fleet.enabled,
    channel_exclusions: fleet.channel_exclusions,
    configured_in_ota: fleet.configured_in_ota,
    ...patch,
  };
  return upsertPropertyRule(propertyId, input, actor);
}

/**
 * Remove this home's own row for a key, so the fleet default applies again.
 * automation_sends keeps the override's rows (automation_id SET NULL, the
 * key kept): what it sent stays in the history, and the planner's key
 * dedupe never sends it again to the same stay.
 */
export async function deletePropertyRule(propertyId: string, key: string): Promise<{ ok: boolean; error?: string }> {
  if (!isServiceConfigured) return { ok: false, error: 'Service role is not configured.' };
  const { error } = await supabaseAdmin.from('message_automations').delete().eq('property_id', propertyId).eq('key', key);
  return error ? { ok: false, error: error.message } : { ok: true };
}

// ── Test send ───────────────────────────────────────────────────────────

/**
 * Text the operator what the guest would receive, rendered against the
 * home's next stay (or a sample stay when the calendar is empty). Secrets
 * stay masked: a test never carries a door code to a typed-in number. Sent
 * from the GUESTS line so the operator sees the same sender the guest does.
 * Nothing is written to the ledger or the inbox.
 */
export async function sendTestToOperator(propertyId: string, ruleId: string, phone: string): Promise<{ ok: boolean; error?: string; preview?: string }> {
  if (!isServiceConfigured) return { ok: false, error: 'Service role is not configured.' };
  const to = toE164Phone(phone);
  if (!to) return { ok: false, error: 'That does not look like a phone number.' };
  const [rule, bundle] = await Promise.all([getAutomationRule(ruleId), loadPropertyBundle(propertyId)]);
  if (!rule) return { ok: false, error: 'Rule not found.' };
  if (!bundle) return { ok: false, error: 'Property not found.' };
  const stay = (await loadNextStay(propertyId)) ?? sampleStay(propertyId);
  const guest = await loadGuest(stay.guest_id);
  const adjustment = await loadAdjustmentFor(propertyId, stay.check_in);
  const ctx = await mergeContextFor(stay, bundle, guest, adjustment, rule.timezone);
  const rendered = renderTemplate(rule.body, ctx);
  const content = `TEST from Helm (${bundle.property.name}, ${rule.key}). Secrets masked.\n\n${rendered.masked}`;
  try {
    await sendMessage({ from: quoFromNumber('guests'), to, content });
    return { ok: true, preview: rendered.masked };
  } catch (e) {
    return { ok: false, error: classifySendError(e) };
  }
}

function sampleStay(propertyId: string): AutomationBooking {
  const today = ymdInZone(new Date(), 'America/New_York');
  return {
    id: 'sample',
    property_id: propertyId,
    channel: 'direct',
    status: 'confirmed',
    check_in: addDays(today, 7),
    check_out: addDays(today, 10),
    guest_name: 'Sample Guest',
    guest_phone: null,
    guest_email: null,
    guest_id: null,
    duplicate_of: null,
    first_seen_at: new Date().toISOString(),
    booked_at: new Date().toISOString(),
    external_confirmation_code: null,
    num_guests: 2,
  };
}

async function loadNextStay(propertyId: string): Promise<AutomationBooking | null> {
  const today = ymdInZone(new Date(), 'America/New_York');
  const { data } = await supabaseAdmin
    .from('bookings')
    .select(BOOKING_COLS)
    .eq('property_id', propertyId)
    .eq('status', 'confirmed')
    .is('duplicate_of', null)
    .gte('check_out', today)
    .order('check_in', { ascending: true })
    .limit(1);
  const row = Array.isArray(data) ? (data[0] as AutomationBooking | undefined) : undefined;
  return row ?? null;
}

// ── Property panel view ─────────────────────────────────────────────────

export type PanelRule = {
  rule: AutomationRule;
  source: 'fleet' | 'property';
  silenced: boolean;
  active: boolean;
  /** The fleet default this home overrides, when it has its own row. */
  fleet: AutomationRule | null;
  /** The template needs a door code and no lock is mapped: approve is forced. */
  forcedApprove: boolean;
  preview: {
    subject: string | null;
    masked: string;
    missing: string[];
    fireAt: string | null;
    rail: Rail | null;
  } | null;
};

export type PanelSend = {
  id: string;
  automation_id: string | null;
  key: string;
  booking_id: string;
  guest_name: string;
  check_in: string;
  check_out: string;
  channel: string;
  fire_at: string;
  status: string;
  delivery_used: string | null;
  to_address: string | null;
  /** Masked: a secret in the subject reads as •••• here. */
  subject_rendered: string | null;
  /** Masked: door code and wifi read as ••••, unfilled fields as [field]. Display only, never a send body. */
  body_rendered: string | null;
  /**
   * The rule's body with its {{merge fields}} intact. The editable draft on a
   * parked row seeds from THIS, so an operator's edit still fills the real
   * door code at send time instead of texting the mask.
   */
  template_body: string | null;
  missing_fields: string[];
  error: string | null;
  sent_at: string | null;
  approved_by: string | null;
  ota_url: string | null;
};

export type AutomationsPanelView = {
  property: {
    id: string;
    name: string;
    title: string | null;
    calendar_authority: string;
    automations_enabled: boolean;
    /** Null on a home switched on before the stamp existed: booking_confirmed waits for an off/on. */
    automations_enabled_at: string | null;
    region: string;
  };
  helmRun: boolean;
  lockMapped: boolean;
  hasRatePlan: boolean;
  recipients: string[];
  nextStay: {
    id: string;
    guest_name: string;
    check_in: string;
    check_out: string;
    channel: string;
    hasPhone: boolean;
    hasEmail: boolean;
  } | null;
  rules: PanelRule[];
  sends: PanelSend[];
  counts: { awaiting: number; scheduled: number; noContact: number; sent: number };
};

export async function getAutomationsPanelView(propertyId: string): Promise<AutomationsPanelView | null> {
  if (!isServiceConfigured) return null;
  const bundle = await loadPropertyBundle(propertyId);
  if (!bundle) return null;
  const now = new Date();
  const [rules, nextStay, sendRows] = await Promise.all([listAutomationRules([propertyId]), loadNextStay(propertyId), loadPanelSends(propertyId)]);

  const guest = nextStay ? await loadGuest(nextStay.guest_id) : null;
  const adjustment = nextStay ? await loadAdjustmentFor(propertyId, nextStay.check_in) : null;
  const ctx = nextStay ? await mergeContextFor(nextStay, bundle, guest, adjustment) : null;

  const effective = effectiveRulesFor(propertyId, rules);
  const panelRules: PanelRule[] = effective.map((e) => {
    const r = e.rule;
    let preview: PanelRule['preview'] = null;
    if (nextStay && ctx) {
      const rendered = renderTemplate(r.body, ctx);
      const fireAt = fireAtFor(r, nextStay, bundle.plan, adjustment, now);
      preview = {
        subject: r.delivery === 'email' || r.delivery === 'sms_then_email' ? renderSubject(r.subject, ctx).masked : null,
        masked: rendered.masked,
        missing: rendered.missing,
        fireAt: fireAt ? fireAt.toISOString() : null,
        rail: pickRail(r, nextStay, guest, bundle.recipients),
      };
    }
    return {
      rule: r,
      source: e.source,
      silenced: e.silenced,
      active: e.active,
      fleet: e.source === 'property' ? e.fleet : null,
      forcedApprove: templateHasDoorCode(r.body) && !bundle.lockMapped,
      preview,
    };
  });

  const ruleById = new Map(rules.map((r) => [r.id, r]));
  const bookingIds = [...new Set(sendRows.map((s) => s.booking_id))];
  const bookings = new Map<string, AutomationBooking>();
  for (const ids of chunk(bookingIds)) {
    const { data } = await supabaseAdmin.from('bookings').select(BOOKING_COLS).in('id', ids);
    for (const b of (data ?? []) as AutomationBooking[]) bookings.set(b.id, b);
  }
  const sends: PanelSend[] = sendRows.map((s) => {
    const b = bookings.get(s.booking_id);
    const ota = b ? otaChannelOfBooking(b.channel) : null;
    const rule = s.automation_id ? ruleById.get(s.automation_id) : undefined;
    return {
      id: s.id,
      automation_id: s.automation_id,
      key: rule?.key ?? s.automation_key ?? 'rule',
      booking_id: s.booking_id,
      guest_name: b ? guestNameIdentity(b.guest_name) ? (b.guest_name ?? '').trim() : 'Guest' : 'Guest',
      check_in: b?.check_in ?? s.planned_check_in,
      check_out: b?.check_out ?? s.planned_check_out,
      channel: b?.channel ?? '',
      fire_at: s.fire_at,
      status: s.status,
      delivery_used: s.delivery_used,
      to_address: s.to_address,
      subject_rendered: s.subject_rendered,
      body_rendered: s.body_rendered,
      template_body: rule?.body ?? null,
      missing_fields: Array.isArray(s.missing_fields) ? s.missing_fields : [],
      error: s.error,
      sent_at: s.sent_at,
      approved_by: s.approved_by,
      ota_url: ota ? otaThreadUrl(ota, b?.external_confirmation_code) : null,
    };
  });

  return {
    property: {
      id: bundle.property.id,
      name: bundle.property.name,
      title: bundle.property.title,
      calendar_authority: bundle.property.calendar_authority ?? 'guesty',
      automations_enabled: !!bundle.property.automations_enabled,
      automations_enabled_at: bundle.property.automations_enabled_at ?? null,
      region: bundle.property.region ?? 'cape_ann',
    },
    helmRun: bundle.property.calendar_authority === 'helm',
    lockMapped: bundle.lockMapped,
    hasRatePlan: !!bundle.plan,
    recipients: bundle.recipients.map((r) => r.display_name),
    nextStay: nextStay
      ? {
          id: nextStay.id,
          guest_name: guestNameIdentity(nextStay.guest_name) ? (nextStay.guest_name ?? '').trim() : 'Guest',
          check_in: nextStay.check_in,
          check_out: nextStay.check_out,
          channel: nextStay.channel,
          hasPhone: !!guestPhoneOf(nextStay, guest),
          hasEmail: !!guestEmailOf(nextStay, guest),
        }
      : null,
    rules: panelRules,
    sends,
    counts: {
      awaiting: sends.filter((s) => s.status === 'awaiting_approval').length,
      scheduled: sends.filter((s) => s.status === 'scheduled').length,
      noContact: sends.filter((s) => s.status === 'skipped_no_contact').length,
      sent: sends.filter((s) => s.status === 'sent').length,
    },
  };
}

/** Every parked row plus the most recent 60 of everything else. */
async function loadPanelSends(propertyId: string): Promise<AutomationSendRow[]> {
  const [{ data: parked }, { data: recent }] = await Promise.all([
    supabaseAdmin.from('automation_sends').select(SEND_COLS).eq('property_id', propertyId).in('status', ['awaiting_approval', 'scheduled', 'sending']).order('fire_at', { ascending: true }).limit(200),
    supabaseAdmin.from('automation_sends').select(SEND_COLS).eq('property_id', propertyId).order('fire_at', { ascending: false }).limit(60),
  ]);
  const byId = new Map<string, AutomationSendRow>();
  for (const r of [...((parked ?? []) as AutomationSendRow[]), ...((recent ?? []) as AutomationSendRow[])]) byId.set(r.id, r);
  return [...byId.values()].sort((a, b) => {
    const rank = (s: string) => (s === 'awaiting_approval' ? 0 : s === 'scheduled' || s === 'sending' ? 1 : 2);
    const d = rank(a.status) - rank(b.status);
    if (d !== 0) return d;
    return rank(a.status) < 2 ? a.fire_at.localeCompare(b.fire_at) : b.fire_at.localeCompare(a.fire_at);
  });
}
