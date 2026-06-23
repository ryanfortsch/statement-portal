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

/** The lifecycle stage classification for a turnover, shared by the compact
 *  micro-rail and the live readout. Pure given `nowMs`. */
export type StageCls = 'passed' | 'good' | 'active' | 'future' | 'est';

export type Lifecycle = {
  checkedOut: boolean;
  cleanerIn: boolean;
  cleaned: boolean;
  inspected: boolean;
  ready: boolean;
  active: 'in' | 'cleaning' | 'inspected' | null;
  overdue: boolean;
  pips: StageCls[]; // 6: out, in, cleaning, cleaned, inspected, ready
  enteredAt: string | null;
  cleanedEstimated: boolean;
};

export function lifecycleOf(t: Turnover, nowMs: number, todayStr: string): Lifecycle {
  const cs = t.cleaningSession;
  const checkedOut = t.previousCheckout !== null && t.previousCheckout <= todayStr;
  const cleanerIn = !!cs?.enteredAt;
  const cleaned = !!(cs?.finishedAt ?? t.cleaning);
  const inspected = t.inspectionStatus === 'complete' || t.manuallyCompleted;
  const ready = cleaned && inspected;
  const cleanedEstimated = !!cs && cs.finishSource === 'estimate' && !cleanedConfirmed(cs.finishSource);

  // Far-out turns stay calm: only "due" when same-day or check-in within ~36h.
  const target = Date.parse(`${t.checkIn.slice(0, 10)}T16:00:00`);
  const hUntil = (target - nowMs) / 3_600_000;
  const due = checkedOut && (t.isSameDayTurnover || hUntil < 36);

  let active: Lifecycle['active'] = null;
  if (!checkedOut) active = null;
  else if (!cleanerIn) active = due ? 'in' : null;
  else if (!cleaned) active = 'cleaning';
  else if (!inspected) active = due ? 'inspected' : null;

  const overdue = active !== null && target < nowMs;

  const pips: StageCls[] = [
    checkedOut ? 'passed' : 'future',
    cleanerIn ? 'good' : active === 'in' ? 'active' : 'future',
    cleaned ? 'good' : active === 'cleaning' ? 'active' : 'future',
    cleaned ? (cleanedEstimated ? 'est' : 'good') : 'future',
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
