/** Isolated 17 Beach sandbox rules. No production booking/calendar imports. */
export const PILOTS = {
  front: { propertyId: '0767ca11-cdab-4405-8450-9216643fa97e', roomTypeId: '296b90c7-4f73-4207-881f-36bdde8e2e06', capacity: 12 },
  back: { propertyId: 'f6740c33-d499-43b3-873b-35a3df980f87', roomTypeId: '34c31cac-51ed-4043-80b5-8f280f9b0fb4', capacity: 4 },
} as const;
export type Unit = keyof typeof PILOTS;
export type Member = Unit | 'whole';
export const TEST_RATE_TITLE = 'TEST ONLY - 20-night pilot - $100 placeholder';
export const TEST_START = '2027-01-01';
export const TEST_END = '2027-05-01'; // Checkout exclusive; only occupied Jan-Apr nights.
export type Revision = {
  id: string; bookingId: string; member: Member; status: 'new' | 'modified' | 'cancelled';
  checkIn: string; checkOut: string; receivedAt: string;
};
export type Ledger = { version: 1; revisions: Revision[] };
export type Hold = { id: string; member: Member; checkIn: string; checkOut: string };
export const emptyLedger = (): Ledger => ({ version: 1, revisions: [] });

function dateMs(date: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Invalid calendar date');
  const value = Date.parse(`${date}T00:00:00Z`);
  if (!Number.isFinite(value) || new Date(value).toISOString().slice(0, 10) !== date) throw new Error('Invalid calendar date');
  return value;
}
export function nights(start: string, end: string): string[] {
  const from = dateMs(start), to = dateMs(end);
  if (to <= from || to - from > 366 * 86400000) throw new Error('Invalid or oversized date range');
  return Array.from({ length: (to - from) / 86400000 }, (_, i) => new Date(from + i * 86400000).toISOString().slice(0, 10));
}
function member(value: unknown): asserts value is Member {
  if (value !== 'front' && value !== 'back' && value !== 'whole') throw new Error('Unknown pilot member');
}
function identifier(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(value)) throw new Error('Invalid pilot identifier');
}
export function revisionTime(value: string): string {
  // Channex timestamps may omit the UTC suffix. Preserve microseconds for ordering.
  const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?Z?$/.exec(value);
  if (!match) throw new Error('Invalid revision timestamp');
  dateMs(match[1]);
  const parts = match[2].split(':').map(Number);
  if (parts[0] > 23 || parts[1] > 59 || parts[2] > 59) throw new Error('Invalid revision timestamp');
  return `${match[1]}T${match[2]}.${(match[3] ?? '').padEnd(6, '0')}Z`;
}
export function validateRevision(r: Revision): Revision {
  identifier(r.id); identifier(r.bookingId); member(r.member);
  if (!['new', 'modified', 'cancelled'].includes(r.status)) throw new Error('Unsupported revision status');
  nights(r.checkIn, r.checkOut);
  return { id: r.id, bookingId: r.bookingId, member: r.member, status: r.status, checkIn: r.checkIn, checkOut: r.checkOut, receivedAt: revisionTime(r.receivedAt) };
}
export function latestBookings(ledger: Ledger): Revision[] {
  const current = new Map<string, Revision>();
  for (const r of ledger.revisions) {
    const key = `${r.member}:${r.bookingId}`;
    if (!current.has(key) || current.get(key)!.receivedAt < r.receivedAt) current.set(key, r);
  }
  return [...current.values()];
}
export function applyRevision(ledger: Ledger, input: Revision): { ledger: Ledger; outcome: 'applied' | 'duplicate' | 'stale' } {
  const next = validateRevision(input);
  const previous = ledger.revisions.find((r) => r.id === next.id);
  if (previous) {
    if (JSON.stringify(previous) !== JSON.stringify(next)) throw new Error('Revision ID reused with different data');
    return { ledger, outcome: 'duplicate' };
  }
  const current = latestBookings(ledger).find((r) => r.member === next.member && r.bookingId === next.bookingId);
  if (current?.receivedAt === next.receivedAt) throw new Error('Ambiguous revision order; reconcile before acknowledging');
  return {
    ledger: { version: 1, revisions: [...ledger.revisions, next] },
    outcome: current && current.receivedAt > next.receivedAt ? 'stale' : 'applied',
  };
}
export function parseLedger(value: unknown): Ledger {
  if (!value || typeof value !== 'object' || !('version' in value) || value.version !== 1 || !('revisions' in value) || !Array.isArray(value.revisions)) throw new Error('Invalid staging ledger');
  let ledger = emptyLedger();
  for (const r of value.revisions) ledger = applyRevision(ledger, r).ledger;
  return ledger;
}
export function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Unexpected Channex response shape');
  return value as Record<string, unknown>;
}
export function textField(value: unknown): string {
  if (typeof value !== 'string' || !value) throw new Error('Missing Channex field');
  return value;
}
export function normalizeRevision(raw: unknown): Revision {
  const resource = record(raw), a = record(resource.attributes);
  const unit = (Object.keys(PILOTS) as Unit[]).find((u) => PILOTS[u].propertyId === a.property_id);
  if (!unit) throw new Error('Revision is outside the pilot properties');
  // Refuse real guests even if someone later attaches a channel to staging.
  if (a.ota_name !== 'Offline' || !/^HELMTEST-[A-Za-z0-9_-]+$/.test(textField(a.ota_reservation_code))) throw new Error('Non-synthetic booking found; staging import stopped');
  if (!Array.isArray(a.rooms) || a.rooms.length !== 1) throw new Error('Unmapped or multi-room revision');
  const room = record(a.rooms[0]);
  if (room.room_type_id !== PILOTS[unit].roomTypeId) throw new Error('Revision room mapping differs from pilot');
  const checkIn = textField(a.arrival_date), checkOut = textField(a.departure_date);
  if ((room.checkin_date && room.checkin_date !== checkIn) || (room.checkout_date && room.checkout_date !== checkOut)) throw new Error('Room and booking dates disagree');
  return validateRevision({ id: textField(resource.id), bookingId: textField(a.booking_id), member: unit, status: a.status as Revision['status'], checkIn, checkOut, receivedAt: textField(a.inserted_at) });
}
export type AvailabilityDay = { member: Member; date: string; availability: 0 | 1; blockers: string[] };
export function availability(ledger: Ledger, holds: Hold[], start: string, end: string, complete: Record<Member, boolean>): AvailabilityDay[] {
  for (const hold of holds) { identifier(hold.id); member(hold.member); nights(hold.checkIn, hold.checkOut); }
  const active = latestBookings(ledger).filter((r) => r.status !== 'cancelled');
  return (['whole', 'front', 'back'] as Member[]).flatMap((target) => nights(start, end).map((date) => {
    const blockers: string[] = [];
    // All three sources must be current before opening any inventory.
    if (!complete.whole || !complete.front || !complete.back) blockers.push('incomplete-source');
    if (target !== 'whole' && (date < TEST_START || date >= TEST_END)) blockers.push('outside-pilot-season');
    for (const b of [...active.map((r) => ({ ...r, id: r.bookingId })), ...holds]) {
      if ((b.member === target || b.member === 'whole' || target === 'whole') && b.checkIn <= date && date < b.checkOut) blockers.push(b.id);
    }
    return { member: target, date, availability: blockers.length ? 0 : 1, blockers };
  }));
}
export function conflicts(ledger: Ledger): Array<[string, string]> {
  const rows = latestBookings(ledger).filter((r) => r.status !== 'cancelled');
  const result: Array<[string, string]> = [];
  for (let i = 0; i < rows.length; i++) for (let j = i + 1; j < rows.length; j++) {
    const a = rows[i], b = rows[j];
    if ((a.member === b.member || a.member === 'whole' || b.member === 'whole') && a.checkIn < b.checkOut && b.checkIn < a.checkOut) result.push([a.bookingId, b.bookingId]);
  }
  return result;
}
export function syntheticScenario(): { name: string; whole: number; front: number; back: number }[] {
  let ledger = emptyLedger();
  const scenarios = [
    { id: 'whole-new', bookingId: 'whole-test', member: 'whole', status: 'new' },
    { id: 'whole-cancel', bookingId: 'whole-test', member: 'whole', status: 'cancelled' },
    { id: 'back-new', bookingId: 'back-test', member: 'back', status: 'new' },
    { id: 'front-new', bookingId: 'front-test', member: 'front', status: 'new' },
    { id: 'back-cancel', bookingId: 'back-test', member: 'back', status: 'cancelled' },
    { id: 'front-cancel', bookingId: 'front-test', member: 'front', status: 'cancelled' },
  ] as const;
  return scenarios.map((r, index) => {
    ledger = applyRevision(ledger, { ...r, checkIn: '2027-02-01', checkOut: '2027-03-01', receivedAt: `2026-09-30T12:00:0${index}Z` }).ledger;
    const days = availability(ledger, [], '2027-02-01', '2027-02-02', { whole: true, front: true, back: true });
    return { name: r.id, whole: days[0].availability, front: days[1].availability, back: days[2].availability };
  });
}
