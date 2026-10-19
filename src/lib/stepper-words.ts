/**
 * Words on the inspection stepper's bottom bar (src/app/inspections/[id]/
 * Stepper.tsx), kept here so the rule is tested without a browser.
 */

/** The forward button says what it does: a marked card moves on (Next), an
 *  unmarked one is left for later (Skip). */
export function stepperForwardLabel(marked: boolean): 'Next →' | 'Skip →' {
  return marked ? 'Next →' : 'Skip →';
}

/** Shown once, the first time a contractor marks a card Issue on a packet
 *  walk: approving the trip is what files their issues as work orders
 *  (openWorkSlipsForInspectionIssues, run by the office's approve). */
export const ISSUE_BECOMES_WORK_ORDER = 'An Issue becomes a work order once the office approves the trip.';

/** Device memory that the line was shown (per browser, not per walk). */
export const ISSUE_HINT_SEEN_KEY = 'helm-field-issue-hint-seen';
