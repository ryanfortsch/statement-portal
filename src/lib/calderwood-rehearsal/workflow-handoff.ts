/** Full-inventory synthetic review. No provider reads, writes, contacts or send authority. */
export type ReviewedSource = 'Website' | 'Manual' | 'Direct - stay cape ann' | 'other-verified' | 'unknown';
type Scope = 'channel' | 'direct' | 'website' | 'all';
export type WorkflowTemplate = { key: string; workflow: string; label: string; delivery: 'booking-channel' | 'sms' | 'email'; audience: 'guest' | 'cleaner' | 'staff'; scope: Scope };
const guestEvents = ['confirmation', 'pre_arrival', 'key_code', 'pre_checkout'] as const;
const labels = { confirmation: 'Confirmation', pre_arrival: 'Check-in instructions', key_code: 'Key code', pre_checkout: 'Checkout reminder' };
/** Local audit identifiers, never Guesty template IDs. This is the October 17 inventory. */
export const CALDERWOOD_WORKFLOW_TEMPLATES: readonly WorkflowTemplate[] = [
  ...guestEvents.map(event => ({ key: `channel.${event}`, workflow: 'Calderwood Messaging', label: labels[event], delivery: 'booking-channel' as const, audience: 'guest' as const, scope: 'channel' as const })),
  ...['advance', 'arrival'].map(event => ({ key: `cleaner.${event}`, workflow: 'Cleaning updates - Luana', label: event === 'advance' ? 'Advance reminder' : 'Arrival-day reminder', delivery: 'sms' as const, audience: 'cleaner' as const, scope: 'all' as const })),
  { key: 'staff.alteration', workflow: 'Copy of STAFF Booking Change CT', label: 'Booking alteration', delivery: 'sms', audience: 'staff', scope: 'all' },
  ...guestEvents.flatMap(event => (['sms', 'email'] as const).map(delivery => ({ key: `direct.${event}.${delivery}`, workflow: 'DIRECT BOOKING', label: labels[event], delivery, audience: 'guest' as const, scope: 'direct' as const }))),
  { key: 'agreement.email', workflow: 'Rental Agreement', label: 'Agreement attachment', delivery: 'email', audience: 'guest', scope: 'website' },
  ...['arrival_a', 'arrival_b', 'checkout_day', 'checkout_hours'].map(event => ({ key: `staff.${event}`, workflow: 'STAFF messages ONLY', label: { arrival_a: 'Arrival notice A', arrival_b: 'Arrival notice B', checkout_day: 'Prior-day checkout notice', checkout_hours: 'Checkout-day notice' }[event]!, delivery: 'sms' as const, audience: 'staff' as const, scope: 'all' as const })),
];
export type WorkflowObligation = {
  /** Verified occurrence identity; never infer an alteration occurrence from a changed date. */
  occurrence: string;
  /** Covers source/property applicability, recipient set, transport and approved content. */
  bindingRevision: string;
  recipients: readonly string[];
  fireAt: string | null;
  expiresAt: string | null;
  held: 'held' | 'clear' | 'unknown';
};
export type WorkflowEvidenceRow = {
  template: string; occurrence: string; bindingRevision: string; recipient: string;
  sent: boolean; queued: boolean; uncertain: boolean;
  senderStoppedAt: string | null;
};
export type WorkflowHandoffInput = {
  propertyId: string; reservationId: string; revision: string; source: ReviewedSource;
  status: 'confirmed' | 'cancelled' | 'unknown'; now: Date; maxEvidenceAgeMs: number;
  obligations: Readonly<Record<string, WorkflowObligation | undefined>>;
  evidence: null | { propertyId: string; reservationId: string; revision: string; source: ReviewedSource;
    observedAt: string; complete: boolean; rows: readonly WorkflowEvidenceRow[] };
};
export type WorkflowDisposition = 'review' | 'not-applicable' | 'suppress' | 'retain-guesty' | 'hold' | 'candidate';
export type WorkflowReviewRow = { template: WorkflowTemplate; disposition: WorkflowDisposition; reason: string;
  recipients: { recipient: string; disposition: WorkflowDisposition; reason: string }[]; canSend: false };
