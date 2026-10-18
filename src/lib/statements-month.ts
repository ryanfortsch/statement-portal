import { operatingDate } from './operating-date.ts';

/**
 * The statement month as a link. /statements?month=YYYY-MM opens that
 * month; a bare /statements opens the newest one. Every door into the page
 * that knows which month it means (the home feed card, the nav pill, the
 * upload page, the close handoff board, Ask Helm) builds its link here, so
 * none of them can land the operator on a month it did not mean.
 *
 * Pure: no reads, no network. Kept free of imports beyond operatingDate so
 * client components, server routes and tests can all use it.
 */

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

/** A YYYY-MM statement month, as the URL and the period rows spell it. */
export function isStatementMonth(value: unknown): value is string {
  return typeof value === 'string' && MONTH.test(value);
}

/**
 * The month a close works on: the calendar month before today, in Eastern
 * time. Statements are written in the first days of the next month, so
 * this is what the upload page and both inputs cards default to.
 */
export function previousCalendarMonth(now: Date = new Date()): string {
  const [y, m] = operatingDate(now).split('-').map(Number);
  const prevY = m === 1 ? y - 1 : y;
  const prevM = m === 1 ? 12 : m - 1;
  return `${prevY}-${String(prevM).padStart(2, '0')}`;
}

/** /statements for a month, or the newest month when none is given. */
export function statementsHref(month?: string | null): string {
  return isStatementMonth(month) ? `/statements?month=${month}` : '/statements';
}

/** The upload page for a month (and optionally one property). */
export function statementsUploadHref(month?: string | null, propertyId?: string | null): string {
  const params = new URLSearchParams();
  if (isStatementMonth(month)) params.set('month', month);
  if (propertyId) params.set('property', propertyId);
  const q = params.toString();
  return q ? `/statements/upload?${q}` : '/statements/upload';
}
