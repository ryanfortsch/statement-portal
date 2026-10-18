/**
 * The kinds of job the office sends from one form ("Send a job") and adds to
 * a trip from the packet page's Add a stop. One list, one set of words, so
 * the two doors never drift apart.
 *
 * Kept free of imports: the sync-scheduling smoke bundles the form with a
 * hand-written alias map, and every import here is one more entry there.
 */

export type JobKind = 'inspection' | 'adhoc' | 'setup';

/** The word a person reads, in the order the select lists them. */
export const JOB_KIND_LABEL: Record<JobKind, string> = {
  inspection: 'Full inspection',
  adhoc: 'One-off job',
  setup: 'Property setup',
};

/** The trades a job can be sent to. Creative has no packets, and cleaning has
 *  no tab, so a job always lands on the Inspectors or the Handymen board. */
export type JobTrade = 'inspection' | 'maintenance';

export function jobTrade(trade: string | null | undefined): JobTrade {
  return trade === 'maintenance' ? 'maintenance' : 'inspection';
}

/** A full inspection is the inspectors' walk; handymen get the task kinds. */
export function jobKindsFor(trade: JobTrade): JobKind[] {
  return trade === 'inspection' ? ['inspection', 'adhoc', 'setup'] : ['adhoc', 'setup'];
}

/** Coerce an untrusted kind (URL param, form field) to one the trade offers.
 *  Anything else is a one-off job, the form's everyday use. */
export function parseJobKind(v: string | null | undefined, trade: JobTrade): JobKind {
  const kinds = jobKindsFor(trade);
  return kinds.includes(v as JobKind) ? (v as JobKind) : 'adhoc';
}