function instant(value: string | null | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(value)) return NaN;
  const day = Date.parse(value.slice(0, 10) + 'T00:00:00Z');
  return Number.isFinite(day) && new Date(day).toISOString().slice(0, 10) === value.slice(0, 10) ? Date.parse(value) : NaN;
}
function applies(scope: Scope, source: ReviewedSource) {
  if (scope === 'all') return true;
  if (scope === 'website') return source === 'Website';
  return scope === 'channel' ? source === 'other-verified' : source !== 'other-verified';
}
export function reviewCalderwoodWorkflowHandoff(input: WorkflowHandoffInput): WorkflowReviewRow[] {
  const { evidence } = input;
  const now = input.now.getTime(), observed = instant(evidence?.observedAt);
  const sourceKnown = ['Website', 'Manual', 'Direct - stay cape ann', 'other-verified'].includes(input.source);
  const identityValid = [input.propertyId, input.reservationId, input.revision].every(value => value.trim().length > 0);
  const knownKeys = new Set(CALDERWOOD_WORKFLOW_TEMPLATES.map(template => template.key));
  const catalogMatches = Object.keys(input.obligations).every(key => knownKeys.has(key)) && evidence?.rows.every(row => knownKeys.has(row.template));
  const snapshotValid = catalogMatches && identityValid && Number.isFinite(now) && Number.isFinite(input.maxEvidenceAgeMs) && input.maxEvidenceAgeMs > 0
    && evidence?.complete === true && evidence.propertyId === input.propertyId && evidence.reservationId === input.reservationId
    && evidence.revision === input.revision && evidence.source === input.source
    && Number.isFinite(observed) && observed <= now && now - observed <= input.maxEvidenceAgeMs;
  return CALDERWOOD_WORKFLOW_TEMPLATES.map(template => {
    const result = (disposition: WorkflowDisposition, reason: string, recipients: WorkflowReviewRow['recipients'] = []): WorkflowReviewRow => ({ template, disposition, reason, recipients, canSend: false });
    if (!identityValid || !Number.isFinite(now)) return result('review', 'Current stay identity and review time are required.');
    if (!sourceKnown) return result('review', 'Source mapping is unverified. Do not omit any workflow.');
    if (!applies(template.scope, input.source)) {
      if (evidence?.rows.some(row => row.template === template.key)) return result('review', 'History or queue evidence exists outside the current source scope. Reconcile the previous binding.');
      return result('not-applicable', 'Outside this verified source scope. Existing history still requires retention.');
    }
    if (!snapshotValid) return result('review', 'Complete, fresh history and queue evidence must match the property, stay, source and current revision.');
    const obligation = input.obligations[template.key];
    if (!obligation || !obligation.occurrence.trim() || !obligation.bindingRevision.trim()
      || !obligation.recipients.length || obligation.recipients.some(value => !value.trim())
      || new Set(obligation.recipients).size !== obligation.recipients.length)
      return result('review', 'Verify the occurrence, content/transport binding and complete recipient set.');
    // Extra or old bindings are not harmless: they may represent an unresolved send or queue.
    const rows = evidence!.rows.filter(row => row.template === template.key);
    if (rows.length !== obligation.recipients.length || rows.some(row => row.occurrence !== obligation.occurrence
      || row.bindingRevision !== obligation.bindingRevision || !obligation.recipients.includes(row.recipient))
      || new Set(rows.map(row => row.recipient)).size !== rows.length)
      return result('review', 'Missing, duplicate or conflicting occurrence/recipient evidence requires reconciliation.');
    const recipients = rows.map(row => {
      const decision = (disposition: WorkflowDisposition, reason: string) => ({ recipient: row.recipient, disposition, reason });
      if (typeof row.sent !== 'boolean' || typeof row.queued !== 'boolean' || row.uncertain !== false)
        return decision('review', 'The prior delivery outcome is uncertain.');
      const stopped = instant(row.senderStoppedAt), stoppedBeforeSnapshot = Number.isFinite(stopped) && stopped <= observed;
      if (row.senderStoppedAt !== null && !stoppedBeforeSnapshot) return decision('review', 'Sender-stop evidence is invalid or later than the snapshot.');
      if (row.queued) {
        if (row.sent || stoppedBeforeSnapshot || input.status !== 'confirmed' || obligation.held !== 'clear')
          return decision('review', 'A queued copy conflicts with sent, stopped, cancelled or held state. Resolve it with the current sender.');
        return decision('retain-guesty', 'Guesty owns this queued copy. Do not create another.');
      }
      if (row.sent) return decision('suppress', 'Already sent to this recipient. Preserve history and do not replay.');
      if (input.status === 'cancelled') return decision('suppress', 'Cancelled stay. Do not create this message.');
      if (input.status !== 'confirmed') return decision('review', 'The current stay is not verified as confirmed.');
      if (obligation.held === 'held') return decision('hold', 'Preserve the operator hold through the handoff.');
      if (obligation.held !== 'clear') return decision('review', 'The operator hold state is unknown.');
      if (!stoppedBeforeSnapshot) return decision('review', 'An empty queue does not prove the current sender has stopped.');
      const fireAt = instant(obligation.fireAt), expiresAt = instant(obligation.expiresAt);
      if (!Number.isFinite(fireAt) || !Number.isFinite(expiresAt) || fireAt <= now || expiresAt <= fireAt)
        return decision('review', 'Verify a future send time and later source expiry. No automatic catch-up.');
      return decision('candidate', 'Future unsent obligation with source sender drained. Separate activation review is still required.');
    });
    const dispositions = new Set(recipients.map(row => row.disposition));
    if (dispositions.size !== 1) return result('review', 'Recipient outcomes differ. Do not retry or transfer the whole message.', recipients);
    return result(recipients[0].disposition, recipients[0].reason, recipients);
  });
}
