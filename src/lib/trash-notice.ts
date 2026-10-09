import { civicForProperty, cartSetOutFor, normalizeTrashDay } from './civic.ts';
import type { HelmPropertyRow } from './properties.ts';

/**
 * The 4 x 6 trash-day notice: a fridge card that nudges a guest to bring the
 * trash down to the carts and roll them out the night before pickup.
 *
 * Pure. Every sentence on the card comes from civic.ts (the city rule, which
 * nothing else may word) or from the property row (where the carts live).
 * This module only decides whether a home gets a card and assembles the two.
 *
 * A home is skipped, never guessed at: a Rockport home has no carts to roll,
 * and a Gloucester home whose street the route splits has no day until an
 * operator phones DPW and sets it on the row. A card with the wrong day puts
 * a cart at the curb for a week at $400 per occurrence (Sec. 5-66(q)).
 */
export type TrashNotice = {
  propertyId: string;
  /** Internal name: the operator index and the PDF filename. */
  propertyName: string;
  /** What the card prints: the guest-facing title, else the internal name. */
  displayName: string;
  /** Resolved collection weekday, e.g. "Friday". */
  day: string;
  /** The evening before, e.g. "Thursday". */
  outNight: string;
  outLine: string;
  /** Label fragment for the second step ("once emptied"), null when the carts are our job. */
  backWhen: string | null;
  backLine: string;
  /** Where the carts live, from properties.trash_notes (location only, by contract). */
  location: string | null;
  /** 'row' when an operator set trash_day; 'street' when the DPW list answered. */
  daySource: 'row' | 'street';
  /** We roll the carts for this home; the two steps say so. */
  cartsHandledByUs: boolean;
};

export type TrashNoticeSkip = {
  propertyId: string;
  propertyName: string;
  reason: string;
};

export type TrashNoticeResult =
  | { ok: true; notice: TrashNotice }
  | { ok: false; skip: TrashNoticeSkip };

export const DPW_PHONE = '978-325-5600';

/** The columns a notice needs. civicForProperty reads the civic four; the rest is the card. */
export const TRASH_NOTICE_COLUMNS =
  'id, name, title, address, city, trash_day, recycling_day, trash_notes, carts_handled_by_us, parking_regulations, is_active, kind';

/** The Gloucester homes the fleet-wide print page covers. */
export function isTrashNoticeHome(p: Pick<HelmPropertyRow, 'is_active' | 'kind' | 'city'>): boolean {
  return p.is_active && p.kind === 'managed' && cityOf(p.city) === 'Gloucester';
}

export function trashNoticeFor(p: HelmPropertyRow): TrashNoticeResult {
  const city = cityOf(p.city);
  if (city !== 'Gloucester') {
    return skip(p, `${city || 'This city'} has no cart rule to print. The notice is Gloucester only.`);
  }

  const civic = civicForProperty(p);
  const cartsHandledByUs = p.carts_handled_by_us === true;
  const setOut = cartSetOutFor(city, civic.trashDay, { cartsHandledByUs });
  if (!setOut) {
    return skip(
      p,
      `No collection day on file. The street is split across two published days or missing from the DPW list, so confirm the day with DPW (${DPW_PHONE}) and set it on the property.`,
    );
  }

  const location = (p.trash_notes ?? '').trim() || null;
  const rowDay = normalizeTrashDay(p.trash_day);

  return {
    ok: true,
    notice: {
      propertyId: p.id,
      propertyName: p.name,
      displayName: (p.title ?? '').trim() || p.name,
      day: setOut.day,
      outNight: setOut.outNight,
      outLine: setOut.outLine,
      backWhen: setOut.backWhen,
      backLine: setOut.backLine,
      location,
      daySource: rowDay && rowDay === setOut.day ? 'row' : 'street',
      cartsHandledByUs,
    },
  };
}

function cityOf(raw: string | null | undefined): string {
  return (raw || '').split(',')[0].trim();
}

function skip(p: HelmPropertyRow, reason: string): TrashNoticeResult {
  return { ok: false, skip: { propertyId: p.id, propertyName: p.name, reason } };
}
