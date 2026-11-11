import { record } from './primitives.ts';
import { normalizeAirbnbBookingRevision, parseAirbnbBookingRevision,
  type AirbnbBookingMapping, type AirbnbBookingRevision } from './revision.ts';

const maskedFields = new Set(['mail', 'phone', 'address', 'city', 'state', 'zip', 'country', 'notes']);

/** Compare an exact revision to the retained pre-ACK projection. A successful
 * comparison alone is not an ACK: only the provider's explicit status is.
 * The temporary substitution never changes either input or grants send authority.
 */
export function compareAirbnbRevisionObservation(raw: unknown, retained: AirbnbBookingRevision,
  mapping: AirbnbBookingMapping): boolean {
  try {
    const expected = parseAirbnbBookingRevision(retained);
    const row = record(structuredClone(raw)), a = record(row.attributes), customer = record(a.customer);
    if (row.type !== 'booking_revision') throw Error();
    const acknowledged = a.acknowledge_status === 'acknowledged';
    for (const [field, saved] of Object.entries(expected.guestDetails)) {
      const container = field === 'notes' ? a : customer;
      if (container[field] !== '***') continue;
      if (!acknowledged || !maskedFields.has(field) || saved === null) throw Error();
      container[field] = saved;
    }
    const current = normalizeAirbnbBookingRevision(row, mapping);
    if (JSON.stringify(current) !== JSON.stringify(expected)) throw Error();
    return acknowledged;
  } catch { throw Error('Channex revision observation does not match retained data'); }
}
