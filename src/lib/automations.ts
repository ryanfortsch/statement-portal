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
  pickRail,
  planAutomationSends,
  recipientsCovering,
  renderTemplate,
  resolveAutomationsFor,
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
  'id, property_id, channel, status, check_in, check_out, guest_name, guest_phone, guest_email, guest_id, duplicate_of, first_seen_at, external_confirmation_code, num_guests';

const SEND_COLS =
  'id, booking_id, automation_id, property_id, fire_at, status, delivery_used, to_address, subject_rendered, body_rendered, secrets_sent, missing_fields, provider_message_id, guest_message_id, error, planned_check_in, planned_check_out, approved_by, approved_at, sent_at, created_at, updated_at';

const PROPERTY_COLS =
  'id, name, title, address, city, region, calendar_authority, automations_enabled, timezone, wifi_name, parking, parking_regulations, trash_day, recycling_day, is_active';

// ── Shapes ──────────────────────────────────────────────────────────────

export type AutomationSendRow = {
  id: string;
  booking_id: string;
  automation_id: string;
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

export async function getAutomationRule(id: string): Promise<AutomationRule | null> {
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
  });
}

function renderSubject(rule: AutomationRule, ctx: MergeContext): string {
  const fallback = `A note about your stay at {{property_title}}`;
  return renderTemplate(rule.subject?.trim() || fallback, ctx).text;
}

// ── Planner ─────────────────────────────────────────────────────────────

export type PlanSummary = {
  properties: number;
  bookings: number;
  planned: number;
  inserted: number;
  retimed: number;
  stale: number;
  unchanged: number;
  frozen: number;
  superseded: number;
  dry: boolean;
};

