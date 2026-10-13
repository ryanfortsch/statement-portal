/** Pure review only. No Guesty reads, queue writes, or permission to send. */
import { calderwoodMessageSchedule, type CalderwoodMessageKey, type ScheduleInput } from './message-schedule.ts';

export type HandoffEvidence = {
  reservationId: string;
  /** Opaque version covering dates, times, status and source mapping. */
  revision: string;
  observedAt: string;
  /** Complete sent history AND queue, for all applicable workflows. */
  complete: boolean;
  /** Verified stop/drain of the applicable sender, not merely a disconnect. */
  senderStoppedAt: string | null;
  messages: Partial<Record<CalderwoodMessageKey, {
    sent: boolean;
    queued: boolean;
    uncertain: boolean;
    /** Verified source expiry; missing expiry blocks a takeover candidate. */
    expiresAt?: string;
  }>>;
};
export type HandoffInput = {
  reservationId: string;
  revision: string;
  schedule: Omit<ScheduleInput, 'sent'>;
  evidence: HandoffEvidence | null;
  /** Explicit review freshness policy, not a delivery guarantee. */
  maxEvidenceAgeMs: number;
};
export type HandoffDisposition = 'suppress' | 'retain-guesty' | 'hold' | 'review' | 'candidate';

function timestamp(value: string): number {
  return /T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) ? Date.parse(value) : NaN;
}

export function calderwoodMessageHandoff(input: HandoffInput) {
  if (!input.reservationId.trim() || !input.revision.trim()
      || !Number.isFinite(input.maxEvidenceAgeMs) || input.maxEvidenceAgeMs <= 0) {
    throw new Error('Reservation, revision and positive evidence age required');
  }
  // Do not accept an unverified sent hint from the schedule as handoff evidence.
  const rows = calderwoodMessageSchedule({ ...input.schedule, sent: [] });
  const evidence = input.evidence;
  const now = input.schedule.now.getTime();
  const observed = evidence ? timestamp(evidence.observedAt) : NaN;
  const stopped = evidence?.senderStoppedAt ? timestamp(evidence.senderStoppedAt) : NaN;
  const snapshotValid = evidence !== null && evidence.reservationId === input.reservationId
    && evidence.revision === input.revision && evidence.complete
    && Number.isFinite(observed) && observed <= now && now - observed <= input.maxEvidenceAgeMs;
  const senderStopped = Number.isFinite(stopped) && stopped <= observed;

  return rows.map(row => {
    let disposition: HandoffDisposition = 'review';
    let reason = 'Current, complete, matching sent-history and queue evidence required.';
    const message = snapshotValid ? evidence!.messages[row.key] : undefined;
    if (message && !message.uncertain) {
      if (message.queued) {
        disposition = message.sent || senderStopped ? 'review' : 'retain-guesty';
        reason = message.sent ? 'Sent history and a queued copy coexist. Resolve the duplicate.'
          : senderStopped ? 'Queue remains after sender stop. Confirm removal or delivery.'
          : 'Guesty still owns this queued message. Do not create a Helm copy.';
      } else if (message.sent) {
        disposition = 'suppress';
        reason = 'Verified sent history. Do not replay.';
      } else if (row.status === 'cancelled') {
        disposition = 'suppress';
        reason = 'Cancelled stay. Do not create a message.';
      } else if (row.status === 'held') {
        disposition = 'hold';
        reason = 'Preserve the operator hold. Handoff does not release it.';
      } else if (!senderStopped) {
        reason = 'No queued copy observed, but Guesty may still schedule or send. Verify sender stop first.';
      } else if (!row.fireAt || Date.parse(row.fireAt) <= now || row.status !== 'planned') {
        reason = 'Missing, due or overdue time. Review without automatic catch-up.';
      } else if (!message.expiresAt || !Number.isFinite(timestamp(message.expiresAt))
          || timestamp(message.expiresAt) <= now
          || timestamp(message.expiresAt) <= Date.parse(row.fireAt)) {
        reason = 'Source expiry is missing, invalid or already reached before the proposed send. Review required.';
      } else {
        disposition = 'candidate';
        reason = 'Future unsent message with source sender stopped. Candidate for a separate activation review only.';
      }
    }
    return { key: row.key, fireAt: row.fireAt, expiresAt: message?.expiresAt ?? null, disposition, reason, canSend: false as const };
  });
}
