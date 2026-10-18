import type { Turnover } from '@/lib/operations';

/** Shared formatting helpers for the turnover board's opened row and its
 *  six-stage rail. Pure, no I/O. The row's words themselves are decided in
 *  lib/turnover-board.ts. */

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
