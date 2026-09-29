import type { Booking, ChannelListing } from './channels-types';

export const CALDERWOOD_ID = '65_calderwood';
export const PROPERTY_TIMEZONE = 'America/New_York';
export type WorkspaceBooking = Pick<Booking, 'id' | 'property_id' | 'channel' | 'source' | 'external_booking_id' | 'external_confirmation_code' | 'check_in' | 'check_out' | 'status' | 'guest_name' | 'num_guests' | 'gross_amount' | 'cleaning_fee' | 'taxes' | 'payout' | 'currency' | 'duplicate_of' | 'updated_at' | 'last_seen_at'>;
export type GuestySnapshot = {
  guesty_reservation_id: string; property_id: string; guest_name: string | null;
  confirmation_code: string | null; check_in: string | null; check_out: string | null;
  channel: string | null; status: string | null; synced_at: string | null;
};
export type CalendarBlock = { property_id: string; date: string; synced_at: string | null };
export type WorkspaceFeed = Pick<ChannelListing, 'id' | 'channel' | 'is_active' | 'ical_import_enabled' | 'last_imported_at' | 'last_import_status'>;
export type WorkspaceData = {
  asOf: string; configured: boolean;
  property: { id: string; name: string; address: string | null } | null;
  bookings: WorkspaceBooking[]; guesty: GuestySnapshot[]; blocks: CalendarBlock[]; feeds: WorkspaceFeed[];
  sources: Record<'property' | 'bookings' | 'guesty' | 'blocks' | 'feeds', string | null>;
};
export type Comparison = { guesty: GuestySnapshot; booking: WorkspaceBooking | null; issues: string[] };

export function validDay(day: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(day) && Number.isFinite(Date.parse(`${day}T12:00:00Z`)) && new Date(`${day}T12:00:00Z`).toISOString().slice(0, 10) === day;
}
export function addDays(day: string, count: number): string {
  return new Date(Date.parse(`${day}T12:00:00Z`) + count * 86400000).toISOString().slice(0, 10);
}
export function localDay(iso: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: PROPERTY_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));
}
export function validInterval(start: string | null, end: string | null): boolean {
  return !!start && !!end && validDay(start) && validDay(end) && start < end;
}
export function intersects(start: string, end: string, from: string, to: string): boolean {
  return validInterval(start, end) && start < to && end > from;
}
export function canonicalBookings(rows: WorkspaceBooking[]): WorkspaceBooking[] {
  return rows.filter(b => b.property_id === CALDERWOOD_ID && !b.duplicate_of);
}
export function guestyStatus(status: string | null): string {
  const value = status?.toLowerCase();
  if (value === 'canceled' || value === 'cancelled') return 'cancelled';
  if (value === 'reserved') return 'confirmed';
  if (value && ['confirmed', 'completed', 'pending', 'inquiry'].includes(value)) return value;
  return 'unknown';
}
export function occupies(status: string): boolean {
  return ['confirmed', 'completed', 'block'].includes(status);
}

// Resolve known aliases only. Date/name similarity must never silently merge stays.
export function compareReservations(bookings: WorkspaceBooking[], snapshots: GuestySnapshot[]): Comparison[] {
  const scoped = bookings.filter(b => b.property_id === CALDERWOOD_ID);
  const byId = new Map(scoped.map(b => [b.id, b]));
  function resolve(row: WorkspaceBooking): WorkspaceBooking | null {
    const visited = new Set<string>();
    let current: WorkspaceBooking | undefined = row;
    while (current?.duplicate_of) {
      if (visited.has(current.id)) return null;
      visited.add(current.id);
      current = byId.get(current.duplicate_of);
    }
    return current ?? null;
  }
  return snapshots.filter(g => g.property_id === CALDERWOOD_ID).map(g => {
    const exact = scoped.filter(b => b.source === 'guesty_legacy' && b.external_booking_id === g.guesty_reservation_id);
    const candidates = exact.length ? exact : scoped.filter(b => !!g.confirmation_code && b.external_confirmation_code === g.confirmation_code);
    const resolved = candidates.map(resolve);
    const unique = [...new Map(resolved.filter((b): b is WorkspaceBooking => !!b).map(b => [b.id, b])).values()];
    const broken = resolved.some(b => !b);
    const booking = !broken && unique.length === 1 ? unique[0] : null;
    const issues: string[] = [];
    if (!candidates.length) issues.push('No matching Helm record');
    else if (broken) issues.push('Broken duplicate reference');
    else if (unique.length !== 1) issues.push('Ambiguous reservation match');
    if (!validInterval(g.check_in, g.check_out)) issues.push('Invalid Guesty dates');
    if (guestyStatus(g.status) === 'unknown') issues.push('Unrecognized Guesty status');
    if (booking) {
      if (booking.check_in !== g.check_in || booking.check_out !== g.check_out) issues.push('Dates differ');
      if (guestyStatus(g.status) !== 'unknown' && booking.status !== guestyStatus(g.status)) issues.push('Status differs');
    }
    return { guesty: g, booking, issues };
  });
}

