/**
 * Personal keypad codes for Rising Tide staff: one PIN per person, programmed
 * onto every lock Seam can reach at a home we run, so a teammate's door
 * entries read as THEM instead of borrowing the cleaner's 2222 (which would
 * log every visit as a cleaning). Delaney asked for 7699 on 2026-11-04 and
 * Ryan agreed to it "across the board".
 *
 * This file is the pure half: the roster of codes and the decisions. The
 * Seam calls live in staff-codes.ts, which runs on the same daily sync as the
 * maintenance and creative PINs, so a newly connected lock picks a person's
 * code up within a day, and the property page's Sync Seam devices button
 * does it on demand.
 *
 * The digits are operator-known, like 3333 and 5555, but personal: import
 * this only from server modules (staff-codes.test.ts holds that).
 *
 * Leaving the team revokes: set the member `active: false` in team.ts and the
 * next sync deletes the code Helm programmed (never a hand-programmed one).
 */

export type StaffCode = { email: string; code: string };

export const STAFF_CODES: readonly StaffCode[] = [
  { email: 'delaney@risingtidestr.com', code: '7699' },
];

/** The fleet's PINs are all four digits (Schlage Encode wants one length per
 *  lock), no leading zero, matching the guest and Field generators. */
const PIN_SHAPE = /^[1-9]\d{3}$/;

/** "Rising Tide <short>": classifyCodeRole reads /rising tide/ as staff, so a
 *  teammate's keypad entry never lights "guest in residence". */
export function staffCodeName(shortName: string): string {
  return `Rising Tide ${shortName}`;
}

type Member = { email: string; short: string; active: boolean; starts?: string };

export type StaffCodeIntent = {
  email: string;
  code: string;
  name: string;
  /** true: the code belongs on the lock. false: revoke the one Helm made. */
  wanted: boolean;
};

/**
 * Which staff codes belong on locks today. A code that is malformed, collides
 * with a fleet PIN, or is shared by two people is dropped entirely (a shared
 * PIN makes keypad attribution ambiguous, and the lock refuses duplicates).
 * A member who has not started yet, or is no longer active, is not wanted.
 * An email missing from the roster is dropped: without a name there is no
 * code Helm can safely say it made.
 */
export function staffCodeIntents(
  codes: readonly StaffCode[],
  members: readonly Member[],
  fleetPins: readonly string[],
  todayET: string,
): StaffCodeIntent[] {
  const fleet = new Set(fleetPins.filter(Boolean));
  const counts = new Map<string, number>();
  for (const c of codes) counts.set(c.code, (counts.get(c.code) ?? 0) + 1);
  const out: StaffCodeIntent[] = [];
  for (const c of codes) {
    if (!PIN_SHAPE.test(c.code) || fleet.has(c.code) || counts.get(c.code)! > 1) continue;
    const m = members.find((x) => x.email.toLowerCase() === c.email.toLowerCase());
    if (!m) continue;
    const started = !m.starts || m.starts <= todayET;
    out.push({ email: m.email, code: c.code, name: staffCodeName(m.short), wanted: m.active && started });
  }
  return out;
}

export type LockCodeLite = { access_code_id: string; code: string | null; name?: string | null; managed: boolean };

export type StaffCodeAction =
  | { kind: 'present'; intent: StaffCodeIntent }
  | { kind: 'create'; intent: StaffCodeIntent }
  | { kind: 'revoke'; intent: StaffCodeIntent; accessCodeId: string };

/**
 * What to do on one lock. `homeActive` is false for a lock mapped to a home we
 * no longer run (4 Brier Neck): nothing is created there and Helm's own staff
 * codes come off. An unmapped lock (null) is treated as ours, the way the
 * maintenance PIN treats it. Revocation touches only a MANAGED code carrying
 * both the staff name and the PIN, so an owner's or hand-programmed code with
 * the same digits is never deleted.
 */
export function planLockStaffCodes(
  intents: readonly StaffCodeIntent[],
  lockCodes: readonly LockCodeLite[],
  homeActive: boolean | null,
): StaffCodeAction[] {
  const actions: StaffCodeAction[] = [];
  for (const intent of intents) {
    const onLock = lockCodes.filter((c) => (c.code ?? '').trim() === intent.code);
    if (intent.wanted && homeActive !== false) {
      actions.push(onLock.length ? { kind: 'present', intent } : { kind: 'create', intent });
      continue;
    }
    for (const c of onLock) {
      if (c.managed && (c.name ?? '').trim() === intent.name) {
        actions.push({ kind: 'revoke', intent, accessCodeId: c.access_code_id });
      }
    }
  }
  return actions;
}
