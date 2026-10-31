/**
 * Who may change whose name is on a walk. The dispatcher (team.ts, the
 * `dispatch` duty) names anyone and takes anyone off; everyone else names
 * themselves and takes themselves off. Pure, so plan-actions.ts and its
 * test share one rule.
 */

export const WALK_FOR_OTHERS = 'Only the dispatcher plans a walk for someone else';
export const WALK_OFF_OTHERS = 'Only the dispatcher takes someone else off a walk';

const norm = (e: string | null | undefined): string => (e ?? '').trim().toLowerCase();

/** A named person who is not the caller. Nobody named is not someone else. */
export function isSomeoneElse(me: string, who: string | null | undefined): boolean {
  const w = norm(who);
  return !!w && w !== norm(me);
}

/**
 * True when a save would name someone other than the caller, or take
 * someone other than the caller off. Leaving the name as it is, naming
 * yourself, or taking yourself off is anyone's.
 */
export function changesSomeoneElse(me: string, want: string | null | undefined, have: string | null | undefined): boolean {
  const w = norm(want);
  if (w === norm(have)) return false;
  if (w === norm(me)) return false;
  if (!w) return isSomeoneElse(me, have);
  return true;
}