export type OccupancyEvent = { id: string; start: string; end: string; label: string; kind: 'booking' | 'guesty' | 'block'; status: string; channel: string; bookingId?: string; comparisonId?: string };
export function occupancyEvents(data: WorkspaceData): OccupancyEvent[] {
  const events: OccupancyEvent[] = canonicalBookings(data.bookings).filter(b => occupies(b.status) && validInterval(b.check_in, b.check_out)).map(b => ({ id: b.id, start: b.check_in, end: b.check_out, label: b.guest_name ?? (b.status === 'block' ? 'Owner / maintenance block' : 'Guest name unavailable'), kind: 'booking', status: b.status, channel: b.channel, bookingId: b.id }));
  // Show unresolved Guesty claims as separate evidence, never as a new live booking.
  for (const c of data.sources.bookings || data.sources.guesty ? [] : compareReservations(data.bookings, data.guesty)) {
    const g = c.guesty;
    if ((!c.booking || c.issues.includes('Dates differ') || c.issues.includes('Status differs')) && occupies(guestyStatus(g.status)) && validInterval(g.check_in, g.check_out)) {
      events.push({ id: `guesty:${g.guesty_reservation_id}`, start: g.check_in!, end: g.check_out!, label: g.guest_name ?? 'Guesty reservation', kind: 'guesty', status: guestyStatus(g.status), channel: g.channel ?? 'Unknown', comparisonId: g.guesty_reservation_id });
    }
  }
  const dates = [...new Set(data.blocks.filter(b => b.property_id === CALDERWOOD_ID && validDay(b.date)).map(b => b.date))].sort();
  for (let i = 0; i < dates.length; i++) {
    const start = dates[i]; let last = start;
    while (i + 1 < dates.length && dates[i + 1] === addDays(last, 1)) last = dates[++i];
    events.push({ id: `block:${start}`, start, end: addDays(last, 1), label: 'Guesty calendar block', kind: 'block', status: 'block', channel: 'Guesty' });
  }
  return events.sort((a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id));
}

export function freshness(timestamp: string | null, asOf: string, maxHours: number): string {
  if (!timestamp) return 'Not recorded';
  const age = Date.parse(asOf) - Date.parse(timestamp);
  if (!Number.isFinite(age) || age < 0) return 'Invalid timestamp';
  return age <= maxHours * 3600000 ? 'Recent' : 'Stale';
}

// A shareable baseline is a snapshot of imported evidence, not proof of OTA parity.
export function baseline(data: WorkspaceData) {
  return {
    version: 1, capturedAt: data.asOf, property: data.property, timezone: PROPERTY_TIMEZONE,
    authority: 'Not verified by this snapshot', provenance: 'Read-only database copies; no live OTA verification',
    sourceErrors: data.sources, bookings: canonicalBookings(data.bookings), guesty: data.guesty,
    calendarBlocks: data.blocks, calendarFeeds: data.feeds,
    comparisons: data.sources.bookings || data.sources.guesty ? null : compareReservations(data.bookings, data.guesty),
    outstanding: ['Live rates and restrictions', 'Listing fees and policies', 'Outstanding balances and refunds', 'Scheduled messages and templates', 'Conversation history', 'Calendar coverage and live channel availability', 'Local cleaner and access workflow'],
  };
}
