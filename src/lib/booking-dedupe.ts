/**
 * Which `bookings` rows are the same stay, and which row speaks for it.
 *
 * The pure half of `dedupeAllBookings` in ical-sync.ts: same-stay
 * clustering, a cluster's effective status, the canonical pick and the
 * enrichment pooling. Import-free at runtime on purpose, so `npm test` can
 * exercise every rule with no bundler and no database (lib/ical's
 * placeholder-name test is injected for the same reason). The loader that
 * pages `bookings` and the writer that applies the plan stay in
 * ical-sync.ts.
 */

import type { BookingSource } from '@/lib/channels-types';

/**
 * Canonical-source priority. When the same physical stay appears in
 * `bookings` from more than one source, the highest-priority row is kept
 * canonical and the rest get `duplicate_of` pointed at it.
 *
 * direct_booking / manual are Helm-native and authoritative. ical_import is
 * the live channel truth. guesty_legacy is the frozen historical backfill
 * and always loses.
 */
const SOURCE_PRIORITY: Record<BookingSource, number> = {
  direct_booking: 5,
  manual: 4,
  ical_import: 3,
  email_parse: 2,
  guesty_legacy: 1,
};

export type DedupRow = {
  id: string;
  property_id: string;
  source: BookingSource;
  status: string;
  check_in: string;
  check_out: string;
  duplicate_of: string | null;
  created_at: string;
  cancelled_at: string | null;
  /** bookings.cancelled_by: 'ical-sync' for a feed's disappearance, an
   *  operator's email (or 'operator') for a cancel pressed in Helm. Optional
   *  so fixtures that predate it load; absent reads as not an operator's. */
  cancelled_by?: string | null;
  /** bookings.cancel_reason. 'operator_delete: ...' marks a record the
   *  operator removed (Delete), not a guest's cancellation; optional so
   *  fixtures that predate it load. */
  cancel_reason?: string | null;
  // Which channel_listings feed this row arrived on. Used to tell a direct OTA
  // feed (reliable cancel signal) apart from the Guesty aggregate feed (which
  // can transiently drop a still-confirmed reservation).
  channel_listing_id: string | null;
  // The feed's own SUMMARY on an ical_import row ("Reserved", "Blocked",
  // "Airbnb (Not available)"). Read through the injected isBlockSummary to
  // tell a hold a direct feed stored as confirmed from a stay.
  raw_summary: string | null;
  // bookings.channel. Read only for a property named in
  // strictChannelPropertyIds; optional so fixtures that predate it load.
  channel?: string | null;
  // Enrichment fields: a deduped cluster pools these onto the canonical row,
  // since no single source has all of them (Airbnb/Guesty iCal lack the guest
  // name; the guesty_legacy backfill lacks the confirmation code, etc).
  guest_name: string | null;
  guest_email: string | null;
  guest_phone: string | null;
  external_confirmation_code: string | null;
  external_booking_id: string | null;
  payout: number | null;
  gross_amount: number | null;
  num_guests: number | null;
};

const ENRICH_FIELDS = [
  'guest_name',
  'guest_email',
  'guest_phone',
  'external_confirmation_code',
  'external_booking_id',
  'payout',
  'gross_amount',
  'num_guests',
] as const;

export type DedupOptions = {
  /** True for a row that arrived on the Guesty per-listing aggregate feed,
   *  whose cancellations are not trusted; see clusterEffectiveStatus. */
  isFromAggregateFeed: (r: DedupRow) => boolean;
  /** lib/ical's placeholder test ("Reservation HM…", "Guest to be
   *  announced"), injected so this file stays import-free. */
  isPlaceholderGuestName: (name: string | null) => boolean;
  /** lib/ical's hold-keyword test over raw_summary ("Blocked", "Airbnb
   *  (Not available)", "CLOSED - Not available"), injected for the same
   *  reason. Optional, default never: every caller and test that predates
   *  it sees exactly the old plan. */
  isBlockSummary?: (raw: string | null) => boolean;
  /**
   * Properties whose date joins must never cross channels: the homes Helm
   * runs (properties.calendar_authority = 'helm'). There every row comes
   * from an independent OTA feed or from Helm itself, so a VRBO stay and an
   * Airbnb stay on the same dates are two guests, typically one freeing the
   * nights and the other taking them. Joined, the live stay became a
   * duplicate of the cancelled one and vanished from every reader that
   * filters duplicate_of (the export, the availability bridge, the booking
   * writer's overlap check), so the same nights could be sold twice. Guesty-
   * run homes keep today's joins: Guesty relabels the same stay across its
   * records often enough that a cross-channel join there is usually right.
   * Absent: no property is strict (every existing caller and test).
   *
   * Two more joins are refused on these homes, both about a live stay being
   * filed under a cancelled one on the SAME channel:
   *   - two ical_import rows from the same direct feed never date-join. One
   *     feed, two event UIDs, two events: a VRBO guest who cancels and a
   *     second who books the freed nights both arrive as a bare "Reserved"
   *     with no name and no code, and pass three used to place the live row
   *     in the cancelled one's cluster (its only candidate), so the live
   *     stay left the export, the availability bridge and the overlap check.
   *   - an ical_import row first seen after the home's cutover
   *     (cutoverAtByProperty) never date-joins a Guesty-era row: a
   *     guesty_legacy record or a row of the Guesty aggregate feed. Guesty
   *     stopped writing both at the cutover, so every one describes a
   *     reservation that existed then, and its feed twin was already on
   *     file. A row first seen later is a later booking; joined to a frozen
   *     twin whose feed row was cancelled, it was hidden the same way. (The
   *     aggregate row counts too: round three found a post-flip VRBO rebook
   *     hidden through the frozen "Reservation HA-..." row of the week's
   *     earlier guest.)
   *   - two rows Helm itself wrote (manual, direct_booking) never date-join.
   *     The booking writer refuses a second live row over the first, so two
   *     of them on the same nights are a cancelled entry and its
   *     replacement, and joined, the replacement was filed under the cancel.
   */
  strictChannelPropertyIds?: ReadonlySet<string>;
  /** properties.cutover_at per Helm-run home (see strictChannelPropertyIds). */
  cutoverAtByProperty?: ReadonlyMap<string, string>;
};

