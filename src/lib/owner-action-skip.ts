/**
 * Which proposed owner follow-ups to file, one tick box each.
 *
 * Before 2026-10-23 one box covered the set: a roof job card for 21 Horton
 * proposed a guest notice and a calendar hold, the hold was wanted and the
 * notice was not, and the only choice was both or neither. The concierge
 * (stay-concierge #117) gives each action a stable `key` and files all but
 * the keys sent back as `skip_actions`.
 */
export type KeyedAction = { key?: string };

/** One key per action. A card from a concierge without keys falls back to
 *  positions, which are never sent: those can only be skipped all at once. */
export function actionKeys(actions: KeyedAction[]): string[] {
  return actions.map((a, i) => a.key ?? `idx-${i}`);
}

/** The ticks a card opens with: what the operator chose last time (a
 *  scheduled card, a reload), all unticked if she switched the set off. */
export function initialSkipped(
  keys: string[],
  status?: { enabled?: number; skipped?: string[] } | null,
): Set<string> {
  if (status?.enabled === 0) return new Set(keys);
  const saved = new Set(status?.skipped ?? []);
  return new Set(keys.filter((k) => saved.has(k)));
}

/** What a decision sends: file nothing only when every item is unticked,
 *  otherwise file the set minus the real keys she unticked. */
export function skipPlan(keys: string[], skipped: Set<string>): { fileActions: boolean; skipActions: string[] } {
  if (keys.length === 0) return { fileActions: true, skipActions: [] };
  const kept = keys.filter((k) => !skipped.has(k));
  if (kept.length === 0) return { fileActions: false, skipActions: [] };
  return { fileActions: true, skipActions: keys.filter((k) => skipped.has(k) && !k.startsWith('idx-')) };
}
