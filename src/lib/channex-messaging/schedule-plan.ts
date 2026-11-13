import 'server-only';
import { z } from 'zod';
import { preparedRulePolicy, type PreparationRule } from './preparation-rules.ts';
import { calderwoodTimeWordingNeedsReview, reviewCalderwoodTiming, type SourceClocks } from './preparation-timing.ts';

// No bodies, destinations, credentials, error text or approval notes are read.
export const MESSAGE_SCHEDULE_LEDGER_FIELDS = 'id,booking_id,property_id,automation_id,automation_key,fire_at,status,planned_check_in,planned_check_out,sent_at,provider_message_id';
const instant = z.iso.datetime({ offset: true });
const ledgerRow = z.object({
  id: z.uuid(), booking_id: z.uuid(), property_id: z.literal('65_calderwood'),
  automation_id: z.uuid().nullable(), automation_key: z.string().min(1).max(80).nullable(),
  fire_at: instant, status: z.enum(['scheduled', 'sending', 'awaiting_approval', 'sent',
    'skipped_no_contact', 'skipped_channel', 'skipped_cancelled', 'skipped_dates_moved',
    'configured_in_ota', 'failed', 'cancelled']),
  planned_check_in: z.iso.date(), planned_check_out: z.iso.date(),
  sent_at: instant.nullable(), provider_message_id: z.string().min(1).max(500).nullable(),
}).strict();
export type ScheduleLedgerRow = z.infer<typeof ledgerRow>;
export function parseScheduleLedger(value: unknown): ScheduleLedgerRow[] {
  const result = z.array(ledgerRow).max(5000).safeParse(value);
  if (!result.success || new Set(result.data.map(r => r.id)).size !== result.data.length
    || result.data.some(r => r.planned_check_in >= r.planned_check_out)) throw Error('Message schedule history unavailable');
  return result.data.sort((a, b) => a.id.localeCompare(b.id));
}

export type ScheduleState = 'future_candidate' | 'past_not_replayed' | 'template_review'
  | 'timing_review' | 'wording_review' | 'dst_review' | 'stay_inactive' | 'already_sent' | 'delivery_uncertain'
  | 'history_conflict' | 'held' | 'existing_schedule' | 'schedule_changed';
export const SCHEDULE_STATE_LABELS: Record<ScheduleState, string> = {
  future_candidate: 'Future time calculated · not queued',
  past_not_replayed: 'Past or due · never added as a new send',
  template_review: 'Prepared template needs review',
  timing_review: 'Source time needs verification',
  wording_review: 'Message wording conflicts with the stay time · review required',
  dst_review: 'Daylight-saving time needs verification',
  stay_inactive: 'Stay cancelled or superseded · no new send',
  already_sent: 'Already recorded as sent · never recreated',
  delivery_uncertain: 'Delivery may have started · no automatic retry',
  history_conflict: 'Conflicting message history · no new send',
  held: 'Existing hold or decision preserved',
  existing_schedule: 'Existing schedule retained · no second message',
  schedule_changed: 'Existing schedule needs review for changed dates or time',
};

/** Deterministic scheduling core for the migration. Identity is per stay + workflow,
 * never per rule row: replacing a rule must not recreate a sent/uncertain message.
 * This release runs it in review only. Persisting jobs and enabling dispatch still
 * require the source handover and an atomic store adapter; a result grants neither. */
export function planCalderwoodSchedule(input: {
  stay: { canonicalId: string; status: string; duplicateOf: string | null; clocks: SourceClocks };
  rules: readonly PreparationRule[]; ledger: readonly ScheduleLedgerRow[]; now: number;
}) {
  const { stay, rules, ledger, now } = input;
  if (!z.uuid().safeParse(stay.canonicalId).success) throw Error('Invalid message stay');
  const timings = reviewCalderwoodTiming(stay.clocks, now);
  const history = ledger.filter(r => r.booking_id === stay.canonicalId);
  const resolvedKey = (h: ScheduleLedgerRow) => h.automation_key ?? rules.find(r => r.id === h.automation_id)?.key ?? null;
  return timings.map(t => {
    const matchingRules = rules.filter(r => r.property_id === '65_calderwood' && r.key === t.key);
    const rule = matchingRules.length === 1 ? matchingRules[0] : null;
    // A deleted rule with a missing key cannot be safely attributed to a workflow.
    const unattributed = history.some(h => resolvedKey(h) === null || (h.automation_key !== null
      && rules.some(r => r.id === h.automation_id && r.key !== h.automation_key)));
    const matches = history.filter(h => resolvedKey(h) === t.key || (rule && h.automation_id === rule.id));
    const existing = matches[0];
    let state: ScheduleState;
    if (stay.status !== 'confirmed' || stay.duplicateOf !== null) state = 'stay_inactive';
    else if (unattributed || matches.length > 1 || (existing && existing.automation_key !== null && existing.automation_key !== t.key)) state = 'history_conflict';
    else if (existing?.status === 'sent' || existing?.sent_at) state = 'already_sent';
    else if (existing && (existing.status === 'sending' || existing.status === 'failed' || existing.provider_message_id)) state = 'delivery_uncertain';
    else if (existing && existing.status !== 'scheduled') state = 'held';
    else if (existing && existing.automation_id !== rule?.id) state = 'history_conflict';
    else if (!rule || !preparedRulePolicy(rule, now)) state = 'template_review';
    else if (t.status === 'dst_review') state = 'dst_review';
    else if (!t.at) state = 'timing_review';
    else if (calderwoodTimeWordingNeedsReview(t.key, stay.clocks)) state = 'wording_review';
    else if (existing) state = existing.planned_check_in === stay.clocks.start && existing.planned_check_out === stay.clocks.end
      && Date.parse(existing.fire_at) === Date.parse(t.at) ? 'existing_schedule' : 'schedule_changed';
    else state = t.status === 'future' ? 'future_candidate' : 'past_not_replayed';
    return { key: t.key, identity: `65_calderwood:${stay.canonicalId}:${t.key}`, fireAt: t.at,
      state, label: SCHEDULE_STATE_LABELS[state], canSchedule: false as const, canSend: false as const };
  });
}
