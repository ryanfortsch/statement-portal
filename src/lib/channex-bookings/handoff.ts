import { BookingAuditError, compareBookingCollections, parseCanonicalSnapshot,
  type CanonicalSnapshot, type RemoteBooking } from './reconciliation.ts';

/** A review manifest, never an adoption command. Reuse the full comparison's
 * validation before narrowing to current/upcoming canonical stays. Past rows
 * still participate in identity ambiguity checks. No codes or guest data leave. */
export function buildExistingStayHandoff(snapshot: CanonicalSnapshot, remote: RemoteBooking[],
  window: { start: string; end: string }) {
  const comparison = compareBookingCollections(snapshot, remote, window);
  const all = parseCanonicalSnapshot(snapshot).rows;
  const identity = (code: string | null) => code?.trim().toUpperCase() || null;
  let references = 0;
  const rows = all.filter(b => !b.duplicateOf && ['confirmed', 'completed'].includes(b.status)
    && b.checkIn < window.end && b.checkOut > window.start).map(b => {
    const key = identity(b.code);
    const candidates = b.channel === 'airbnb' && key ? remote.filter(r => identity(r.code) === key) : [];
    references += candidates.length;
    if (references > 20_000) throw new BookingAuditError('AUDIT_LIMIT_REACHED');
    const local = key ? all.filter(r => !r.duplicateOf && r.channel === 'airbnb'
      && identity(r.code) === key) : [];
    const matched = candidates[0];
    const issues = comparison.issues.filter(i => i.canonicalIds.includes(b.id)
      || (matched && i.remoteIds.includes(matched.id)));
    const state = b.channel !== 'airbnb' ? 'other_channel_requires_protection'
      : !key || local.length !== 1 || candidates.length > 1
        || (matched && matched.code !== b.code) ? 'identity_requires_review'
      : !matched ? 'awaiting_provider_booking'
      : matched.status === 'cancelled' ? 'status_requires_review'
      : matched.checkIn !== b.checkIn || matched.checkOut !== b.checkOut ? 'dates_require_review'
      : issues.length ? 'calendar_conflict_requires_review'
      : 'matched_requires_explicit_handoff';
    return { canonicalId: b.id, channel: b.channel, source: b.source, state,
      remoteIds: candidates.map(r => r.id).sort() };
  });
  return { window, currentAndUpcomingStays: rows.length,
    airbnbStays: rows.filter(r => r.channel === 'airbnb').length,
    otherChannelStays: rows.filter(r => r.channel !== 'airbnb').length,
    awaitingProviderBookings: rows.filter(r => r.state === 'awaiting_provider_booking').length,
    exactMatchesRequiringHandoff: rows.filter(r => r.state === 'matched_requires_explicit_handoff').length,
    rows, messageHistoryReviewRequired: true as const,
    readyForAutomaticImport: false as const, plannedBookingCreates: 0 as const };
}
