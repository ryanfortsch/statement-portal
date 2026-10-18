/**
 * Mark handled's reasons, one tap each. Short on purpose and drawn from what
 * the real bypasses were: the guest rollup reads these back against the guard
 * that suppressed an auto-send, and a long menu would fragment the counts.
 * The guest set lives with the guest card (MessagingQueue.tsx), where the
 * rollup's test reads it; the team queues say "They" for "Guest".
 */
export const TEAM_HANDLED_REASONS = ['Already answered', 'They said thanks', 'Not worth a reply'] as const;

/** A card nobody wrote in (a proactive reminder) cannot have said thanks. */
export function reasonsFor(reasons: readonly string[], proactive: boolean): readonly string[] {
  return proactive ? reasons.filter((r) => !/said thanks$/.test(r)) : reasons;
}

/** A team card the operator composed herself (a proactive reminder), not an
 *  AI draft of something they wrote: there is nothing to coach or redraft. */
export function isTeamProactive(a: { topic?: string; external_message_id?: string }): boolean {
  return a.topic === 'proactive_reminder' || /^(recurring|proactive):/.test(a.external_message_id || '');
}
