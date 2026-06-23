import type { Turnover } from '@/lib/operations';

/** Shared formatting helpers for the Operations turnover rows (used by the
 *  server page header + the client CompactTurnoverRow). Pure, no I/O. */

export function fieldChipLabel(fp: NonNullable<Turnover['fieldPacket']>): string {
  switch (fp.status) {
    case 'draft':
      return 'Field · drafted';
    case 'published':
      return 'Field · open for claim';
    case 'claimed':
    case 'in_progress':
      return `Field · ${fp.contractorName ?? 'claimed'}`;
    case 'submitted':
      return 'Field · submitted';
    case 'approved':
      return 'Field · done';
    default:
      return 'Field';
  }
}

export function fieldChipColor(status: string): string {
  switch (status) {
    case 'published':
      return 'var(--signal)';
    case 'claimed':
    case 'in_progress':
    case 'submitted':
      return 'var(--tide-deep)';
    case 'approved':
      return 'var(--positive)';
    default:
      return 'var(--ink-4)';
  }
}

export function formatDateLong(value: string): string {
  if (!value) return '—';
  try {
    const d = new Date(`${value.slice(0, 10)}T00:00:00`);
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  } catch {
    return value;
  }
}

export function formatDateShort(value: string): string {
  if (!value) return '—';
  try {
    const d = new Date(`${value.slice(0, 10)}T00:00:00`);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return value;
  }
}

/** Per-stage identity color for the rail pips / nodes, indexed by pip slot
 *  (0 checked out, 1 cleaner in, 2 cleaning, 3 cleaned, 4 inspected, 5 guest
 *  ready). Checkout reads blue, the cleaning trio tan / orange, inspection
 *  yellow, guest-ready green. State (done / active / future) is shown by fill
 *  vs ring vs muted; the hue is the stage's identity, so you can tell which
 *  stage a dot is by its color even on the tiny micro-rail. */
export const STAGE_HUES = [
  'var(--tide)',     // checked out: blue
  '#c0772f',         // cleaner in: tan / orange
  '#c0772f',         // cleaning: tan / orange
  '#c0772f',         // cleaned: tan / orange
  '#d6a51e',         // inspected: yellow
  'var(--positive)', // guest-ready: green
] as const;

/** The lifecycle stage classification for a turnover, shared by the compact
 *  micro-rail and the live readout. Pure given `nowMs`.
 *  'na' = a stage this property can't observe (the two lock-only middle pips
 *  on a lockless home): a quiet passthrough, not a pending or skipped stage. */
export type StageCls = 'passed' | 'good' | 'active' | 'future' | 'est' | 'na';

export type Lifecycle = {
  checkedOut: boolean;
  cleanerIn: boolean;
  cleaned: boolean;
  inspected: boolean;
  ready: boolean;
  // 'in'/'cleaning' are lock-only (monitored homes). 'clean' is the lockless
  // equivalent: due-and-not-yet-cleaned, advanced by Quo text or manual confirm.
  active: 'in' | 'cleaning' | 'clean' | 'inspected' | null;
  overdue: boolean;
  pips: StageCls[]; // 6: out, in, cleaning, cleaned, inspected, ready
  enteredAt: string | null;
  cleanedEstimated: boolean;
};

export function lifecycleOf(t: Turnover, nowMs: number, todayStr: string): Lifecycle {
  const cs = t.cleaningSession;
  const monitored = t.lockMonitored;
  const checkedOut = t.previousCheckout !== null && t.previousCheckout <= todayStr;
  // "Cleaner in" is a lock-only fact (entered_at is written only by a 2222
  // keypad unlock). On a lockless home it can never be true, so we never claim
  // it: that's what prevents the false, permanent "Awaiting cleaner" pulse.
  const cleanerIn = monitored && !!cs?.enteredAt;
  const cleaned = !!(cs?.finishedAt ?? t.cleaning);
  const inspected = t.inspectionStatus === 'complete' || t.manuallyCompleted;
  const ready = cleaned && inspected;
  const cleanedEstimated = !!cs && cs.finishSource === 'estimate' && !cleanedConfirmed(cs.finishSource);

  // Far-out turns stay calm: only "due" when same-day or check-in within ~36h.
  const target = Date.parse(`${t.checkIn.slice(0, 10)}T16:00:00`);
  const hUntil = (target - nowMs) / 3_600_000;
  const due = checkedOut && (t.isSameDayTurnover || hUntil < 36);

  // The stage we're actively waiting on. Monitored homes track the cleaner
  // physically (in -> cleaning); lockless homes can't observe entry, so they
  // wait on the clean itself ('clean'), advanced only by a Quo text or a
  // manual confirm.
  let active: Lifecycle['active'] = null;
  if (!checkedOut) active = null;
  else if (monitored) {
    if (!cleanerIn) active = due ? 'in' : null;
    else if (!cleaned) active = 'cleaning';
    else if (!inspected) active = due ? 'inspected' : null;
  } else {
    if (!cleaned) active = due ? 'clean' : null;
    else if (!inspected) active = due ? 'inspected' : null;
  }

  const overdue = active !== null && target < nowMs;

  // Always six pip slots so the columns line up down the ledger. On a lockless
  // home the two lock-only middle slots become 'na' (a quiet passthrough, not
  // a pending stage), and the active wait lands on the Cleaned pip.
  const pips: StageCls[] = monitored
    ? [
        checkedOut ? 'passed' : 'future',
        cleanerIn ? 'good' : active === 'in' ? 'active' : 'future',
        cleaned ? 'good' : active === 'cleaning' ? 'active' : 'future',
        cleaned ? (cleanedEstimated ? 'est' : 'good') : 'future',
        inspected ? 'good' : active === 'inspected' ? 'active' : 'future',
        ready ? 'good' : 'future',
      ]
    : [
        checkedOut ? 'passed' : 'future',
        'na',
        'na',
        cleaned ? 'good' : active === 'clean' ? 'active' : 'future',
        inspected ? 'good' : active === 'inspected' ? 'active' : 'future',
        ready ? 'good' : 'future',
      ];

  return {
    checkedOut,
    cleanerIn,
    cleaned,
    inspected,
    ready,
    active,
    overdue,
    pips,
    enteredAt: cs?.enteredAt ?? null,
    cleanedEstimated,
  };
}

function cleanedConfirmed(src: string | null): boolean {
  return src === 'quo' || src === 'manual';
}