export type DedupPlan = {
  /** Every row given: null to stand canonical, else its canonical's id. */
  desired: Map<string, string | null>;
  /** Per canonical, the fields it is missing that a duplicate provides, plus
   *  a pooled booking id corrected or cleared (see bookingIdPatch); a row
   *  standing alone can carry the latter. */
  enrichPatches: Map<string, Record<string, unknown>>;
  /** Clusters of two or more rows. */
  clusters: number;
  /** Rows that came out as somebody's duplicate. */
  duplicates: number;
};

type Placeholder = DedupOptions['isPlaceholderGuestName'];

/** Whole days between two YYYY-MM-DD dates, absolute. */
function dayGap(d1: string, d2: string): number {
  const a = Date.parse(`${d1}T00:00:00Z`);
  const b = Date.parse(`${d2}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Infinity;
  return Math.abs(a - b) / 86400_000;
}

/**
 * A guest identity that actually distinguishes two rows.
 *
 * Placeholders do not: Booking.com withholds the guest name until close to
 * arrival and Guesty records "Guest to be announced" in the meantime, while
 * the iCal feeds record "Reservation <code>". Two rows both wearing a
 * placeholder tell us nothing about whether they are the same booking.
 */
function realGuestName(name: string | null, isPlaceholder: Placeholder): string | null {
  if (isPlaceholder(name)) return null;
  const t = (name ?? '').trim().toLowerCase().replace(/[^a-z]/g, '');
  return t === '' ? null : t;
}

/** True only when the two rows name DIFFERENT people. */
function conflictingGuest(a: DedupRow, b: DedupRow, isPlaceholder: Placeholder): boolean {
  const ea = normId(a.guest_email);
  const eb = normId(b.guest_email);
  if (ea && eb && ea.toLowerCase() !== eb.toLowerCase()) return true;
  const na = realGuestName(a.guest_name, isPlaceholder);
  const nb = realGuestName(b.guest_name, isPlaceholder);
  return !!(na && nb && na !== nb);
}

/**
 * Same stay, even though the external ids disagree.
 *
 * Guesty reissues a reservation id when a booking is modified, and records
 * the same Booking.com stay more than once as the guest name is revealed. The
 * old rows linger with their own ids, so `conflictingIdentity` reads them as
 * different reservations and blocks the date-based merge. The result is one
 * physical stay counted two or three times: 21 Horton showed 43 occupied
 * nights in a 31-night August.
 *
 * Requires BYTE-IDENTICAL dates, deliberately narrower than `sameStay`'s
 * one-day tolerance. Differing ids plus fuzzy dates is where a genuine pair
 * of distinct reservations would get wrongly merged; exact dates at one
 * property is a stay, not a coincidence. Verified against the whole 2026
 * book: five clusters collapse, and the only two exact-date pairs naming
 * different people are both refused.
 *
 * Pairwise only. Whether the two CLUSTERS may merge is decided by
 * `planDedupe`, which also knows what the rest of each cluster says.
 */
function sameStayDespiteIds(a: DedupRow, b: DedupRow, isPlaceholder: Placeholder): boolean {
  if (a.check_in !== b.check_in || a.check_out !== b.check_out) return false;
  return !conflictingGuest(a, b, isPlaceholder);
}

/**
 * Two bookings represent the same physical stay if their date ranges
 * overlap AND both endpoints sit within one day of each other.
 *
 * The overlap requirement is what stops two *consecutive* stays (one
 * guest's checkout day is the next guest's checkin day) from being merged.
 * The one-day endpoint tolerance absorbs the off-by-one that iCal's
 * exclusive-DTEND semantics occasionally produce across channels.
 */
function sameStay(a: DedupRow, b: DedupRow): boolean {
  const overlaps = a.check_in < b.check_out && b.check_in < a.check_out;
  if (!overlaps) return false;
  return dayGap(a.check_in, b.check_in) <= 1 && dayGap(a.check_out, b.check_out) <= 1;
}

/** Trim to null so an empty external id never matches another empty one. */
function normId(v: string | null): string | null {
  if (v == null) return null;
  const t = v.trim();
  return t === '' ? null : t;
}

/**
 * The booking id a row can vouch for: its own, written by a source that has
 * one. Null on an ical_import row whatever the column says.
 *
 * guesty_legacy rows are keyed on the Guesty reservation id (guesty-backfill
 * writes it). An iCal feed carries no reservation id and ical-sync's upsert
 * row has no external_booking_id, so any value on an ical_import row was
 * POOLED onto it by the enrichment at the bottom of planDedupe while it stood
 * canonical. A pooled id is a copy of a twin's, and it outlives the cluster
 * it was copied in: a cluster split never reverts a patch.
 *
 * 53 Rocky Neck, 2026-10-08 to 10-12, is the worked case. Monica Lashley
 * booked HMTWCKF422, cancelled it on 07-17 and rebooked the same dates on
 * 07-20 as HMSZKNJ3CD. While the clusters were fused (pre-#1568) the
 * cancelled aggregate-feed row of the first reservation was canonical and
 * took the Guesty id of the live one. #1568 told the two codes apart, but
 * pass one joined "any shared booking id, never refused", so the borrowed id
 * glued the clusters straight back together, the direct feed's trusted
 * cancel made the whole cluster cancelled, and the live stay vanished from
 * every schedule surface (they read duplicate_of is null + confirmed). 309
 * ical_import rows carried such an id on 2026-09-21.
 *
 * So a pooled id is identity for nothing. It stays enrichment, and
 * bookingIdPatch holds it to what the cluster's native rows actually carry.
 */
function nativeBookingId(r: DedupRow): string | null {
  if (r.source === 'ical_import') return null;
  return normId(r.external_booking_id);
}

/**
 * What the canonical's external_booking_id should be, as a patch, or null
 * for no change.
 *
 * A canonical that carries its own booking id (see nativeBookingId) is left
 * alone. Otherwise the column is a pooled copy and is held to the cluster:
 * it keeps its value only while some native row in the cluster carries the
 * same id, else it takes the first id a native row does carry, or is cleared
 * when there is none. Only-fill-when-empty is what let the borrowed
 * 53 Rocky Neck id outlive the fused cluster it was copied in; and a copy is
 * never taken from another pooled copy, so a stale id cannot hop between
 * iCal rows either.
 */
function bookingIdPatch(canonical: DedupRow, cluster: DedupRow[]): Record<string, unknown> | null {
  if (nativeBookingId(canonical)) return null;
  const current = normId(canonical.external_booking_id);
  const vouched: string[] = [];
  for (const r of cluster) {
    const id = nativeBookingId(r);
    if (id && !vouched.includes(id)) vouched.push(id);
  }
  if (current && vouched.includes(current)) return null;
  const want = vouched[0] ?? null;
  if (current === want) return null;
  return { external_booking_id: want };
}

/**
 * Two rows are the SAME reservation when they share a non-empty confirmation
 * code or a booking id each carries natively. This is the reliable
 * cross-source join: a single Airbnb stay arrives as a direct-feed iCal row,
 * a Guesty aggregate-feed iCal row, and a guesty_legacy row, all carrying the
 * same channel confirmation code.
 */
function shareIdentity(a: DedupRow, b: DedupRow): boolean {
  const ca = normId(a.external_confirmation_code);
  const cb = normId(b.external_confirmation_code);
  if (ca && cb && ca === cb) return true;
  const ia = nativeBookingId(a);
  const ib = nativeBookingId(b);
  return !!(ia && ib && ia === ib);
}

/**
 * Two rows are EXPLICITLY different reservations when both carry a code (or
 * both a native booking id) and they differ. Such a pair must never be
 * merged by a bare date overlap -- that's what keeps a cancel-then-rebook
 * (fresh code on the same dates) and a genuine same-date double-booking as
 * separate stays.
 */
function conflictingIdentity(a: DedupRow, b: DedupRow): boolean {
  const ca = normId(a.external_confirmation_code);
  const cb = normId(b.external_confirmation_code);
  if (ca && cb && ca !== cb) return true;
  const ia = nativeBookingId(a);
  const ib = nativeBookingId(b);
  return !!(ia && ib && ia !== ib);
}

// Positive (non-cancelled) statuses, most-live first. Used to pick a cluster's
// effective status when no trustworthy cancellation is present.
const POSITIVE_STATUS_ORDER = ['completed', 'confirmed', 'pending', 'inquiry', 'block'];

/**
 * The effective status of a same-reservation cluster.
 *
 * A cancellation only "wins" when it comes from a TRUSTED source: a direct OTA
 * feed (Airbnb's own calendar export), or a Helm-native / Guesty-API row. The
 * Guesty per-listing AGGREGATE feed is excluded -- it has been observed to drop
 * a still-confirmed reservation (the direct Airbnb feed and the Guesty API both
 * kept showing it), so an aggregate-only disappearance must not hide a real
 * stay. An unnamed Guesty record's cancel is excluded too (isUnnamedRecord):
 * it retires that record, not the stay. When nothing trustworthy says
 * cancelled, the most-live positive status present wins; a cluster of nothing
 * but untrusted cancellations is treated as cancelled because there's no
 * positive signal left.
 */
/**
 * A "cancellation" dated after the guest left is not a cancellation.
 *
 * iCal feeds drop past events as a matter of routine, and the cancel pass
 * in ical-sync marks a vanished event cancelled. That is DELIBERATE and
 * stays: the row is history, and its own comment explains why letting a
 * rolled-off past booking cancel is the established behaviour. What is new
 * is that such a row must not speak for the whole STAY.
 *
 * Before same-stay clustering got tighter, a rolled-off iCal row usually sat
 * in its own cluster and hurt nobody. Now it lands beside the Guesty rows that
 * say confirmed, and one dropped past event cancels a stay that demonstrably
 * happened. 262 rows carry a cancelled_at after their own check_out; 99 stays
 * covering 392 nights had a confirmed row and no surviving canonical because
 * of it.
 *
 * 21 Horton, 2026-08-08 to 08-22, is the worked case. Robin Tellier stayed:
 * three Guesty rows say confirmed. Two iCal rows went "cancelled" on 08-23 and
 * 08-24, the days AFTER checkout, and that killed the cluster.
 *
 * Rows with no cancelled_at keep the old behaviour and stay trusted; absence
 * of a timestamp is not evidence the cancel was late. A cancel dated on or
 * before checkout is still trusted, so a genuine cancellation of a future
 * stay is unaffected.
 */
function isPostStayCancel(r: DedupRow): boolean {
  if (!r.cancelled_at) return false;
  return r.cancelled_at.slice(0, 10) > r.check_out;
}

/**
 * A Guesty record that never named its guest: from the backfill, with no
 * channel code and no real name.
 *
 * Booking.com hands Guesty a reservation before the guest is identified.
 * Guesty records it as "Guest to be announced" with no BC- code and its own
 * reservation id, and when the guest is named a SECOND record arrives with
 * the code; the placeholder is then retired as `closed`, which the backfill
 * mirrors as cancelled when the stay is still ahead (guesty-legacy-status.ts).
 * A placeholder never followed by a named record is a booking that fell
 * through.
 *
 * The placeholder has nothing but its dates, so it clusters with the named
 * record by dates: 20 Hammond 2026-09-02 to 09-07 held two beside Carola
 * Raggl's BC-Wz2rvkB8x, and 3 Locust 2027-06-01 to 06-08 one beside Gary
 * Heathcote's BC-l0PnOpEkV. Its cancel must therefore speak for its own
 * record only. Trusted, it made Gary's cluster cancelled and elected itself
 * canonical, and his live stay vanished from every schedule surface. When
 * such records are ALL a cluster has, the cluster is cancelled anyway, since
 * nothing positive is left: that is how the closed placeholders of
 * 2026-09-21 (five at 3 Locust, one at 73 Rocky Neck, booked 2025-08 to
 * 2026-07, each overlapping another guest's confirmed stay) leave the
 * double-booking list and the cleaner schedule.
 *
 * Scoped to the Guesty backfill on purpose. A direct OTA feed row is the
 * channel's own calendar, and its cancel is trusted with or without a code.
 */
function isUnnamedRecord(r: DedupRow, isPlaceholder: Placeholder): boolean {
  return (
    r.source === 'guesty_legacy' &&
    normId(r.external_confirmation_code) === null &&
    realGuestName(r.guest_name, isPlaceholder) === null
  );
}

/** A row Helm itself wrote: the booking writer's own sources. */
function isHelmNative(r: DedupRow): boolean {
  return r.source === 'manual' || r.source === 'direct_booking';
}

/** A cancel an operator pressed in Helm (cancelled_by set and not the
 *  sync's). That is somebody saying this reservation is off, whichever
 *  source row they pressed it on. */
function isOperatorCancel(r: DedupRow): boolean {
  return !!r.cancelled_by && r.cancelled_by !== 'ical-sync';
}

/** A cancellation worth believing: not the aggregate feed's, not a feed
 *  dropping a stay that already happened, not an unnamed record's, and not
 *  a hold's (a VRBO "Blocked" row the old sync stored as confirmed and
 *  later cancelled was never a stay, so its cancel says nothing about one). */
function isTrustedCancel(
  r: DedupRow,
  isFromAggregateFeed: (r: DedupRow) => boolean,
  isPlaceholder: Placeholder,
  isBlockLike: (r: DedupRow) => boolean,
  helmRun = false,
): boolean {
  return (
    r.status === 'cancelled' &&
    // Delete on a record is the operator removing a row (a typed duplicate
    // of a stay the feed also carries, say), never the guest cancelling:
    // trusted, deleting a hand-typed Airbnb twin cancelled the real stay.
    !String(r.cancel_reason ?? '').startsWith('operator_delete:') &&
    // An aggregate-feed disappearance is not believed; on a Helm-run home an
    // operator's cancel of that same row is. There the aggregate row is often
    // the canonical of a Guesty-era stay, the one the hub links to, and one
    // cancel has to take. A Guesty-run home is unchanged: Guesty is still
    // the authority there, and a cancel typed only in Helm is not.
    (!isFromAggregateFeed(r) || (helmRun && isOperatorCancel(r))) &&
    !isPostStayCancel(r) &&
    !isUnnamedRecord(r, isPlaceholder) &&
    !isBlockLike(r)
  );
}

function clusterEffectiveStatus(cluster: DedupRow[], trusted: (r: DedupRow) => boolean): string {
  const trustedCancel = cluster.some(trusted);
  if (trustedCancel) return 'cancelled';
  for (const s of POSITIVE_STATUS_ORDER) {
    if (cluster.some((r) => r.status === s)) return s;
  }
  return 'cancelled';
}

/**
 * Pick the canonical row of a cluster. It must carry the cluster's effective
 * status so downstream reads (which filter on status) see the right thing
 * without us mutating any source row: prefer rows whose status equals the
 * effective status, then a real booking over a block, then (on a Helm-run
 * home only) a row something still updates over a frozen Guesty-era one,
 * then higher source priority, then the earliest-created row.
 *
 * `frozen` is that Helm-run rule. After the flip nothing updates a
 * guesty_legacy row or a row of the retired aggregate feed, and the
 * aggregate row, an ical_import row like the direct feed's, used to win the
 * created_at tie (it was first seen months earlier). An Airbnb guest who
 * then extended in place moved only the direct row, which sat as a
 * duplicate: the extra nights were free on staycapeann.com, never sent to
 * VRBO or Booking.com, and open to the booking writer.
 */
function pickCanonical(cluster: DedupRow[], effectiveStatus: string, frozen: (r: DedupRow) => boolean = () => false): DedupRow {
  return [...cluster].sort((a, b) => {
    const aMatch = a.status === effectiveStatus ? 0 : 1;
    const bMatch = b.status === effectiveStatus ? 0 : 1;
    if (aMatch !== bMatch) return aMatch - bMatch;           // effective-status first
    const aBlock = a.status === 'block' ? 1 : 0;
    const bBlock = b.status === 'block' ? 1 : 0;
    if (aBlock !== bBlock) return aBlock - bBlock;            // non-block first
    const aFrozen = frozen(a) ? 1 : 0;
    const bFrozen = frozen(b) ? 1 : 0;
    if (aFrozen !== bFrozen) return aFrozen - bFrozen;        // live over frozen (Helm-run only)
    const ap = SOURCE_PRIORITY[a.source] ?? 0;
    const bp = SOURCE_PRIORITY[b.source] ?? 0;
    if (ap !== bp) return bp - ap;                           // higher priority first
    return a.created_at.localeCompare(b.created_at);         // earliest first
  })[0];
}

/** Both sides know something, and none of it agrees. */
function disjoint(a: Set<string> | undefined, b: Set<string> | undefined): boolean {
  if (!a?.size || !b?.size) return false;
  for (const v of a) if (b.has(v)) return false;
  return true;
}

/** Nights shared by two [check_in, check_out) ranges. 0 when they only touch. */
function overlapNights(a: DedupRow, b: DedupRow): number {
  const start = a.check_in > b.check_in ? a.check_in : b.check_in;
  const end = a.check_out < b.check_out ? a.check_out : b.check_out;
  if (end <= start) return 0;
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000);
}

/**
 * True when the union of the covers' nights includes every night of the
 * target. A sweep over the covers by check-in: each one that starts on or
 * before the uncovered edge pushes the edge to its check-out; the first
 * that starts after the edge means a night nobody covers.
 */
function nightsCovered(target: DedupRow, covers: DedupRow[]): boolean {
  const sorted = [...covers].sort((a, b) => a.check_in.localeCompare(b.check_in));
  let edge = target.check_in;
  for (const c of sorted) {
    if (c.check_in > edge) break;
    if (c.check_out > edge) edge = c.check_out;
    if (edge >= target.check_out) return true;
  }
  return edge >= target.check_out;
}

/** Statuses a canonical row must carry to cover an echo's nights. */
const COVERING_STATUSES = new Set(['confirmed', 'completed', 'block']);

/** Milliseconds between two rows' created_at, absolute. */
function createdGap(a: DedupRow, b: DedupRow): number {
  const x = Date.parse(a.created_at);
  const y = Date.parse(b.created_at);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return Infinity;
  return Math.abs(x - y);
}

/**
 * Cluster every row into stays and choose each stay's canonical.
 *
 * Union-find over same-stay pairs within a property, in three passes.
 *
 * Pass one joins rows that share a confirmation code or a native booking id
 * (an ical_import row's is a pooled copy and joins nothing; see
 * nativeBookingId): one reservation seen by several feeds. Never refused; a
 * code names one reservation for good.
 *
 * Pass two joins by dates, but only rows that carry EVIDENCE of which
 * reservation they are (a code or a real guest name), and only when the
 * two CLUSTERS are not already known to differ: they name different
 * people, or they carry different codes and one of them is cancelled on
 * a trusted source while the other is not. Different codes alone prove
 * nothing. Airbnb issues a fresh code when a booking is altered, and
 * 21 Horton's Robin Tellier (2026-08-08 to 08-22) is one stay under three
 * of them, all confirmed; folding those together is what stops a 31-night
 * August from showing 43 occupied nights. A trusted cancel, though, speaks
 * only for the reservation it came from, so a cancelled code next to a
 * live one is a cancel-then-rebook whoever the guest is.
 *
 * Pass three places the rows with no evidence at all (the direct Airbnb
 * feed says only "Reserved"). Such a row passes every pairwise test against
 * both sides of a cancel-then-rebook, and union-find used to carry the
 * merge across it. 20 Hammond, 2026-09-19 to 09-22: Lauren Foy cancelled on
 * 08-23, Ashley Dobransky rebooked the exact dates on 08-26, the nameless
 * rows fused the two reservations, the trusted cancel made the whole
 * cluster cancelled, and the live stay vanished from every schedule while
 * the cleaner was booked. Now an evidence-less row joins the one candidate
 * cluster that agrees with it: a cancelled row goes with the cancelled
 * reservation, a live row with the live one, and among equals the cluster
 * whose rows appeared closest in time (the direct feed and the aggregate
 * feed pick up a new booking in the same sync). With a single candidate
 * this is exactly the old merge, so a lone stay is clustered as before.
 *
 * Holds sit outside all three. A row is block-like when its status is
 * `block`, or it is an ical_import row whose raw_summary is a hold (the
 * injected isBlockSummary: "Blocked", "Airbnb (Not available)", "CLOSED -
 * Not available"), which is how a direct feed's hold looks when the old
 * sync stored it as confirmed. Block-like rows never date-join, never take
 * a pass-three placement, and their cancels are never trusted stay cancels:
 * a hold's disappearance must never cancel a stay.
 *
 * Pass four, echo suppression, runs after the canonicals are chosen. On a
 * Guesty-free home every OTA imports Helm's export, so a stay booked on
 * VRBO comes back from Airbnb's feed as "Airbnb (Not available)" on the
 * same nights: the same stay seen a second time, not a hold. A canonical
 * block-like ical_import row from a direct feed whose EVERY night is
 * covered by canonical rows of other sources or other channel_listings
 * (confirmed / completed / block) is marked duplicate_of the covering row
 * with the most shared nights, earliest created on ties. Coverage is the
 * UNION: Airbnb coalesces adjacent unavailability into one span, so one
 * "Not available" 09-01..09-10 over a VRBO stay 09-01..09-05 and a Helm
 * block 09-05..09-10 is an echo of both. Partial coverage stays canonical:
 * that is a real hold the operator set on the OTA. Echo candidates never
 * cover each other (two OTAs echoing one another would otherwise both
 * vanish), and pass four never unions clusters, so no status or
 * enrichment pooling crosses an echo. It lives here, not in a reader,
 * because the writer in ical-sync clears any duplicate_of this planner did
 * not compute.
 */
export function planDedupe(rows: DedupRow[], opts: DedupOptions): DedupPlan {
  const { isFromAggregateFeed, isPlaceholderGuestName: isPlaceholder } = opts;
  const isBlockSummary = opts.isBlockSummary ?? (() => false);
  const strictChannels: ReadonlySet<string> = opts.strictChannelPropertyIds ?? new Set();
  const cutoverAt: ReadonlyMap<string, string> = opts.cutoverAtByProperty ?? new Map();
  /** Refused on a Helm-run home even when the dates agree (DedupOptions). */
  const strictRefuses = (a: DedupRow, b: DedupRow): boolean => {
    if (!strictChannels.has(a.property_id)) return false;
    if (a.channel && b.channel && a.channel !== b.channel) return true;
    if (
      a.source === 'ical_import' &&
      b.source === 'ical_import' &&
      a.channel_listing_id != null &&
      a.channel_listing_id === b.channel_listing_id &&
      !isFromAggregateFeed(a)
    ) {
      return true;
    }
    if (isHelmNative(a) && isHelmNative(b)) return true;
    // Instants, not strings: Postgres writes "+00:00" where JS writes "Z".
    const at = Date.parse(cutoverAt.get(a.property_id) ?? '');
    if (Number.isFinite(at)) {
      const guestyEra = (r: DedupRow) => r.source === 'guesty_legacy' || isFromAggregateFeed(r);
      // A row first seen after the cutover: from a direct feed, or written
      // by Helm (a Booking.com booking typed in after the flip over a week an
      // earlier Guesty-era guest cancelled was filed under that cancel).
      const lateFeedRow = (r: DedupRow) =>
        ((r.source === 'ical_import' && !isFromAggregateFeed(r)) || isHelmNative(r)) && Date.parse(r.created_at) > at;
      if ((lateFeedRow(a) && guestyEra(b)) || (lateFeedRow(b) && guestyEra(a))) return true;
    }
    return false;
  };
  /** A hold, by status or by what the feed called it. The summary test is
   *  for direct feeds, and for the Guesty aggregate feed only on a Helm-run
   *  home: on a Guesty-run home Guesty's cancelled "Blocked by Guesty" rows
   *  cluster as they always have (read as holds there, 1,625 of them stood
   *  up as canonical rows and pushed real stays off the bookings list). */
  const isBlockLike = (r: DedupRow): boolean =>
    r.status === 'block' ||
    // A hold Helm made is a hold whatever its status: lifted, it is kept as
    // a cancelled row, and read as a stay that row date-joined the guest
    // who took the week and its trusted cancel hid them (fleet homes too).
    (isHelmNative(r) && r.channel === 'block') ||
    (r.source === 'ical_import' &&
      isBlockSummary(r.raw_summary) &&
      (!isFromAggregateFeed(r) || strictChannels.has(r.property_id)));
  /** Nothing updates it any more: a Guesty-era row on a Helm-run home. */
  const frozen = (r: DedupRow): boolean =>
    strictChannels.has(r.property_id) && (r.source === 'guesty_legacy' || isFromAggregateFeed(r));
  const trusted = (r: DedupRow): boolean =>
    isTrustedCancel(r, isFromAggregateFeed, isPlaceholder, isBlockLike, strictChannels.has(r.property_id));

  const byProperty = new Map<string, DedupRow[]>();
  for (const r of rows) {
    const list = byProperty.get(r.property_id);
    if (list) list.push(r);
    else byProperty.set(r.property_id, [r]);
  }

  const desired = new Map<string, string | null>();
  // Per-canonical field patches: fields the canonical is missing but a
  // duplicate in its cluster provides.
  const enrichPatches = new Map<string, Record<string, unknown>>();
  let clusterCount = 0;
  let dupCount = 0;

  for (const list of byProperty.values()) {
    const parent = new Map<string, string>(list.map((r) => [r.id, r.id]));
    // What each cluster knows about WHICH reservation it is, kept on the
    // root: the channel confirmation codes and the real guest names its
    // rows carry.
    const codes = new Map<string, Set<string>>();
    const names = new Map<string, Set<string>>();
    // Whether a trusted source has cancelled this cluster's reservation.
    const dead = new Map<string, boolean>();
    const hasEvidence = new Map<string, boolean>();
    for (const r of list) {
      const code = normId(r.external_confirmation_code);
      const name = realGuestName(r.guest_name, isPlaceholder);
      codes.set(r.id, new Set(code ? [code] : []));
      names.set(r.id, new Set(name ? [name] : []));
      dead.set(r.id, trusted(r));
      hasEvidence.set(r.id, !!(code || name));
    }
    const find = (x: string): string => {
      let root = x;
      while (parent.get(root) !== root) root = parent.get(root)!;
      let cur = x;
      while (parent.get(cur) !== root) {
        const next = parent.get(cur)!;
        parent.set(cur, root);
        cur = next;
      }
      return root;
    };
    const union = (x: string, y: string) => {
      const rx = find(x);
      const ry = find(y);
      if (rx === ry) return;
      parent.set(rx, ry);
      for (const c of codes.get(rx) ?? []) codes.get(ry)!.add(c);
      for (const n of names.get(rx) ?? []) names.get(ry)!.add(n);
      if (dead.get(rx)) dead.set(ry, true);
    };
    /** The two rows' clusters are known to be different reservations: they
     *  name different people, or they carry different codes and only one of
     *  them is cancelled on a trusted source. */
    const conflictingClusters = (x: string, y: string): boolean => {
      const rx = find(x);
      const ry = find(y);
      if (disjoint(names.get(rx), names.get(ry))) return true;
      return disjoint(codes.get(rx), codes.get(ry)) && dead.get(rx) !== dead.get(ry);
    };
    /** The date-based same-stay test, as one pairwise verdict. */
    const sameStayByDates = (a: DedupRow, b: DedupRow): boolean => {
      // Blocks (owner holds, and the OTA holds a direct feed stored as
      // confirmed) are distinct calendar entities; only ever fold them in
      // by a shared id, never by a bare date overlap.
      if (isBlockLike(a) || isBlockLike(b)) return false;
      // On a Helm-run home a date join never crosses channels, never pairs
      // two events of one direct feed, and never pairs a post-cutover feed
      // row with a frozen Guesty record (DedupOptions.strictChannelPropertyIds).
      if (strictRefuses(a, b)) return false;
      // Identical dates and nothing saying these are different people: one
      // stay, whatever the ids claim. Runs BEFORE conflictingIdentity,
      // because reissued Guesty ids are exactly what that guard mistakes
      // for two separate reservations.
      if (sameStayDespiteIds(a, b, isPlaceholder)) return true;
      // Don't let a date overlap merge two explicitly-different reservations.
      if (conflictingIdentity(a, b)) return false;
      // Same dates, no conflicting identity -> same stay (covers a direct-feed
      // row that lacks the channel code lining up with its Guesty twin).
      return sameStay(a, b);
    };

    // Pass one: the same reservation across sources is always one stay.
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        if (shareIdentity(list[i], list[j])) union(list[i].id, list[j].id);
      }
    }

    // Pass two: the same dates, between rows that know who they are, unless
    // their clusters say otherwise.
    for (let i = 0; i < list.length; i++) {
      if (!hasEvidence.get(list[i].id)) continue;
      for (let j = i + 1; j < list.length; j++) {
        if (!hasEvidence.get(list[j].id)) continue;
        const a = list[i];
        const b = list[j];
        if (find(a.id) === find(b.id)) continue;
        if (conflictingClusters(a.id, b.id)) continue;
        if (sameStayByDates(a, b)) union(a.id, b.id);
      }
    }

    // Pass three: rows with no evidence join the cluster that agrees with
    // them. A cluster's evidence is what its root has pooled, so a row already
    // sitting with a coded or named twin (joined by booking id in pass one)
    // is placed and skipped. Among candidates holding a twin: one whose
    // status agrees with the row, then one that knows which reservation it
    // is, then the one whose twin appeared closest in time. Repeated until
    // nothing moves, so a chain of such rows still ends up together: a
    // row's only twin may find its cluster after the row itself was visited.
    const clusterHasEvidence = (root: string): boolean =>
      (codes.get(root)?.size ?? 0) > 0 || (names.get(root)?.size ?? 0) > 0;
    const saysCancelled = (r: DedupRow): boolean => r.status === 'cancelled' && !isPostStayCancel(r);
    let moved = true;
    while (moved) {
      moved = false;
      for (const r of list) {
        if (isBlockLike(r)) continue;
        const own = find(r.id);
        if (clusterHasEvidence(own)) continue;
        const others = new Map<string, DedupRow[]>();
        for (const m of list) {
          const root = find(m.id);
          if (root === own) continue;
          const arr = others.get(root);
          if (arr) arr.push(m);
          else others.set(root, [m]);
        }
        let best: { root: string; agrees: boolean; knows: boolean; gap: number } | null = null;
        for (const [root, members] of others) {
          const twins = members.filter((m) => sameStayByDates(r, m));
          if (twins.length === 0) continue;
          const agrees =
            (clusterEffectiveStatus(members, trusted) === 'cancelled') === saysCancelled(r);
          const knows = clusterHasEvidence(root);
          const gap = Math.min(...twins.map((m) => createdGap(r, m)));
          const better =
            !best ||
            (agrees !== best.agrees ? agrees : knows !== best.knows ? knows : gap < best.gap);
          if (better) best = { root, agrees, knows, gap };
        }
        if (best) {
          union(r.id, best.root);
          moved = true;
        }
      }
    }

    const clusters = new Map<string, DedupRow[]>();
    for (const r of list) {
      const root = find(r.id);
      const c = clusters.get(root);
      if (c) c.push(r);
      else clusters.set(root, [r]);
    }

    for (const cluster of clusters.values()) {
      if (cluster.length === 1) {
        const only = cluster[0];
        desired.set(only.id, null);
        // A row standing alone has no twin to have borrowed from: an
        // ical_import row still wearing a booking id got it in a cluster it
        // has since left, and it comes off.
        const stale = bookingIdPatch(only, cluster);
        if (stale) enrichPatches.set(only.id, stale);
        continue;
      }
      clusterCount += 1;
      const effective = clusterEffectiveStatus(cluster, trusted);
      const canonical = pickCanonical(cluster, effective, frozen);
      for (const r of cluster) {
        if (r.id === canonical.id) {
          desired.set(r.id, null);
        } else {
          desired.set(r.id, canonical.id);
          dupCount += 1;
        }
      }

      // Pool enrichment fields onto the canonical: for each field the canonical
      // is missing, take the first value from a duplicate. guest_name is special
      // -- a placeholder ("Reservation HM…") counts as missing so a real name
      // from the Guesty side overwrites the iCal code. external_booking_id is
      // special the other way: held to the cluster, not just filled when empty.
      const patch: Record<string, unknown> = {};
      for (const field of ENRICH_FIELDS) {
        if (field === 'guest_name') {
          if (!isPlaceholder(canonical.guest_name)) continue;
          const donor = cluster.find((r) => r.id !== canonical.id && !isPlaceholder(r.guest_name));
          if (donor) patch.guest_name = (donor.guest_name as string).trim();
          continue;
        }
        if (field === 'external_booking_id') {
          Object.assign(patch, bookingIdPatch(canonical, cluster));
          continue;
        }
        if (canonical[field] != null) continue;
        const donor = cluster.find((r) => r.id !== canonical.id && r[field] != null);
        if (donor) patch[field] = donor[field];
      }
      if (Object.keys(patch).length > 0) {
        enrichPatches.set(canonical.id, patch);
      }
    }

    // Pass four: echo suppression (see the docblock). Live direct-feed holds
    // that came out canonical, against every other canonical that holds
    // nights and is not itself such a hold. A cancelled hold holds no nights
    // and echoes nothing; it stands as its own cancelled row.
    const canonicalRows = list.filter((r) => (desired.get(r.id) ?? null) === null);
    const echoes = canonicalRows.filter(
      (r) =>
        r.source === 'ical_import' &&
        isBlockLike(r) &&
        !isFromAggregateFeed(r) &&
        COVERING_STATUSES.has(r.status),
    );
    if (echoes.length > 0) {
      const echoIds = new Set(echoes.map((r) => r.id));
      const covers = canonicalRows.filter((c) => !echoIds.has(c.id) && COVERING_STATUSES.has(c.status));
      for (const echo of echoes) {
        // A closure echoes only what existed before it: Helm had to hold
        // the nights, export them, and the OTA had to pull, before the OTA
        // could close them. A row made later (an owner hold typed over a
        // Booking.com closure) is not its cause, and filed under it a
        // Booking.com guest vanished from the calendar and the hub.
        const echoAt = Date.parse(echo.created_at);
        const candidates = covers.filter(
          (c) =>
            (c.source !== 'ical_import' || c.channel_listing_id !== echo.channel_listing_id) &&
            overlapNights(echo, c) > 0 &&
            !(Number.isFinite(echoAt) && Date.parse(c.created_at) > echoAt),
        );
        if (candidates.length === 0 || !nightsCovered(echo, candidates)) continue;
        const target = [...candidates].sort(
          (a, b) => overlapNights(echo, b) - overlapNights(echo, a) || a.created_at.localeCompare(b.created_at),
        )[0];
        desired.set(echo.id, target.id);
        dupCount += 1;
        // Anything that had the echo as its canonical follows it, so a
        // reader following duplicate_of lands on a canonical in one hop.
        for (const r of list) {
          if (r.id !== echo.id && desired.get(r.id) === echo.id) desired.set(r.id, target.id);
        }
      }
    }
  }

  return { desired, enrichPatches, clusters: clusterCount, duplicates: dupCount };
}
