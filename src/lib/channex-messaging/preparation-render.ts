import 'server-only';
import { z } from 'zod';
import { cleanerReminderRecipientSchema, resolveCleanerReminderLink, withCleanerReminderLink } from '../cleaner-reminder-link.ts';
import { guestNameIdentity, renderTemplate, templateFields, MERGE_FIELDS, MASK, type MergeContext } from '../automations-core.ts';
import { CALDERWOOD_MESSAGE_WORKFLOWS, type SourceClocks } from './preparation-timing.ts';
import { preparedRulePolicy } from './preparation-rules.ts';
import type { PreparationRule } from './preparation-rules.ts';
import type { GuestyHandoffStay } from '../channex-bookings/message-identity.ts';

const text = z.string().max(16000).nullable();
const snapshot = z.object({
  property: z.object({ id: z.literal('65_calderwood'), name: text, wifi_name: text }).strict(),
  access: z.object({ smart_lock_code: text, key_code_location: text, wifi_password: text }).strict().nullable(),
  lockMapped: z.boolean(),
  // Contact and token stay server-only. Only configuration status and a masked
  // marker leave this reader; the private revision detects rotation mid-review.
  cleanerRecipients: z.array(cleanerReminderRecipientSchema.strict()).max(200),
  bookings: z.array(z.object({ id: z.uuid(), property_id: z.literal('65_calderwood'),
    check_in: z.iso.date(), check_out: z.iso.date(), status: z.string(), guest_name: text }).strict()).max(5000),
}).strict();
export type PreparationRenderInputs = z.infer<typeof snapshot>;

/** Private server input. No credential, name, or credential digest leaves this module. */
export function parsePreparationRenderInputs(value: unknown, stays: readonly GuestyHandoffStay[]) {
  const parsed = snapshot.safeParse(value);
  if (!parsed.success) throw Error('Message render inputs unavailable');
  const input = parsed.data;
  if (new Set(input.bookings.map(b => b.id)).size !== input.bookings.length) throw Error('Ambiguous render inputs');
  for (const s of stays) {
    const b = input.bookings.find(b => b.id === s.canonicalId);
    if (!b || !['confirmed', 'completed'].includes(b.status) || b.check_in !== s.start || b.check_out !== s.end)
      throw Error('Message render identity changed');
  }
  // Exclude unrelated/historical records before comparison or rendering.
  return { ...input, bookings: input.bookings.filter(b => stays.some(s => s.canonicalId === b.id)).sort((a, b) => a.id.localeCompare(b.id)) };
}

/** Guesty's observed English date form, scoped to the migrated six templates.
 * Generic Helm long-date fields keep their existing format. */
export function formatGuestyMessageDate(value: string) {
  if (!z.iso.date().safeParse(value).success) throw Error('Invalid message date');
  const date = new Date(value + 'T12:00:00Z');
  if (date.toISOString().slice(0, 10) !== value) throw Error('Invalid message date');
  const n = date.getUTCDate(), last = n % 100;
  const ordinal = last >= 11 && last <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] ?? 'th');
  const month = new Intl.DateTimeFormat('en-US', { month: 'short', timeZone: 'UTC' }).format(date);
  return `${month} ${n}${ordinal}, ${date.getUTCFullYear()}`;
}
const present = (value: string | null | undefined) => Boolean(value?.trim());

/** Presence is useful to an operator, but never a delivery/access attestation. */
export function reviewPreparationInputs(input: PreparationRenderInputs) {
  const covering = input.cleanerRecipients.filter(r => r.property_ids.includes('65_calderwood')
    || (r.property_ids.length === 0 && r.region === 'bridgeport_ct'));
  const enabled = covering.filter(r => r.enabled);
  return {
    entryCode: input.lockMapped ? 'stay_code_review' as const
      : present(input.access?.smart_lock_code) ? 'stored' as const : 'missing' as const,
    wifiName: present(input.property.wifi_name), wifiPassword: present(input.access?.wifi_password),
    cleaner: { configuredRecipients: covering.length, enabledRecipients: enabled.length,
      status: covering.length === 0 ? 'not_configured' as const : enabled.length === 0 ? 'disabled' as const
        : enabled.length > 1 ? 'multiple_recipients' as const : 'access_review' as const,
      scheduleLinkConfigured: resolveCleanerReminderLink(input.property.id, input.cleanerRecipients) !== null,
      scheduleAccessVerified: false as const, recipientVerified: false as const },
  };
}

