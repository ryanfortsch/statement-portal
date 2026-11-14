/** Fail closed before a reservation can supply a thread, folio or agreement. */
export function selectDisputeReservation<T extends { guesty_reservation_id?: string | null }>(
  rows: T[],
  readFailed: boolean,
): { reservation: T | null; issue: string | null } {
  if (readFailed) return { reservation: null, issue: 'the reservation (lookup failed; retry before gathering stay evidence)' };
  if (rows.length > 1) return { reservation: null, issue: 'the reservation (multiple synced records match this charge; verify the booking before gathering stay evidence)' };
  if (rows.length === 0) return { reservation: null, issue: 'the reservation (no synced Guesty row matches this charge)' };
  if (!rows[0].guesty_reservation_id?.trim()) return { reservation: null, issue: 'the reservation (the matching record has no reservation ID)' };
  return { reservation: rows[0], issue: null };
}