const EMPTY_PLAN: PlanSummary = { properties: 0, bookings: 0, planned: 0, inserted: 0, retimed: 0, stale: 0, unchanged: 0, frozen: 0, superseded: 0, dry: false };

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
          .gte('first_seen_at', sinceIso)
          .order('id', { ascending: true })
          .range(from, to),
      { label: 'automations plan fresh' },
    );
    for (const b of [...windowRows, ...freshRows]) byId.set(b.id, b);
  }
  const bookings = [...byId.values()].filter((b) => effectiveByProperty.get(b.property_id)?.size);

  const plans: Record<string, StayPlanLike> = {};
  await Promise.all(
    activeIds.map(async (id) => {
      plans[id] = await loadPlan(id);
    }),
  );
  const adjustments = await loadAdjustments(activeIds, addDays(today, -60));

  const planned = planAutomationSends({ bookings, rules, plans, adjustments, now });

  // The ledger for these stays, so the plan reconciles instead of inserting blind.
  const bookingIds = [...new Set(planned.map((p) => p.booking_id))];
  const existing: ExistingSend[] = [];
  for (const ids of chunk(bookingIds)) {
    const { data, error } = await supabaseAdmin
      .from('automation_sends')
      .select('id, booking_id, automation_id, fire_at, status, planned_check_in, planned_check_out')
      .in('booking_id', ids);
    if (error) throw new Error(`automation_sends read: ${error.message}`);
    for (const r of (data ?? []) as ExistingSend[]) existing.push(r);
  }
  const diff = diffPlan(planned, existing);

  // Rows waiting on a rule that no longer applies to the home (an override
  // arrived, or the rule was disabled) are cancelled so a fleet row and its
  // override never both fire for one stay.
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
          .update({ status: 'cancelled', error: 'rule superseded or disabled', updated_at: now.toISOString() })
          .in('id', part)
          .in('status', ['scheduled', 'awaiting_approval']);
      }
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
      const { error } = await supabaseAdmin
        .from('automation_sends')
        .update({ ...u.patch, updated_at: now.toISOString() })
        .eq('id', u.id)
        .in('status', ['scheduled', 'skipped_dates_moved']);
      if (error) throw new Error(`automation_sends retime: ${error.message}`);
    }
  }

  return {
    properties: activeIds.length,
    bookings: bookings.length,
    planned: planned.length,
    inserted: diff.inserts.length,
    retimed: diff.updates.length,
    stale: planned.filter((p) => p.status === 'skipped_cancelled').length,
    unchanged: diff.unchanged,
    frozen: diff.frozen,
    superseded,
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

async function deliverSms(to: string, rendered: Rendered, row: AutomationSendRow, rule: AutomationRule, now: Date): Promise<Delivered> {
  const msg = await sendMessage({ from: quoFromNumber('guests'), to, content: rendered.text });
  const providerMessageId = (msg as { id?: string } | null)?.id ?? null;
  let guestMessageId: string | null = null;
  try {
    const r = await recordOutboundSms({
      phone: to,
      body: rendered.masked,
      at: now.toISOString(),
      quoMessageId: providerMessageId,
      senderKind: 'automation',
      senderLabel: `Automation: ${rule.key}`,
      source: 'automation',
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
  subject: string,
  rendered: Rendered,
  row: AutomationSendRow,
  rule: AutomationRule,
  booking: AutomationBooking,
  bundle: PropertyBundle,
  now: Date,
): Promise<Delivered> {
  const ok = await sendTransactionalViaResend({
    to,
    subject,
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
      subject,
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
  const ctx = booking && bundle ? await mergeContextFor(booking, bundle, guest, adjustment) : {};
  const body = opts.bodyOverride?.trim() || rule?.body || '';
  const rendered = renderTemplate(body, ctx);
  const subject = rule ? renderSubject(rule, ctx) : null;

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
    subject_rendered: subject,
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

  const secretsPresent = templateFields(body).some((f) => SECRET_FIELDS.has(f) && !rendered.missing.includes(f));
  try {
    let delivered: Delivered;
    switch (decision.rail) {
      case 'sms': {
        const to = guestPhoneOf(booking, guest);
        if (!to) throw new Error('no phone at send time');
        delivered = await deliverSms(to, rendered, row, rule, opts.now);
        break;
      }
      case 'email': {
        const to = guestEmailOf(booking, guest);
        if (!to) throw new Error('no email at send time');
        delivered = await deliverEmail(to, subject ?? 'A note about your stay', rendered, row, rule, booking, bundle, opts.now);
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
 * body replaces the template for this one send.
 */
export async function approveSend(id: string, actor: string, opts: { body?: string | null } = {}): Promise<SendVerbResult> {
  if (!isServiceConfigured) return { ok: false, error: 'Service role is not configured.' };
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

/** Skip a parked or scheduled row. It stays in the ledger as cancelled with the actor's note. */
export async function skipSend(id: string, actor: string): Promise<SendVerbResult> {
  if (!isServiceConfigured) return { ok: false, error: 'Service role is not configured.' };
  const { data, error } = await supabaseAdmin
    .from('automation_sends')
    .update({ status: 'cancelled', error: `skipped by ${actor}`, updated_at: new Date().toISOString() })
    .eq('id', id)
    .in('status', ['awaiting_approval', 'scheduled'])
    .select('id');
  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) return { ok: false, error: 'That message can no longer be skipped.' };
  return { ok: true, status: 'cancelled' };
}

// ── Property switch ─────────────────────────────────────────────────────

export type SwitchResult = { ok: true; enabled: boolean; planned?: PlanSummary } | { ok: false; error: string };

/**
 * The automations_enabled switch. Enabling requires calendar_authority =
 * 'helm' (a Guesty-run home would receive duplicates of Guesty's own
 * automations) and plans the home at once; disabling cancels every row that
 * has not gone out.
 */
export async function setAutomationsEnabled(propertyId: string, enabled: boolean, actor: string): Promise<SwitchResult> {
  if (!isServiceConfigured) return { ok: false, error: 'Service role is not configured.' };
  const property = await loadPropertyRow(propertyId);
  if (!property) return { ok: false, error: 'Property not found.' };
  if (enabled && property.calendar_authority !== 'helm') {
    return { ok: false, error: 'Automations run only once Helm is this home\'s calendar authority. Cut the home over on its Channels page first.' };
  }
  const { error } = await supabaseAdmin
    .from('properties')
    .update({ automations_enabled: enabled, updated_at: new Date().toISOString() })
    .eq('id', propertyId);
  if (error) return { ok: false, error: error.message };
  if (!enabled) {
    await supabaseAdmin
      .from('automation_sends')
      .update({ status: 'cancelled', error: `automations disabled by ${actor}`, updated_at: new Date().toISOString() })
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
 * automation_sends cascades on automation_id: the override's send history
 * goes with it, which the panel says out loud.
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
  const ctx = await mergeContextFor(stay, bundle, guest, adjustment);
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
  automation_id: string;
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
  subject_rendered: string | null;
  body_rendered: string | null;
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
        subject: r.delivery === 'email' || r.delivery === 'sms_then_email' ? renderSubject(r, ctx) : null,
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

  const keyById = new Map(rules.map((r) => [r.id, r.key]));
  const bookingIds = [...new Set(sendRows.map((s) => s.booking_id))];
  const bookings = new Map<string, AutomationBooking>();
  for (const ids of chunk(bookingIds)) {
    const { data } = await supabaseAdmin.from('bookings').select(BOOKING_COLS).in('id', ids);
    for (const b of (data ?? []) as AutomationBooking[]) bookings.set(b.id, b);
  }
  const sends: PanelSend[] = sendRows.map((s) => {
    const b = bookings.get(s.booking_id);
    const ota = b ? otaChannelOfBooking(b.channel) : null;
    return {
      id: s.id,
      automation_id: s.automation_id,
      key: keyById.get(s.automation_id) ?? 'rule',
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
