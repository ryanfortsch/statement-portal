import { z } from 'zod';
import { parseCanonicalSnapshot, type CanonicalSnapshot } from './reconciliation.ts';

export const GUESTY_CALDERWOOD = '66797ba7f51d72001388bc29';
export const GUESTY_ACCOUNT = '666a36847fc6d5653142b08e';
const ident = z.string().regex(/^[a-f0-9]{24}$/);
const date = z.iso.date();
// CSV-era mirror records use synthetic IDs. Retain them for collision detection,
// but only permit a verified Guesty ObjectId to become an API destination.
const mirrorRow = z.object({ guesty_reservation_id: z.string().min(1).max(200), property_id: z.literal('65_calderwood'),
  listing_id: ident.nullable(), confirmation_code: z.string().max(160).nullable(),
  check_in: date.nullable(), check_out: date.nullable(), channel: z.string().max(80).nullable(),
  status: z.string().max(80).nullable() }).strict();
export type GuestyHandoffStay = { canonicalId: string; id: string; listingId: string; accountId: string;
  code: string; start: string; end: string; status: 'confirmed' };
export class MessageHandoffError extends Error {
  readonly code: 'IDENTITY_REVIEW_REQUIRED' | 'SOURCE_READ_FAILED' | 'SOURCES_CHANGED'
    | 'HANDOFF_READ_FAILED' | 'MESSAGE_AUTOMATIONS_ENABLED' | 'READ_LIMIT_REACHED';
  constructor(code: MessageHandoffError['code']) { super(code); this.code = code; }
}

/** The local mirror only discovers IDs. Live Guesty detail must confirm them
 * before history is read. Historical and duplicate records still make an
 * identity ambiguous; date coincidence never resolves that ambiguity. */
export function resolveMessageStayIdentities(snapshot: CanonicalSnapshot, mirror: unknown, start: string, end: string) {
  try {
    date.parse(start); date.parse(end);
    if (start >= end || Date.parse(end) - Date.parse(start) > 500 * 86400000) throw Error();
    const local = parseCanonicalSnapshot(snapshot).rows;
    const source = z.array(mirrorRow).max(5000).parse(mirror);
    if (new Set(source.map(r => r.guesty_reservation_id)).size !== source.length) throw Error();
    const active = local.filter(b => !b.duplicateOf && ['confirmed', 'completed'].includes(b.status)
      && b.checkIn < end && b.checkOut > start);
    if (active.length > 12) throw Error();
    const normalize = (s: string | null) => s?.trim().toUpperCase() || null;
    return active.map(b => {
      const key = normalize(b.code);
      const matches = source.filter(r => key && normalize(r.confirmation_code) === key);
      const canonical = local.filter(r => !r.duplicateOf && key && normalize(r.code) === key && r.status !== 'block');
      const s = matches[0];
      if (b.channel !== 'airbnb' || !key || b.holdKind || canonical.length !== 1 || matches.length !== 1
        || s.confirmation_code !== b.code || !/^[A-Za-z0-9_-]+$/.test(b.code!)
        || s.listing_id !== GUESTY_CALDERWOOD || s.channel?.toLowerCase() !== 'airbnb' || s.status !== 'confirmed'
        || s.check_in !== b.checkIn || s.check_out !== b.checkOut) throw Error();
      return { canonicalId: b.id, id: ident.parse(s.guesty_reservation_id), listingId: GUESTY_CALDERWOOD,
        accountId: GUESTY_ACCOUNT, code: b.code!, start: b.checkIn, end: b.checkOut, status: 'confirmed' as const };
    }).sort((a, b) => a.canonicalId.localeCompare(b.canonicalId));
  } catch { throw new MessageHandoffError('IDENTITY_REVIEW_REQUIRED'); }
}
