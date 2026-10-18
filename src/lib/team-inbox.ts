/**
 * The Team inbox's filter (2026-10-18): the cleaner and contractor queues are
 * one list at /messaging/team, narrowed by ?audience=. The old routes
 * (/cleaner-messaging, /contractor-messaging) redirect here with the filter
 * set, so a link in an old text or alert still lands on the right cards.
 */
export const TEAM_INBOX = '/messaging/team';

export const TEAM_AUDIENCES = ['all', 'cleaners', 'contractors'] as const;
export type TeamAudience = (typeof TEAM_AUDIENCES)[number];

export function parseTeamAudience(value: string | string[] | undefined): TeamAudience {
  const v = Array.isArray(value) ? value[0] : value;
  return v === 'cleaners' || v === 'contractors' ? v : 'all';
}

export function teamHref(audience: TeamAudience, hash = ''): string {
  return `${TEAM_INBOX}${audience === 'all' ? '' : `?audience=${audience}`}${hash}`;
}

/** The sections that belong to the cleaners (the schedule text, "clean
 *  after?") show unless the filter is contractors only. */
export function showsCleaners(audience: TeamAudience): boolean {
  return audience !== 'contractors';
}

export function showsContractors(audience: TeamAudience): boolean {
  return audience !== 'cleaners';
}
