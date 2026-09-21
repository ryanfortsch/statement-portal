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
  // Which channel_listings feed this row arrived on. Used to tell a direct OTA
  // feed (reliable cancel signal) apart from the Guesty aggregate feed (which
  // can transiently drop a still-confirmed reservation).
  channel_listing_id: string | null;
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

/** A cancellation worth believing: not the aggregate feed's, not a feed
 *  dropping a stay that already happened, not an unnamed record's. */
function isTrustedCancel(
  r: DedupRow,
  isFromAggregateFeed: (r: DedupRow) => boolean,
  isPlaceholder: Placeholder,
): boolean {
  return (
    r.status === 'cancelled' &&
    !isFromAggregateFeed(r) &&
    !isPostStayCancel(r) &&
    !isUnnamedRecord(r, isPlaceholder)
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
 * effective status, then a real booking over a block, then higher source
 * priority, then the earliest-created row.
 */
function pickCanonical(cluster: DedupRow[], effectiveStatus: string): DedupRow {
  return [...cluster].sort((a, b) => {
    const aMatch = a.status === effectiveStatus ? 0 : 1;
    const bMatch = b.status === effectiveStatus ? 0 : 1;
    if (aMatch !== bMatch) return aMatch - bMatch;           // effective-status first
    const aBlock = a.status === 'block' ? 1 : 0;
    const bBlock = b.status === 'block' ? 1 : 0;
    if (aBlock !== bBlock) return aBlock - bBlock;            // non-block first
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
 */
export function planDedupe(rows: DedupRow[], opts: DedupOptions): DedupPlan {
  const { isFromAggregateFeed, isPlaceholderGuestName: isPlaceholder } = opts;
  const trusted = (r: DedupRow): boolean => isTrustedCancel(r, isFromAggregateFeed, isPlaceholder);

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
      // Blocks (owner holds) are distinct calendar entities; only ever fold
      // them in by a shared id, never by a bare date overlap.
      if (a.status === 'block' || b.status === 'block') return false;
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
        if (r.status === 'block') continue;
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
      const canonical = pickCanonical(cluster, effective);
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
  }

  return { desired, enrichPatches, clusters: clusterCount, duplicates: dupCount };
}