/** Render rehearsal only. It deliberately never constructs a sendable body:
 * guest names, Wi-Fi name/password and codes use labels before rendering.
 * Lock-mapped stay codes and cleaner-link access still require their own review. */
export function rehearsePreparedMessages(rules: readonly PreparationRule[], input: PreparationRenderInputs,
  stay: GuestyHandoffStay, clocks: SourceClocks) {
  const b = input.bookings.find(b => b.id === stay.canonicalId);
  if (!b || b.check_in !== clocks.start || b.check_out !== clocks.end) throw Error('Message render identity changed');
  const arrival = clocks.plannedArrival === null ? clocks.defaultArrival : clocks.plannedArrival;
  const departure = clocks.plannedDeparture === null ? clocks.defaultDeparture : clocks.plannedDeparture;
  const staticCode = present(input.access?.smart_lock_code);
  // A key location is not necessarily a keypad code. Do not call it verified.
  const codeForRehearsal = !input.lockMapped && staticCode;
  const ctx: MergeContext = {
    guest_first: guestNameIdentity(b.guest_name) ? '[Guest]' : null,
    property_name: input.property.name,
    check_in_long: formatGuestyMessageDate(stay.start), check_out_long: formatGuestyMessageDate(stay.end),
    door_code: codeForRehearsal ? MASK : null,
    wifi_name: present(input.property.wifi_name) ? '[Wi-Fi network]' : null,
    wifi_password: present(input.access?.wifi_password) ? MASK : null,
    cleaner_schedule_url: null,
  };
  return CALDERWOOD_MESSAGE_WORKFLOWS.map(flow => {
    const rule = rules.find(r => r.property_id === '65_calderwood' && r.key === flow.key);
    if (!rule || rule.enabled || !rule.configured_in_ota || rule.send_mode !== 'approve'
      || rule.audience !== flow.audience || rule.timezone !== 'America/New_York'
      || !preparedRulePolicy(rule)
      || templateFields(rule.body).some(f => !(MERGE_FIELDS as readonly string[]).includes(f))
      || /[{}]/.test(rule.body.replace(/\{\{\s*[a-zA-Z0-9_]+\s*\}\}/g, '')))
      return { key: flow.key, status: 'template_unavailable' as const, preview: null, missingFields: [] as string[], timeWordingReview: false, canSend: false as const };
    const rendered = renderTemplate(rule.body, withCleanerReminderLink(ctx, input.property.id, rule, input.cleanerRecipients));
    // Also redact a known value if it was accidentally repeated as literal text.
    let preview = rendered.masked;
    for (const value of [b.guest_name, b.guest_name?.trim().split(/\s+/)[0], input.property.wifi_name,
      input.access?.smart_lock_code, input.access?.key_code_location, input.access?.wifi_password,
      ...input.cleanerRecipients.flatMap(r => [r.phone, r.portal_token])]
      .filter((v): v is string => Boolean(v?.trim())).sort((a, b) => b.length - a.length))
      preview = preview.replaceAll(value.trim(), MASK);
    const timeWordingReview = (['booking_confirmed', 'pre_arrival', 'cleaner_arrival'].includes(flow.key) && arrival !== '16:00')
      || (['pre_arrival', 'pre_checkout'].includes(flow.key) && departure !== '11:00');
    return { key: flow.key, status: rendered.missing.length ? 'missing_fields' as const : 'fields_present' as const,
      preview, missingFields: rendered.missing, timeWordingReview, canSend: false as const };
  });
}
