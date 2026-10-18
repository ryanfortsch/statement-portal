/**
 * What a contractor can say about an open work slip at a home they are
 * working: one set of words for the packet page's stop list and the
 * inspection stepper's review screen. Before this, the same slip had a
 * circle on the packet page that meant "I did it" and a tap on the stepper
 * that meant "it was already done", so a contractor who fixed the faucet
 * mid-walk and tapped it there was recorded as having found it fixed.
 *
 * Both rails attach the slip to the stop as a completed task; the office's
 * approval closes it either way, and the note says which it was.
 *
 * Kept free of imports: client components and both action files read it,
 * and the field smoke harnesses bundle it.
 */

export type SlipOutcome = 'done' | 'handled' | 'open';

export const SLIP_OUTCOME_LABEL: Record<SlipOutcome, string> = {
  done: 'Done on this trip',
  handled: 'Already handled',
  open: 'Still open',
};

/** One line under the choice, saying what it does. */
export const SLIP_OUTCOME_HINT: Record<SlipOutcome, string> = {
  done: 'The office closes it when they approve the trip.',
  handled: 'Found done, not done by you. The office closes it when they approve the trip.',
  open: 'It stays on the list for the next visit.',
};

/** The resolution note for a slip found already taken care of. */
export function alreadyHandledNote(name: string, extra?: string): string {
  return `Already handled by the time ${name} arrived (Field)${extra ? `: ${extra}` : ''}`;
}

/** The resolution note for a slip done during the walk, from the stepper. */
export function doneOnTripNote(name: string): string {
  return `Done on this trip by ${name} (Field)`;
}

/** The stepper's answers as three disjoint id lists, one answer per slip:
 *  Done on this trip wins over Already handled (it is the claim of work),
 *  and either wins over Still open. Blank and repeated ids drop out. */
export function slipVerdictLists(raw: { done?: string[]; handled?: string[]; open?: string[] }): {
  done: string[];
  handled: string[];
  open: string[];
} {
  const clean = (v?: string[]) => Array.from(new Set((v ?? []).map((x) => x.trim()).filter(Boolean)));
  const done = clean(raw.done);
  const handled = clean(raw.handled).filter((id) => !done.includes(id));
  const open = clean(raw.open).filter((id) => !done.includes(id) && !handled.includes(id));
  return { done, handled, open };
}
