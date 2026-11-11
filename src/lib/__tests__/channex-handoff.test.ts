import test from 'node:test';
import assert from 'node:assert/strict';
import { buildExistingStayHandoff } from '../channex-bookings/handoff.ts';
import type { CanonicalSnapshot, LocalBooking, RemoteBooking } from '../channex-bookings/reconciliation.ts';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const window = { start: '2026-11-06', end: '2028-03-20' };
const local = (n = 1, patch: Partial<LocalBooking> = {}): LocalBooking => ({ id: id(n), channel: 'airbnb',
  source: 'ical_import', status: 'confirmed', checkIn: '2026-11-06', checkOut: '2026-11-09',
  duplicateOf: null, holdKind: null, code: `CODE${n}`, ...patch });
const remote = (patch: Partial<RemoteBooking> = {}): RemoteBooking => ({ id: id(100), revisionId: id(101),
  code: 'CODE1', checkIn: '2026-11-06', checkOut: '2026-11-09', status: 'new', ...patch });
const build = (rows: LocalBooking[], provider: RemoteBooking[] = []) => buildExistingStayHandoff(
  { format: 1, propertyId: '65_calderwood', authority: 'guesty', rows }, provider, window);

test('handoff counts current/upcoming stays without history, duplicates or checkout-day stays', () => {
  const r = build([local(), local(2, { checkIn: '2026-11-01', checkOut: '2026-11-06' }),
    local(3, { duplicateOf: id(1) }), local(4, { checkIn: window.end, checkOut: '2028-03-22' }),
    local(5, { checkIn: '2026-11-04', checkOut: '2026-11-07' }), local(6, { status: 'cancelled' })]);
  assert.equal(r.currentAndUpcomingStays, 2); assert.equal(r.airbnbStays, 2);
  assert.equal(r.awaitingProviderBookings, 2); assert.equal(r.plannedBookingCreates, 0);
  assert.equal(r.readyForAutomaticImport, false); assert.equal(r.messageHistoryReviewRequired, true);
  assert.equal(JSON.stringify(r).includes('CODE'), false);
});
test('exact match still requires deliberate handoff and message-history review', () => {
  const r = build([local(), local(2, { duplicateOf: id(1), code: 'CODE1' })], [remote()]);
  assert.equal(r.rows[0].state, 'matched_requires_explicit_handoff');
  assert.equal(r.exactMatchesRequiringHandoff, 1); assert.equal(r.readyForAutomaticImport, false);
});
test('date changes and cancellations are reviewed even when provider dates move outside the horizon', () => {
  assert.equal(build([local()], [remote({ checkIn: '2029-01-01', checkOut: '2029-01-03' })]).rows[0].state, 'dates_require_review');
  assert.equal(build([local()], [remote({ status: 'cancelled' })]).rows[0].state, 'status_requires_review');
});
test('historical duplicate identities, missing codes and normalized-only matches are never auto-adopted', () => {
  const past = local(2, { code: ' code1 ', status: 'cancelled', checkIn: '2024-01-01', checkOut: '2024-01-03' });
  for (const rows of [[local(), past], [local(1, { code: null })]]) {
    assert.equal(build(rows, [remote()]).rows[0].state, 'identity_requires_review');
  }
  assert.equal(build([local()], [remote({ code: 'code1' })]).rows[0].state, 'identity_requires_review');
  assert.equal(build([local()], [remote(), remote({ id: id(102), revisionId: id(103) })]).rows[0].state, 'identity_requires_review');
});
test('independent holds and other-channel stays remain protected', () => {
  const r = build([local(), local(2, { status: 'block', holdKind: 'owner' }),
    local(3, { channel: 'vrbo' })], [remote()]);
  assert.equal(r.rows[0].state, 'calendar_conflict_requires_review');
  assert.equal(r.otherChannelStays, 1); assert.equal(r.rows[1].state, 'other_channel_requires_protection');
  assert.equal(r.currentAndUpcomingStays, 2);
});
test('handoff rejects broken canonical graphs, bad windows and untrusted extra fields', () => {
  assert.throws(() => build([local(1, { duplicateOf: id(999) })]));
  assert.throws(() => build([local()], [remote({ revisionId: 'bad' })]));
  assert.throws(() => build([{ ...local(), guest_name: 'PRIVATE_SENTINEL' } as LocalBooking]));
  const s: CanonicalSnapshot = { format: 1, propertyId: '65_calderwood', authority: 'guesty', rows: [] };
  assert.throws(() => buildExistingStayHandoff(s, [], { start: '2026-02-30', end: window.end }));
});
test('many-to-many ambiguity stops before building an unbounded handoff manifest', () => {
  const rows = Array.from({ length: 150 }, (_, n) => local(n + 1, { code: 'COLLISION' }));
  const provider = Array.from({ length: 150 }, (_, n) => remote({ id: id(n + 1000),
    revisionId: id(n + 2000), code: 'COLLISION' }));
  assert.throws(() => build(rows, provider), /AUDIT_LIMIT_REACHED/);
});
